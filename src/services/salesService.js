import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { buildSalesSummary, recordNumber, sortRecordsByDate, toDateKey } from '../utils/recordFilters'
import { isRestartClosed } from '../utils/systemRestart'

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

  if (Number.isNaN(date.getTime()) || toDateKey(paymentDate) !== paymentDate) {
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
  const quantity = Number(item.quantity)
  const unitPrice = Number(item.unitPrice)
  const discount = Number(item.discount ?? 0)
  const subtotal = quantity * unitPrice - discount

  return {
    productId: resolveLegacyProductId(item),
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

  if (!payload.saleDate || toDateKey(payload.saleDate) !== payload.saleDate) {
    throw Object.assign(new Error('Data da venda é obrigatória.'), { code: 'sales/invalid-date' })
  }

  if (!payload.items?.length) {
    throw Object.assign(new Error('A venda deve possuir ao menos um produto.'), { code: 'sales/no-items' })
  }

  for (const item of payload.items) {
    if (!item.productId) {
      throw Object.assign(new Error('Selecione um produto válido.'), { code: 'sales/invalid-product' })
    }

    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw Object.assign(new Error('Quantidade deve ser maior que zero.'), { code: 'sales/invalid-quantity' })
    }

    if (![item.unitPrice, item.discount, item.subtotal].every(Number.isFinite) || item.unitPrice < 0 || item.discount < 0 || item.subtotal < 0) {
      throw Object.assign(new Error('Valores negativos não são permitidos.'), { code: 'sales/invalid-values' })
    }
  }

  if (![payload.totalAmount, payload.totalDiscount].every(Number.isFinite) || payload.totalAmount < 0 || payload.totalDiscount < 0) {
    throw Object.assign(new Error('Valores negativos não são permitidos.'), { code: 'sales/invalid-values' })
  }

  if (payload.paymentMethod === PAYMENT_INSTALLMENTS) {
    if (!Number.isSafeInteger(payload.installments) || payload.installments <= 0) {
      throw Object.assign(new Error('Informe a quantidade de parcelas.'), { code: 'sales/invalid-installments' })
    }

    if (!payload.firstDueDate) {
      throw Object.assign(new Error('Informe o primeiro vencimento.'), { code: 'sales/invalid-due-date' })
    }
    if (toDateKey(payload.firstDueDate) !== payload.firstDueDate || payload.dueDates.length !== payload.installments || payload.dueDates.some(entry => toDateKey(entry.dueDate) !== entry.dueDate || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0) || Math.abs(payload.dueDates.reduce((sum, entry) => sum + Number(entry.amount), 0) - payload.totalAmount) > 0.01) {
      throw Object.assign(new Error('Confira os vencimentos e os valores das parcelas.'), { code: 'sales/invalid-due-date' })
    }
  }
  if (![PAYMENT_CASH, PAYMENT_INSTALLMENTS].includes(payload.paymentMethod)) throw Object.assign(new Error('Escolha venda à vista ou a prazo.'), { code: 'sales/invalid-payment-method' })
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

export async function listSalesByUser(uid) {
  const salesQuery = getSalesCollectionRef(uid)
  const snapshot = await getDocs(salesQuery)

  return sortRecordsByDate(snapshot.docs.map((saleDoc) => ({
    ...saleDoc.data(),
    id: saleDoc.id,
  })), 'saleDate')
}

export function subscribeSalesByUser(uid, onData, onError) {
  const salesQuery = getSalesCollectionRef(uid)

  return onSnapshot(
    salesQuery,
    (snapshot) => {
      const sales = sortRecordsByDate(snapshot.docs.map((saleDoc) => ({
        ...saleDoc.data(),
        id: saleDoc.id,
      })), 'saleDate')

      onData(sales)
    },
    onError,
  )
}

export function subscribeSalesModuleSource(uid, source, onData, onError) {
  ensureFirestoreReady()
  ensureUser(uid)
  const collections = { sales: 'sales', clients: 'clients', products: 'products', receivables: 'financeiroReceber', payments: 'financeiroRecebimentos' }
  if (!Object.hasOwn(collections, source)) throw new Error('Fonte inválida para vendas.')
  return onSnapshot(collection(db, 'users', uid, collections[source]), { includeMetadataChanges: true }, snapshot => {
    onData(snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id })), !snapshot.metadata?.fromCache)
  }, onError)
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

export async function createSaleByUser(uid, payload, requestId) {
  ensureFirestoreReady()
  ensureUser(uid)
  const saleData = normalizeSalePayload(payload)
  validateSalePayload(saleData)

  const saleRef = requestId ? doc(getSalesCollectionRef(uid), requestId) : doc(getSalesCollectionRef(uid))
  const initialPaid = saleData.paymentMethod === PAYMENT_CASH ? saleData.totalAmount : Number(payload.initialPaidAmount ?? 0)
  const initialDate = payload.initialPaymentDate || saleData.saleDate
  if (!Number.isFinite(initialPaid) || initialPaid < 0 || initialPaid > saleData.totalAmount || initialPaid > 0 && toDateKey(initialDate) !== initialDate) {
    throw Object.assign(new Error('Confira o pagamento inicial e sua data. Ele não pode ultrapassar o total da venda.'), { code: 'sales/invalid-initial-payment' })
  }

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(saleRef)
    if (existing.exists()) return
    const stockByProduct = new Map()
    const quantities = new Map()
    for (const item of saleData.items) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity)

    for (const [productId, quantity] of quantities) {
      const productRef = doc(getProductsCollectionRef(uid), productId)
      const productSnapshot = await transaction.get(productRef)

      if (!productSnapshot.exists()) {
        throw Object.assign(new Error('Produto selecionado não foi encontrado.'), { code: 'sales/product-not-found' })
      }

      const rawStock = productSnapshot.data().stockQuantity
      const currentStock = recordNumber(rawStock)
      if (!Number.isSafeInteger(currentStock) || currentStock < 0) throw Object.assign(new Error('O estoque deste produto precisa de revisão antes da venda.'), { code: 'sales/invalid-stock' })

      if (quantity > currentStock) {
        throw Object.assign(new Error('Estoque insuficiente para concluir a venda.'), {
          code: 'sales/insufficient-stock',
        })
      }

      stockByProduct.set(productId, { productRef, currentStock })
    }

    const stockProofItems = []
    for (const [productId, quantity] of quantities) {
      const productInfo = stockByProduct.get(productId)
      const nextStock = productInfo.currentStock - quantity
      const eventId = `sale-debit-${saleRef.id}-${productId}`
      stockProofItems.push({ productId, quantity, before: productInfo.currentStock, after: nextStock, eventId })

      transaction.update(productInfo.productRef, {
        stockQuantity: nextStock,
        stockMovementId: eventId,
        updatedAt: serverTimestamp(),
      })
    }

    const paidAmount = initialPaid
    const remainingAmount = Math.max(0, saleData.totalAmount - paidAmount)

    assertFiniteNumber('paidAmount', paidAmount)
    assertFiniteNumber('remainingAmount', remainingAmount)

    const saleDocPayload = {
      ...saleData,
      paidAmount,
      amountPaid: paidAmount,
      remainingAmount,
      status: deriveStatus(saleData.totalAmount, paidAmount),
      payments: paidAmount > 0 ? [{ paymentId: `${saleRef.id}-initial`, amount: paidAmount, paymentDate: initialDate }] : [],
      stockDebitProof: { version: 1, items: stockProofItems },
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
  const [accounts, payments] = await Promise.all([
    getDocsFromServer(query(getReceivablesCollectionRef(uid), where('saleId', '==', saleId))),
    getDocsFromServer(query(getPaymentsHistoryCollectionRef(uid), where('saleId', '==', saleId))),
  ])

  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const previousSale = saleSnapshot.data()
    if (isRestartClosed(previousSale)) throw new Error('Esta venda foi encerrada para reinício. O histórico não pode ser editado ou recebido como venda atual.')
    const previousItems = previousSale.items || []
    const paidAmount = recordNumber(previousSale.paidAmount ?? previousSale.amountPaid)
    if (paidAmount === null || paidAmount < 0 || paidAmount > saleData.totalAmount) throw Object.assign(new Error('Os valores pagos desta venda precisam de conferência antes da edição.'), { code: 'sales/financial-review-required' })
    const schedule = value => JSON.stringify((value || []).map(entry => ({ dueDate: toDateKey(entry.dueDate), amount: Number(entry.amount) })))
    const changedTerms = previousSale.clientId !== saleData.clientId || previousSale.paymentMethod !== saleData.paymentMethod || toNumber(previousSale.installments, 1) !== saleData.installments || toDateKey(previousSale.firstDueDate) !== saleData.firstDueDate || schedule(previousSale.dueDates) !== schedule(saleData.dueDates)
    if (changedTerms || Math.abs(Number(previousSale.totalAmount) - saleData.totalAmount) > 0.01 && (paidAmount > 0 || accounts.docs.length || payments.docs.length || previousSale.payments?.length)) {
      throw Object.assign(new Error('Esta edição mudaria condições financeiras já registradas. Mantenha cliente, pagamento, parcelas e total; ajustes financeiros precisam de uma etapa específica.'), { code: 'sales/financial-edit-blocked' })
    }

    const previousQuantityByProduct = new Map()
    for (const item of previousItems) {
      const productId = resolveLegacyProductId(item)
      if (!productId || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0) throw Object.assign(new Error('Os itens antigos precisam de revisão antes da edição.'), { code: 'sales/legacy-items' })
      const currentValue = previousQuantityByProduct.get(productId) || 0
      previousQuantityByProduct.set(productId, currentValue + Number(item.quantity))
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

    const stockUpdates = []
    for (const productId of allProductIds) {
      const previousQuantity = previousQuantityByProduct.get(productId) || 0
      const nextQuantity = nextQuantityByProduct.get(productId) || 0
      const stockDelta = previousQuantity - nextQuantity
      if (stockDelta === 0) continue

      const productRef = doc(getProductsCollectionRef(uid), productId)
      const productSnapshot = await transaction.get(productRef)

      if (!productSnapshot.exists()) {
        throw Object.assign(new Error('Produto selecionado não foi encontrado.'), { code: 'sales/product-not-found' })
      }

      const currentStock = recordNumber(productSnapshot.data().stockQuantity)
      if (!Number.isSafeInteger(currentStock) || currentStock < 0) throw Object.assign(new Error('O estoque precisa de conferência antes de alterar os itens.'), { code: 'sales/invalid-stock' })
      const nextStock = currentStock + stockDelta

      if (nextStock < 0) {
        throw Object.assign(new Error('Estoque insuficiente para atualizar a venda.'), {
          code: 'sales/insufficient-stock',
        })
      }

      stockUpdates.push([productRef, {
        stockQuantity: nextStock,
        stockMovementId: `edited-sale-${saleId}`,
        updatedAt: serverTimestamp(),
      }])
    }

    const remainingAmount = Math.max(0, saleData.totalAmount - paidAmount)

    assertFiniteNumber('paidAmount', paidAmount)
    assertFiniteNumber('remainingAmount', remainingAmount)

    const sameItems = previousItems.length === saleData.items.length && previousItems.every((item, index) => {
      const next = saleData.items[index]
      return resolveLegacyProductId(item) === next.productId && Number(item.quantity) === next.quantity && Number(item.unitPrice) === next.unitPrice && Number(item.discount ?? 0) === next.discount
    })
    const saleUpdatePayload = {
      ...(stockUpdates.length ? { stockDebitProof: null } : {}),
      ...(!sameItems ? { items: saleData.items } : {}),
      ...(toDateKey(previousSale.saleDate) !== saleData.saleDate ? { saleDate: saleData.saleDate } : {}),
      ...(Math.abs(Number(previousSale.totalAmount) - saleData.totalAmount) > 0.01 ? { totalAmount: saleData.totalAmount } : {}),
      ...(Number(previousSale.totalDiscount ?? 0) !== saleData.totalDiscount ? { totalDiscount: saleData.totalDiscount } : {}),
      ...(Math.abs(Number(previousSale.totalAmount) - saleData.totalAmount) > 0.01 ? { remainingAmount, status: deriveStatus(saleData.totalAmount, paidAmount) } : {}),
      updatedAt: serverTimestamp(),
    }

    for (const [productRef, update] of stockUpdates) transaction.update(productRef, update)
    transaction.update(saleRef, saleUpdatePayload)
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

export async function registerSalePaymentByUser(uid, saleId, paymentAmount, paymentDate, requestId) {
  ensureFirestoreReady()
  ensureUser(uid)
  const amount = Number(paymentAmount)
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

  const operationId = requestId || doc(getPaymentsHistoryCollectionRef(uid)).id
  const accounts = await getDocsFromServer(query(getReceivablesCollectionRef(uid), where('saleId', '==', saleId)))
  await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef)

    if (!saleSnapshot.exists()) {
      throw Object.assign(new Error('Venda não encontrada.'), { code: 'sales/not-found' })
    }

    const saleData = saleSnapshot.data()
    if (isRestartClosed(saleData)) throw new Error('Esta venda foi encerrada para reinício e não aceita novos recebimentos.')
    const existingPaymentsHistory = Array.isArray(saleData.payments) ? saleData.payments : []
    if (existingPaymentsHistory.some(payment => payment.paymentId === operationId)) return
    const totalAmount = recordNumber(saleData.totalAmount)
    const currentPaid = recordNumber(saleData.paidAmount ?? saleData.amountPaid)

    assertFiniteNumber('sale.totalAmount', totalAmount)
    assertFiniteNumber('sale.paidAmount', currentPaid)

    if (saleData.paidAmount !== undefined && saleData.amountPaid !== undefined && recordNumber(saleData.paidAmount) !== recordNumber(saleData.amountPaid) || saleData.remainingAmount !== undefined && Math.abs(Number(saleData.remainingAmount) - (totalAmount - currentPaid)) > 0.01) {
      throw Object.assign(new Error('Os valores pagos e o saldo salvo não conferem. Revise a venda antes de receber.'), { code: 'sales/financial-review-required' })
    }
    if (totalAmount < 0 || currentPaid < 0 || currentPaid > totalAmount) throw Object.assign(new Error('Os valores da venda precisam de conferência antes de receber.'), { code: 'sales/financial-review-required' })
    const accountSnapshots = []
    for (const account of accounts.docs) accountSnapshots.push(await transaction.get(account.ref))
    const accountData = accountSnapshots.map(entry => {
      if (!entry.exists()) throw Object.assign(new Error('As parcelas mudaram. Reabra o recebimento para conferir.'), { code: 'sales/accounts-changed' })
      const data = entry.data()
      const accountAmount = recordNumber(data.amount)
      const received = recordNumber(data.receivedAmount ?? 0)
      if (accountAmount === null || received === null || accountAmount < 0 || received < 0 || received > accountAmount) throw Object.assign(new Error('As parcelas precisam de conferência antes de receber.'), { code: 'sales/financial-review-required' })
      return { ref: entry.ref, data, amount: accountAmount, received }
    })
    if (saleData.paymentMethod === PAYMENT_INSTALLMENTS && (!accountData.length || Math.abs(accountData.reduce((sum, entry) => sum + entry.amount, 0) - totalAmount) > 0.01 || Math.abs(accountData.reduce((sum, entry) => sum + entry.received, 0) - currentPaid) > 0.01)) {
      throw Object.assign(new Error('As parcelas e a venda têm valores diferentes. Confira antes de receber; nenhum valor foi alterado.'), { code: 'sales/financial-review-required' })
    }
    const safeCurrentPaid = currentPaid
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
    const nextPaymentsHistory = [
      ...existingPaymentsHistory,
      {
        paymentId: operationId,
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

    let remainingPayment = amount
    accountData.sort((first, second) => Number(first.data.installment || 0) - Number(second.data.installment || 0))
    for (const account of accountData) {
      const allocated = Math.min(remainingPayment, account.amount - account.received)
      if (allocated <= 0) continue
      const receivedAmount = account.received + allocated
      transaction.update(account.ref, { receivedAmount, status: deriveStatus(account.amount, receivedAmount), paymentDate: paymentDateTimestamp, updatedAt: serverTimestamp() })
      remainingPayment -= allocated
    }
    transaction.update(saleRef, salePaymentUpdatePayload)
  })
}

export async function getSalesSummaryByUser(uid) {
  return buildSalesSummary(await listSalesByUser(uid))
}
