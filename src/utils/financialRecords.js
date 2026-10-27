import { buildDashboardSummary } from './dashboardSummary.js'
import { matchesDateRange, recordNumber, sortRecordsByDate, toDateKey } from './recordFilters.js'
import { displayText } from './displayText.js'
import { isRestartClosed, RESTART_LABEL } from './systemRestart.js'
import { isSaleCancelled, SALE_CANCELLATION_LABEL } from './saleDeletion.js'

export function financialAccountValues(account, today = toDateKey(new Date())) {
  const amount = recordNumber(account.amount)
  const paid = recordNumber(account.receivedAmount)
  const isMoney = value => value !== null && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001
  const valid = isMoney(amount) && isMoney(paid) && paid <= amount
  const balance = isRestartClosed(account) || isSaleCancelled(account) ? 0 : valid ? amount - paid : null
  const due = toDateKey(account.dueDate)
  const status = isSaleCancelled(account) ? SALE_CANCELLATION_LABEL : isRestartClosed(account) ? RESTART_LABEL : balance === null ? 'Não confirmada' : balance === 0 ? 'Paga' : due && due < today ? 'Em atraso' : paid > 0 ? 'Parcialmente paga' : 'Em aberto'
  return { amount, paid, balance, status, due }
}

export function financialDueRange(mode, custom = {}, today = toDateKey(new Date())) {
  if (mode === 'today') return { from: today, to: today }
  const [year, month, day] = today.split('-').map(Number)
  if (mode === 'month') return { from: `${today.slice(0, 7)}-01`, to: toDateKey(new Date(year, month, 0)) }
  if (mode === 'week') {
    const current = new Date(year, month - 1, day, 12)
    const monday = new Date(current)
    monday.setDate(day - ((current.getDay() + 6) % 7))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: toDateKey(monday), to: toDateKey(sunday) }
  }
  if (mode === 'custom') return { from: custom.from || '', to: custom.to || '' }
  return { from: '', to: '' }
}

function normalized(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function accountPaymentHistory(account, payments) {
  return sortRecordsByDate(payments.filter(payment => payment.receivableId === account.id), 'paymentDate')
}

export function buildFinancialView({ receivables = [], payments = [], sales = [], clients = [] }, filters = {}, dueRange = {}, paymentRange = {}, today = toDateKey(new Date())) {
  const salesById = new Map(sales.map(sale => [sale.id, sale]))
  const clientsById = new Map(clients.map(client => [client.id, client]))
  const rows = sortRecordsByDate(receivables.map(account => {
    const sale = salesById.get(account.saleId)
    const clientId = account.clientId || sale?.clientId || ''
    const conflict = Boolean(account.clientId && sale?.clientId && account.clientId !== sale.clientId)
    const client = conflict ? null : clientsById.get(clientId)
    const values = financialAccountValues(account, today)
    return { ...account, ...values, savedStatus: account.status || '', clientId, clientName: displayText(client?.name || account.clientName, 'Cliente não identificado'), nickname: displayText(client?.nickname, ''), conflicting: conflict, saleFound: Boolean(sale), saleDate: account.saleDate || sale?.saleDate || '' }
  }), 'dueDate', 'asc')
  const term = normalized(filters.client)
  const selected = rows.filter(account => (!term || [account.clientName, account.nickname].some(value => normalized(value).includes(term))) && (!filters.status || (filters.status === 'Em aberto' ? account.balance > 0 : account.status === filters.status)) && matchesDateRange(account.dueDate, dueRange.from, dueRange.to))
  const invalidAccounts = rows.filter(account => account.balance === null).length
  const unlinkedAccounts = rows.filter(account => !account.saleFound).length
  const statusConflicts = rows.filter(account => ['Pago', 'Paga'].includes(account.statusSaved || account.savedStatus) && account.balance > 0).length
  const pending = rows.filter(account => account.balance > 0)
  const unknownOwners = pending.filter(account => !account.clientId || account.conflicting).length
  const dashboard = buildDashboardSummary({ sales, payments, receivables }, paymentRange, today)
  const unknownDueDates = pending.filter(account => !account.due).length
  const historyDifferences = rows.filter(account => {
    const history = accountPaymentHistory(account, payments)
    return history.length && (account.paid === null || Math.abs(history.reduce((sum, payment) => sum + (recordNumber(payment.amount) ?? 0), 0) - account.paid) > 0.01)
  }).length
  const untracedPaidCount = rows.filter(account => {
    if (isSaleCancelled(account) || !(account.paid > 0) || accountPaymentHistory(account, payments).length) return false
    const sale = salesById.get(account.saleId)
    return !sale || !(Array.isArray(sale.payments) && sale.payments.length || payments.some(payment => payment.saleId === sale.id))
  }).length
  const paymentWarnings = dashboard.warnings.filter(warning => ['payment-dates', 'payment-values', 'history-sources', 'payment-history'].includes(warning.code))
  const receivedIssues = [
    ...(untracedPaidCount ? [{ code: 'untraced-paid', count: untracedPaidCount, message: 'conta(s) têm valor pago salvo, mas não há lançamento identificável para confirmar esse recebimento.' }] : []),
    ...paymentWarnings.filter(warning => ['payment-values', 'history-sources'].includes(warning.code) || warning.code === 'payment-dates' && Boolean(paymentRange.from || paymentRange.to)),
  ]
  return {
    rows,
    selected,
    pending: pending.reduce((sum, account) => sum + account.balance, 0),
    overdue: rows.filter(account => account.status === 'Em atraso').reduce((sum, account) => sum + account.balance, 0),
    received: dashboard.totalReceived,
    debtors: new Set(pending.filter(account => account.clientId && !account.conflicting).map(account => account.clientId)).size,
    pendingCount: pending.length,
    unlinkedAccounts,
    invalidAccounts,
    unknownOwners,
    unknownDueDates,
    historyDifferences,
    untracedPaidCount,
    receivedIssues,
    statusConflicts,
    receivedIncomplete: dashboard.incomplete.received || untracedPaidCount > 0 || Boolean(paymentRange.from || paymentRange.to) && dashboard.warnings.some(warning => warning.code === 'payment-dates'),
    paymentWarnings,
  }
}