import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { chromium } from 'playwright'
import { getAuthErrorMessage } from '../src/utils/authErrors.js'

const source = (await readFile(new URL('../src/firebase/config.js', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/import\.meta\.env/g, 'env')
  .replace(/^export \{.*\}$/gm, '')

function initialize(env, overrides = {}) {
  const sdk = {
    getApps: () => [],
    getApp: () => ({ options: { projectId: 'jn-confeccoes' } }),
    initializeApp: options => ({ options }),
    getAuth: app => ({ app }),
    getFirestore: app => ({ app }),
    ...overrides,
  }
  return vm.runInNewContext(`${source}\n;({ auth, db, hasFirebaseConfig, missingFirebaseEnvKeys, firebaseInitializationError })`, { env, ...sdk, console: { error() {} } })
}

const minimalEnv = { VITE_FIREBASE_API_KEY: 'test-only', VITE_FIREBASE_AUTH_DOMAIN: 'jn-confeccoes.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'jn-confeccoes' }
const missing = initialize({})
assert.equal(missing.auth, null)
assert.deepEqual(Array.from(missing.missingFirebaseEnvKeys), ['apiKey', 'authDomain', 'projectId'])
assert.ok(initialize(minimalEnv).auth)
assert.ok(initialize(minimalEnv).db)
const invalid = initialize(minimalEnv, { getAuth: () => { throw Object.assign(new Error('Simulado'), { code: 'auth/invalid-api-key' }) } })
assert.equal(invalid.firebaseInitializationError.code, 'auth/invalid-api-key')
const mismatch = initialize(minimalEnv, { getApps: () => [{}], getApp: () => ({ options: { projectId: 'outro-projeto-ficticio' } }) })
assert.equal(mismatch.auth, null)
assert.equal(mismatch.firebaseInitializationError.code, 'auth/firebase-project-mismatch')
assert.match(getAuthErrorMessage({ code: 'auth/operation-not-allowed' }), /não está habilitado/)
assert.match(getAuthErrorMessage({ code: 'auth/unauthorized-domain' }), /não está autorizado/)
const safeMessage = getAuthErrorMessage({ code: 'auth/not-configured', missingEnvKeys: ['VITE_FIREBASE_API_KEY', 'do-not-display'] })
assert.match(safeMessage, /VITE_FIREBASE_API_KEY/)
assert.doesNotMatch(safeMessage, /do-not-display/)
console.log('OK: configuração mínima, variáveis ausentes, erros originais e isolamento de projeto; nenhum SDK real usado nestas verificações.')

const baseUrl = process.env.JN_TEST_URL || 'http://localhost:5173'
const origin = new URL(baseUrl).origin
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
const browser = await chromium.launch({ headless: true })
const email = 'teste.isolado@example.invalid'
const password = 'TesteSomenteLocal123!'
const uid = 'test-jn-auth'
const now = Math.floor(Date.now() / 1000)
const token = [
  { alg: 'RS256', typ: 'JWT' },
  { aud: 'jn-confeccoes', iss: 'https://securetoken.google.com/jn-confeccoes', sub: uid, user_id: uid, email, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.simulated'

try {
  const context = await browser.newContext()
  let mode = 'disabled'
  let signInRequests = 0
  const errors = []
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.name))
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.hostname !== 'identitytoolkit.googleapis.com') return route.abort()
    if (url.pathname.endsWith('/accounts:signInWithPassword')) {
      signInRequests += 1
      const payload = route.request().postDataJSON()
      assert.equal(payload.email, email)
      assert.equal(payload.password, password)
      if (mode !== 'success') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 400, message: mode === 'disabled' ? 'OPERATION_NOT_ALLOWED' : 'INVALID_LOGIN_CREDENTIALS' } }) })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ localId: uid, email, idToken: token, refreshToken: 'simulated-not-real', expiresIn: '3600' }) })
    }
    if (url.pathname.endsWith('/accounts:lookup') && mode === 'success') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: [{ localId: uid, email, displayName: 'Teste isolado JN', emailVerified: true, providerUserInfo: [{ providerId: 'password', email, rawId: email }] }] }) })
    return route.abort()
  })
  await page.goto(`${baseUrl}/login`)
  await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor()
  const config = await page.evaluate(async () => {
    const module = await import('/src/firebase/config.js')
    return { configured: module.hasFirebaseConfig, ready: Boolean(module.auth), projectId: module.app?.options.projectId }
  })
  assert.deepEqual(config, { configured: true, ready: true, projectId: 'jn-confeccoes' })
  assert.equal(signInRequests, 0)
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.login-form-message').filter({ hasText: 'auth/operation-not-allowed' }).waitFor()
  mode = 'invalid'
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.locator('.login-form-message').filter({ hasText: 'auth/invalid-credential' }).waitFor()
  mode = 'success'
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('**/dashboard')
  assert.equal(signInRequests, 3)
  assert.equal(await page.evaluate(async () => (await import('/src/firebase/config.js')).auth.currentUser?.uid), uid)
  assert.deepEqual(errors, [])
  console.log('OK: navegador com configuração JN real, SDK Auth real e respostas de login simuladas; erro de provedor, credenciais inválidas e acesso ao Dashboard. Requisições externas bloqueadas/interceptadas; nenhum usuário real criado ou utilizado.')
  await context.close()
} finally {
  await browser.close()
}