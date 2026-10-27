import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'

const dashboardCollections = {
  sales: 'sales',
  payments: 'financeiroRecebimentos',
  receivables: 'financeiroReceber',
  clients: 'clients',
  products: 'products',
}

export function subscribeDashboardSource(uid, source, onData, onError) {
  if (!db) throw Object.assign(new Error('Firestore não configurado.'), { code: 'firestore/not-configured' })
  if (!uid) throw Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
  if (!Object.hasOwn(dashboardCollections, source)) throw new Error('Fonte inválida para o Dashboard.')
  return onSnapshot(
    collection(db, 'users', uid, dashboardCollections[source]),
    { includeMetadataChanges: true },
    snapshot => onData(snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id })), !snapshot.metadata?.fromCache),
    onError,
  )
}
