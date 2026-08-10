import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, deleteDoc, doc, getDocs, getFirestore, query, where } from 'firebase/firestore'

const TARGET_SALES = [
  {
    clientName: 'robson henrique',
    totalAmount: 1000,
    saleDate: '2026-08-01',
    displayValue: 'R$ 1.000,00',
  },
  {
    clientName: 'Evangelista Prudêncio Alves',
    totalAmount: 130,
    saleDate: '2026-08-01',
    displayValue: 'R$ 130,00',
  },
]

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function parseNumber(value, fallback = NaN) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function normalizeDate(value) {
  const raw = String(value || '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split('/')
    return `${year}-${month}-${day}`
  }

  return raw
}

async function loadDotEnv(filePath) {
  const envText = await fs.readFile(filePath, 'utf8')
  const env = {}

  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    env[key] = value
  }

  return env
}

async function promptForPassword(promptText) {
  output.write(promptText)

  const wasRaw = input.isRaw
  const previousListeners = input.listeners('data')
  for (const listener of previousListeners) {
    input.removeListener('data', listener)
  }

  if (input.isTTY) {
    input.setRawMode(true)
  }

  input.resume()
  input.setEncoding('utf8')

  let password = ''

  return new Promise((resolve) => {
    const onData = (chunk) => {
      const value = String(chunk)

      if (value === '\r' || value === '\n') {
        input.removeListener('data', onData)
        if (input.isTTY) {
          input.setRawMode(Boolean(wasRaw))
        }
        output.write('\n')
        resolve(password)
        return
      }

      if (value === '\u0003') {
        output.write('\nOperação cancelada.\n')
        process.exit(1)
      }

      if (value === '\u007F') {
        password = password.slice(0, -1)
        return
      }

      password += value
    }

    input.on('data', onData)
  })
}

function buildFirebaseConfig(env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
  }
}

function isTargetSale(sale, target) {
  return (
    normalizeText(sale.clientName) === normalizeText(target.clientName)
    && normalizeDate(sale.saleDate) === target.saleDate
    && parseNumber(sale.totalAmount) === target.totalAmount
  )
}

async function findLinkedDocumentsCount(db, uid, saleId) {
  const receivablesQuery = query(collection(db, 'users', uid, 'financeiroReceber'), where('saleId', '==', saleId))
  const paymentsQuery = query(collection(db, 'users', uid, 'financeiroRecebimentos'), where('saleId', '==', saleId))

  const [receivablesSnapshot, paymentsSnapshot] = await Promise.all([
    getDocs(receivablesQuery),
    getDocs(paymentsQuery),
  ])

  return {
    receivables: receivablesSnapshot.size,
    payments: paymentsSnapshot.size,
  }
}

async function main() {
  const rootDir = process.cwd()
  const env = await loadDotEnv(path.join(rootDir, '.env'))
  const firebaseConfig = buildFirebaseConfig(env)
  const app = initializeApp(firebaseConfig)
  const auth = getAuth(app)
  const db = getFirestore(app)
  const rl = readline.createInterface({ input, output })

  try {
    const email = String(process.env.FIREBASE_EMAIL || '').trim() || (await rl.question('Email Firebase: ')).trim()
    const password = String(process.env.FIREBASE_PASSWORD || '') || await promptForPassword('Senha Firebase: ')

    if (!email || !password) {
      throw new Error('Email e senha são obrigatórios para autenticar no Firebase.')
    }

    const credentials = await signInWithEmailAndPassword(auth, email, password)
    const uid = credentials.user.uid

    console.log(`Autenticado com UID: ${uid}`)
    console.log(`Coleção de vendas: users/${uid}/sales`)

    const salesSnapshot = await getDocs(collection(db, 'users', uid, 'sales'))
    const sales = salesSnapshot.docs.map((saleDoc) => ({
      ...saleDoc.data(),
      id: saleDoc.id,
      path: saleDoc.ref.path,
    }))

    const matchedSales = []

    for (const target of TARGET_SALES) {
      const match = sales.find((sale) => isTargetSale(sale, target))

      if (!match) {
        console.log(`Nao encontrada: ${target.clientName} | ${target.displayValue} | ${target.saleDate}`)
        continue
      }

      const linkedCounts = await findLinkedDocumentsCount(db, uid, match.id)
      matchedSales.push({
        target,
        sale: match,
        linkedCounts,
      })
    }

    if (matchedSales.length !== TARGET_SALES.length) {
      console.log('Operacao interrompida: nem todas as vendas alvo foram encontradas com correspondencia exata.')
      process.exitCode = 1
      return
    }

    console.log('Vendas localizadas para exclusao:')
    for (const entry of matchedSales) {
      console.log(JSON.stringify({
        id: entry.sale.id,
        path: entry.sale.path,
        clientName: entry.sale.clientName,
        saleDate: entry.sale.saleDate,
        totalAmount: entry.sale.totalAmount,
        receivablesLinked: entry.linkedCounts.receivables,
        paymentsLinked: entry.linkedCounts.payments,
      }, null, 2))
    }

    const confirmation = (await rl.question('Digite EXCLUIR para remover somente essas vendas: ')).trim()

    if (confirmation !== 'EXCLUIR') {
      console.log('Operacao cancelada sem excluir documentos.')
      return
    }

    for (const entry of matchedSales) {
      await deleteDoc(doc(db, 'users', uid, 'sales', entry.sale.id))
      console.log(`Excluida venda ${entry.sale.id} em ${entry.sale.path}`)
    }

    console.log('Exclusao concluida com sucesso.')
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error('Falha ao excluir vendas especificas:', {
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  })
  process.exit(1)
})