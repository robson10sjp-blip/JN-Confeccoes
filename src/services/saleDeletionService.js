import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { app, auth, db } from '../firebase/config'
import { packRestartValue } from '../utils/systemRestart'
import { isSaleCancelled, planSaleStockReturn, SALE_CANCELLATION_KIND, SALE_CANCELLATION_LABEL } from '../utils/saleDeletion'

const SOURCES = { sales: 'sales', products: 'products', accounts: 'financeiroReceber', payments: 'financeiroRecebimentos', receipts: 'receipts', otherPayments: 'payments' }

function ensureAccess(uid) {
  if (!db || app?.options?.projectId !== 'jn-confeccoes' || !uid || auth?.currentUser?.uid !== uid) throw new Error('Entre no JN com o usuário dono da venda antes de excluir.')
}

function encoded(value) {
  return JSON.stringify(packRestartValue(value))
}

async function readContext(uid, saleId) {
  const [user, ...groups] = await Promise.all([
    getDocFromServer(doc(db, 'users', uid)),
    ...Object.entries(SOURCES).map(async ([source, name]) => {
      const snapshot = await getDocsFromServer(collection(db, 'users', uid, name))
      return [source, snapshot.docs.map(entry => ({ source, id: entry.id, data: entry.data() }))]
    }),
  ])
  const sources = Object.fromEntries(groups)
  const saleRecord = sources.sales.find(entry => entry.id === saleId)
  if (!saleRecord) throw new Error('Venda não localizada. Nenhum registro foi alterado.')
  const sale = { ...saleRecord.data, id: saleId }
  const accountIds = new Set(sources.accounts.filter(entry => entry.data.saleId === saleId).map(entry => entry.id))
  const linked = [saleRecord, ...['accounts', 'payments', 'receipts', 'otherPayments'].flatMap(source => sources[source].filter(entry => entry.data.saleId === saleId || source !== 'accounts' && accountIds.has(entry.data.receivableId)))]
  for (const entry of linked) {
    const account = sources.accounts.find(account => account.id === entry.data.receivableId)?.data
    if (entry.data.saleId && entry.data.saleId !== saleId || account?.saleId && account.saleId !== saleId || sale.clientId && entry.data.clientId && sale.clientId !== entry.data.clientId) throw new Error('Há conta, pagamento ou recibo com IDs de vendas/clientes diferentes. É preciso conferir esse vínculo antes de excluir; nenhum registro foi alterado.')
  }
  const userData = user.data() || {}
  const previousReturns = [...(userData.systemRestart?.result?.returns || []), ...(userData.systemMovementCleanup?.result?.returns || [])]
  const plan = planSaleStockReturn(sale, sources.products.map(entry => ({ ...entry.data, id: entry.id })), previousReturns.some(entry => entry.saleId === saleId))
  const affected = [...linked, ...sources.products.filter(entry => plan.returns.some(returned => returned.productId === entry.id))]
  if (affected.length > 400) throw new Error('Esta venda tem vínculos demais para uma exclusão atômica segura. Nenhum registro foi alterado; é necessária execução assistida.')
  const fingerprint = JSON.stringify(affected.map(entry => [entry.source, entry.id, packRestartValue(entry.data)]).sort((first, second) => `${first[0]}/${first[1]}`.localeCompare(`${second[0]}/${second[1]}`)))
  return { uid, saleId, sale, plan, affected, fingerprint, userBefore: user.exists() ? encoded(user.data()) : null, counts: Object.fromEntries(['accounts', 'payments', 'receipts', 'otherPayments'].map(source => [source, linked.filter(entry => entry.source === source && !isSaleCancelled(entry.data)).length])) }
}

export async function prepareSaleDeletionByUser(uid, saleId) {
  ensureAccess(uid)
  if (!saleId || typeof saleId !== 'string') throw new Error('Venda não identificada.')
  return readContext(uid, saleId)
}

export async function executeSaleDeletionByUser(uid, saleId, reviewed) {
  ensureAccess(uid)
  if (!reviewed || reviewed.uid !== uid || reviewed.saleId !== saleId) throw new Error('Abra a confirmação da venda antes de excluir.')
  const fresh = await readContext(uid, saleId)
  if (isSaleCancelled(fresh.sale)) return { ...fresh.sale.saleCancellation.result, alreadyCancelled: true }
  if (fresh.fingerprint !== reviewed.fingerprint || fresh.userBefore !== reviewed.userBefore || JSON.stringify(fresh.plan) !== JSON.stringify(reviewed.plan)) throw new Error('A venda, os vínculos ou o estoque mudaram. Reabra a confirmação; nenhuma parte da exclusão foi gravada.')
  const saleRef = doc(db, 'users', uid, 'sales', saleId)
  const result = { saleId, returnedUnits: fresh.plan.returns.reduce((sum, entry) => sum + entry.quantity, 0), returnedProducts: fresh.plan.returns.length, counts: fresh.counts, warnings: fresh.plan.warnings, alreadyReturned: Boolean(fresh.plan.alreadyReturned), stockNeedsReview: Boolean(fresh.plan.needsStockReview) }
  return runTransaction(db, async transaction => {
    const currentSale = await transaction.get(saleRef)
    if (!currentSale.exists()) throw new Error('Venda não localizada. Nenhum dado foi alterado.')
    if (isSaleCancelled(currentSale.data())) return { ...currentSale.data().saleCancellation.result, alreadyCancelled: true }
    const user = await transaction.get(doc(db, 'users', uid))
    if ((user.exists() ? encoded(user.data()) : null) !== fresh.userBefore) throw new Error('O estado do reinício mudou. Reabra a confirmação da venda.')
    for (const entry of fresh.affected) {
      const current = await transaction.get(doc(db, 'users', uid, SOURCES[entry.source], entry.id))
      if (!current.exists() || encoded(current.data()) !== encoded(entry.data)) throw new Error('Um registro mudou durante a conferência. Nenhuma parte da exclusão foi gravada; confira novamente.')
    }
    const cancellation = { kind: SALE_CANCELLATION_KIND, label: SALE_CANCELLATION_LABEL, saleId, cancelledAt: serverTimestamp(), result }
    for (const entry of fresh.affected.filter(entry => entry.source !== 'products')) transaction.update(doc(db, 'users', uid, SOURCES[entry.source], entry.id), { saleCancellation: cancellation, ...(entry.source === 'sales' && fresh.plan.returns.length ? { stockReturn: { completed: true, reason: 'sale-cancellation', items: fresh.plan.returns } } : {}) })
    for (const entry of fresh.plan.returns) transaction.update(doc(db, 'users', uid, 'products', entry.productId), { stockQuantity: entry.after, stockMovementId: `cancelled-sale-${saleId}-${entry.productId}` })
    return result
  })
}