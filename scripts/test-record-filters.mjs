import assert from 'node:assert/strict'
import { buildSalesSummary, computeReceivableBalance, computeReceivableStatus, computeSaleStatus, filterRecords, formatRecordDate, prepareReceivables, prepareSales, sortRecordsByDate, toDateKey } from '../src/utils/recordFilters.js'

assert.equal(toDateKey('27/10/2026'), '2026-10-27')
assert.equal(toDateKey('2026-10-27T00:00:00Z'), '2026-10-27')
assert.equal(toDateKey({ toDate: () => new Date(2026, 9, 27) }), '2026-10-27')
assert.equal(toDateKey('31/02/2026'), '')
assert.equal(formatRecordDate('2026-10-27'), '27/10/2026')
assert.equal(formatRecordDate(null), 'Não informada')
assert.equal(formatRecordDate('31/02/2026'), 'Data inválida')
const records = [{ id: 'legacy' }, { id: 'old', saleDate: '01/01/2025' }, { id: 'new', saleDate: '2026-10-27' }]
assert.deepEqual(sortRecordsByDate(records, 'saleDate').map(record => record.id), ['new', 'old', 'legacy'])
assert.equal(records[0].id, 'legacy')
console.log('OK: datas brasileiras, Timestamp, datas ausentes e ordenação sem excluir registros antigos.')

const today = '2026-10-27'
const sales = [{ id: 's1', clientId: 'c1', saleDate: '01/09/2026', totalAmount: 100, paidAmount: 40, items: [{ quantity: 2 }] }, { id: 's2', totalAmount: 50, paidAmount: 50 }]
const clients = [{ id: 'c1', name: 'Cliente de teste' }, { id: 'c2', name: 'Cliente de teste' }]
const receivables = [
	{ id: 'r1', saleId: 's1', clientId: 'c1', dueDate: '01/10/2026', amount: 100, receivedAmount: 40 },
	{ id: 'legacy', clientId: 'c2', dueDate: '2025-01-01', amount: 200, receivedAmount: 0, status: 'Pago' },
	{ id: 'paid', saleId: 'deleted', dueDate: '2025-01-01', amount: 50, receivedAmount: 50 },
	{ id: 'no-date', amount: 20 },
	{ id: 'invalid', amount: 'inválido' },
]
const before = JSON.stringify({ sales, clients, receivables })
const preparedSales = prepareSales(sales, clients, receivables, today)
const preparedAccounts = prepareReceivables(receivables, sales, clients, today)
assert.equal(computeReceivableStatus(receivables[1], today), 'Atrasado')
assert.equal(computeReceivableStatus(receivables[2], today), 'Pago')
assert.equal(computeReceivableStatus(receivables[3], today), 'Pendente')
assert.equal(computeReceivableStatus(receivables[4], today), 'Não informado')
assert.equal(computeReceivableStatus({ amount: -1 }, today), 'Não informado')
assert.equal(computeReceivableStatus({ amount: ' ' }, today), 'Não informado')
assert.equal(computeReceivableBalance(receivables[0]), 60)
assert.equal(preparedSales[0].clientName, 'Cliente de teste')
assert.equal(preparedSales[1].clientName, 'Cliente não identificado')
assert.equal(preparedAccounts[0].saleDate, '01/09/2026')
assert.equal(preparedAccounts[1].saleDate, '')
assert.equal(preparedAccounts[1].saleLink, 'Sem venda vinculada')
assert.equal(preparedAccounts[2].saleLink, 'Venda não localizada')
assert.equal(preparedAccounts[1].status, 'Pago')
assert.equal(filterRecords(preparedSales, { saleFrom: '2026-09-01', saleTo: '2026-09-01' }).length, 1)
assert.equal(filterRecords(preparedSales, { dueFrom: '2026-10-01', dueTo: '2026-10-01' }).length, 1)
assert.equal(filterRecords(preparedAccounts, { saleFrom: '2025-01-01', saleTo: '2025-01-01' }).length, 0)
assert.equal(filterRecords(preparedAccounts, { status: 'Pendente' }).length, 3)
assert.equal(filterRecords(preparedAccounts, { status: 'Atrasado' }).length, 2)
assert.equal(filterRecords(preparedAccounts, { status: 'Pago' }).length, 1)
assert.equal(filterRecords(preparedAccounts, { dueFrom: '2026-10-01', dueTo: '2026-10-01', client: 'CLIENTE', status: 'Pendente' }).length, 1)
assert.equal(filterRecords(preparedAccounts, { saleFrom: '2026-10-30', saleTo: '2026-10-01' }).length, 0)
assert.deepEqual(buildSalesSummary(preparedSales), { totalSales: 2, totalSoldValue: 150, totalProductsSold: 2 })
assert.equal(buildSalesSummary([]).totalSoldValue, 0)
assert.equal(preparedAccounts.filter(entry => entry.saleLink !== 'Vinculada').length, 4)
assert.equal(computeSaleStatus({ id: 'schedule', totalAmount: 100, paidAmount: 50, dueDates: [{ dueDate: '2026-09-01', amount: 50 }, { dueDate: '2026-11-01', amount: 50 }] }, [], today), 'Parcial')
assert.equal(computeSaleStatus({ totalAmount: 100, paidAmount: 100 }, [], today), 'Pago')
assert.equal(JSON.stringify({ sales, clients, receivables }), before)
console.log('OK: filtros inclusivos, datas distintas, saldos, atraso sem quitação automática, vínculos exatos e totais sem duplicação; dados originais preservados.')