import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth, hasFirebaseConfig, missingFirebaseEnvKeys, firebaseInitializationError } from '../firebase/config'

function createFirebaseConfigError() {
  if (firebaseInitializationError) {
    return { code: firebaseInitializationError.code || 'auth/initialization-failed' }
  }
  return {
    code: 'auth/not-configured',
    missingEnvKeys: missingFirebaseEnvKeys.map(key => `VITE_FIREBASE_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`),
  }
}

export function loginUser(email, password) {
  if (!hasFirebaseConfig || !auth) {
    return Promise.reject(createFirebaseConfigError())
  }

  return signInWithEmailAndPassword(auth, email, password)
}

export async function registerUser(name, email, password) {
  if (!hasFirebaseConfig || !auth) {
    throw createFirebaseConfigError()
  }

  const credentials = await createUserWithEmailAndPassword(auth, email, password)

  if (name?.trim()) {
    await updateProfile(credentials.user, { displayName: name.trim() })
  }

  return credentials
}

export function logoutUser() {
  if (!hasFirebaseConfig || !auth) {
    return Promise.resolve()
  }

  return signOut(auth)
}

export function sendResetPassword(email) {
  if (!hasFirebaseConfig || !auth) {
    return Promise.reject(createFirebaseConfigError())
  }

  return sendPasswordResetEmail(auth, email)
}

export function observeAuthState(callback) {
  if (!hasFirebaseConfig || !auth) {
    callback(null)
    return () => {}
  }

  try {
    return onAuthStateChanged(auth, callback)
  } catch (error) {
    console.error('Falha ao observar estado de autenticacao:', error)
    callback(null)
    return () => {}
  }
}