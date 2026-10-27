import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { buildCleanupPlan, buildRestartPlan, isRestartClosed, packRestartValue, unpackRestartValue, CLEANUP_MARKER, RESTART_LABEL, RESTART_MARKER } from '../src/utils/systemRestart.js'
import { buildDashboardSummary } from '../src/utils/dashboardSummary.js'
import { financialAccountValues } from '../src/utils/financialRecords.js'
import { inspectClientRelations } from '../src/utils/clientRecords.js'

const data = {
  clients: [{ id: 'c1', name: 'Cliente fictício' }],
  products: [{ id: 'p1', stockQuantity: 7, stockMovementId: 'debit-1', salePrice: 100 }, { id: 'p2', stockQuantity: 3 }],
  sales: [
    { id: 's1', items: [{ productId: 'p1', quantity: 3 }], stockDebitProof: { version: 1, items: [{ productId: 'p1', quantity: 3, before: 10, after: 7, eventId: 'debit-1' }] } },
    { id: 'old', items: [{ productId: 'p2', quantity: 2 }] },
  ],
  receivables: [{ id: 'a1', saleId: 's1', amount: 300, receivedAmount: 0 }, { id: 'orphan', amount: 50, receivedAmount: 0 }],
  payments: [{ id: 'payment-preserved', amount: 10 }],
}
const original = JSON.stringify(data)
const plan = buildRestartPlan(data)
assert.equal(plan.accountIds.length, 2)
assert.equal(plan.returns.length, 1)
assert.deepEqual(plan.returns[0], { productId: 'p1', description: 'p1', before: 7, quantity: 3, after: 10, saleId: 's1' })
assert.equal(plan.unverifiedAccounts, 1)
assert.equal(plan.unverifiedSales, 1)
assert.equal(plan.counts.clients, 1)
assert.equal(plan.counts.products, 2)
assert.equal(buildRestartPlan({ ...data, products: [{ ...data.products[0], stockQuantity: 8 }] }).returns.length, 0)
assert.equal(buildRestartPlan({ ...data, sales: [{ ...data.sales[0], stockReturn: { completed: true } }] }).returns.length, 0)
assert.equal(buildRestartPlan({ ...data, sales: data.sales.map(sale => ({ ...sale, restartClosure: { kind: RESTART_MARKER } })), receivables: data.receivables.map(account => ({ ...account, restartClosure: { kind: RESTART_MARKER } })) }).accountIds.length, 0)
assert.equal(isRestartClosed({ status: 'Pago' }), false)
assert.equal(JSON.stringify(data), original)
const cleanupPlan = buildCleanupPlan(data)
assert.equal(cleanupPlan.deleteTotal, 5)
assert.equal(cleanupPlan.returns.length, 1)
const afterPreviousRestart = { ...data, sales: data.sales.map(sale => ({ ...sale, restartClosure: { kind: RESTART_MARKER } })) }
const previousCleanupPlan = buildCleanupPlan(afterPreviousRestart, { result: { returns: [{ saleId: 's1', productId: 'p1', quantity: 3 }] } })
assert.equal(previousCleanupPlan.returns.length, 0)
assert.equal(previousCleanupPlan.alreadyReturnedSales, 1)
assert.equal(previousCleanupPlan.accountIds.length, 2)
console.log('OK: plano sem pagamentos fictícios, devolução somente com prova atual, contas sem itens em revisão e nenhum cadastro modificado.')

assert.deepEqual(packRestartValue({ amount: NaN, zero: -0, nested: ['Á', null] }), ['map', [['amount', ['number', 'NaN']], ['nested', ['array', [['string', 'Á'], ['null']]]], ['zero', ['number', '-0']]]])
const specialValues = { amount: NaN, zero: -0, positive: Infinity, negative: -Infinity, date: new Date('2026-10-27T12:00:00Z'), text: '  Nome original  ', array: [null, true] }
assert.deepEqual(unpackRestartValue(JSON.parse(JSON.stringify(packRestartValue(specialValues)))), specialValues)
assert.deepEqual(unpackRestartValue(['timestamp', 10, 123], { timestamp: (seconds, nanoseconds) => ({ seconds, nanoseconds }) }), { seconds: 10, nanoseconds: 123 })
assert.throws(() => unpackRestartValue(['timestamp', 10, 123]), /conversor Firestore/)
const source = (await readFile(new URL('../src/services/systemRestartService.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/export /g, '')
const documents = new Map()
const uid = 'test-restart-only'
let failCommit = false
let writes = 0
const userPath = `users/${uid}`
const names = { clients: 'clients', products: 'products', sales: 'sales', receivables: 'financeiroReceber', payments: 'financeiroRecebimentos' }
function seed() {
  documents.clear()
  documents.set(userPath, { displayName: 'Usuário fictício' })
  for (const [source, collection] of Object.entries(names)) for (const { id, ...value } of data[source]) documents.set(`${userPath}/${collection}/${id}`, structuredClone(value))
}
const ref = path => ({ path, id: path.split('/').at(-1) })
const snapshot = document => ({ ref: document, id: document.id, exists: () => documents.has(document.path), data: () => structuredClone(documents.get(document.path)) })
const service = vm.runInNewContext(`${source}\n;({ prepareSystemRestartByUser, executeSystemRestartByUser })`, {
  app: { options: { projectId: 'jn-confeccoes' } }, auth: { currentUser: { uid } }, db: {}, crypto, TextEncoder,
  buildCleanupPlan, buildRestartPlan, isRestartClosed, packRestartValue: value => packRestartValue(structuredClone(value)), CLEANUP_MARKER, RESTART_LABEL, RESTART_MARKER,
  collection: (_db, ...parts) => ref(parts.join('/')), doc: (_db, ...parts) => ref(parts.join('/')),
  getDocFromServer: async document => { assert.ok(document.path.startsWith(userPath)); return snapshot(document) },
  getDocsFromServer: async collection => { assert.ok(collection.path.startsWith(userPath)); return { docs: [...documents.keys()].filter(path => path.startsWith(collection.path + '/') && path.split('/').length === collection.path.split('/').length + 1).map(path => snapshot(ref(path))) } },
  serverTimestamp: () => 'timestamp-simulado',
  runTransaction: async (_db, callback) => {
    const pending = []
    const result = await callback({
      get: async document => { assert.equal(pending.length, 0); return snapshot(document) },
      update: (document, value) => pending.push([document.path, { ...documents.get(document.path), ...value }]),
      set: (document, value, options) => pending.push([document.path, options?.merge ? { ...documents.get(document.path), ...value } : value]),
      delete: document => pending.push([document.path, undefined]),
    })
    if (failCommit) throw new Error('Falha simulada antes do commit')
    for (const [path, value] of pending) { if (value === undefined) documents.delete(path); else documents.set(path, structuredClone(value)) }
    writes += pending.length
    return result
  },
})
seed()
const beforeDatabase = JSON.stringify([...documents])
const prepared = await service.prepareSystemRestartByUser(uid)
assert.equal(JSON.stringify([...documents]), beforeDatabase)
assert.equal(prepared.plan.accountIds.length, 2)
assert.equal(JSON.parse(prepared.backupText).projectId, 'jn-confeccoes')
assert.equal(JSON.parse(prepared.backupText).records.length, 8)
await assert.rejects(service.executeSystemRestartByUser(uid, prepared, false), /baixe a cópia/)
failCommit = true
await assert.rejects(service.executeSystemRestartByUser(uid, prepared, true), /Falha simulada/)
assert.equal(JSON.stringify([...documents]), beforeDatabase)
failCommit = false
const result = await service.executeSystemRestartByUser(uid, prepared, true)
assert.equal(result.closedAccounts, 2)
assert.equal(result.returnedSales, 1)
assert.equal(result.verified, true)
assert.equal(documents.get(`${userPath}/products/p1`).stockQuantity, 10)
assert.equal(documents.get(`${userPath}/products/p2`).stockQuantity, 3)
assert.equal(documents.get(`${userPath}/clients/c1`).name, 'Cliente fictício')
assert.equal(documents.get(`${userPath}/products/p1`).salePrice, 100)
assert.equal(documents.get(`${userPath}/financeiroReceber/a1`).receivedAmount, 0)
assert.equal(documents.get(`${userPath}/financeiroRecebimentos/payment-preserved`).amount, 10)
assert.equal(documents.get(`${userPath}/financeiroReceber/a1`).restartClosure.label, RESTART_LABEL)
const closedAccounts = data.receivables.map(account => ({ ...account, restartClosure: { kind: RESTART_MARKER } }))
const closedSales = data.sales.map(sale => ({ ...sale, restartClosure: { kind: RESTART_MARKER } }))
assert.equal(financialAccountValues(closedAccounts[0]).balance, 0)
assert.equal(financialAccountValues(closedAccounts[0]).status, RESTART_LABEL)
assert.equal(buildDashboardSummary({ sales: closedSales, receivables: closedAccounts }).outstanding, 0)
assert.equal(buildDashboardSummary({ sales: closedSales }).salesCount, 0)
assert.equal(inspectClientRelations('c1', { sales: closedSales.map(sale => ({ ...sale, clientId: 'c1' })), receivables: closedAccounts.map(account => ({ ...account, clientId: 'c1' })) }).balance, 0)
const firstWrites = writes
const repeated = await service.executeSystemRestartByUser(uid, prepared, true)
assert.equal(repeated.alreadyCompleted, true)
assert.equal(writes, firstWrites)
assert.equal(documents.get(`${userPath}/products/p1`).stockQuantity, 10)
seed()
const changed = await service.prepareSystemRestartByUser(uid)
documents.get(`${userPath}/products/p1`).stockQuantity = 8
await assert.rejects(service.executeSystemRestartByUser(uid, changed, true), /dados mudaram/)
assert.equal(documents.get(`${userPath}/financeiroReceber/a1`).restartClosure, undefined)
await assert.rejects(service.prepareSystemRestartByUser('other-user'), /Entre na conta/)
console.log('OK: cópia antes da gravação, falha sem alteração parcial, proteção por usuário, preservação de clientes/preços/pagamentos e segunda execução sem nova devolução.')

seed()
documents.set(`${userPath}/financeiroRecebimentos/payment-preserved`, { amount: 330 })
const cleanup = await service.prepareSystemRestartByUser(uid, 'cleanup')
const beforeCleanup = JSON.stringify([...documents])
failCommit = true
await assert.rejects(service.executeSystemRestartByUser(uid, cleanup, true), /Falha simulada/)
assert.equal(JSON.stringify([...documents]), beforeCleanup)
failCommit = false
const cleared = await service.executeSystemRestartByUser(uid, cleanup, true)
assert.equal(cleared.mode, 'cleanup')
assert.equal(cleared.verified, true)
assert.equal(cleared.deletedCounts.payments, 1)
assert.equal(cleared.returnedUnits, 3)
assert.equal(documents.get(`${userPath}/products/p1`).stockQuantity, 10)
assert.equal(documents.get(`${userPath}/clients/c1`).name, 'Cliente fictício')
assert.equal(documents.get(`${userPath}/products/p1`).salePrice, 100)
assert.equal([...documents.keys()].filter(path => /\/(sales|financeiroReceber|financeiroRecebimentos|receipts|payments)\//.test(path)).length, 0)
assert.equal(buildDashboardSummary({}).totalReceived, 0)
const cleanupWrites = writes
assert.equal((await service.executeSystemRestartByUser(uid, cleanup, true)).alreadyCompleted, true)
assert.equal(writes, cleanupWrites)
seed()
const previous = await service.prepareSystemRestartByUser(uid)
await service.executeSystemRestartByUser(uid, previous, true)
const afterArchive = await service.prepareSystemRestartByUser(uid, 'cleanup')
assert.equal(afterArchive.plan.alreadyReturnedSales, 1)
assert.equal(afterArchive.plan.returns.length, 0)
await service.executeSystemRestartByUser(uid, afterArchive, true)
assert.equal(documents.get(`${userPath}/products/p1`).stockQuantity, 10)
console.log('OK: limpeza remove movimentações e recebidos de R$ 330 fictícios, falha é atômica, clientes/produtos ficam e devolução anterior não é repetida.')