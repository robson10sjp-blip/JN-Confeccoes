import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'

function getClientCollectionRef(uid) {
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
  const now = serverTimestamp()

  await addDoc(getClientCollectionRef(uid), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateClientByUser(uid, clientId, payload) {
  const clientRef = doc(db, 'users', uid, 'clients', clientId)

  await updateDoc(clientRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteClientByUser(uid, clientId) {
  const clientRef = doc(db, 'users', uid, 'clients', clientId)
  await deleteDoc(clientRef)
}
