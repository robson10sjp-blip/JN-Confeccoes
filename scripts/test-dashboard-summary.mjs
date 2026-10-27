import assert from 'node:assert/strict'
import { buildDashboardSummary, getDashboardPeriod } from '../src/utils/dashboardSummary.js'

const today = '2026-10-27'
const data = {
  sales: [
    { id: 's1', saleDate: '2026-09-01', totalAmount: 100, paidAmount: 40, payments: [{ amount: 40, paymentDate: '2026-10-01' }] },
    { id: 's2', saleDate: '2026-10-27', totalAmount: 50, paidAmount: 50, status: 'Pago' },
  ],
  payments: [{ id: 'p1', saleId: 's1', amount: 40, paymentDate: '2026-10-01' }, { id: 'orphan', amount: 10, paymentDate: '27/10/2026' }],
  receivables: [{ id: 'r1', saleId: 's1', amount: 100, receivedAmount: 40, dueDate: '2026-10-01' }, { id: 'old', amount: 300, receivedAmount: 0, dueDate: '2020-01-01', status: 'Pago' }],
  clients: [{ id: 'c1' }, { id: 'c2' }],
  products: [{ id: 'p1', stockQuantity: 2087 }, { id: 'p2', stockQuantity: 0 }, { id: 'p3', stockQuantity: 3 }],
}
const original = JSON.stringify(data)
const all = buildDashboardSummary(data, {}, today)
assert.equal(all.totalSold, 150)
assert.equal(all.totalReceived, 50)
assert.equal(all.outstanding, 60)
assert.equal(all.salesCount, 2)
assert.equal(all.clientsCount, 2)
assert.equal(all.stockUnits, 2090)
assert.equal(all.productCount, 3)
assert.deepEqual(all.overdue, { count: 1, amount: 60, incomplete: false })
assert.equal(all.stockAttention.empty.length, 1)
assert.equal(all.stockAttention.low.length, 1)
assert.ok(all.warnings.some(warning => warning.code === 'orphan-accounts'))
assert.ok(all.warnings.some(warning => warning.code === 'saved-status'))
assert.ok(all.warnings.some(warning => warning.code === 'payment-history'))
const month = buildDashboardSummary(data, getDashboardPeriod('month', {}, today), today)
assert.equal(month.totalSold, 50)
assert.equal(month.totalReceived, 50)
assert.equal(month.outstanding, 0)
assert.equal(month.clientsCount, 2)
assert.equal(month.stockUnits, all.stockUnits)
const day = buildDashboardSummary(data, getDashboardPeriod('today', {}, today), today)
assert.equal(day.totalReceived, 10)
assert.equal(day.totalSold, 50)
assert.deepEqual(getDashboardPeriod('year', {}, today), { from: '2026-01-01', to: '2026-12-31' })
assert.deepEqual(getDashboardPeriod('month', {}, today), { from: '2026-10-01', to: '2026-10-31' })
assert.equal(buildDashboardSummary({ sales: [{ id: 'no-date', totalAmount: 5, paidAmount: 0 }] }, {}, today).totalSold, 5)
assert.equal(buildDashboardSummary({ sales: [{ id: 'no-date', totalAmount: 5, paidAmount: 0 }] }, getDashboardPeriod('today', {}, today), today).totalSold, 0)
const invalid = buildDashboardSummary({ sales: [{ totalAmount: 'invalid' }], products: [{ stockQuantity: -1 }, { stockQuantity: ' ' }] }, {}, today)
assert.equal(invalid.incomplete.sold, true)
assert.equal(invalid.incomplete.outstanding, true)
assert.equal(invalid.incomplete.stock, true)
assert.equal(buildDashboardSummary({}, {}, today).salesCount, 0)
assert.equal(JSON.stringify(data), original)
const fallbackPayments = buildDashboardSummary({ sales: [{ id: 's1', saleDate: today, totalAmount: 100, paidAmount: 40 }], payments: [{ saleId: 's1', paymentDate: today, amount: 40 }] }, {}, today)
assert.equal(fallbackPayments.totalReceived, 40)
const mixedHistories = buildDashboardSummary({ ...data, payments: [...data.payments, { saleId: 's1', amount: 7, paymentDate: today }] }, {}, today)
assert.equal(mixedHistories.totalReceived, 50)
assert.ok(mixedHistories.warnings.some(warning => warning.code === 'history-sources'))
assert.equal(mixedHistories.incomplete.received, true)
const noDoubleByAccount = buildDashboardSummary({ ...data, payments: [{ receivableId: 'r1', amount: 40, paymentDate: today }] }, {}, today)
assert.equal(noDoubleByAccount.totalReceived, 40)
const paidOldSale = buildDashboardSummary({ sales: [{ id: 'paid', saleDate: '2020-01-01', totalAmount: 100, paidAmount: 100, status: 'Pago' }], receivables: [{ saleId: 'paid', amount: 100, receivedAmount: 100, dueDate: '2020-02-01' }] }, {}, today)
assert.equal(paidOldSale.overdue.count, 0)
const unconfirmedOverdue = buildDashboardSummary({ sales: [{ id: 'legacy', totalAmount: 100, paidAmount: 0 }] }, {}, today)
assert.equal(unconfirmedOverdue.overdue.incomplete, true)
const savedBalance = buildDashboardSummary({ sales: [{ id: 'legacy', totalAmount: 100, remainingAmount: 60, status: 'Pago', dueDates: [{ amount: 100, dueDate: '2020-01-01' }] }] }, {}, today)
assert.equal(savedBalance.overdue.count, 1)
assert.equal(savedBalance.outstanding, 60)
console.log('OK: venda e recebimento por datas próprias, histórico sem duplicação, saldo sem contas avulsas, estoque em unidades, avisos e registros preservados.')