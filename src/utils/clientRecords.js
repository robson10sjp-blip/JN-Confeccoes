import { getDashboardSaleBalance } from './dashboardSummary.js'
import { computeSaleStatus, recordNumber, sortRecordsByDate } from './recordFilters.js'
import { isRestartClosed } from './systemRestart.js'
import { isSaleCancelled } from './saleDeletion.js'

export function normalizeClientText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits
}

export function isValidClientPhone(value) {
  if (!String(value ?? '').trim()) return true
  if (!/^[\d\s()+.\-]+$/.test(String(value))) return false
  const digits = phoneDigits(value)
  return /^[1-9]{2}(?:[2-5]\d{7}|9\d{8})$/.test(digits)
}

export function formatClientPhoneInput(value) {
  const text = String(value ?? '')
  if (/[^\d\s()+.\-]/.test(text)) return text
  const digits = phoneDigits(text)
  if (digits.length > 11) return text
  if (!digits) return ''
  if (digits.length < 3) return `(${digits}`
  const local = digits.slice(2)
  const split = local.length > 8 ? 5 : 4
  return `(${digits.slice(0, 2)}) ${local.length > split ? `${local.slice(0, split)}-${local.slice(split)}` : local}`
}

export function filterClientRecords(clients, search = '', city = '') {
  const term = normalizeClientText(search)
  const digits = search.replace(/\D/g, '')
  return clients.filter(client => {
    const textMatch = [client.name, client.nickname, client.phone, client.secondaryPhone].some(value => normalizeClientText(value).includes(term))
    const phoneMatch = digits && /^[\d\s()+.\-]+$/.test(search) && [client.phone, client.secondaryPhone].some(value => phoneDigits(value).includes(digits))
    return (!term || textMatch || phoneMatch) && (!city || normalizeClientText(client.city) === city)
  }).sort((first, second) => String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR', { sensitivity: 'base' }) || String(first.id).localeCompare(String(second.id)))
}

export function getClientCities(clients) {
  const cities = new Map()
  for (const client of clients) {
    const label = String(client.city || '').trim()
    if (label) cities.set(normalizeClientText(label), label)
  }
  return [...cities].map(([value, label]) => ({ value, label })).sort((first, second) => first.label.localeCompare(second.label, 'pt-BR'))
}

export function findClientDuplicates(clients, candidate) {
  const cpf = String(candidate.cpf || '').replace(/\D/g, '')
  const phones = [candidate.phone, candidate.secondaryPhone].filter(value => phoneDigits(value) && isValidClientPhone(value)).map(phoneDigits)
  return clients.filter(client => client.id !== candidate.id && (
    cpf.length === 11 && String(client.cpf || '').replace(/\D/g, '') === cpf ||
    normalizeClientText(client.name) === normalizeClientText(candidate.name) && [client.phone, client.secondaryPhone].some(value => isValidClientPhone(value) && phones.includes(phoneDigits(value)))
  ))
}

export function validateClientDraft(draft, original = null) {
  if (!String(draft.name || '').trim()) return 'Informe o nome do cliente.'
  if ((!original || String(original.phone ?? '') !== draft.phone) && !isValidClientPhone(draft.phone)) return 'Confira o telefone principal: use DDD e número, com 10 ou 11 dígitos, ou deixe o campo vazio.'
  const secondaryPhone = String(draft.secondaryPhone ?? '')
  if ((!original || String(original.secondaryPhone ?? '') !== secondaryPhone) && !isValidClientPhone(secondaryPhone)) return 'Confira o outro telefone: use DDD e número, com 10 ou 11 dígitos, ou deixe o campo vazio.'
  if (!secondaryPhone.trim() && String(draft.secondaryPhoneLabel ?? '').trim() && (!original || String(original.secondaryPhoneLabel ?? '') !== draft.secondaryPhoneLabel || String(original.secondaryPhone ?? '') !== secondaryPhone)) return 'Informe o outro telefone ou deixe sua identificação vazia.'
  if (draft.cpf && (!original || String(original.cpf ?? '') !== draft.cpf) && !/^\d{11}$/.test(draft.cpf.replace(/[.\-\s]/g, ''))) return 'O CPF deve ter 11 dígitos, ou o campo pode ficar vazio.'
  return ''
}

export function buildClientChanges(draft, original = null) {
  return Object.fromEntries(Object.entries(draft)
    .filter(([field, value]) => !original || String(original[field] ?? '') !== value)
    .map(([field, value]) => [field, value.trim()]))
}

function reliableClientSaleBalance(sale) {
  if (isSaleCancelled(sale)) return 0
  if (isRestartClosed(sale)) return 0
  const amount = recordNumber(sale.totalAmount)
  const paidValue = sale.paidAmount ?? sale.amountPaid
  const paid = recordNumber(paidValue)
  const balance = getDashboardSaleBalance(sale)
  if (amount === null || amount < 0 || balance === null) return null
  if (paidValue !== undefined && paidValue !== null && (paid === null || paid < 0 || paid > amount)) return null
  if (sale.paidAmount !== undefined && sale.amountPaid !== undefined && recordNumber(sale.paidAmount) !== recordNumber(sale.amountPaid)) return null
  if (sale.remainingAmount !== undefined && (recordNumber(sale.remainingAmount) === null || Math.abs(Number(sale.remainingAmount) - balance) > 0.01)) return null
  return balance
}

export function inspectClientRelations(clientId, records) {
  const sales = (records.sales || []).filter(sale => sale.clientId === clientId)
  const saleIds = new Set(sales.map(sale => sale.id))
  const accounts = (records.receivables || []).filter(entry => entry.clientId === clientId || saleIds.has(entry.saleId))
  const accountIds = new Set(accounts.map(entry => entry.id))
  const related = entry => entry.clientId === clientId || saleIds.has(entry.saleId) || accountIds.has(entry.receivableId)
  const payments = (records.payments || []).filter(related)
  const receipts = (records.receipts || []).filter(related)
  const otherPayments = (records.otherPayments || []).filter(related)
  const allSales = new Map((records.sales || []).map(sale => [sale.id, sale]))
  const allAccounts = new Map((records.receivables || []).map(entry => [entry.id, entry]))
  const owners = entry => new Set([entry.clientId, allSales.get(entry.saleId)?.clientId, allAccounts.get(entry.receivableId)?.clientId, allSales.get(allAccounts.get(entry.receivableId)?.saleId)?.clientId].filter(Boolean))
  const hasReliableOwner = entry => owners(entry).size === 1
  const unresolvedCount = Object.values(records).flat().filter(entry => !hasReliableOwner(entry)).length
  const conflicting = [...accounts, ...payments, ...receipts, ...otherPayments].some(entry => owners(entry).size > 1)
  const balances = sales.map(reliableClientSaleBalance)
  const inconsistentSales = sales.filter(sale => !isRestartClosed(sale) && !isSaleCancelled(sale)).some(sale => {
    const linked = accounts.filter(entry => entry.saleId === sale.id)
    if (!linked.length) return false
    const amounts = linked.map(entry => recordNumber(entry.amount))
    const received = linked.map(entry => recordNumber(entry.receivedAmount))
    if ([...amounts, ...received].some(value => value === null || value < 0)) return true
    if (linked.some((entry, index) => received[index] > amounts[index])) return true
    const accountAmount = amounts.reduce((sum, value) => sum + value, 0)
    const accountPaid = received.reduce((sum, value) => sum + value, 0)
    return Math.abs(accountAmount - Number(sale.totalAmount)) < 0.01 && Math.abs(accountAmount - accountPaid - reliableClientSaleBalance(sale)) > 0.01
  })
  const accountBalances = accounts.filter(entry => !saleIds.has(entry.saleId)).map(entry => {
    if (isRestartClosed(entry) || isSaleCancelled(entry)) return 0
    const amount = recordNumber(entry.amount)
    const received = recordNumber(entry.receivedAmount)
    return amount === null || received === null || amount < 0 || received < 0 || received > amount ? null : amount - received
  })
  const hasRelated = sales.length + accounts.length + payments.length + receipts.length + otherPayments.length > 0
  return {
    sales: sortRecordsByDate(sales.map(sale => {
      const balance = reliableClientSaleBalance(sale)
      return { ...sale, displayStatus: balance === null ? 'Precisa de revisão' : computeSaleStatus({ ...sale, paidAmount: Number(sale.totalAmount) - balance }, accounts) }
    }), 'saleDate'),
    accounts,
    payments,
    hasRelated,
    unresolvedCount,
    unresolvedDebtCount: [...(records.sales || []), ...(records.receivables || [])].filter(entry => !isRestartClosed(entry) && !isSaleCancelled(entry) && !hasReliableOwner(entry)).length,
    conflicting,
    balance: !sales.some(sale => !isRestartClosed(sale) && !isSaleCancelled(sale)) && !accounts.some(account => !isRestartClosed(account) && !isSaleCancelled(account)) ? 0 : conflicting || inconsistentSales || [...balances, ...accountBalances].some(value => value === null) ? null : [...balances, ...accountBalances].reduce((sum, value) => sum + value, 0),
  }
}