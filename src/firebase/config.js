import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim(),
}

const requiredFirebaseEnvKeys = [
  'apiKey',
  'authDomain',
  'projectId',
]

const missingFirebaseEnvKeys = requiredFirebaseEnvKeys.filter((key) => !firebaseConfig[key])
const hasFirebaseConfig = missingFirebaseEnvKeys.length === 0

let app = null
let auth = null
let db = null
let firebaseInitializationError = null

if (hasFirebaseConfig) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
    if (app.options.projectId !== firebaseConfig.projectId) {
      throw Object.assign(new Error('O aplicativo Firebase inicializado pertence a outro projeto.'), { code: 'auth/firebase-project-mismatch' })
    }
    auth = getAuth(app)
    db = getFirestore(app)
  } catch (error) {
    firebaseInitializationError = error
    console.error('Falha ao inicializar Firebase:', error)
  }
} else {
  console.error('Configuração do Firebase incompleta. Variáveis ausentes:', missingFirebaseEnvKeys)
}

export { app, auth, db, hasFirebaseConfig, missingFirebaseEnvKeys, firebaseInitializationError }