import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { parseAst } from 'rollup/parseAst'

const site = 'https://robson10sjp-blip.github.io/JN-Confeccoes/'
const projectId = 'jn-confeccoes'
const envFields = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' })
  assert.ok(response.ok, 'Nao foi possivel ler o site publico do JN.')
  return response.text()
}

function readStaticString(node) {
  if (node.type === 'ChainExpression') return readStaticString(node.expression)
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'CallExpression' && node.arguments.length === 0 && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.property.name === 'trim') {
    const value = readStaticString(node.callee.object)
    return typeof value === 'string' ? value.trim() : undefined
  }
  return undefined
}

try {
  assert.ok(process.argv.length === 2 || process.argv.length === 3 && ['--check', '--write'].includes(process.argv[2]), 'Use --check ou --write.')
  const html = await fetchText(site)
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => new URL(match[1], site))
  const configurations = new Map()
  for (const source of sources) {
    assert.equal(source.origin, new URL(site).origin, 'Script fora do site JN; recuperacao cancelada.')
    const stack = [parseAst(await fetchText(source))]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (node.type === 'ObjectExpression') {
        const fields = Object.fromEntries(node.properties
          .filter(property => property.type === 'Property' && !property.computed)
          .map(property => [property.key.name ?? property.key.value, readStaticString(property.value)]))
        if (fields.projectId === projectId && Object.keys(envFields).every(key => fields[key])) {
          const config = Object.fromEntries(Object.keys(envFields).map(key => [key, fields[key]]))
          assert.equal(config.authDomain, 'jn-confeccoes.firebaseapp.com', 'Dominio diferente do JN; recuperacao cancelada.')
          assert.ok(Object.values(config).every(value => !/[\r\n]/.test(value)), 'Configuracao invalida.')
          configurations.set(JSON.stringify(config), config)
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const entry of value) stack.push(entry)
        else if (value && typeof value === 'object') stack.push(value)
      }
    }
  }
  assert.equal(configurations.size, 1, 'Configuracao unica do JN nao confirmada; nenhum arquivo foi criado.')
  const config = configurations.values().next().value
  if (process.argv[2] === '--write') {
    const content = Object.entries(envFields).map(([field, variable]) => `${variable}=${JSON.stringify(config[field])}`).join('\n') + '\n'
    await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 })
    console.log('Arquivo .env local criado para jn-confeccoes, sem sobrescrever arquivos existentes nem exibir valores. Reinicie o Vite.')
  } else {
    console.log('OK: configuracao web publica de jn-confeccoes confirmada. Nenhum arquivo criado. Use --write para gerar .env local.')
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'O arquivo .env ja existe e nao foi alterado.' : 'Recuperacao cancelada. Verifique a disponibilidade e a configuracao publica do site JN; nenhum valor foi exibido.')
  process.exitCode = 1
}