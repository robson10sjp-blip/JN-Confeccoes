import { buildDashboardSummary } from './dashboardSummary.js'
import { recordNumber } from './recordFilters.js'
import { displayProductDescription } from './displayText.js'

export const PRODUCT_FIELDS = ['code', 'description', 'category', 'size', 'color', 'brand', 'stockQuantity', 'costPrice', 'salePrice', 'observation']

export function normalizeProductText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

export function productDescription(product) {
  return displayProductDescription(product.description || product.name)
}

export function productStock(product) {
  const quantity = recordNumber(product.stockQuantity)
  return quantity !== null && quantity >= 0 && Number.isInteger(quantity) ? quantity : null
}

export function summarizeProducts(products) {
  const summary = buildDashboardSummary({ products })
  return { count: summary.productCount, units: summary.stockUnits, empty: summary.stockAttention.empty.length, incomplete: summary.incomplete.stock }
}

function priceInCents(value) {
  const amount = recordNumber(value)
  if (amount === null || amount < 0) return null
  const cents = amount * 100
  const rounded = Math.round(cents)
  return Number.isSafeInteger(rounded) && Math.abs(cents - rounded) < 0.000001 ? rounded : null
}

export function productValuation(product) {
  const stock = productStock(product)
  const quantity = Number.isSafeInteger(stock) ? stock : null
  const saleCents = priceInCents(product.salePrice)
  const costCents = priceInCents(product.costPrice)
  const multiply = price => quantity === 0 ? 0 : quantity === null || price === null || !Number.isSafeInteger(quantity * price) ? null : quantity * price
  const saleValue = multiply(saleCents)
  const costValue = multiply(costCents)
  return {
    saleCents: saleValue,
    costCents: costValue,
    profitCents: saleValue === null || costValue === null ? null : saleValue - costValue,
    invalidQuantity: quantity === null,
    invalidSalePrice: saleCents === null,
    invalidCostPrice: costCents === null,
  }
}

export function valueProductStock(products) {
  const values = products.map(productValuation)
  const sum = field => {
    const total = values.reduce((amount, value) => amount + (value[field] ?? 0), 0)
    return Number.isSafeInteger(total) ? total / 100 : null
  }
  const saleValue = sum('saleCents')
  const costValue = sum('costCents')
  const invalidQuantityCount = values.filter(value => value.invalidQuantity).length
  const invalidSalePriceCount = values.filter(value => value.invalidSalePrice).length
  const costMissingCount = values.filter(value => value.invalidCostPrice).length
  const saleReviewCount = values.filter(value => value.invalidQuantity || value.invalidSalePrice || value.saleCents === null).length
  const costIncomplete = values.some(value => value.costCents === null) || costValue === null
  const saleIncomplete = saleReviewCount > 0 || saleValue === null
  const profitValue = saleIncomplete || costIncomplete || costMissingCount > 0 ? null : sum('profitCents')
  return { saleValue, costValue, profitValue, saleIncomplete, costIncomplete: costIncomplete || costMissingCount > 0, invalidQuantityCount, invalidSalePriceCount, saleReviewCount, costMissingCount }
}

export function filterProductRecords(products, search = '', category = '', stock = '') {
  const term = normalizeProductText(search)
  return products.filter(product => {
    const quantity = productStock(product)
    return (!term || [product.description, product.name, product.code].some(value => normalizeProductText(value).includes(term))) &&
      (!category || normalizeProductText(product.category) === category) &&
      (!stock || stock === 'available' && quantity > 0 || stock === 'empty' && quantity === 0)
  }).sort((first, second) => productDescription(first).localeCompare(productDescription(second), 'pt-BR', { sensitivity: 'base' }) || String(first.id).localeCompare(String(second.id)))
}

export function getProductCategories(products) {
  const categories = new Map()
  for (const product of products) {
    const label = String(product.category || '').trim()
    if (label) categories.set(normalizeProductText(label), label)
  }
  return [...categories].map(([value, label]) => ({ value, label })).sort((first, second) => first.label.localeCompare(second.label, 'pt-BR'))
}

export function mapProductDraft(product = {}) {
  return Object.fromEntries(PRODUCT_FIELDS.map(field => [field, String(field === 'description' ? product.description ?? product.name ?? '' : product[field] ?? '')]))
}

export function parseProductPrice(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  let normalized
  if (/^\d+(?:\.\d{1,2})?$/.test(text)) normalized = text
  else if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.')
  else return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

export function validateProductDraft(draft, original = null) {
  const previous = original ? mapProductDraft(original) : null
  const changed = field => !previous || draft[field] !== previous[field]
  if (changed('description') && !draft.description.trim()) return 'Informe a descrição do produto.'
  if (changed('code') && !draft.code.trim()) return 'Informe o código do produto.'
  if (changed('stockQuantity')) {
    const stock = recordNumber(draft.stockQuantity)
    if (stock === null || stock < 0 || !Number.isInteger(stock)) return 'Informe a quantidade de peças em estoque: um número inteiro, igual ou maior que zero.'
  }
  if (changed('salePrice') && parseProductPrice(draft.salePrice) === null) return 'Informe um preço de venda válido, igual ou maior que zero. Exemplo: 230,00.'
  if (changed('costPrice') && draft.costPrice.trim() && parseProductPrice(draft.costPrice) === null) return 'Confira o preço de custo: use um valor igual ou maior que zero, ou deixe vazio.'
  return ''
}

export function buildProductChanges(draft, original = null) {
  const previous = original ? mapProductDraft(original) : null
  return Object.fromEntries(PRODUCT_FIELDS.filter(field => !previous || draft[field] !== previous[field]).map(field => {
    if (field === 'stockQuantity') return [field, Number(draft[field])]
    if (['salePrice', 'costPrice'].includes(field)) return [field, field === 'costPrice' && !draft[field].trim() ? null : parseProductPrice(draft[field])]
    return [field, draft[field].trim()]
  }))
}

export function findProductCodeDuplicates(products, draft) {
  const code = normalizeProductText(draft.code)
  return code ? products.filter(product => product.id !== draft.id && normalizeProductText(product.code) === code) : []
}

export function inspectProductSales(productId, sales) {
  let unresolvedCount = 0
  const related = sales.filter(sale => {
    if (!Array.isArray(sale.items) || !sale.items.length) { unresolvedCount += 1; return false }
    let linked = false
    for (const item of sale.items) {
      const id = item?.productId || item?.id || item?.product?.id
      if (typeof id !== 'string' || !id.trim()) unresolvedCount += 1
      else if (id.trim() === productId) linked = true
    }
    return linked
  })
  return { salesCount: related.length, unresolvedCount }
}