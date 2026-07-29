import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const PAYMENT_CASH = 'À Vista'
const PAYMENT_INSTALLMENTS = 'Prazo'

function getSalesCollectionRef(uid) {
  return collection(db, 'users', uid, 'sales')
}

function getProductsCollectionRef(uid) {
  return collection(db, 'users', uid, 'products')
}

function getReceivablesCollectionRef(uid) {
  return collection(db, 'users', uid, 'financeiroReceber')
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function normalizeItem(item) {
  const quantity = toNumber(item.quantity)
  const unitPrice = toNumber(item.unitPrice)
  const discount = toNumber(item.discount)
  const subtotal = quantity * unitPrice - discount

  return {
    productId: item.productId,
    productCode: item.productCode || '',
    productDescription: item.productDescription || '',
    quantity,
    unitPrice,
    discount,
    subtotal,
  }
}

function normalizeSalePayload(payload) {
  const items = (payload.items || []).map(normalizeItem)
  const totalDiscount = items.reduce((acc, item) => acc + item.discount, 0)
  const totalAmount = items.reduce((acc, item) => acc + item.subtotal, 0)

  return {
    clientId: payload.clientId,
    clientName: payload.clientName || '',
    saleDate: payload.saleDate,
    paymentMethod: payload.paymentMethod,
    installments: payload.paymentMethod === PAYMENT_INSTALLMENTS ? toNumber(payload.installments) : 1,
    firstDueDate: payload.paymentMethod === PAYMENT_INSTALLMENTS ? payload.firstDueDate || '' : '',
    dueDates: payload.paymentMethod === PAYMENT_INSTALLMENTS ? payload.dueDates || [] : [],
    items,
    totalDiscount,
    totalAmount,
  }
}

function validateSalePayload(payload) {
  if (!payload.clientId) {
    throw Object.assign(new Error('Cliente é obrigatório.'), { code: 'sales/invalid-client' })
  }

  if (!payload.saleDate) {
    throw Object.assign(new Error('Data da venda é obrigatória.'), { code: 'sales/invalid-date' })
  }

  if (!payload.items?.length) {
    throw Object.assign(new Error('A venda deve possuir ao menos um produto.'), { code: 'sales/no-items' })
  }

  for (const item of payload.items) {
    if (!item.productId) {
      throw Object.assign(new Error('Selecione um produto válido.'), { code: 'sales/invalid-product' })
    }

    if (item.quantity <= 0) {
      throw Object.assign(new Error('Quantidade deve ser maior que zero.'), { code: 'sales/invalid-quantity' })
    }

    if (item.unitPrice < 0 || item.discount < 0 || item.subtotal < 0) {
      throw Object.assign(new Error('Valores negativos não são permitidos.'), { code: 'sales/invalid-values' })
    }
  }

  if (payload.totalAmount < 0 || payload.totalDiscount < 0) {
    throw Object.assign(new Error('Valores negativos não são permitidos.'), { code: 'sales/invalid-values' })
  }

  if (payload.paymentMethod === PAYMENT_INSTALLMENTS) {
    if (!payload.installments || payload.installments <= 0) {
      throw Object.assign(new Error('Informe a quantidade de parcelas.'), { code: 'sales/invalid-installments' })
    }

    if (!payload.firstDueDate) {
      throw Object.assign(new Error('Informe o primeiro vencimento.'), { code: 'sales/invalid-due-date' })
    }
  }
}

function deriveStatus(totalAmount, paidAmount) {
  if (paidAmount <= 0) {
    return 'Pendente'
  }

  if (paidAmount >= totalAmount) {
    return 'Pago'
  }

  return 'Parcial'
}

function buildReceivablesFromSale(uid, saleId, saleData, paidAmount = 0) {
  if (saleData.paymentMethod !== PAYMENT_INSTALLMENTS || !saleData.dueDates?.length) {
    return []
  }

  let remainingPaid = paidAmount

  return saleData.dueDates.map((dueDateEntry, index) => {
    const amount = toNumber(dueDateEntry.amount)
    const receivedAmount = Math.max(0, Math.min(remainingPaid, amount))
    remainingPaid = Math.max(0, remainingPaid - amount)

    const status = receivedAmount >= amount ? 'Pago' : receivedAmount > 0 ? 'Parcial' : 'Pendente'

    return {
      ref: doc(getReceivablesCollectionRef(uid)),
      data: {
        saleId,
        clientId: saleData.clientId,
        clientName: saleData.clientName,
        installment: index + 1,
        dueDate: dueDateEntry.dueDate,
        amount,
        receivedAmount,
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    }
  })
}

async function deleteReceivablesBySaleId(uid, saleId, transaction) {
  const receivablesQuery = query(getReceivablesCollectionRef(uid), where('saleId', '==', saleId))
  const receivablesSnapshot = await transaction.get(receivablesQuery)

  receivablesSnapshot.forEach((entryDoc) => {
    transaction.delete(entryDoc.ref)
  })
}

export async function listSalesByUser(uid) {
  const salesQuery = query(getSalesCollectionRef(uid), orderBy('saleDate', 'desc'))
  const snapshot = await getDocs(salesQuery)

  return snapshot.docs.map((saleDoc) => ({
    id: saleDoc.id,
    ...saleDoc.data(),
  }))
}

export async function createSaleByUser(uid, payload) {
  const saleData = normalizeSalePayload(payload)
  validateSalePayload(saleData)

  const saleRef = doc(getSalesCollectionRef(uid))

  await runTransaction(db, async (transaction) => {
    const stockByProduct = new Map()

    for (const item of saleData.items) {
      const productRef = doc(getProductsCollectionRef(uid), item.productId)
      const productSnapshot = await transaction.get(productRef)

      if (!productSnapshot.exists()) {
        throw Object.assign(new Error('Produto selecionado não foi encontrado.'), { code: 'sales/product-not-found' })
      }

      const currentStock = toNumber(productSnapshot.data().stockQuantity)

      if (item.quantity > currentStock) {
        throw Object.assign(new Error('Estoque insuficiente para concluir a venda.'), {
          code: 'sales/insufficient-stock',
        })
      }

      stockByProduct.set(item.productId, { productRef, currentStock })
    }

    for (const item of saleData.items) {
      const productInfo = stockByProduct.get(item.productId)
      const nextStock = productInfo.currentStock - item.quantity

      transaction.update(productInfo.productRef, {
        stockQuantity: nextStock,
        updatedAt: serverTimestamp(),
      })
    }

    const paidAmount = saleData.paymentMethod === PAYMENT_CASH ? saleData.totalAmount : 0

    transaction.set(saleRef, {
      ...saleData,
      paidAmount,
      status: deriveStatus(saleData.totalAmount, paidAmount),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    const receivables = buildReceivablesFromSale(uid, saleRef.id, saleData, paidAmount)

    for (const receivable of receivables) {
      transaction.set(receivable.ref, receivable.data)
    }
  })

  return saleRef.id
}

export async function updateSaleByUser(uid, saleId, payload) {
  const saleData = normalizeSalePayload(payload)
  validateSalePayload(saleData)

  const saleRef = doc(getSalesCollectionRef(uid), saleId)

  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const previousSale = saleSnapshot.data()
    const previousItems = previousSale.items || []

    const previousQuantityByProduct = new Map()
    for (const item of previousItems) {
      const currentValue = previousQuantityByProduct.get(item.productId) || 0
      previousQuantityByProduct.set(item.productId, currentValue + toNumber(item.quantity))
    }

    const nextQuantityByProduct = new Map()
    for (const item of saleData.items) {
      const currentValue = nextQuantityByProduct.get(item.productId) || 0
      nextQuantityByProduct.set(item.productId, currentValue + toNumber(item.quantity))
    }

    const allProductIds = new Set([
      ...previousQuantityByProduct.keys(),
      ...nextQuantityByProduct.keys(),
    ])

    for (const productId of allProductIds) {
      const previousQuantity = previousQuantityByProduct.get(productId) || 0
      const nextQuantity = nextQuantityByProduct.get(productId) || 0
      const stockDelta = previousQuantity - nextQuantity

      const productRef = doc(getProductsCollectionRef(uid), productId)
      const productSnapshot = await transaction.get(productRef)

      if (!productSnapshot.exists()) {
        throw Object.assign(new Error('Produto selecionado não foi encontrado.'), { code: 'sales/product-not-found' })
      }

      const currentStock = toNumber(productSnapshot.data().stockQuantity)
      const nextStock = currentStock + stockDelta

      if (nextStock < 0) {
        throw Object.assign(new Error('Estoque insuficiente para atualizar a venda.'), {
          code: 'sales/insufficient-stock',
        })
      }

      transaction.update(productRef, {
        stockQuantity: nextStock,
        updatedAt: serverTimestamp(),
      })
    }

    const previousPaidAmount = toNumber(previousSale.paidAmount)
    const paidAmount = saleData.paymentMethod === PAYMENT_CASH
      ? saleData.totalAmount
      : Math.min(previousPaidAmount, saleData.totalAmount)

    transaction.update(saleRef, {
      ...saleData,
      paidAmount,
      status: deriveStatus(saleData.totalAmount, paidAmount),
      updatedAt: serverTimestamp(),
    })

    await deleteReceivablesBySaleId(uid, saleId, transaction)

    const receivables = buildReceivablesFromSale(uid, saleId, saleData, paidAmount)

    for (const receivable of receivables) {
      transaction.set(receivable.ref, receivable.data)
    }
  })
}

export async function deleteSaleByUser(uid, saleId) {
  const saleRef = doc(getSalesCollectionRef(uid), saleId)

  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const saleData = saleSnapshot.data()
    const saleItems = saleData.items || []

    for (const item of saleItems) {
      const productRef = doc(getProductsCollectionRef(uid), item.productId)
      const productSnapshot = await transaction.get(productRef)

      if (!productSnapshot.exists()) {
        continue
      }

      const currentStock = toNumber(productSnapshot.data().stockQuantity)
      const nextStock = currentStock + toNumber(item.quantity)

      transaction.update(productRef, {
        stockQuantity: nextStock,
        updatedAt: serverTimestamp(),
      })
    }

    await deleteReceivablesBySaleId(uid, saleId, transaction)

    transaction.delete(saleRef)
  })
}

export async function registerSalePaymentByUser(uid, saleId, paymentAmount, paymentDate) {
  const amount = toNumber(paymentAmount)

  if (amount <= 0) {
    throw Object.assign(new Error('Informe um valor de recebimento maior que zero.'), {
      code: 'sales/invalid-payment',
    })
  }

  const saleRef = doc(getSalesCollectionRef(uid), saleId)

  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const saleData = saleSnapshot.data()
    const totalAmount = toNumber(saleData.totalAmount)
    const currentPaid = toNumber(saleData.paidAmount)
    const nextPaid = Math.min(totalAmount, currentPaid + amount)

    transaction.update(saleRef, {
      paidAmount: nextPaid,
      status: deriveStatus(totalAmount, nextPaid),
      updatedAt: serverTimestamp(),
    })

    if (saleData.paymentMethod !== PAYMENT_INSTALLMENTS) {
      return
    }

    const receivablesQuery = query(
      getReceivablesCollectionRef(uid),
      where('saleId', '==', saleId),
      orderBy('installment', 'asc'),
    )

    const receivablesSnapshot = await transaction.get(receivablesQuery)

    let remainingPaid = nextPaid

    receivablesSnapshot.forEach((entryDoc) => {
      const entryData = entryDoc.data()
      const installmentAmount = toNumber(entryData.amount)
      const receivedAmount = Math.max(0, Math.min(remainingPaid, installmentAmount))
      remainingPaid = Math.max(0, remainingPaid - installmentAmount)

      const status = receivedAmount >= installmentAmount ? 'Pago' : receivedAmount > 0 ? 'Parcial' : 'Pendente'

      transaction.update(entryDoc.ref, {
        receivedAmount,
        status,
        lastPaymentDate: paymentDate || '',
        updatedAt: serverTimestamp(),
      })
    })
  })
}

export async function getSalesSummaryByUser(uid) {
  const snapshot = await getDocs(getSalesCollectionRef(uid))

  return snapshot.docs.reduce(
    (acc, saleDoc) => {
      const saleData = saleDoc.data() || {}
      const items = saleData.items || []

      acc.totalSales += 1
      acc.totalSoldValue += toNumber(saleData.totalAmount)
      acc.totalProductsSold += items.reduce((total, item) => total + toNumber(item.quantity), 0)

      return acc
    },
    {
      totalSales: 0,
      totalSoldValue: 0,
      totalProductsSold: 0,
    },
  )
}
