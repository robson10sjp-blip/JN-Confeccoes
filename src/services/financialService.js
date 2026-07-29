import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { listClientsByUser } from './clientsService'
import { getSalesSummaryByUser, listSalesByUser, registerSalePaymentByUser } from './salesService'

function getReceivablesCollectionRef(uid) {
  return collection(db, 'users', uid, 'financeiroReceber')
}

function getPaymentsHistoryCollectionRef(uid) {
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

export function computeReceivableStatus(receivable, todayDate = getTodayDateString()) {
  const totalAmount = parseNumber(receivable.amount)
  const receivedAmount = parseNumber(receivable.receivedAmount)
  const balance = Math.max(0, totalAmount - receivedAmount)

  if (balance <= 0) {
    return 'Pago'
  }

  if (receivable.dueDate && receivable.dueDate < todayDate) {
    return 'Atrasado'
  }

  if (receivedAmount > 0) {
    return 'Parcial'
  }

  return 'Pendente'
}

export function computeReceivableBalance(receivable) {
  return Math.max(0, parseNumber(receivable.amount) - parseNumber(receivable.receivedAmount))
}

export async function listReceivablesByUser(uid) {
  const receivablesQuery = query(getReceivablesCollectionRef(uid), orderBy('dueDate', 'asc'))
  const snapshot = await getDocs(receivablesQuery)

  return snapshot.docs.map((entryDoc) => ({
    id: entryDoc.id,
    ...entryDoc.data(),
  }))
}

export async function listFinancialPaymentsByUser(uid) {
  const paymentsQuery = query(getPaymentsHistoryCollectionRef(uid), orderBy('paymentDate', 'desc'))
  const snapshot = await getDocs(paymentsQuery)

  return snapshot.docs.map((entryDoc) => ({
    id: entryDoc.id,
    ...entryDoc.data(),
  }))
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
  return dateValue >= range.from && dateValue <= range.to
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
      if (status === 'Pago') {
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
    if (status === 'Pago') {
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
      .filter((receivable) => computeReceivableStatus(receivable) !== 'Pago')
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
      const status = computeReceivableStatus(receivable, today)
      if (status === 'Pago' || !receivable.dueDate || receivable.dueDate > today) {
        return null
      }

      const dueDate = new Date(`${receivable.dueDate}T00:00:00`)
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
        dueDate: receivable.dueDate,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1))
}

export async function loadFinancialModuleData(uid) {
  const [receivables, payments, sales, clients, salesSummary] = await Promise.all([
    listReceivablesByUser(uid),
    listFinancialPaymentsByUser(uid),
    listSalesByUser(uid),
    listClientsByUser(uid),
    getSalesSummaryByUser(uid),
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
    salesSummary,
  }
}

export async function registerFinancialPaymentByUser(uid, receivable, payload) {
  const amount = parseNumber(payload.amount)
  const balance = computeReceivableBalance(receivable)

  if (amount <= 0) {
    throw Object.assign(new Error('Não é permitido receber valor negativo ou zero.'), {
      code: 'financial/invalid-amount',
    })
  }

  if (amount > balance) {
    throw Object.assign(new Error('Não é permitido receber acima do saldo.'), {
      code: 'financial/amount-over-balance',
    })
  }

  await registerSalePaymentByUser(uid, receivable.saleId, amount, payload.paymentDate)

  await addDoc(getPaymentsHistoryCollectionRef(uid), {
    receivableId: receivable.id,
    saleId: receivable.saleId,
    clientId: receivable.clientId,
    clientName: receivable.clientName || '',
    amount,
    paymentDate: payload.paymentDate,
    paymentMethod: payload.paymentMethod || '',
    observation: payload.observation || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}
