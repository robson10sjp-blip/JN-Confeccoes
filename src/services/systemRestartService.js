import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'firebase/firestore'
import { app, auth, db } from '../firebase/config'
import { buildCleanupPlan, buildRestartPlan, CLEANUP_MARKER, isRestartClosed, packRestartValue, RESTART_LABEL, RESTART_MARKER } from '../utils/systemRestart'

const SOURCES = { clients: 'clients', products: 'products', sales: 'sales', receivables: 'financeiroReceber', payments: 'financeiroRecebimentos', receipts: 'receipts', otherPayments: 'payments' }
const WRITE_LIMIT = 400
const MOVEMENTS = ['sales', 'receivables', 'payments', 'receipts', 'otherPayments']

function modeSettings(mode) {
  if (mode === 'cleanup') return { field: 'systemMovementCleanup', marker: CLEANUP_MARKER }
  if (mode === 'archive') return { field: 'systemRestart', marker: RESTART_MARKER }
  throw new Error('Modo de reinício inválido.')
}

function restartPlan(data, mode, userData) {
  return mode === 'cleanup' ? buildCleanupPlan(data, userData?.systemRestart) : buildRestartPlan(data)
}

function ensureAccess(uid) {
  if (!db || app?.options?.projectId !== 'jn-confeccoes') throw new Error('A operação exige o Firebase do JN Confecções.')
  if (!uid || auth?.currentUser?.uid !== uid) throw new Error('Entre na conta do JN que possui os registros antes de preparar o reinício.')
}

function canonical(records) {
  return JSON.stringify(records.map(entry => ({ source: entry.source, id: entry.id, data: packRestartValue(entry.data) })).sort((first, second) => `${first.source}/${first.id}`.localeCompare(`${second.source}/${second.id}`)))
}

async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function readData(uid) {
  const groups = await Promise.all(Object.entries(SOURCES).map(async ([source, name]) => {
    const snapshot = await getDocsFromServer(collection(db, 'users', uid, name))
    return [source, snapshot.docs.map(entry => ({ source, id: entry.id, data: entry.data() }))]
  }))
  const records = groups.flatMap(([, entries]) => entries)
  const data = Object.fromEntries(groups.map(([source, entries]) => [source, entries.map(entry => ({ ...entry.data, id: entry.id }))]))
  return { records, data }
}

export async function prepareSystemRestartByUser(uid, mode = 'archive') {
  ensureAccess(uid)
  const settings = modeSettings(mode)
  const userRef = doc(db, 'users', uid)
  const user = await getDocFromServer(userRef)
  if (user.data()?.[settings.field]?.kind === settings.marker) return { alreadyCompleted: true, result: user.data()[settings.field].result }
  const { records, data } = await readData(uid)
  const plan = restartPlan(data, mode, user.data())
  const writeCount = mode === 'cleanup' ? plan.deleteTotal + plan.returns.length + 1 : plan.accountIds.length + plan.saleIds.length + plan.returns.length + 1
  if (writeCount > WRITE_LIMIT) throw new Error('Este volume excede o limite seguro de uma transação. Nenhum dado foi alterado; o reinício precisa de execução assistida em servidor.')
  const operationId = crypto.randomUUID()
  const capturedAt = new Date().toISOString()
  const userBefore = user.exists() ? packRestartValue(user.data()) : null
  const fingerprint = canonical(records)
  const backup = { format: 'jn-system-restart-backup-v1', mode, projectId: 'jn-confeccoes', uid, operationId, capturedAt, userBefore, records: JSON.parse(fingerprint), plan }
  const backupText = JSON.stringify(backup, null, 2)
  return { mode, uid, operationId, capturedAt, records, data, plan, userBefore, fingerprint, backupText, backupHash: await hash(backupText), filename: `jn-antes-${mode === 'cleanup' ? 'da-limpeza-completa' : 'do-reinicio'}-${operationId}.json` }
}

export async function executeSystemRestartByUser(uid, prepared, backupRequested) {
  ensureAccess(uid)
  if (!backupRequested || !prepared || prepared.uid !== uid || !prepared.operationId) throw new Error('Prepare a conferência e baixe a cópia antes de confirmar.')
  const mode = prepared.mode || 'archive'
  const settings = modeSettings(mode)
  if (await hash(prepared.backupText) !== prepared.backupHash || canonical(prepared.records) !== prepared.fingerprint) throw new Error('A conferência foi modificada. Prepare uma nova cópia antes de executar.')
  const backup = JSON.parse(prepared.backupText)
  if (backup.uid !== uid || backup.mode !== mode || backup.projectId !== 'jn-confeccoes' || backup.operationId !== prepared.operationId || JSON.stringify(backup.records) !== prepared.fingerprint || JSON.stringify(backup.plan) !== JSON.stringify(prepared.plan) || JSON.stringify(backup.userBefore) !== JSON.stringify(prepared.userBefore)) throw new Error('A cópia não corresponde a esta conferência.')
  const userRef = doc(db, 'users', uid)
  const latestUser = await getDocFromServer(userRef)
  if (latestUser.data()?.[settings.field]?.kind === settings.marker) return { ...latestUser.data()[settings.field].result, alreadyCompleted: true }
  if (JSON.stringify(latestUser.exists() ? packRestartValue(latestUser.data()) : null) !== JSON.stringify(prepared.userBefore)) throw new Error('O cadastro do usuário mudou após a cópia. Prepare novamente.')
  const fresh = await readData(uid)
  if (canonical(fresh.records) !== prepared.fingerprint) throw new Error('Os dados mudaram depois da cópia. Nada foi executado; prepare uma nova conferência.')
  const plan = restartPlan(fresh.data, mode, latestUser.data())
  if (JSON.stringify(plan) !== JSON.stringify(prepared.plan)) throw new Error('O plano não corresponde aos dados conferidos. Prepare novamente.')
  const affected = prepared.records.filter(entry => mode === 'cleanup' ? MOVEMENTS.includes(entry.source) || entry.source === 'products' && plan.returns.some(returned => returned.productId === entry.id) : entry.source === 'receivables' && plan.accountIds.includes(entry.id) || entry.source === 'sales' && plan.saleIds.includes(entry.id) || entry.source === 'products' && plan.returns.some(returned => returned.productId === entry.id))
  if (affected.length + 1 > WRITE_LIMIT) throw new Error('O plano excede o limite seguro. Nenhum dado foi alterado.')
  const result = { mode, operationId: prepared.operationId, closedAccounts: mode === 'cleanup' ? 0 : plan.accountIds.length, archivedSales: mode === 'cleanup' ? 0 : plan.saleIds.length, ...(mode === 'cleanup' ? { deletedCounts: plan.deleteCounts, deletedTotal: plan.deleteTotal, alreadyReturnedSales: plan.alreadyReturnedSales } : {}), returnedSales: plan.returnedSaleIds.length, returnedProducts: plan.returns.length, returnedUnits: plan.returns.reduce((sum, entry) => sum + entry.quantity, 0), unverifiedAccounts: plan.unverifiedAccounts, unverifiedSales: plan.unverifiedSales, clientsPreserved: plan.counts.clients, productsPreserved: plan.counts.products, paymentsPreserved: mode === 'cleanup' ? 0 : plan.counts.payments, returns: plan.returns, reviews: plan.reviews, backupFilename: prepared.filename, backupHash: prepared.backupHash }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 500000) throw new Error('O relatório é grande demais para o limite seguro. Nenhuma gravação foi feita; use uma execução assistida em servidor.')
  const outcome = await runTransaction(db, async transaction => {
    const user = await transaction.get(userRef)
    if (user.data()?.[settings.field]?.kind === settings.marker) return { ...user.data()[settings.field].result, alreadyCompleted: true }
    if (JSON.stringify(user.exists() ? packRestartValue(user.data()) : null) !== JSON.stringify(prepared.userBefore)) throw new Error('O cadastro do usuário mudou após a cópia. Prepare novamente.')
    for (const entry of affected) {
      const current = await transaction.get(doc(db, 'users', uid, SOURCES[entry.source], entry.id))
      if (!current.exists() || JSON.stringify(packRestartValue(current.data())) !== JSON.stringify(packRestartValue(entry.data))) throw new Error('Um registro mudou durante a conferência. Nenhuma parte do reinício foi gravada; prepare novamente.')
    }
    const closure = { kind: RESTART_MARKER, operationId: prepared.operationId, label: RESTART_LABEL, closedAt: serverTimestamp() }
    if (mode === 'cleanup') {
      for (const entry of affected.filter(entry => MOVEMENTS.includes(entry.source))) transaction.delete(doc(db, 'users', uid, SOURCES[entry.source], entry.id))
    } else {
      for (const accountId of plan.accountIds) transaction.update(doc(db, 'users', uid, SOURCES.receivables, accountId), { restartClosure: closure })
      for (const saleId of plan.saleIds) transaction.update(doc(db, 'users', uid, SOURCES.sales, saleId), { restartClosure: closure, ...(plan.returnedSaleIds.includes(saleId) ? { stockReturn: { completed: true, operationId: prepared.operationId, items: plan.returns.filter(entry => entry.saleId === saleId) } } : {}) })
    }
    for (const entry of plan.returns) transaction.update(doc(db, 'users', uid, SOURCES.products, entry.productId), { stockQuantity: entry.after, stockMovementId: `restart-${prepared.operationId}-${entry.productId}` })
    transaction.set(userRef, { [settings.field]: { kind: settings.marker, operationId: prepared.operationId, completedAt: serverTimestamp(), result } }, { merge: true })
    return result
  })
  try {
    const after = await readData(uid)
    const expected = new Map(prepared.records.map(entry => [`${entry.source}/${entry.id}`, JSON.stringify(packRestartValue(entry.data))]))
    if (mode === 'cleanup') {
      const clientsUnchanged = after.data.clients.length === plan.counts.clients && after.records.filter(entry => entry.source === 'clients').every(entry => expected.get(`clients/${entry.id}`) === JSON.stringify(packRestartValue(entry.data)))
      const productsUnchanged = after.data.products.length === plan.counts.products && after.records.filter(entry => entry.source === 'products').every(entry => {
        const before = prepared.records.find(original => original.source === 'products' && original.id === entry.id)
        const returned = plan.returns.find(value => value.productId === entry.id)
        return before && JSON.stringify(packRestartValue(entry.data)) === JSON.stringify(packRestartValue(returned ? { ...before.data, stockQuantity: returned.after, stockMovementId: `restart-${prepared.operationId}-${entry.id}` } : before.data))
      })
      return { ...outcome, verified: clientsUnchanged && productsUnchanged && MOVEMENTS.every(source => after.data[source].length === 0) }
    }
    const currentProtected = after.records.filter(entry => ['clients', 'payments', 'receipts', 'otherPayments'].includes(entry.source))
    const protectedBefore = prepared.records.filter(entry => ['clients', 'payments', 'receipts', 'otherPayments'].includes(entry.source))
    const protectedUnchanged = currentProtected.length === protectedBefore.length && currentProtected.every(entry => expected.get(`${entry.source}/${entry.id}`) === JSON.stringify(packRestartValue(entry.data)))
    const accountsClosed = after.data.receivables.length === prepared.data.receivables.length && after.data.receivables.filter(entry => plan.accountIds.includes(entry.id)).length === plan.accountIds.length && after.data.receivables.filter(entry => plan.accountIds.includes(entry.id)).every(isRestartClosed)
    const stockConfirmed = plan.returns.every(entry => after.data.products.find(product => product.id === entry.productId)?.stockQuantity === entry.after)
    return { ...outcome, verified: protectedUnchanged && accountsClosed && stockConfirmed && after.data.products.length === plan.counts.products && after.data.sales.length === prepared.data.sales.length }
  } catch {
    return { ...outcome, verified: false }
  }
}