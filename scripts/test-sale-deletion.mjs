import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { packRestartValue } from '../src/utils/systemRestart.js'
import { buildDashboardSummary } from '../src/utils/dashboardSummary.js'
import { financialAccountValues } from '../src/utils/financialRecords.js'
import { buildSalesSummary } from '../src/utils/recordFilters.js'
import { isSaleCancelled, planSaleStockReturn, SALE_CANCELLATION_KIND, SALE_CANCELLATION_LABEL } from '../src/utils/saleDeletion.js'

const products = [{ id: 'p1', stockQuantity: 7, stockMovementId: 'debit-1' }]
const sale = { id: 's1', items: [{ productId: 'p1', quantity: 3 }], stockDebitProof: { version: 1, items: [{ productId: 'p1', quantity: 3, before: 10, after: 7, eventId: 'debit-1' }] } }
const before = JSON.stringify({ sale, products })
assert.equal(planSaleStockReturn(sale, products).returns[0].after, 10)
assert.equal(planSaleStockReturn(sale, products, true).returns.length, 0)
assert.equal(planSaleStockReturn({ ...sale, stockReturn: { completed: true } }, products).alreadyReturned, true)
assert.equal(planSaleStockReturn({ id: 'old', items: [{ productId: 'p1', quantity: 3 }] }, products).needsStockReview, true)
assert.equal(planSaleStockReturn(sale, [{ ...products[0], stockQuantity: 8 }]).returns.length, 0)
assert.equal(isSaleCancelled({ saleCancellation: { kind: SALE_CANCELLATION_KIND } }), true)
assert.equal(JSON.stringify({ sale, products }), before)
console.log('OK: devolução apenas comprovada, devolução anterior não repetida e venda antiga sem prova fica em conferência; nenhum dado alterado.')

const source = (await readFile(new URL('../src/services/saleDeletionService.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/export /g, '')
const docs = new Map()
const uid = 'test-delete-only'
const base = `users/${uid}`
let failCommit = false
let beforeTransaction = null
let writes = 0
const ref = path => ({ path, id: path.split('/').at(-1) })
const snapshot = document => ({ ref: document, id: document.id, exists: () => docs.has(document.path), data: () => structuredClone(docs.get(document.path)) })
const service = vm.runInNewContext(`${source}\n;({ prepareSaleDeletionByUser, executeSaleDeletionByUser })`, {
	app: { options: { projectId: 'jn-confeccoes' } }, auth: { currentUser: { uid } }, db: {},
	packRestartValue: value => packRestartValue(structuredClone(value)), isSaleCancelled, planSaleStockReturn, SALE_CANCELLATION_KIND, SALE_CANCELLATION_LABEL,
	doc: (_db, ...parts) => ref(parts.join('/')), collection: (_db, ...parts) => ref(parts.join('/')),
	getDocFromServer: async document => snapshot(document),
	getDocsFromServer: async collection => ({ docs: [...docs.keys()].filter(path => path.startsWith(collection.path + '/') && path.split('/').length === collection.path.split('/').length + 1).map(path => snapshot(ref(path))) }),
	serverTimestamp: () => 'timestamp-simulado',
	runTransaction: async (_db, callback) => {
		beforeTransaction?.()
		beforeTransaction = null
		const pending = []
		const result = await callback({ get: async document => { assert.equal(pending.length, 0); return snapshot(document) }, update: (document, value) => pending.push([document.path, { ...docs.get(document.path), ...structuredClone(value) }]) })
		if (failCommit) throw new Error('Falha simulada antes do commit')
		for (const [path, value] of pending) docs.set(path, value)
		writes += pending.length
		return result
	},
})
docs.set(base, {})
docs.set(`${base}/sales/s1`, { ...sale, paidAmount: 50, totalAmount: 300, payments: [{ amount: 50, paymentDate: '2026-10-27' }] })
docs.set(`${base}/products/p1`, { ...products[0], salePrice: 100 })
docs.set(`${base}/financeiroReceber/a1`, { saleId: 's1', amount: 300, receivedAmount: 50 })
docs.set(`${base}/financeiroRecebimentos/pay1`, { receivableId: 'a1', amount: 50, paymentDate: '2026-10-27' })
docs.set(`${base}/financeiroReceber/unrelated`, { saleId: 'another-sale', clientName: 'Mesmo nome não cria vínculo', amount: 10, receivedAmount: 0 })
const startingDocs = structuredClone([...docs])
const reviewed = await service.prepareSaleDeletionByUser(uid, 's1')
assert.equal(reviewed.counts.payments, 1)
const beforeWrite = JSON.stringify([...docs])
failCommit = true
await assert.rejects(service.executeSaleDeletionByUser(uid, 's1', reviewed), /Falha simulada/)
assert.equal(JSON.stringify([...docs]), beforeWrite)
failCommit = false
const result = await service.executeSaleDeletionByUser(uid, 's1', reviewed)
assert.equal(result.returnedUnits, 3)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 10)
assert.equal(docs.get(`${base}/products/p1`).salePrice, 100)
assert.equal(docs.get(`${base}/financeiroRecebimentos/pay1`).amount, 50)
assert.equal(isSaleCancelled(docs.get(`${base}/financeiroReceber/unrelated`)), false)
assert.equal(isSaleCancelled(docs.get(`${base}/financeiroReceber/a1`)), true)
assert.equal(isSaleCancelled(docs.get(`${base}/financeiroRecebimentos/pay1`)), true)
assert.equal(financialAccountValues(docs.get(`${base}/financeiroReceber/a1`)).balance, 0)
assert.equal(buildDashboardSummary({ sales: [{ ...docs.get(`${base}/sales/s1`), id: 's1' }], payments: [{ ...docs.get(`${base}/financeiroRecebimentos/pay1`), id: 'pay1' }], receivables: [{ ...docs.get(`${base}/financeiroReceber/a1`), id: 'a1' }] }).totalReceived, 0)
assert.equal(buildSalesSummary([docs.get(`${base}/sales/s1`)]).totalSales, 0)
const firstWrites = writes
assert.equal((await service.executeSaleDeletionByUser(uid, 's1', reviewed)).alreadyCancelled, true)
assert.equal(writes, firstWrites)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 10)
await assert.rejects(service.prepareSaleDeletionByUser('other-user', 's1'), /Entre no JN/)
console.log('OK: venda com pagamento cancelada atomicamente, conta sem cobrança, histórico financeiro preservado, falha sem alteração parcial e repetição sem nova devolução.')

const reset = () => { docs.clear(); for (const [path, value] of structuredClone(startingDocs)) docs.set(path, value) }
reset()
docs.get(`${base}/financeiroRecebimentos/pay1`).saleId = 'different-sale'
const conflictBefore = JSON.stringify([...docs])
await assert.rejects(service.prepareSaleDeletionByUser(uid, 's1'), /IDs de vendas\/clientes diferentes/)
assert.equal(JSON.stringify([...docs]), conflictBefore)
reset()
const stalePreview = await service.prepareSaleDeletionByUser(uid, 's1')
docs.get(`${base}/products/p1`).stockQuantity = 6
const staleBefore = JSON.stringify([...docs])
await assert.rejects(service.executeSaleDeletionByUser(uid, 's1', stalePreview), /mudaram/)
assert.equal(JSON.stringify([...docs]), staleBefore)

reset()
const racingPreview = await service.prepareSaleDeletionByUser(uid, 's1')
beforeTransaction = () => { docs.get(`${base}/sales/s1`).paidAmount = 60 }
const writesBeforeRace = writes
await assert.rejects(service.executeSaleDeletionByUser(uid, 's1', racingPreview), /registro mudou/)
assert.equal(writes, writesBeforeRace)
assert.equal(isSaleCancelled(docs.get(`${base}/sales/s1`)), false)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 7)

reset()
docs.set(base, { systemRestart: { result: { returns: [{ saleId: 's1', productId: 'p1', quantity: 3 }] } } })
const previouslyReturnedPreview = await service.prepareSaleDeletionByUser(uid, 's1')
assert.equal(previouslyReturnedPreview.plan.alreadyReturned, true)
assert.equal((await service.executeSaleDeletionByUser(uid, 's1', previouslyReturnedPreview)).returnedUnits, 0)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 7)

reset()
delete docs.get(`${base}/sales/s1`).stockDebitProof
const legacyPreview = await service.prepareSaleDeletionByUser(uid, 's1')
const legacyResult = await service.executeSaleDeletionByUser(uid, 's1', legacyPreview)
assert.equal(legacyResult.stockNeedsReview, true)
assert.equal(legacyResult.returnedUnits, 0)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 7)
assert.equal(financialAccountValues(docs.get(`${base}/financeiroReceber/a1`)).balance, 0)

reset()
docs.get(`${base}/sales/s1`).paidAmount = 300
docs.get(`${base}/sales/s1`).payments[0].amount = 300
docs.get(`${base}/financeiroReceber/a1`).receivedAmount = 300
docs.get(`${base}/financeiroRecebimentos/pay1`).amount = 300
const fullyPaidPreview = await service.prepareSaleDeletionByUser(uid, 's1')
await service.executeSaleDeletionByUser(uid, 's1', fullyPaidPreview)
assert.equal(docs.get(`${base}/sales/s1`).paidAmount, 300)
assert.equal(docs.get(`${base}/sales/s1`).payments[0].amount, 300)
assert.equal(docs.get(`${base}/financeiroRecebimentos/pay1`).amount, 300)
assert.equal(docs.get(`${base}/products/p1`).stockQuantity, 10)
console.log('OK: estoque/recebimento concorrente interrompem sem gravação parcial; devolução anterior não se repete; legado fica em revisão e venda totalmente paga preserva valores e datas originais.')