import { computeReceivableBalance, computeReceivableStatus, computeSaleStatus, matchesDateRange, recordNumber, toDateKey } from './recordFilters.js'
import { isRestartClosed } from './systemRestart.js'

export function getDashboardPeriod(mode = 'all', custom = {}, today = toDateKey(new Date())) {
  if (mode === 'today') return { from: today, to: today }
  if (mode === 'month') {
    const [year, month] = today.split('-').map(Number)
    return { from: `${today.slice(0, 7)}-01`, to: toDateKey(new Date(year, month, 0)) }
  }
  if (mode === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
  if (mode === 'custom') return { from: custom.from || '', to: custom.to || '' }
  return { from: '', to: '' }
}

function nonnegative(value) {
  const number = recordNumber(value)
  return number !== null && number >= 0 ? number : null
}

export function getDashboardSaleBalance(sale) {
  if (isRestartClosed(sale)) return 0
  const amount = nonnegative(sale.totalAmount)
  const paid = nonnegative(sale.paidAmount ?? sale.amountPaid)
  if (amount !== null && paid !== null && paid <= amount) return amount - paid
  const balance = nonnegative(sale.remainingAmount)
  return balance !== null && amount !== null && balance <= amount ? balance : null
}

export function buildDashboardSummary({ sales = [], payments = [], receivables = [], clients = [], products = [] }, range = {}, today = toDateKey(new Date())) {
  const warnings = []
  const warn = (code, count, message) => { if (count) warnings.push({ code, count, message }) }
  const selectedSales = sales.filter(sale => !isRestartClosed(sale) && matchesDateRange(sale.saleDate, range.from, range.to))
  const saleIds = new Set(sales.map(sale => sale.id))
  const accountsById = new Map(receivables.map(entry => [entry.id, entry]))
  const embeddedSaleIds = new Set(sales.filter(sale => Array.isArray(sale.payments) && sale.payments.length).map(sale => sale.id))
  const recordedPayments = [
    ...sales.flatMap(sale => embeddedSaleIds.has(sale.id) ? sale.payments.map(payment => ({ ...payment, saleId: sale.id })) : []),
    ...payments.filter(payment => !embeddedSaleIds.has(payment.saleId || accountsById.get(payment.receivableId)?.saleId)),
  ]
  const selectedPayments = recordedPayments.filter(payment => matchesDateRange(payment.paymentDate, range.from, range.to))
  const invalidSaleAmounts = selectedSales.filter(sale => nonnegative(sale.totalAmount) === null).length
  const unknownBalances = selectedSales.filter(sale => getDashboardSaleBalance(sale) === null).length
  const invalidPayments = selectedPayments.filter(payment => nonnegative(payment.amount) === null).length
  const invalidStocks = products.filter(product => nonnegative(product.stockQuantity) === null || !Number.isInteger(Number(product.stockQuantity))).length
  const overdueSales = sales.filter(sale => {
    const balance = getDashboardSaleBalance(sale)
    if (!(balance > 0)) return false
    return computeSaleStatus({ ...sale, paidAmount: nonnegative(sale.totalAmount) - balance }, receivables, today) === 'Atrasado'
  })
  const missingDueDates = sales.filter(sale => {
    if (!(getDashboardSaleBalance(sale) > 0)) return false
    const linked = receivables.filter(entry => entry.saleId === sale.id)
    const schedule = linked.length ? linked : Array.isArray(sale.dueDates) ? sale.dueDates : []
    return !schedule.length || schedule.some(entry => !toDateKey(entry.dueDate))
  }).length
  const stock = products.filter(product => nonnegative(product.stockQuantity) !== null && Number.isInteger(Number(product.stockQuantity)))
  const unlinkedAccounts = receivables.filter(entry => !entry.saleId || !saleIds.has(entry.saleId)).length
  const inconsistentSales = sales.filter(sale => !isRestartClosed(sale)).filter(sale => {
    const balance = getDashboardSaleBalance(sale)
    const savedBalance = nonnegative(sale.remainingAmount)
    return balance !== null && (sale.status === 'Pago' && balance > 0 || savedBalance !== null && Math.abs(savedBalance - balance) > 0.01)
  }).length
  const inconsistentAccounts = receivables.filter(entry => entry.status === 'Pago' && computeReceivableBalance(entry) > 0).length
  const missingPaymentHistory = sales.filter(sale => {
    const recorded = recordedPayments.filter(payment => payment.saleId === sale.id || accountsById.get(payment.receivableId)?.saleId === sale.id)
      .reduce((sum, payment) => sum + (nonnegative(payment.amount) ?? 0), 0)
    const paid = nonnegative(sale.paidAmount ?? sale.amountPaid)
    return paid !== null && Math.abs(paid - recorded) > 0.01
  }).length
  warn('sale-dates', sales.filter(sale => !toDateKey(sale.saleDate)).length, 'venda(s) sem data válida. Não entram em um período com datas.')
  warn('payment-dates', recordedPayments.filter(payment => !toDateKey(payment.paymentDate)).length, 'pagamento(s) sem data válida. Não entram em um período com datas.')
  warn('sale-values', invalidSaleAmounts, 'venda(s) sem valor válido. Total vendido incompleto.')
  warn('sale-balances', unknownBalances, 'venda(s) sem saldo confiável. Falta receber incompleto.')
  warn('due-dates', missingDueDates, 'venda(s) em aberto sem vencimentos completos. Não é possível confirmar todos os atrasos.')
  warn('payment-values', invalidPayments, 'pagamento(s) sem valor válido. Total recebido incompleto.')
  warn('stock-values', invalidStocks, 'produto(s) sem quantidade de estoque válida. Estoque incompleto.')
  warn('orphan-accounts', unlinkedAccounts, 'conta(s) sem venda localizada. Não foram somadas às vendas nem ao saldo das vendas.')
  warn('saved-status', inconsistentSales + inconsistentAccounts, 'registro(s) com status pago ou saldo salvo diferente dos valores registrados. Nenhum dado foi alterado.')
  warn('payment-history', missingPaymentHistory, 'venda(s) com valor pago diferente do histórico de pagamentos. O valor acumulado não foi somado novamente.')
  const historyDifferences = sales.filter(sale => {
    if (!embeddedSaleIds.has(sale.id)) return false
    const ledger = payments.filter(payment => (payment.saleId || accountsById.get(payment.receivableId)?.saleId) === sale.id)
    if (!ledger.length) return false
    const ledgerTotal = ledger.reduce((sum, payment) => sum + (nonnegative(payment.amount) ?? 0), 0)
    const saleTotal = sale.payments.reduce((sum, payment) => sum + (nonnegative(payment.amount) ?? 0), 0)
    return Math.abs(ledgerTotal - saleTotal) > 0.01
  }).length
  warn('history-sources', historyDifferences, 'venda(s) com históricos de pagamento diferentes. Foi usado o histórico da própria venda, sem unir lançamentos incertos.')
  warn('orphan-payments', recordedPayments.filter(payment => !saleIds.has(payment.saleId || accountsById.get(payment.receivableId)?.saleId)).length, 'pagamento(s) sem venda localizada. Permanecem nos recebimentos registrados, sem criar vendas.')
  const stockAttention = {
    empty: stock.filter(product => Number(product.stockQuantity) === 0),
    low: stock.filter(product => Number(product.stockQuantity) > 0 && Number(product.stockQuantity) <= 5),
  }
  return {
    totalSold: selectedSales.reduce((sum, sale) => sum + (nonnegative(sale.totalAmount) ?? 0), 0),
    totalReceived: selectedPayments.reduce((sum, payment) => sum + (nonnegative(payment.amount) ?? 0), 0),
    outstanding: selectedSales.reduce((sum, sale) => sum + (getDashboardSaleBalance(sale) ?? 0), 0),
    salesCount: selectedSales.length,
    clientsCount: clients.length,
    stockUnits: stock.reduce((sum, product) => sum + Number(product.stockQuantity), 0),
    productCount: products.length,
    incomplete: { sold: invalidSaleAmounts > 0, received: invalidPayments > 0 || historyDifferences > 0, outstanding: unknownBalances > 0, stock: invalidStocks > 0 },
    overdue: { count: overdueSales.length, amount: overdueSales.reduce((sum, sale) => sum + getDashboardSaleBalance(sale), 0), incomplete: missingDueDates > 0 || sales.some(sale => getDashboardSaleBalance(sale) === null) },
    stockAttention,
    warnings,
    selectedPaymentsCount: selectedPayments.length,
    overdueAccounts: receivables.filter(entry => computeReceivableStatus(entry, today) === 'Atrasado').length,
  }
}