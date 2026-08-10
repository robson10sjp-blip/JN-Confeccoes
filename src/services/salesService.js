import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const PAYMENT_CASH = 'À Vista'
const PAYMENT_INSTALLMENTS = 'Prazo'

function ensureFirestoreReady() {
  if (!db) {
    throw Object.assign(new Error('Firestore não inicializado.'), { code: 'firestore/not-configured' })
  }
}

function ensureUser(uid) {
  if (!uid) {
    throw Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
  }
}

function getSalesCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'sales')
}

function getProductsCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'products')
}

function getReceivablesCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'financeiroReceber')
}

function getPaymentsHistoryCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'financeiroRecebimentos')
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function assertFiniteNumber(field, value) {
  if (!isFiniteNumber(value)) {
    console.error('[sales/validation] Campo numerico invalido:', {
      field,
      value,
      type: typeof value,
    })
    throw Object.assign(new Error(`Campo numerico invalido: ${field}`), {
      code: 'sales/invalid-argument',
      field,
    })
  }
}

function assertValidDateInput(paymentDate) {
  if (!paymentDate || typeof paymentDate !== 'string') {
    console.error('[sales/validation] Data de recebimento ausente ou invalida:', {
      field: 'paymentDate',
      paymentDate,
    })
    throw Object.assign(new Error('Data de recebimento é obrigatória.'), {
      code: 'sales/invalid-payment-date',
      field: 'paymentDate',
    })
  }

  const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)

  if (!isIsoDate) {
    console.error('[sales/validation] Formato de data invalido:', {
      field: 'paymentDate',
      paymentDate,
    })
    throw Object.assign(new Error('Data de recebimento inválida.'), {
      code: 'sales/invalid-payment-date',
      field: 'paymentDate',
    })
  }

  const date = new Date(`${paymentDate}T12:00:00`)

  if (Number.isNaN(date.getTime())) {
    console.error('[sales/validation] Data de recebimento nao pode ser convertida:', {
      field: 'paymentDate',
      paymentDate,
    })
    throw Object.assign(new Error('Data de recebimento inválida.'), {
      code: 'sales/invalid-payment-date',
      field: 'paymentDate',
    })
  }

  return date
}

function assertNoUndefinedFields(fieldMap, context) {
  for (const [field, value] of Object.entries(fieldMap)) {
    if (value === undefined) {
      console.error('[sales/validation] Campo undefined detectado antes de salvar:', {
        context,
        field,
        value,
      })

      throw Object.assign(new Error(`Campo obrigatório ausente: ${field}`), {
        code: 'sales/invalid-argument',
        field,
      })
    }
  }
}

function assertDocumentReference(ref, context) {
  if (!ref || typeof ref.path !== 'string' || !ref.path.trim()) {
    console.error('[sales/validation] Referencia de documento invalida:', {
      context,
      ref,
    })

    throw Object.assign(new Error(`Referencia de documento invalida: ${context}`), {
      code: 'sales/invalid-document-reference',
      context,
    })
  }
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

function resolveLegacyProductId(item) {
  if (!item || typeof item !== 'object') {
    return ''
  }

  if (typeof item.productId === 'string' && item.productId.trim()) {
    return item.productId.trim()
  }

  if (typeof item.id === 'string' && item.id.trim()) {
    return item.id.trim()
  }

  if (typeof item.product?.id === 'string' && item.product.id.trim()) {
    return item.product.id.trim()
  }

  return ''
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
  const saleReceivablesQuery = query(getReceivablesCollectionRef(uid), where('saleId', '==', saleId))
  const receivablesSnapshot = await transaction.get(saleReceivablesQuery)

  receivablesSnapshot.forEach((entryDoc) => {
    transaction.delete(entryDoc.ref)
  })
}

export async function listSalesByUser(uid) {
  const salesQuery = query(getSalesCollectionRef(uid), orderBy('saleDate', 'desc'))
  const snapshot = await getDocs(salesQuery)

  return snapshot.docs.map((saleDoc) => ({
    ...saleDoc.data(),
    id: saleDoc.id,
  }))
}

export function subscribeSalesByUser(uid, onData, onError) {
  const salesQuery = query(getSalesCollectionRef(uid), orderBy('saleDate', 'desc'))

  return onSnapshot(
    salesQuery,
    (snapshot) => {
      const sales = snapshot.docs.map((saleDoc) => ({
        ...saleDoc.data(),
        id: saleDoc.id,
      }))

      onData(sales)
    },
    onError,
  )
}

export async function getSaleReceiptDataByUser(uid, saleId) {
  ensureFirestoreReady()
  ensureUser(uid)

  if (!saleId) {
    throw Object.assign(new Error('Venda inválida para recibo.'), { code: 'sales/invalid-sale-id' })
  }

  const saleRef = doc(getSalesCollectionRef(uid), saleId)
  const saleSnapshot = await getDoc(saleRef)

  if (!saleSnapshot.exists()) {
    throw Object.assign(new Error('Venda não encontrada para gerar recibo.'), { code: 'sales/not-found' })
  }

  const paymentsQuery = query(getPaymentsHistoryCollectionRef(uid), where('saleId', '==', saleId))
  const paymentsSnapshot = await getDocs(paymentsQuery)

  const payments = paymentsSnapshot.docs
    .map((paymentDoc) => ({
      id: paymentDoc.id,
      ...paymentDoc.data(),
    }))
    .sort((a, b) => {
      const dateA = String(a.paymentDate || '')
      const dateB = String(b.paymentDate || '')
      return dateA > dateB ? -1 : dateA < dateB ? 1 : 0
    })

  return {
    sale: {
      id: saleSnapshot.id,
      ...saleSnapshot.data(),
    },
    payments,
  }
}

export async function createSaleByUser(uid, payload) {
  ensureFirestoreReady()
  ensureUser(uid)
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
    const remainingAmount = Math.max(0, saleData.totalAmount - paidAmount)

    assertFiniteNumber('paidAmount', paidAmount)
    assertFiniteNumber('remainingAmount', remainingAmount)

    const saleDocPayload = {
      ...saleData,
      paidAmount,
      amountPaid: paidAmount,
      remainingAmount,
      status: deriveStatus(saleData.totalAmount, paidAmount),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }

    assertNoUndefinedFields(
      {
        paidAmount: saleDocPayload.paidAmount,
        amountPaid: saleDocPayload.amountPaid,
        remainingAmount: saleDocPayload.remainingAmount,
        status: saleDocPayload.status,
        createdAt: saleDocPayload.createdAt,
        updatedAt: saleDocPayload.updatedAt,
      },
      'createSaleByUser:saleDocPayload',
    )

    transaction.set(saleRef, saleDocPayload)

    const receivables = buildReceivablesFromSale(uid, saleRef.id, saleData, paidAmount)

    for (const receivable of receivables) {
      transaction.set(receivable.ref, receivable.data)
    }
  })

  return saleRef.id
}

export async function updateSaleByUser(uid, saleId, payload) {
  ensureFirestoreReady()
  ensureUser(uid)
  const saleData = normalizeSalePayload(payload)
  validateSalePayload(saleData)

  const saleRef = doc(getSalesCollectionRef(uid), saleId)
  assertDocumentReference(saleRef, 'registerSalePaymentByUser:saleRef')

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
    const remainingAmount = Math.max(0, saleData.totalAmount - paidAmount)

    assertFiniteNumber('paidAmount', paidAmount)
    assertFiniteNumber('remainingAmount', remainingAmount)

    const saleUpdatePayload = {
      ...saleData,
      paidAmount,
      amountPaid: paidAmount,
      remainingAmount,
      status: deriveStatus(saleData.totalAmount, paidAmount),
      updatedAt: serverTimestamp(),
    }

    assertNoUndefinedFields(
      {
        paidAmount: saleUpdatePayload.paidAmount,
        amountPaid: saleUpdatePayload.amountPaid,
        remainingAmount: saleUpdatePayload.remainingAmount,
        status: saleUpdatePayload.status,
        updatedAt: saleUpdatePayload.updatedAt,
      },
      'updateSaleByUser:saleUpdatePayload',
    )

    transaction.update(saleRef, saleUpdatePayload)

    await deleteReceivablesBySaleId(uid, saleId, transaction)

    const receivables = buildReceivablesFromSale(uid, saleId, saleData, paidAmount)

    for (const receivable of receivables) {
      transaction.set(receivable.ref, receivable.data)
    }
  })
}

export async function deleteSaleByUser(uid, saleId) {
  ensureFirestoreReady()
  ensureUser(uid)

  if (!saleId || typeof saleId !== 'string' || !saleId.trim()) {
    throw Object.assign(new Error('Venda sem ID válido para exclusão.'), {
      code: 'sales/invalid-sale-id',
    })
  }

  const normalizedSaleId = saleId.trim()
  const saleRef = doc(db, 'users', uid, 'sales', normalizedSaleId)
  const saleSnapshot = await getDoc(saleRef)

  if (!saleSnapshot.exists()) {
    throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
  }

  await deleteDoc(saleRef)
}

export async function registerSalePaymentByUser(uid, saleId, paymentAmount, paymentDate) {
  ensureFirestoreReady()
  ensureUser(uid)
  const amount = toNumber(paymentAmount)
  const paymentDateAsDate = assertValidDateInput(paymentDate)
  const paymentDateTimestamp = Timestamp.fromDate(paymentDateAsDate)

  assertFiniteNumber('paymentAmount', amount)
  assertNoUndefinedFields(
    {
      uid,
      saleId,
      paymentAmount,
      paymentDate,
      paymentDateTimestamp,
    },
    'registerSalePaymentByUser:input',
  )

  if (amount <= 0) {
    throw Object.assign(new Error('Informe um valor de recebimento maior que zero.'), {
      code: 'sales/invalid-payment',
    })
  }

  const saleRef = doc(getSalesCollectionRef(uid), saleId)
  assertDocumentReference(saleRef, 'registerSalePaymentByUser:saleRef')

  const salePaymentContext = await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const saleData = saleSnapshot.data()
    const totalAmount = toNumber(saleData.totalAmount)
    const currentPaid = toNumber(
      saleData.paidAmount ?? saleData.amountPaid,
      0,
    )

    assertFiniteNumber('sale.totalAmount', totalAmount)
    assertFiniteNumber('sale.paidAmount', currentPaid)

    const safeCurrentPaid = Math.max(0, Math.min(totalAmount, currentPaid))
    const remainingBeforePayment = Math.max(0, totalAmount - safeCurrentPaid)

    if (amount > remainingBeforePayment) {
      console.error('[sales/validation] Valor recebido acima do saldo.', {
        field: 'paymentAmount',
        amount,
        remainingBeforePayment,
        saleId,
      })
      throw Object.assign(new Error('O valor informado ultrapassa o saldo da venda.'), {
        code: 'sales/payment-over-balance',
        field: 'paymentAmount',
      })
    }

    const nextPaid = safeCurrentPaid + amount
    const remainingAmount = Math.max(0, totalAmount - nextPaid)
    const nextStatus = deriveStatus(totalAmount, nextPaid)
    const existingPaymentsHistory = Array.isArray(saleData.payments) ? saleData.payments : []
    const nextPaymentsHistory = [
      ...existingPaymentsHistory,
      {
        amount,
        paymentDate,
      },
    ]

    assertFiniteNumber('nextPaid', nextPaid)
    assertFiniteNumber('remainingAmount', remainingAmount)

    const salePaymentUpdatePayload = {
      paidAmount: nextPaid,
      amountPaid: nextPaid,
      remainingAmount,
      status: nextStatus,
      paymentDate: paymentDateTimestamp,
      lastPaymentDate: paymentDate,
      payments: nextPaymentsHistory,
      updatedAt: serverTimestamp(),
    }

    assertNoUndefinedFields(
      {
        paidAmount: salePaymentUpdatePayload.paidAmount,
        amountPaid: salePaymentUpdatePayload.amountPaid,
        remainingAmount: salePaymentUpdatePayload.remainingAmount,
        status: salePaymentUpdatePayload.status,
        paymentDate: salePaymentUpdatePayload.paymentDate,
        lastPaymentDate: salePaymentUpdatePayload.lastPaymentDate,
        payments: salePaymentUpdatePayload.payments,
        updatedAt: salePaymentUpdatePayload.updatedAt,
      },
      'registerSalePaymentByUser:salePaymentUpdatePayload',
    )

    transaction.update(saleRef, salePaymentUpdatePayload)

    return {
      paymentMethod: saleData.paymentMethod,
      nextPaid,
    }
  }).catch((error) => {
    if (error?.code === 'invalid-argument' || error?.code === 'sales/invalid-argument') {
      console.error('[sales/payment] invalid-argument durante recebimento', {
        uid,
        saleId,
        paymentAmount,
        amountParsed: amount,
        paymentDate,
        paymentDateTimestamp,
        code: error?.code,
        message: error?.message,
        field: error?.field,
      })
    }

    throw error
  })

  if (salePaymentContext.paymentMethod !== PAYMENT_INSTALLMENTS) {
    return
  }

  const receivablesQuery = query(
    getReceivablesCollectionRef(uid),
    where('saleId', '==', saleId),
  )

  const receivablesSnapshot = await getDocs(receivablesQuery)
  const receivablesBatch = writeBatch(db)
  let remainingPaid = salePaymentContext.nextPaid

  const receivableDocs = [...receivablesSnapshot.docs].sort((a, b) => {
    const installmentA = toNumber(a.data()?.installment)
    const installmentB = toNumber(b.data()?.installment)
    return installmentA - installmentB
  })

  receivableDocs.forEach((entryDoc) => {
    const entryData = entryDoc.data()
    const installmentAmount = toNumber(entryData.amount)
    const receivedAmount = Math.max(0, Math.min(remainingPaid, installmentAmount))
    remainingPaid = Math.max(0, remainingPaid - installmentAmount)

    const status = receivedAmount >= installmentAmount ? 'Pago' : receivedAmount > 0 ? 'Parcial' : 'Pendente'

    const receivableUpdatePayload = {
      receivedAmount,
      status,
      paymentDate: paymentDateTimestamp,
      updatedAt: serverTimestamp(),
    }

    assertNoUndefinedFields(
      {
        receivedAmount: receivableUpdatePayload.receivedAmount,
        status: receivableUpdatePayload.status,
        paymentDate: receivableUpdatePayload.paymentDate,
        updatedAt: receivableUpdatePayload.updatedAt,
      },
      'registerSalePaymentByUser:receivableUpdatePayload',
    )

    receivablesBatch.update(entryDoc.ref, receivableUpdatePayload)
  })

  await receivablesBatch.commit()
}

export async function getSalesSummaryByUser(uid) {
  ensureUser(uid)
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
