import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

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
  const clientsQuery = query(getClientCollectionRef(uid), orderBy('createdAt', 'desc'))
  const snapshot = await getDocs(clientsQuery)

  return snapshot.docs.map((clientDoc) => ({
    id: clientDoc.id,
    ...clientDoc.data(),
  }))
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
  const clientRef = doc(db, 'users', uid, 'clients', clientId)
  await deleteDoc(clientRef)
}

export function subscribeClientsByUser(uid, onData, onError) {
  const clientsQuery = query(getClientCollectionRef(uid), orderBy('createdAt', 'desc'))

  return onSnapshot(
    clientsQuery,
    (snapshot) => {
      const clients = snapshot.docs.map((clientDoc) => ({
        id: clientDoc.id,
        ...clientDoc.data(),
      }))

      onData(clients)
    },
    onError,
  )
}
