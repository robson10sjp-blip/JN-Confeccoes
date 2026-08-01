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

function getProductsCollectionRef(uid) {
  ensureFirestoreReady()
  ensureUser(uid)
  return collection(db, 'users', uid, 'products')
}

export async function listProductsByUser(uid) {
  const productsQuery = query(getProductsCollectionRef(uid), orderBy('createdAt', 'desc'))
  const snapshot = await getDocs(productsQuery)

  return snapshot.docs.map((productDoc) => ({
    id: productDoc.id,
    ...productDoc.data(),
  }))
}

export async function countProductsByUser(uid) {
  const snapshot = await getDocs(getProductsCollectionRef(uid))
  return snapshot.size
}

export async function createProductByUser(uid, payload) {
  ensureUser(uid)
  const now = serverTimestamp()

  await addDoc(getProductsCollectionRef(uid), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateProductByUser(uid, productId, payload) {
  ensureFirestoreReady()
  ensureUser(uid)
  const productRef = doc(db, 'users', uid, 'products', productId)

  await updateDoc(productRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProductByUser(uid, productId) {
  ensureFirestoreReady()
  ensureUser(uid)
  const productRef = doc(db, 'users', uid, 'products', productId)
  await deleteDoc(productRef)
}

export function subscribeProductsByUser(uid, onData, onError) {
  const productsQuery = query(getProductsCollectionRef(uid), orderBy('createdAt', 'desc'))

  return onSnapshot(
    productsQuery,
    (snapshot) => {
      const products = snapshot.docs.map((productDoc) => ({
        id: productDoc.id,
        ...productDoc.data(),
      }))

      onData(products)
    },
    onError,
  )
}
