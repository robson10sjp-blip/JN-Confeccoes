export const RESTART_LABEL = 'Encerrada para reinício'
export const RESTART_MARKER = 'jn-system-restart-v1'
export const CLEANUP_MARKER = 'jn-movement-cleanup-v1'

export function buildCleanupPlan(data, previousRestart = null) {
  const sales = data.sales || []
  const previouslyReturned = new Set([
    ...(previousRestart?.result?.returns || []).map(entry => entry.saleId),
    ...sales.filter(sale => sale.stockReturn?.completed).map(sale => sale.id),
  ])
  const candidates = sales.filter(sale => !previouslyReturned.has(sale.id)).map(sale => ({ ...sale, restartClosure: null }))
  const plan = buildRestartPlan({ ...data, sales: candidates, receivables: [] })
  const originalSales = new Map(sales.map(sale => [sale.id, sale]))
  for (const account of data.receivables || []) {
    const sale = originalSales.get(account.saleId)
    if (!sale || !Array.isArray(sale.items) || !sale.items.length) plan.reviews.push({ type: 'account', id: account.id, reason: !sale ? 'Conta sem venda localizada: não informa produto nem quantidade para devolver.' : 'Conta com venda sem itens identificáveis; estoque mantido.' })
  }
  const deleteCounts = Object.fromEntries(['sales', 'receivables', 'payments', 'receipts', 'otherPayments'].map(source => [source, (data[source] || []).length]))
  return {
    ...plan,
    mode: 'cleanup',
    accountIds: (data.receivables || []).map(account => account.id),
    saleIds: sales.map(sale => sale.id),
    unverifiedAccounts: new Set(plan.reviews.filter(entry => entry.type === 'account').map(entry => entry.id)).size,
    alreadyReturnedSales: sales.filter(sale => previouslyReturned.has(sale.id)).length,
    deleteCounts,
    deleteTotal: Object.values(deleteCounts).reduce((sum, count) => sum + count, 0),
  }
}

export function isRestartClosed(record) {
  return record?.restartClosure?.kind === RESTART_MARKER
}

export function packRestartValue(value) {
  if (value === null) return ['null']
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value]
  if (typeof value === 'number') return ['number', Number.isNaN(value) ? 'NaN' : value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value]
  if (Array.isArray(value)) return ['array', value.map(packRestartValue)]
  if (value instanceof Date) return ['date', value.toISOString()]
  if (value && typeof value.toDate === 'function' && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) return ['timestamp', value.seconds, value.nanoseconds]
  if (value && typeof value.toBase64 === 'function') return ['bytes', value.toBase64()]
  if (value?.type === 'document' && typeof value.path === 'string' && value.firestore) return ['reference', value.path]
  if (value?.constructor?.name === 'GeoPoint') return ['geopoint', value.latitude, value.longitude]
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return ['map', Object.keys(value).sort().map(key => [key, packRestartValue(value[key])])]
  throw new Error('Há um tipo de dado que não pode ser copiado com segurança. Nenhum reinício foi executado.')
}

export function unpackRestartValue(value, types = {}) {
  if (!Array.isArray(value)) throw new Error('Valor de cópia inválido.')
  const [type, data, extra] = value
  if (type === 'null') return null
  if (type === 'string' || type === 'boolean') return data
  if (type === 'number') return data === 'NaN' ? NaN : data === '+Infinity' ? Infinity : data === '-Infinity' ? -Infinity : data === '-0' ? -0 : data
  if (type === 'date') return new Date(data)
  if (type === 'array') return data.map(entry => unpackRestartValue(entry, types))
  if (type === 'map') return Object.fromEntries(data.map(([key, entry]) => [key, unpackRestartValue(entry, types)]))
  if (type === 'timestamp' && types.timestamp) return types.timestamp(data, extra)
  if (type === 'reference' && types.reference) return types.reference(data)
  if (type === 'bytes' && types.bytes) return types.bytes(data)
  if (type === 'geopoint' && types.geopoint) return types.geopoint(data, extra)
  throw new Error('A cópia exige um conversor Firestore para restaurar este tipo com segurança.')
}

export function buildRestartPlan(data) {
  const products = new Map((data.products || []).map(product => [product.id, product]))
  const sales = data.sales || []
  const salesById = new Map(sales.map(sale => [sale.id, sale]))
  const reviews = []
  const eligible = []
  const reservedProducts = new Set()
  const accounts = (data.receivables || []).filter(account => !isRestartClosed(account))
  for (const sale of sales) {
    if (isRestartClosed(sale)) continue
    const items = Array.isArray(sale.items) ? sale.items : []
    if (!items.length) { reviews.push({ type: 'sale', id: sale.id, reason: 'Venda sem itens localizados; não há quantidade comprovada para devolver.' }); continue }
    const quantities = new Map()
    let invalid = false
    for (const item of items) {
      const productId = item?.productId || item?.id || item?.product?.id
      const quantity = item?.quantity
      if (typeof productId !== 'string' || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || !products.has(productId)) {
        invalid = true
        reviews.push({ type: 'sale', id: sale.id, productId: typeof productId === 'string' ? productId : '', reason: 'Produto, ID ou quantidade não comprovados. Estoque mantido.' })
      } else quantities.set(productId, (quantities.get(productId) || 0) + quantity)
    }
    const proof = sale.stockDebitProof
    const proofItems = proof?.version === 1 && Array.isArray(proof.items) ? proof.items : []
    const candidate = []
    if (!invalid && proofItems.length === quantities.size) {
      for (const [productId, quantity] of quantities) {
        const product = products.get(productId)
        const evidence = proofItems.filter(entry => entry.productId === productId)
        const entry = evidence.length === 1 ? evidence[0] : null
        if (!entry || reservedProducts.has(productId) || typeof product.stockQuantity !== 'number' || !Number.isSafeInteger(product.stockQuantity) || product.stockQuantity < 0 || !Number.isSafeInteger(entry.before) || !Number.isSafeInteger(entry.after) || entry.before - entry.after !== quantity || entry.quantity !== quantity || entry.after !== product.stockQuantity || entry.eventId !== product.stockMovementId || !entry.eventId || sale.stockReturn?.completed || !Number.isSafeInteger(product.stockQuantity + quantity)) {
          invalid = true
          break
        }
        candidate.push({ productId, description: product.description || product.name || product.code || productId, before: product.stockQuantity, quantity, after: product.stockQuantity + quantity, saleId: sale.id })
      }
    } else invalid = true
    if (invalid) {
      reviews.push({ type: 'sale', id: sale.id, reason: 'Não há trilha de baixa atual e não devolvida para todos os itens. Não é seguro devolver somente pela existência da venda.' })
    } else {
      for (const entry of candidate) reservedProducts.add(entry.productId)
      eligible.push({ saleId: sale.id, products: candidate })
    }
  }
  for (const account of accounts) {
    const sale = salesById.get(account.saleId)
    if (!sale || !Array.isArray(sale.items) || !sale.items.length) reviews.push({ type: 'account', id: account.id, reason: !sale ? 'Conta sem venda localizada. Não informa produtos nem quantidade baixada.' : 'Venda da conta não possui itens localizados. Sem devolução comprovável.' })
  }
  return {
    accountIds: accounts.map(account => account.id),
    saleIds: sales.filter(sale => !isRestartClosed(sale)).map(sale => sale.id),
    returns: eligible.flatMap(entry => entry.products),
    returnedSaleIds: eligible.map(entry => entry.saleId),
    reviews,
    unverifiedAccounts: new Set(reviews.filter(entry => entry.type === 'account').map(entry => entry.id)).size,
    unverifiedSales: new Set(reviews.filter(entry => entry.type === 'sale').map(entry => entry.id)).size,
    counts: { clients: (data.clients || []).length, products: (data.products || []).length, payments: (data.payments || []).length },
  }
}