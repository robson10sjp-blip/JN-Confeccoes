import { buildDashboardSummary, getDashboardSaleBalance } from './dashboardSummary.js'
import { matchesDateRange, prepareSales, recordNumber, sortRecordsByDate, toDateKey } from './recordFilters.js'
import { isRestartClosed, RESTART_LABEL } from './systemRestart.js'

export function normalizeSalesText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function saleRecordedPayments(sale, payments, receivables = []) {
  if (Array.isArray(sale.payments) && sale.payments.length) return sortRecordsByDate(sale.payments, 'paymentDate')
  const accountIds = new Set(receivables.filter(entry => entry.saleId === sale.id).map(entry => entry.id))
  return sortRecordsByDate(payments.filter(entry => entry.saleId === sale.id || accountIds.has(entry.receivableId)), 'paymentDate')
}

export function buildSalesView(sales, clients, receivables, payments, filters, range) {
  const clientsById = new Map(clients.map(client => [client.id, client]))
  const rows = prepareSales(sales, clients, receivables).map(sale => {
    const balance = getDashboardSaleBalance(sale)
    const total = recordNumber(sale.totalAmount)
    const received = isRestartClosed(sale) ? recordNumber(sale.paidAmount ?? sale.amountPaid) : balance === null || total === null ? null : total - balance
    return { ...sale, nickname: clientsById.get(sale.clientId)?.nickname || '', balance, received, situation: isRestartClosed(sale) ? RESTART_LABEL : balance === null ? 'Não confirmada' : balance === 0 ? 'Paga' : received > 0 ? 'Parcialmente paga' : 'Em aberto' }
  })
  const term = normalizeSalesText(filters.client)
  const scope = rows.filter(sale => (filters.status === RESTART_LABEL ? isRestartClosed(sale) : !isRestartClosed(sale)) && (!term || [sale.clientName, sale.nickname].some(value => normalizeSalesText(value).includes(term))) && (!filters.status || (filters.status === 'Em aberto' ? sale.balance > 0 : sale.situation === filters.status)) && (!filters.dueFrom && !filters.dueTo || sale.filterDueDates.some(date => matchesDateRange(date, filters.dueFrom, filters.dueTo))))
  const ids = new Set(scope.map(sale => sale.id))
  const accountIds = new Set(receivables.filter(entry => ids.has(entry.saleId)).map(entry => entry.id))
  const filtered = Boolean(term || filters.status || filters.dueFrom || filters.dueTo)
  const scopedPayments = payments.filter(payment => !filtered || ids.has(payment.saleId) || accountIds.has(payment.receivableId))
  const summary = buildDashboardSummary({ sales: scope, payments: scopedPayments, receivables }, range)
  return { rows: sortRecordsByDate(scope.filter(sale => matchesDateRange(sale.saleDate, range.from, range.to)), 'saleDate'), summary, allRows: rows }
}

export function buildSaleDueDates(count, firstDate, totalAmount) {
  const installments = Number(count)
  if (!Number.isSafeInteger(installments) || installments < 1 || toDateKey(firstDate) !== firstDate || !Number.isFinite(totalAmount) || totalAmount < 0) return []
  const [year, month, day] = firstDate.split('-').map(Number)
  const totalCents = Math.round(totalAmount * 100)
  const each = Math.floor(totalCents / installments)
  return Array.from({ length: installments }, (_, index) => {
    const lastDay = new Date(year, month + index, 0).getDate()
    const date = new Date(year, month - 1 + index, Math.min(day, lastDay), 12)
    return { installment: index + 1, dueDate: toDateKey(date), amount: (index === installments - 1 ? totalCents - each * index : each) / 100 }
  })
}