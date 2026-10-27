import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { recordNumber, toDateKey } from '../src/utils/recordFilters.js'
import { displayProductDescription, displayText } from '../src/utils/displayText.js'
import { isRestartClosed } from '../src/utils/systemRestart.js'
import { buildDashboardSummary } from '../src/utils/dashboardSummary.js'
import { buildProductChanges, filterProductRecords, findProductCodeDuplicates, getProductCategories, inspectProductSales, mapProductDraft, parseProductPrice, productStock, productValuation, summarizeProducts, validateProductDraft, valueProductStock } from '../src/utils/productRecords.js'

const products = [
  { id: 'a', description: 'Água e utensílios', code: 'UT-1', category: 'Cozinha', stockQuantity: 2087, salePrice: 230, size: 'P, M, G e GG', color: 'Azul / branco' },
  { id: 'b', description: 'Panela', code: 'P-2', category: 'Panelas', stockQuantity: 0, salePrice: 125.5 },
  { id: 'c', name: 'Camiseta', stockQuantity: 3, category: 'Masculino' },
]
const before = JSON.stringify(products)
assert.equal(displayText('  Maria   da\nSilva  '), 'Maria da Silva')
assert.equal(displayText('  McDonald   D’Ávila  '), 'McDonald D’Ávila')
assert.equal(displayProductDescription('  PANELA   DE   Tramontina  GG  24cm '), 'Panela de Tramontina GG 24cm')
assert.equal(displayProductDescription('  JOGO DE PANELAS   ABC-123  P/M/G  iPhone '), 'Jogo de panelas ABC-123 P/M/G iPhone')
assert.equal(displayProductDescription('CALCA  sem acento'), 'CALCA sem acento')
assert.equal(displayProductDescription(''), 'Não informado')
assert.equal(filterProductRecords(products, 'AGUA').length, 1)
assert.equal(filterProductRecords(products, 'ut-1').length, 1)
assert.equal(filterProductRecords(products, '', 'cozinha').length, 1)
assert.equal(filterProductRecords(products, '', '', 'available').length, 2)
assert.equal(filterProductRecords(products, '', '', 'empty').length, 1)
assert.equal(getProductCategories(products).length, 3)
assert.equal(filterProductRecords(products)[0].id, 'a')
assert.deepEqual(summarizeProducts(products), { count: 3, units: 2090, empty: 1, incomplete: false })
assert.equal(summarizeProducts(products).units, buildDashboardSummary({ products }).stockUnits)
assert.equal(productStock({ stockQuantity: -1 }), null)
assert.equal(summarizeProducts([...products, { stockQuantity: 'antigo' }]).incomplete, true)
assert.equal(parseProductPrice('1.250,50'), 1250.5)
assert.equal(parseProductPrice('-1'), null)
assert.equal(parseProductPrice('Infinity'), null)
assert.equal(parseProductPrice('9'.repeat(400)), null)
assert.equal(productStock({ stockQuantity: ' ' }), null)
assert.equal(filterProductRecords([{ id: 'legacy', stockQuantity: null }], '', '', 'empty').length, 0)
const draft = mapProductDraft(products[0])
assert.deepEqual(buildProductChanges({ ...draft, brand: 'Outra marca' }, products[0]), { brand: 'Outra marca' })
const legacyProduct = { id: 'old', name: 'Produto antigo', code: 'ANT', size: '  P, M, G e GG  ', color: 'Azul / branco', category: '  Panelas antigas  ', stockQuantity: 'quantidade a conferir', salePrice: 'valor antigo' }
const legacyDraft = { ...mapProductDraft(legacyProduct), brand: 'Marca informada' }
assert.equal(validateProductDraft(legacyDraft, legacyProduct), '')
assert.deepEqual(buildProductChanges(legacyDraft, legacyProduct), { brand: 'Marca informada' })
assert.equal(validateProductDraft({ ...draft, stockQuantity: '1.5' }, products[0]).includes('inteiro'), true)
assert.equal(validateProductDraft({ ...draft, salePrice: '-1' }, products[0]).includes('preço'), true)
const utensil = { ...mapProductDraft(), description: 'Panela de teste', code: 'NOVA', stockQuantity: '2', salePrice: '230,00' }
assert.equal(validateProductDraft(utensil), '')
assert.equal(buildProductChanges(utensil).salePrice, 230)
assert.equal(findProductCodeDuplicates(products, { code: 'ut-1' }).length, 1)
assert.equal(inspectProductSales('a', [{ items: [{ productId: 'a' }] }]).salesCount, 1)
assert.equal(inspectProductSales('a', [{ items: [{ product: { id: 'a' } }] }]).salesCount, 1)
assert.equal(inspectProductSales('a', [{ items: [{ productDescription: 'Mesmo nome não cria vínculo' }] }]).unresolvedCount, 1)
assert.equal(JSON.stringify(products), before)
const valuation = valueProductStock([{ stockQuantity: 3, salePrice: 230, costPrice: 100 }, { stockQuantity: 2, salePrice: 125.5, costPrice: 80 }, { stockQuantity: 0, salePrice: 900, costPrice: 500 }])
assert.equal(valuation.saleValue, 941)
assert.equal(valuation.costValue, 460)
assert.equal(valuation.profitValue, 481)
assert.equal(valuation.saleIncomplete, false)
const missingCost = valueProductStock([{ stockQuantity: 2, salePrice: 230, costPrice: '' }])
assert.equal(missingCost.saleValue, 460)
assert.equal(missingCost.costMissingCount, 1)
assert.equal(missingCost.costIncomplete, true)
assert.equal(missingCost.profitValue, null)
const invalidValues = valueProductStock([{ stockQuantity: null, salePrice: 10 }, { stockQuantity: 2, salePrice: 'inválido' }, { stockQuantity: -1, salePrice: 20 }, { stockQuantity: 0, salePrice: 30 }])
assert.equal(invalidValues.saleReviewCount, 3)
assert.equal(invalidValues.invalidQuantityCount, 2)
assert.equal(invalidValues.invalidSalePriceCount, 1)
assert.equal(invalidValues.saleIncomplete, true)
assert.equal(productValuation({ stockQuantity: 0 }).saleCents, 0)
assert.equal(valueProductStock([{ stockQuantity: 3, salePrice: 0.1, costPrice: 0.03 }]).saleValue, 0.3)
assert.equal(valueProductStock([{ stockQuantity: 2, salePrice: 5, costPrice: 8 }]).profitValue, -6)
assert.equal(valueProductStock([{ stockQuantity: 2, salePrice: 5, costPrice: 0 }]).costMissingCount, 0)
assert.equal(valueProductStock([{ stockQuantity: 2, salePrice: 0, costPrice: 0 }]).saleValue, 0)
assert.equal(valueProductStock([{ stockQuantity: 1, salePrice: ' ', costPrice: false }]).saleIncomplete, true)
assert.equal(valueProductStock([{ stockQuantity: 1, salePrice: 1.234 }]).invalidSalePriceCount, 1)
assert.equal(valueProductStock([{ stockQuantity: Number.MAX_SAFE_INTEGER, salePrice: 20 }]).saleIncomplete, true)
assert.equal(valueProductStock([]).saleValue, 0)
assert.equal(valueProductStock([]).profitValue, 0)
assert.equal(JSON.stringify(products), before)
console.log('OK: estimativa quantidade × preço, custo ausente sem zero presumido, lucro incompleto oculto, estoque zero, centavos e avisos de revisão.')
console.log('OK: busca, categorias reais, estoque inteiro e igual ao Dashboard, preços, utensílios sem tamanho/cor, edição parcial e vendas por ID; dados preservados.')

const source = (await readFile(new URL('../src/services/productsService.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/export /g, '')
const writes = []
let serverSales = [{ id: 's1', items: [{ productId: 'linked' }] }]
let currentStock = 4
const service = vm.runInNewContext(`${source}\n;({ deleteProductByUser, updateProductByUser })`, {
  db: {}, collection: (_db, ...parts) => ({ path: parts.join('/') }), doc: (_db, ...parts) => ({ path: parts.join('/') }),
  getDocsFromServer: async () => ({ docs: serverSales.map(({ id, ...data }) => ({ id, data: () => data })) }),
  deleteDoc: async ref => writes.push({ type: 'delete', path: ref.path }),
  updateDoc: async (ref, data) => writes.push({ type: 'update', path: ref.path, data }),
  runTransaction: async (_db, callback) => callback({ get: async () => ({ exists: () => true, data: () => ({ stockQuantity: currentStock }) }), update: (ref, data) => writes.push({ type: 'transaction', path: ref.path, data }) }),
  serverTimestamp: () => 'timestamp-simulado', inspectProductSales,
})
await assert.rejects(service.deleteProductByUser('test-only', 'linked'), error => error.code === 'products/delete-blocked')
assert.equal(writes.length, 0)
serverSales = [{ id: 'legacy', items: [{ productDescription: 'Sem ID' }] }]
await assert.rejects(service.deleteProductByUser('test-only', 'unlinked'), error => error.code === 'products/delete-blocked')
assert.equal(writes.length, 0)
serverSales = []
await service.deleteProductByUser('test-only', 'unlinked')
assert.equal(writes[0].path, 'users/test-only/products/unlinked')
await service.updateProductByUser('test-only', 'p1', { brand: 'Outra marca' })
assert.equal(Object.hasOwn(writes[1].data, 'stockQuantity'), false)
await assert.rejects(service.updateProductByUser('test-only', 'p1', { stockQuantity: 8 }, 5), error => error.code === 'products/stock-changed')
assert.equal(writes.length, 2)
await service.updateProductByUser('test-only', 'p1', { stockQuantity: 8 }, currentStock)
assert.equal(writes[2].data.stockQuantity, 8)
console.log('OK: exclusão vinculada/legada bloqueada, edição parcial não toca estoque e alteração concorrente impede sobrescrita; SDK inteiramente simulado.')

const salesSource = (await readFile(new URL('../src/services/salesService.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/export /g, '')
const documents = new Map([['users/test-only/products/p1', { stockQuantity: 10, size: 'P, M, G e GG', color: 'Azul / branco' }]])
let generatedId = 0
const salesService = vm.runInNewContext(`${salesSource}\n;({ createSaleByUser })`, {
  db: {}, console, recordNumber, toDateKey, isRestartClosed,
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  doc: (ref, ...parts) => {
    const path = ref.path ? `${ref.path}/${parts.length ? parts.join('/') : `sale-${++generatedId}`}` : parts.join('/')
    return { path, id: path.split('/').at(-1) }
  },
  serverTimestamp: () => 'timestamp-simulado',
  runTransaction: async (_db, callback) => {
    const pending = []
    const result = await callback({
      get: async ref => ({ exists: () => documents.has(ref.path), data: () => ({ ...documents.get(ref.path) }) }),
      update: (ref, data) => pending.push([ref.path, { ...documents.get(ref.path), ...data }]),
      set: (ref, data) => pending.push([ref.path, data]),
    })
    for (const [path, data] of pending) documents.set(path, data)
    return result
  },
})
const sale = { clientId: 'client-test', clientName: 'Cliente fictício', saleDate: '2026-10-27', paymentMethod: 'À Vista', items: [{ productId: 'p1', quantity: 2, unitPrice: 230, discount: 0 }] }
await salesService.createSaleByUser('test-only', sale)
assert.equal(documents.get('users/test-only/products/p1').stockQuantity, 8)
assert.equal(documents.get('users/test-only/products/p1').size, 'P, M, G e GG')
assert.equal(documents.get('users/test-only/products/p1').color, 'Azul / branco')
await assert.rejects(salesService.createSaleByUser('test-only', { ...sale, items: [{ ...sale.items[0], quantity: 9 }] }), error => error.code === 'sales/insufficient-stock')
assert.equal(documents.get('users/test-only/products/p1').stockQuantity, 8)
console.log('OK: criação de venda existente baixa somente a quantidade total do produto e recusa estoque insuficiente; tamanhos e cores preservados em banco simulado.')
await salesService.createSaleByUser('test-only', { ...sale, items: [{ ...sale.items[0], quantity: 2 }, { ...sale.items[0], quantity: 3 }] })
assert.equal(documents.get('users/test-only/products/p1').stockQuantity, 3)
await assert.rejects(salesService.createSaleByUser('test-only', { ...sale, items: [{ ...sale.items[0], quantity: 2 }, { ...sale.items[0], quantity: 2 }] }), error => error.code === 'sales/insufficient-stock')
assert.equal(documents.get('users/test-only/products/p1').stockQuantity, 3)
console.log('OK: produto repetido em mais de uma linha soma quantidades e desconta estoque uma única vez.')