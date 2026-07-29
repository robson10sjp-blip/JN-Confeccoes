import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../firebase/config'

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export async function registerUser(name, email, password) {
  const credentials = await createUserWithEmailAndPassword(auth, email, password)

  if (name?.trim()) {
    await updateProfile(credentials.user, { displayName: name.trim() })
  }

  return credentials
}

export function logoutUser() {
  return signOut(auth)
}

export function sendResetPassword(email) {
  return sendPasswordResetEmail(auth, email)
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback)
}