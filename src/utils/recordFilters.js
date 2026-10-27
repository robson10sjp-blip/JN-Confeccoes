import { isRestartClosed, RESTART_LABEL } from './systemRestart.js'
import { isSaleCancelled, SALE_CANCELLATION_LABEL } from './saleDeletion.js'

export function toDateKey(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return toDateKey(value.toDate())
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    return toDateKey(new Date(value.seconds * 1000))
  }
  if (typeof value !== 'string') return ''
  const text = value.trim()
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text)
  const key = brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : ''
  if (!key) return ''
  const parsed = new Date(`${key}T12:00:00`)
  return !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === key ? key : ''
}

export function formatRecordDate(value) {
  const key = toDateKey(value)
  return key ? key.split('-').reverse().join('/') : value ? 'Data inválida' : 'Não informada'
}

export function sortRecordsByDate(records, field, direction = 'desc') {
  return [...records].sort((first, second) => {
    const firstDate = toDateKey(first[field])
    const secondDate = toDateKey(second[field])
    if (!firstDate) return secondDate ? 1 : 0
    if (!secondDate) return -1
    return direction === 'asc' ? firstDate.localeCompare(secondDate) : secondDate.localeCompare(firstDate)
  })
}

export function recordNumber(value) {
  if (value === null || value === undefined || typeof value === 'string' && !value.trim() || typeof value === 'boolean') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function computeReceivableBalance(receivable) {
  if (isSaleCancelled(receivable)) return 0
  if (isRestartClosed(receivable)) return 0
  const amount = recordNumber(receivable.amount)
  const received = recordNumber(receivable.receivedAmount ?? 0)
  return amount === null || received === null || amount < 0 || received < 0 ? null : Math.max(0, amount - received)
}

export function computeReceivableStatus(receivable, today = toDateKey(new Date())) {
  if (isSaleCancelled(receivable)) return SALE_CANCELLATION_LABEL
  if (isRestartClosed(receivable)) return RESTART_LABEL
  const balance = computeReceivableBalance(receivable)
  if (balance === null) return 'Não informado'
  if (balance <= 0) return 'Pago'
  const dueDate = toDateKey(receivable.dueDate)
  if (dueDate && dueDate < today) return 'Atrasado'
  return recordNumber(receivable.receivedAmount) > 0 ? 'Parcial' : 'Pendente'
}

export function computeSaleStatus(sale, receivables = [], today = toDateKey(new Date())) {
  if (isSaleCancelled(sale)) return SALE_CANCELLATION_LABEL
  if (isRestartClosed(sale)) return RESTART_LABEL
  const amount = recordNumber(sale.totalAmount)
  const paid = recordNumber(sale.paidAmount ?? sale.amountPaid)
  const hasAmounts = amount !== null && paid !== null
  if (hasAmounts && paid >= amount) return 'Pago'
  if (!hasAmounts && sale.status === 'Pago') return 'Pago'
  const linked = receivables.filter(entry => sale.id && entry.saleId === sale.id)
  if (linked.some(entry => computeReceivableStatus(entry, today) === 'Atrasado')) return 'Atrasado'
  if (!linked.length && hasAmounts && amount > paid) {
    const dueDates = Array.isArray(sale.dueDates) ? sale.dueDates : []
    let remainingPaid = paid
    for (const entry of sortRecordsByDate(dueDates, 'dueDate', 'asc')) {
      const installmentAmount = recordNumber(entry.amount)
      if (installmentAmount === null) continue
      const balance = Math.max(0, installmentAmount - remainingPaid)
      remainingPaid = Math.max(0, remainingPaid - installmentAmount)
      const dueDate = toDateKey(entry.dueDate)
      if (balance > 0 && dueDate && dueDate < today) return 'Atrasado'
    }
  }
  if (hasAmounts) return paid > 0 ? 'Parcial' : 'Pendente'
  return ['Pendente', 'Parcial', 'Atrasado'].includes(sale.status) ? sale.status : 'Não informado'
}

export function matchesStatus(status, selected) {
  if (!selected) return true
  return selected === 'Pendente' ? ['Pendente', 'Parcial', 'Atrasado'].includes(status) : status === selected
}

export function matchesDateRange(value, from = '', to = '') {
  if (!from && !to) return true
  const key = toDateKey(value)
  return Boolean(key && (!from || key >= from) && (!to || key <= to))
}

export function filterRecords(records, filters) {
  const term = String(filters.client || '').trim().toLocaleLowerCase('pt-BR')
  return records.filter(record =>
    (!term || String(record.clientName || '').toLocaleLowerCase('pt-BR').includes(term)) &&
    matchesStatus(record.displayStatus, filters.status) &&
    matchesDateRange(record.saleDate, filters.saleFrom, filters.saleTo) &&
    (!filters.dueFrom && !filters.dueTo || (record.filterDueDates || [record.dueDate]).some(date => matchesDateRange(date, filters.dueFrom, filters.dueTo)))
  )
}

export function buildSalesSummary(sales) {
  return sales.filter(sale => !isSaleCancelled(sale)).reduce((summary, sale) => ({
    totalSales: summary.totalSales + 1,
    totalSoldValue: summary.totalSoldValue + (recordNumber(sale.totalAmount) ?? 0),
    totalProductsSold: summary.totalProductsSold + (Array.isArray(sale.items) ? sale.items : []).reduce((total, item) => total + (recordNumber(item.quantity) ?? 0), 0),
  }), { totalSales: 0, totalSoldValue: 0, totalProductsSold: 0 })
}

export function prepareSales(sales, clients = [], receivables = [], today = toDateKey(new Date())) {
  const clientsById = new Map(clients.map(client => [client.id, client]))
  return sales.map(sale => {
    const linked = receivables.filter(entry => sale.id && entry.saleId === sale.id)
    return {
      ...sale,
      clientName: clientsById.get(sale.clientId)?.name || sale.clientName || 'Cliente não identificado',
      displayStatus: computeSaleStatus(sale, receivables, today),
      filterDueDates: linked.length ? linked.map(entry => entry.dueDate) : (Array.isArray(sale.dueDates) ? sale.dueDates : []).map(entry => entry.dueDate),
    }
  })
}

export function prepareReceivables(receivables, sales = [], clients = [], today = toDateKey(new Date())) {
  const salesById = new Map(sales.map(sale => [sale.id, sale]))
  const clientsById = new Map(clients.map(client => [client.id, client]))
  return receivables.map(entry => ({
    ...entry,
    clientName: clientsById.get(entry.clientId)?.name || entry.clientName || 'Cliente não identificado',
    saleDate: entry.saleDate || salesById.get(entry.saleId)?.saleDate || '',
    saleLink: !entry.saleId ? 'Sem venda vinculada' : salesById.has(entry.saleId) ? 'Vinculada' : 'Venda não localizada',
    displayStatus: computeReceivableStatus(entry, today),
  }))
}