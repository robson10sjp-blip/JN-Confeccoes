import { collection, doc, getDocs, getDocsFromServer, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { listClientsByUser } from './clientsService'
import { listSalesByUser } from './salesService'
import { buildSalesSummary, computeReceivableBalance, computeReceivableStatus, sortRecordsByDate, toDateKey } from '../utils/recordFilters'
import { financialAccountValues } from '../utils/financialRecords'
import { recordNumber } from '../utils/recordFilters'
import { isRestartClosed } from '../utils/systemRestart'

export { computeReceivableBalance, computeReceivableStatus }

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

function parseNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function formatLocalDate(date) {
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

export function getTodayDateString() {
  return formatLocalDate(new Date())
}

export async function listReceivablesByUser(uid) {
  const receivablesQuery = getReceivablesCollectionRef(uid)
  const snapshot = await getDocs(receivablesQuery)

  return sortRecordsByDate(snapshot.docs.map((entryDoc) => ({
    ...entryDoc.data(),
    id: entryDoc.id,
  })), 'dueDate', 'asc')
}

export async function listFinancialPaymentsByUser(uid) {
  const paymentsQuery = getPaymentsHistoryCollectionRef(uid)
  const snapshot = await getDocs(paymentsQuery)

  return sortRecordsByDate(snapshot.docs.map((entryDoc) => ({
    ...entryDoc.data(),
    id: entryDoc.id,
  })), 'paymentDate')
}

export function subscribeReceivablesByUser(uid, onData, onError) {
  const receivablesQuery = getReceivablesCollectionRef(uid)

  return onSnapshot(
    receivablesQuery,
    (snapshot) => {
      const receivables = sortRecordsByDate(snapshot.docs.map((entryDoc) => ({
        ...entryDoc.data(),
        id: entryDoc.id,
      })), 'dueDate', 'asc')

      onData(receivables)
    },
    onError,
  )
}

export function subscribeFinancialPaymentsByUser(uid, onData, onError) {
  const paymentsQuery = getPaymentsHistoryCollectionRef(uid)

  return onSnapshot(
    paymentsQuery,
    (snapshot) => {
      const payments = sortRecordsByDate(snapshot.docs.map((entryDoc) => ({
        ...entryDoc.data(),
        id: entryDoc.id,
      })), 'paymentDate')

      onData(payments)
    },
    onError,
  )
}

function dateRangeForToday() {
  const today = getTodayDateString()
  return { from: today, to: today }
}

function dateRangeForWeek() {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return {
    from: formatLocalDate(monday),
    to: formatLocalDate(sunday),
  }
}

function dateRangeForMonth() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  return {
    from: formatLocalDate(first),
    to: formatLocalDate(last),
  }
}

function dateRangeForYear() {
  const today = new Date()
  const first = new Date(today.getFullYear(), 0, 1)
  const last = new Date(today.getFullYear(), 11, 31)

  return {
    from: formatLocalDate(first),
    to: formatLocalDate(last),
  }
}

function isDateWithinRange(dateValue, range) {
  const date = toDateKey(dateValue)
  return Boolean(date && date >= range.from && date <= range.to)
}

function computeReportFromData(range, receivables, payments, sales) {
  const sold = sales
    .filter((sale) => sale.saleDate && isDateWithinRange(sale.saleDate, range))
    .reduce((acc, sale) => acc + parseNumber(sale.totalAmount), 0)

  const received = payments
    .filter((payment) => payment.paymentDate && isDateWithinRange(payment.paymentDate, range))
    .reduce((acc, payment) => acc + parseNumber(payment.amount), 0)

  const pending = receivables
    .filter((receivable) => receivable.dueDate && isDateWithinRange(receivable.dueDate, range))
    .reduce((acc, receivable) => {
      const status = computeReceivableStatus(receivable)
      if (status === 'Pago' || status === 'Não informado') {
        return acc
      }
      return acc + computeReceivableBalance(receivable)
    }, 0)

  const overdue = receivables
    .filter((receivable) => receivable.dueDate && isDateWithinRange(receivable.dueDate, range))
    .reduce((acc, receivable) => {
      const status = computeReceivableStatus(receivable)
      if (status !== 'Atrasado') {
        return acc
      }
      return acc + computeReceivableBalance(receivable)
    }, 0)

  return {
    sold,
    received,
    pending,
    overdue,
  }
}

export function buildFinancialIndicators(receivables, payments, salesSummary) {
  const todayRange = dateRangeForToday()
  const weekRange = dateRangeForWeek()
  const monthRange = dateRangeForMonth()

  const totalToReceive = receivables.reduce((acc, receivable) => {
    const status = computeReceivableStatus(receivable)
    if (status === 'Pago' || status === 'Não informado') {
      return acc
    }
    return acc + computeReceivableBalance(receivable)
  }, 0)

  const totalReceived = receivables.reduce(
    (acc, receivable) => acc + parseNumber(receivable.receivedAmount),
    0,
  )

  const totalOverdue = receivables.reduce((acc, receivable) => {
    if (computeReceivableStatus(receivable) !== 'Atrasado') {
      return acc
    }
    return acc + computeReceivableBalance(receivable)
  }, 0)

  const paymentsToday = payments
    .filter((payment) => payment.paymentDate && isDateWithinRange(payment.paymentDate, todayRange))
    .reduce((acc, payment) => acc + parseNumber(payment.amount), 0)

  const paymentsWeek = payments
    .filter((payment) => payment.paymentDate && isDateWithinRange(payment.paymentDate, weekRange))
    .reduce((acc, payment) => acc + parseNumber(payment.amount), 0)

  const paymentsMonth = payments
    .filter((payment) => payment.paymentDate && isDateWithinRange(payment.paymentDate, monthRange))
    .reduce((acc, payment) => acc + parseNumber(payment.amount), 0)

  const debtors = new Set(
    receivables
      .filter((receivable) => computeReceivableBalance(receivable) > 0)
      .map((receivable) => receivable.clientId)
      .filter(Boolean),
  )

  return {
    totalToReceive,
    totalReceived,
    totalOverdue,
    paymentsToday,
    paymentsWeek,
    paymentsMonth,
    totalSalesValue: parseNumber(salesSummary.totalSoldValue),
    clientsInDebt: debtors.size,
  }
}

export function buildFinancialReports(receivables, payments, sales) {
  return {
    day: computeReportFromData(dateRangeForToday(), receivables, payments, sales),
    week: computeReportFromData(dateRangeForWeek(), receivables, payments, sales),
    month: computeReportFromData(dateRangeForMonth(), receivables, payments, sales),
    year: computeReportFromData(dateRangeForYear(), receivables, payments, sales),
  }
}

export function buildPriorities(receivables, clientsById) {
  const today = getTodayDateString()

  return receivables
    .map((receivable) => {
      const dueDateKey = toDateKey(receivable.dueDate)
      if (!(computeReceivableBalance(receivable) > 0) || !dueDateKey || dueDateKey > today) {
        return null
      }

      const dueDate = new Date(`${dueDateKey}T00:00:00`)
      const todayDate = new Date(`${today}T00:00:00`)
      const diffDays = Math.floor((todayDate - dueDate) / (1000 * 60 * 60 * 24))
      const client = clientsById[receivable.clientId] || {}

      return {
        id: receivable.id,
        clientName: receivable.clientName || client.name || 'Cliente',
        city: client.city || '-',
        phone: client.phone || '-',
        amount: computeReceivableBalance(receivable),
        daysLate: Math.max(0, diffDays),
        dueDate: dueDateKey,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
}

export async function loadFinancialModuleData(uid) {
  ensureUser(uid)
  const [receivables, payments, sales, clients] = await Promise.all([
    listReceivablesByUser(uid),
    listFinancialPaymentsByUser(uid),
    listSalesByUser(uid),
    listClientsByUser(uid),
  ])

  const clientsById = clients.reduce((acc, client) => {
    acc[client.id] = client
    return acc
  }, {})

  return {
    receivables,
    payments,
    sales,
    clientsById,
    salesSummary: buildSalesSummary(sales),
  }
}

export async function registerFinancialPaymentByUser(uid, receivable, payload) {
  ensureFirestoreReady()
  ensureUser(uid)
  if (!receivable?.id) throw new Error('Conta não identificada.')
  const amount = Number(payload.amount)

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw Object.assign(new Error('Não é permitido receber valor negativo ou zero.'), {
      code: 'financial/invalid-amount',
    })
  }

  if (toDateKey(payload.paymentDate) !== payload.paymentDate || !payload.paymentDate) throw Object.assign(new Error('Informe uma data de pagamento válida.'), { code: 'financial/invalid-date' })
  const accountRef = doc(getReceivablesCollectionRef(uid), receivable.id)
  const paymentRef = payload.requestId ? doc(getPaymentsHistoryCollectionRef(uid), payload.requestId) : doc(getPaymentsHistoryCollectionRef(uid))
  const saleRef = receivable.saleId ? doc(db, 'users', uid, 'sales', receivable.saleId) : null
  const accountGroup = saleRef ? await getDocsFromServer(query(getReceivablesCollectionRef(uid), where('saleId', '==', receivable.saleId))) : null
  await runTransaction(db, async transaction => {
    const previousPayment = await transaction.get(paymentRef)
    if (previousPayment.exists()) {
      if (previousPayment.data().receivableId !== receivable.id) throw new Error('Identificação de recebimento já utilizada em outra conta. Reabra a conta para conferir.')
      return
    }
    const accountSnapshot = await transaction.get(accountRef)
    if (!accountSnapshot.exists()) throw new Error('A conta não foi localizada. Nenhum pagamento foi registrado.')
    const account = accountSnapshot.data()
    if (isRestartClosed(account)) throw new Error('Esta conta foi encerrada para reinício e não aceita novos pagamentos.')
    if ((account.saleId || '') !== (receivable.saleId || '')) throw new Error('O vínculo da conta mudou. Reabra a conta antes de receber.')
    const values = financialAccountValues(account)
    if (values.balance === null) throw Object.assign(new Error('Os valores da conta precisam de revisão antes do recebimento.'), { code: 'financial/review-required' })
    if (recordNumber(receivable.receivedAmount) !== values.paid) throw Object.assign(new Error('A conta foi atualizada desde a conferência. Reabra o recebimento para confirmar o saldo atual.'), { code: 'financial/account-changed' })
    if (amount > values.balance) throw Object.assign(new Error('O valor recebido não pode ultrapassar o saldo desta conta.'), { code: 'financial/amount-over-balance' })
    const saleSnapshot = saleRef ? await transaction.get(saleRef) : null
    let saleUpdate = null
    if (saleSnapshot?.exists()) {
      const sale = saleSnapshot.data()
      if (isRestartClosed(sale)) throw new Error('A venda desta conta foi encerrada para reinício. Confira o vínculo antes de receber.')
      const total = recordNumber(sale.totalAmount)
      const paid = recordNumber(sale.paidAmount ?? sale.amountPaid)
      if (total === null || paid === null || paid < 0 || paid > total || account.clientId && sale.clientId && account.clientId !== sale.clientId) throw Object.assign(new Error('A conta e a venda precisam de conferência antes de receber.'), { code: 'financial/review-required' })
      if (sale.paidAmount !== undefined && sale.amountPaid !== undefined && recordNumber(sale.paidAmount) !== recordNumber(sale.amountPaid) || sale.remainingAmount !== undefined && Math.abs(Number(sale.remainingAmount) - (total - paid)) > 0.01) throw Object.assign(new Error('Os valores pagos e o saldo da venda não conferem. Revise antes de receber.'), { code: 'financial/review-required' })
      const related = []
      for (const entry of accountGroup.docs) {
        const snapshot = await transaction.get(entry.ref)
        if (!snapshot.exists()) throw new Error('As parcelas mudaram. Reabra a conta para conferir.')
        const data = snapshot.data()
        const checked = financialAccountValues(data)
        if (checked.balance === null || data.saleId !== receivable.saleId || data.clientId && sale.clientId && data.clientId !== sale.clientId) throw Object.assign(new Error('Há parcelas com valores ou vínculos que precisam de revisão.'), { code: 'financial/review-required' })
        related.push({ id: entry.id, ...checked })
      }
      if (!related.some(entry => entry.id === receivable.id) || Math.abs(related.reduce((sum, entry) => sum + entry.amount, 0) - total) > 0.01 || Math.abs(related.reduce((sum, entry) => sum + entry.paid, 0) - paid) > 0.01 || paid + amount > total) throw Object.assign(new Error('As parcelas e a venda não conferem. Nenhum dado foi alterado; revise os valores antes de receber.'), { code: 'financial/review-required' })
      const nextPaid = Math.round((paid + amount) * 100) / 100
      saleUpdate = { paidAmount: nextPaid, amountPaid: nextPaid, remainingAmount: Math.round((total - nextPaid) * 100) / 100, status: nextPaid >= total ? 'Pago' : 'Parcial', payments: [...(Array.isArray(sale.payments) ? sale.payments : []), { paymentId: paymentRef.id, receivableId: receivable.id, amount, paymentDate: payload.paymentDate, paymentMethod: payload.paymentMethod || '' }], lastPaymentDate: payload.paymentDate, updatedAt: serverTimestamp() }
    }
    const nextReceived = Math.round((values.paid + amount) * 100) / 100
    transaction.update(accountRef, { receivedAmount: nextReceived, status: nextReceived >= values.amount ? 'Pago' : 'Parcial', paymentDate: payload.paymentDate, updatedAt: serverTimestamp() })
    if (saleUpdate) transaction.update(saleRef, saleUpdate)
    transaction.set(paymentRef, { receivableId: receivable.id, saleId: account.saleId || '', clientId: account.clientId || '', clientName: account.clientName || '', amount, paymentDate: payload.paymentDate, paymentMethod: payload.paymentMethod || '', observation: payload.observation || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
  return paymentRef.id
}

export function subscribeFinancialSource(uid, source, onData, onError) {
  ensureFirestoreReady()
  ensureUser(uid)
  const sources = { receivables: 'financeiroReceber', payments: 'financeiroRecebimentos', sales: 'sales', clients: 'clients' }
  if (!Object.hasOwn(sources, source)) throw new Error('Fonte financeira inválida.')
  return onSnapshot(collection(db, 'users', uid, sources[source]), { includeMetadataChanges: true }, snapshot => onData(snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id })), !snapshot.metadata?.fromCache), onError)
}
