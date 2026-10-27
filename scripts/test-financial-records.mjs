import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { recordNumber, toDateKey } from '../src/utils/recordFilters.js'
import { isRestartClosed } from '../src/utils/systemRestart.js'
import { isSaleCancelled } from '../src/utils/saleDeletion.js'
import { accountPaymentHistory, buildFinancialView, financialAccountValues, financialDueRange } from '../src/utils/financialRecords.js'

const today = '2026-10-27'
const data = {
  receivables: [
    { id: 'legacy', clientId: 'c1', clientName: 'Cliente fictício', dueDate: '2020-01-01', amount: 100, receivedAmount: 20, status: 'Pago' },
    { id: 'paid', clientId: 'c1', dueDate: '2026-10-27', amount: 50, receivedAmount: 50 },
    { id: 'pending', clientId: 'c1', dueDate: '2026-11-01', amount: 20, receivedAmount: 0 },
  ], payments: [{ id: 'p1', receivableId: 'legacy', clientId: 'c1', amount: 20, paymentDate: today }],
  clients: [{ id: 'c1', name: 'Cliente fictício', nickname: 'Vavá' }], sales: [],
}
const before = JSON.stringify(data)
const view = buildFinancialView(data, {}, {}, {}, today)
assert.equal(view.pending, 100)
assert.equal(view.overdue, 80)
assert.equal(view.received, 20)
assert.equal(view.debtors, 1)
assert.equal(view.unlinkedAccounts, 3)
assert.equal(view.pendingCount, 2)
assert.equal(view.statusConflicts, 1)
assert.equal(buildFinancialView(data, { client: 'VAVA', status: 'Em aberto' }, {}, {}, today).selected.length, 2)
assert.equal(buildFinancialView(data, { status: 'Paga' }, {}, {}, today).selected.length, 1)
assert.equal(buildFinancialView(data, {}, financialDueRange('today', {}, today), {}, today).selected.length, 1)
assert.deepEqual(financialDueRange('week', {}, today), { from: '2026-10-26', to: '2026-11-01' })
assert.equal(financialAccountValues({ amount: 100 }, today).balance, null)
assert.equal(financialAccountValues({ amount: 100, receivedAmount: 110 }, today).balance, null)
assert.equal(financialAccountValues({ amount: 10.001, receivedAmount: 0 }, today).balance, null)
assert.equal(buildFinancialView({ receivables: [{ id: 'old-paid', amount: 100, receivedAmount: 100 }] }).untracedPaidCount, 1)
assert.equal(buildFinancialView({ receivables: [{ id: 'old-paid', amount: 100, receivedAmount: 100 }] }).receivedIncomplete, true)
assert.equal(buildFinancialView({ receivables: [{ id: 'old-paid', amount: 100, receivedAmount: 100 }] }).receivedIssues[0].code, 'untraced-paid')
assert.equal(buildFinancialView({ payments: [{ amount: 'inválido' }] }).receivedIssues[0].code, 'payment-values')
assert.equal(buildFinancialView({ payments: [{ amount: 10 }] }, {}, {}, { from: today, to: today }).receivedIssues[0].code, 'payment-dates')
assert.equal(financialAccountValues(data.receivables[0], today).status, 'Em atraso')
assert.equal(accountPaymentHistory(data.receivables[0], data.payments).length, 1)
assert.equal(JSON.stringify(data), before)
console.log('OK: conta antiga sem venda, pagamentos por ID, saldo e situação sem quitação presumida, cliente distinto por ID, filtros e campos ausentes não tratados como zero.')

const source = (await readFile(new URL('../src/services/financialService.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/^export \{.*\}\s*$/gm, '').replace(/export /g, '')
const documents = new Map()
let generatedId = 0
const ref = path => ({ path, id: path.split('/').at(-1) })
const snapshot = document => ({ ref: document, id: document.id, exists: () => documents.has(document.path), data: () => structuredClone(documents.get(document.path)) })
const service = vm.runInNewContext(`${source}\n;({ registerFinancialPaymentByUser })`, {
  db: {}, recordNumber, toDateKey, financialAccountValues, isRestartClosed, isSaleCancelled,
  collection: (_db, ...parts) => ref(parts.join('/')), doc: (parent, ...parts) => ref(parent.path ? `${parent.path}/${parts.length ? parts.join('/') : `operation-${++generatedId}`}` : parts.join('/')),
  query: (collection, ...conditions) => ({ ...collection, conditions }), where: (field, _operator, value) => ({ field, value }),
  getDocsFromServer: async query => ({ docs: [...documents].filter(([path, data]) => path.startsWith(query.path + '/') && (query.conditions || []).every(condition => data[condition.field] === condition.value)).map(([path]) => snapshot(ref(path))) }),
  serverTimestamp: () => 'timestamp-simulado',
  runTransaction: async (_db, callback) => {
    const pending = []
    await callback({
      get: async document => { assert.equal(pending.length, 0); return snapshot(document) },
      update: (document, data) => pending.push([document.path, { ...documents.get(document.path), ...structuredClone(data) }]),
      set: (document, data) => pending.push([document.path, structuredClone(data)]),
    })
    for (const [path, data] of pending) documents.set(path, data)
  },
})
const accountPath = 'users/test-only/financeiroReceber/old'
const account = { id: 'old', clientId: 'c1', amount: 100, receivedAmount: 0, dueDate: '2020-01-01' }
documents.set(accountPath, { ...account })
const payment = { amount: 30, paymentDate: today, paymentMethod: 'Pix', requestId: 'once' }
await service.registerFinancialPaymentByUser('test-only', account, payment)
assert.equal(documents.get(accountPath).receivedAmount, 30)
await service.registerFinancialPaymentByUser('test-only', account, payment)
assert.equal(documents.get(accountPath).receivedAmount, 30)
assert.equal([...documents.keys()].filter(path => path.includes('/financeiroRecebimentos/')).length, 1)
assert.equal([...documents.keys()].filter(path => path.includes('/sales/')).length, 0)
for (const amount of [0, -1, 71]) await assert.rejects(service.registerFinancialPaymentByUser('test-only', { ...account, receivedAmount: 30 }, { ...payment, requestId: `invalid-${amount}`, amount }))
await service.registerFinancialPaymentByUser('test-only', { ...account, receivedAmount: 30 }, { ...payment, amount: 70, requestId: 'finish' })
assert.equal(documents.get(accountPath).receivedAmount, 100)
assert.equal(documents.get(accountPath).status, 'Pago')
const salePath = 'users/test-only/sales/s1'
documents.set(salePath, { totalAmount: 100, paidAmount: 0, clientId: 'c1', payments: [] })
documents.set('users/test-only/financeiroReceber/a1', { saleId: 's1', clientId: 'c1', amount: 50, receivedAmount: 0 })
documents.set('users/test-only/financeiroReceber/a2', { saleId: 's1', clientId: 'c1', amount: 50, receivedAmount: 0 })
await service.registerFinancialPaymentByUser('test-only', { id: 'a2', saleId: 's1', receivedAmount: 0 }, { ...payment, amount: 20, requestId: 'specific-account' })
assert.equal(documents.get('users/test-only/financeiroReceber/a2').receivedAmount, 20)
assert.equal(documents.get('users/test-only/financeiroReceber/a1').receivedAmount, 0)
assert.equal(documents.get(salePath).paidAmount, 20)
assert.equal(documents.get(salePath).payments.length, 1)
documents.get(salePath).amountPaid = 0
await assert.rejects(service.registerFinancialPaymentByUser('test-only', { id: 'a1', saleId: 's1', receivedAmount: 0 }, { ...payment, amount: 10, requestId: 'conflict' }), error => error.code === 'financial/review-required')
assert.equal(documents.get('users/test-only/financeiroReceber/a1').receivedAmount, 0)
await assert.rejects(service.registerFinancialPaymentByUser('test-only', { ...account, receivedAmount: 100 }, { ...payment, paymentDate: '2026-02-31', requestId: 'bad-date' }), error => error.code === 'financial/invalid-date')
console.log('OK: recebimento parcial/total em conta sem venda, conta específica vinculada, transação atômica e repetição sem duplicação; nenhum SDK real usado.')