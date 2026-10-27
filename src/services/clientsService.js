import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { sortRecordsByDate } from '../utils/recordFilters'
import { inspectClientRelations } from '../utils/clientRecords'

function ensureFirestoreReady() {
  if (!db) {
    throw Object.assign(new Error('Firestore não inicializado.'), { code: 'firestore/not-configured' })
  }
}

function ensureUser(uid) {
  if (!uid) {
    throw Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
  }
}

function getClientCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'clients')
}

export async function listClientsByUser(uid) {
  const clientsQuery = getClientCollectionRef(uid)
  const snapshot = await getDocs(clientsQuery)

  return sortRecordsByDate(snapshot.docs.map((clientDoc) => ({
    ...clientDoc.data(),
    id: clientDoc.id,
  })), 'createdAt')
}

export async function createClientByUser(uid, payload) {
  ensureUser(uid)
  const now = serverTimestamp()

  await addDoc(getClientCollectionRef(uid), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateClientByUser(uid, clientId, payload) {
  ensureFirestoreReady()
  ensureUser(uid)
  const clientRef = doc(db, 'users', uid, 'clients', clientId)

  await updateDoc(clientRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteClientByUser(uid, clientId) {
  ensureFirestoreReady()
  ensureUser(uid)
  const relations = await loadClientRelationsByUser(uid, clientId)
  if (relations.hasRelated || relations.unresolvedCount > 0) {
    throw Object.assign(new Error(relations.hasRelated
      ? 'Este cliente possui vendas, contas ou pagamentos vinculados e não pode ser excluído.'
      : 'Existem registros antigos sem vínculo confiável. A exclusão está bloqueada até a revisão desses registros.'), { code: 'clients/delete-blocked' })
  }
  const clientRef = doc(db, 'users', uid, 'clients', clientId)
  await deleteDoc(clientRef)
}

export async function loadClientRelationsByUser(uid, clientId) {
  ensureFirestoreReady()
  ensureUser(uid)
  if (!clientId) throw new Error('Cliente não identificado.')
  const sources = { sales: 'sales', receivables: 'financeiroReceber', payments: 'financeiroRecebimentos', receipts: 'receipts', otherPayments: 'payments' }
  const entries = await Promise.all(Object.entries(sources).map(async ([key, name]) => {
    const snapshot = await getDocsFromServer(collection(db, 'users', uid, name))
    return [key, snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }))]
  }))
  return inspectClientRelations(clientId, Object.fromEntries(entries))
}

export function subscribeClientsByUser(uid, onData, onError) {
  const clientsQuery = getClientCollectionRef(uid)

  return onSnapshot(
    clientsQuery,
    (snapshot) => {
      const clients = sortRecordsByDate(snapshot.docs.map((clientDoc) => ({
        ...clientDoc.data(),
        id: clientDoc.id,
      })), 'createdAt')

      onData(clients)
    },
    onError,
  )
}
