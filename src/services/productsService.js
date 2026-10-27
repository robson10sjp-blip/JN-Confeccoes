import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { inspectProductSales } from '../utils/productRecords'
import { sortRecordsByDate } from '../utils/recordFilters'

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
  const productsQuery = getProductsCollectionRef(uid)
  const snapshot = await getDocsFromServer(productsQuery)

  return sortRecordsByDate(snapshot.docs.map((productDoc) => ({
    ...productDoc.data(),
    id: productDoc.id,
  })), 'createdAt')
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

export async function updateProductByUser(uid, productId, payload, expectedStockQuantity) {
  ensureFirestoreReady()
  ensureUser(uid)
  const productRef = doc(db, 'users', uid, 'products', productId)

  if (Object.hasOwn(payload, 'stockQuantity')) {
    if (!Number.isInteger(payload.stockQuantity) || payload.stockQuantity < 0) {
      throw Object.assign(new Error('Informe uma quantidade inteira, igual ou maior que zero.'), { code: 'products/invalid-stock' })
    }
    await runTransaction(db, async transaction => {
      const current = await transaction.get(productRef)
      if (!current.exists()) throw new Error('Produto não encontrado. Nenhum dado foi salvo.')
      if (current.data().stockQuantity !== expectedStockQuantity) {
        throw Object.assign(new Error('O estoque mudou desde que você abriu o formulário. Feche e abra a edição novamente para conferir a quantidade atual. Nenhum dado foi salvo.'), { code: 'products/stock-changed' })
      }
      transaction.update(productRef, { ...payload, stockMovementId: 'manual-stock-adjustment', updatedAt: serverTimestamp() })
    })
    return
  }

  await updateDoc(productRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProductByUser(uid, productId) {
  ensureFirestoreReady()
  ensureUser(uid)
  const relations = await loadProductSalesByUser(uid, productId)
  if (relations.salesCount || relations.unresolvedCount) {
    throw Object.assign(new Error(relations.salesCount
      ? 'Este produto está vinculado a vendas e não pode ser excluído.'
      : 'Existem itens de vendas antigos sem vínculo confiável. A exclusão está bloqueada até a revisão.'), { code: 'products/delete-blocked' })
  }
  const productRef = doc(db, 'users', uid, 'products', productId)
  await deleteDoc(productRef)
}

export async function loadProductSalesByUser(uid, productId) {
  ensureFirestoreReady()
  ensureUser(uid)
  if (!productId) throw new Error('Produto não identificado.')
  const snapshot = await getDocsFromServer(collection(db, 'users', uid, 'sales'))
  return inspectProductSales(productId, snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id })))
}

export function subscribeProductsByUser(uid, onData, onError) {
  const productsQuery = getProductsCollectionRef(uid)

  return onSnapshot(
    productsQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      const products = sortRecordsByDate(snapshot.docs.map((productDoc) => ({
        ...productDoc.data(),
        id: productDoc.id,
      })), 'createdAt')

      onData(products, !snapshot.metadata?.fromCache)
    },
    onError,
  )
}
