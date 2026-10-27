import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { recordNumber, toDateKey } from '../src/utils/recordFilters.js'
import { buildSaleDueDates, buildSalesView, saleRecordedPayments } from '../src/utils/salesRecords.js'
import { isRestartClosed } from '../src/utils/systemRestart.js'
import { isSaleCancelled } from '../src/utils/saleDeletion.js'

const viewSales = [{ id: 'old', clientId: 'c1', saleDate: '2020-01-01', totalAmount: 100, paidAmount: 40, payments: [{ amount: 40, paymentDate: '2026-10-27' }] }, { id: 'new', clientId: 'c2', saleDate: '2026-10-27', totalAmount: 50, paidAmount: 50 }]
const viewClients = [{ id: 'c1', name: 'Cliente fictício', nickname: 'Vavá' }, { id: 'c2', name: 'Outro cliente' }]
const view = buildSalesView(viewSales, viewClients, [], [], {}, { from: '2026-10-27', to: '2026-10-27' })
assert.equal(view.rows.length, 1)
assert.equal(view.summary.totalSold, 50)
assert.equal(view.summary.totalReceived, 40)
assert.equal(buildSalesView(viewSales, viewClients, [], [], { client: 'VAVA', status: 'Em aberto' }, {}).rows.length, 1)
assert.equal(buildSalesView(viewSales, viewClients, [], [], { status: 'Paga' }, {}).rows.length, 1)
assert.equal(saleRecordedPayments(viewSales[0], [{ saleId: 'old', amount: 40 }]).length, 1)
assert.deepEqual(buildSaleDueDates(2, '2026-01-31', 100.01).map(entry => entry.dueDate), ['2026-01-31', '2026-02-28'])
assert.deepEqual(buildSaleDueDates(2, '2026-01-31', 100.01).map(entry => entry.amount), [50, 50.01])

const source = (await readFile(new URL('../src/services/salesService.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/export /g, '')
const documents = new Map()
let generatedId = 0
let committed = []
const ref = path => ({ path, id: path.split('/').at(-1) })
const snapshot = document => ({ id: document.id, ref: document, exists: () => documents.has(document.path), data: () => structuredClone(documents.get(document.path)) })
const getDocs = async query => ({ docs: [...documents].filter(([path, data]) => path.startsWith(query.path + '/') && path.split('/').length === query.path.split('/').length + 1 && (query.conditions || []).every(condition => data[condition.field] === condition.value)).map(([path]) => snapshot(ref(path))) })
const service = vm.runInNewContext(`${source}\n;({ createSaleByUser, updateSaleByUser, registerSalePaymentByUser })`, {
  db: {}, console, recordNumber, toDateKey, isRestartClosed, isSaleCancelled,
  collection: (_db, ...parts) => ref(parts.join('/')),
  doc: (parent, ...parts) => ref(parent.path ? `${parent.path}/${parts.length ? parts.join('/') : `generated-${++generatedId}`}` : parts.join('/')),
  query: (collection, ...conditions) => ({ ...collection, conditions }), where: (field, _operator, value) => ({ field, value }),
  getDocs, getDocsFromServer: getDocs,
  serverTimestamp: () => 'timestamp-simulado', Timestamp: { fromDate: date => ({ seconds: date.getTime() / 1000 }) },
  runTransaction: async (_db, callback) => {
    const pending = []
    const result = await callback({
      get: async document => { assert.equal(pending.length, 0, 'Todos os reads devem ocorrer antes dos writes'); assert.equal(document.conditions, undefined, 'Transação não aceita consulta'); return snapshot(document) },
      update: (document, data) => pending.push([document.path, { ...documents.get(document.path), ...structuredClone(data) }]),
      set: (document, data) => pending.push([document.path, structuredClone(data)]),
    })
    for (const [path, data] of pending) documents.set(path, data)
    committed = pending
    return result
  },
})
const productPath = 'users/test-only/products/p1'
documents.set(productPath, { stockQuantity: 10, salePrice: 230 })
const payload = { clientId: 'c1', clientName: 'Cliente fictício', saleDate: '2026-10-27', paymentMethod: 'À Vista', items: [{ productId: 'p1', quantity: 2, unitPrice: 100, discount: 0 }] }
const saleId = await service.createSaleByUser('test-only', payload)
const salePath = `users/test-only/sales/${saleId}`
assert.equal(documents.get(productPath).stockQuantity, 8)
assert.equal(documents.get(salePath).payments[0].amount, 200)
const repeatedPayload = { ...payload, items: [{ ...payload.items[0], quantity: 1 }] }
await service.createSaleByUser('test-only', repeatedPayload, 'same-request')
const stockAfterFirst = documents.get(productPath).stockQuantity
await service.createSaleByUser('test-only', repeatedPayload, 'same-request')
assert.equal(documents.get(productPath).stockQuantity, stockAfterFirst)
assert.equal([...documents.keys()].filter(path => path.endsWith('/same-request')).length, 1)
const paymentBefore = JSON.stringify(documents.get(salePath).payments)
await service.updateSaleByUser('test-only', saleId, payload)
assert.equal(documents.get(productPath).stockQuantity, stockAfterFirst)
assert.ok(committed.every(([path]) => path !== productPath))
assert.equal(Object.hasOwn(committed.find(([path]) => path === salePath)[1], 'payments'), true)
assert.equal(documents.get(salePath).items[0].unitPrice, 100)
documents.get(salePath).saleDate = '27/10/2026'
documents.get(salePath).items[0].legacyField = 'preservar'
await service.updateSaleByUser('test-only', saleId, payload)
assert.equal(documents.get(salePath).saleDate, '27/10/2026')
assert.equal(documents.get(salePath).items[0].legacyField, 'preservar')
assert.equal(JSON.stringify(documents.get(salePath).payments), paymentBefore)
await assert.rejects(service.updateSaleByUser('test-only', saleId, { ...payload, items: [{ ...payload.items[0], quantity: 3 }] }), error => error.code === 'sales/financial-edit-blocked')
const termPayload = { ...payload, paymentMethod: 'Prazo', installments: 1, firstDueDate: '2026-11-27', dueDates: [{ dueDate: '2026-11-27', amount: 200 }] }
const termId = await service.createSaleByUser('test-only', termPayload)
const accountPaths = [...documents.keys()].filter(path => path.includes('/financeiroReceber/'))
const accountBefore = JSON.stringify(accountPaths.map(path => documents.get(path)))
await service.updateSaleByUser('test-only', termId, { ...termPayload, saleDate: '2026-10-26' })
assert.equal(JSON.stringify(accountPaths.map(path => documents.get(path))), accountBefore)
assert.deepEqual([...documents.keys()].filter(path => path.includes('/financeiroReceber/')), accountPaths)
const initialTermId = await service.createSaleByUser('test-only', { ...termPayload, items: [{ ...payload.items[0], quantity: 1 }], dueDates: [{ dueDate: '2026-11-27', amount: 100 }], initialPaidAmount: 25, initialPaymentDate: '2026-10-27' })
assert.equal(documents.get(`users/test-only/sales/${initialTermId}`).paidAmount, 25)
assert.equal(documents.get(`users/test-only/sales/${initialTermId}`).remainingAmount, 75)
const initialTermPath = `users/test-only/sales/${initialTermId}`
await service.registerSalePaymentByUser('test-only', initialTermId, 20, '2026-10-27', 'payment-once')
assert.equal(documents.get(initialTermPath).paidAmount, 45)
await service.registerSalePaymentByUser('test-only', initialTermId, 20, '2026-10-27', 'payment-once')
assert.equal(documents.get(initialTermPath).paidAmount, 45)
assert.equal(documents.get(initialTermPath).payments.length, 2)
assert.equal([...documents.values()].filter(entry => entry.saleId === initialTermId && entry.installment).reduce((sum, entry) => sum + entry.receivedAmount, 0), 45)
await assert.rejects(service.registerSalePaymentByUser('test-only', initialTermId, 100, '2026-10-27', 'over-balance'), error => error.code === 'sales/payment-over-balance')
console.log('OK: edição sem nova baixa, preços históricos preservados, nenhuma parcela/pagamento refeito, alterações financeiras vinculadas bloqueadas e reads antes dos writes.')
console.log('OK: criação e pagamento idempotentes, entrada explícita e atualização atômica de parcelas, sem pagamento duplicado.')