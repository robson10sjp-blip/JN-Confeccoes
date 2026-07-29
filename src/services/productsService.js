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

function getProductsCollectionRef(uid) {
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
  const now = serverTimestamp()

  await addDoc(getProductsCollectionRef(uid), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateProductByUser(uid, productId, payload) {
  const productRef = doc(db, 'users', uid, 'products', productId)

  await updateDoc(productRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProductByUser(uid, productId) {
  const productRef = doc(db, 'users', uid, 'products', productId)
  await deleteDoc(productRef)
}
