import assert from 'node:assert/strict'
import { chromium, devices, webkit } from 'playwright'

const baseUrl = process.env.JN_TEST_URL || 'http://localhost:5173'
const origin = new URL(baseUrl).origin
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'O teste exige servidor local.')

const legacyPhone = '  (11) 99999-2222 / marido (21) 98888-3333  '
const fixtures = {
  clients: [{ id: 'c1', name: 'Cliente de teste', nickname: 'Vavá', phone: '(11) 99999-1234', cpf: '123.456.789-00', city: 'São Paulo', createdAt: '2020-01-01' }, { id: 'c2', name: 'Cliente antigo', phone: legacyPhone, city: 'Curitiba' }],
  sales: [
    { id: 's1', clientId: 'c1', saleDate: '2020-02-01', totalAmount: 100, paidAmount: 40, paymentMethod: 'Prazo', items: [{ quantity: 2 }] },
    { id: 's2', clientId: 'c1', saleDate: '02/02/2020', totalAmount: 50, paidAmount: 50, items: [] },
    { id: 's3', totalAmount: 25, paidAmount: 0, items: [] },
  ],
  financeiroReceber: [
    { id: 'r1', saleId: 's1', clientId: 'c1', dueDate: '01/03/2020', amount: 100, receivedAmount: 40 },
    { id: 'legacy', clientId: 'c2', dueDate: '2020-03-02', amount: 200, receivedAmount: 0, status: 'Pago' },
    { id: 'paid', saleId: 'deleted', dueDate: '2020-01-01', amount: 50, receivedAmount: 50 },
    { id: 'no-date', amount: 20, receivedAmount: 0 },
    { id: 'invalid', amount: 'invalid' },
  ],
  financeiroRecebimentos: [{ id: 'p1', receivableId: 'r1', saleId: 's1', clientId: 'c1', amount: 40, paymentDate: '2020-03-01' }, { id: 'p2', receivableId: 'paid', amount: 50 }],
  products: [{ id: 'product', code: 'LEG-1', description: 'Água e utensílios', category: 'Utensílios', size: '  P, M, G e GG  ', color: 'Azul / branco', stockQuantity: 3, costPrice: 20, salePrice: 230 }, { id: 'panela', code: 'PAN-2', description: 'Panela de teste', category: 'Panelas', stockQuantity: 0, salePrice: 125.5, createdAt: '2020-01-01' }],
  receipts: [],
  payments: [],
}

const firestoreMock = `
const fixtures = ${JSON.stringify(fixtures)};
let userDocument = { displayName: 'Teste isolado JN' };
window.__writes = 0;
window.__readPaths = [];
window.__mockWrites = [];
window.__allowClientWrites = false;
window.__allowProductWrites = false;
window.__allowSalesWrites = false;
window.__allowFinancialWrites = false;
window.__allowRestartWrites = false;
window.__allowSaleDeletionWrites = false;
let generatedId = 0;
const listeners = new Map();
export const collection = (_db, ...parts) => ({ path: parts.join('/') });
export const doc = (...args) => { const parts = args[0]?.path ? args : args.slice(1); let path = parts.map(arg => arg?.path || arg).join('/'); if (args.length === 1 && args[0]?.path) path += '/generated-' + (++generatedId); return { path, id: path.split('/').at(-1) }; };
export const orderBy = (field, direction) => ({ field, direction });
export const where = (field, operator, value) => ({ field, operator, value });
export const query = (ref, ...conditions) => ({ ...ref, conditions });
function snapshot(ref) {
  if (!ref.path.startsWith('users/test-jn-only/')) throw new Error('Leitura fora do usuário de teste');
  window.__readPaths.push(ref.path);
  const key = ref.path.split('/').at(-1);
  if (key === 'sales' && sessionStorage.getItem('fail-sales')) throw Object.assign(new Error('Permissão simulada'), { code: 'permission-denied' });
  if (key === 'clients' && sessionStorage.getItem('fail-clients')) throw Object.assign(new Error('Permissão simulada'), { code: 'permission-denied' });
  if (key === 'products' && sessionStorage.getItem('fail-products')) throw Object.assign(new Error('Permissão simulada'), { code: 'permission-denied' });
  if (key !== 'clients' && sessionStorage.getItem('fail-client-profile')) throw Object.assign(new Error('Leitura simulada indisponível'), { code: 'unavailable' });
  if (!(key in fixtures)) throw new Error('Coleção não simulada: ' + key);
  let entries = [...fixtures[key]];
  for (const condition of ref.conditions || []) {
    entries = entries.filter(entry => condition.operator ? entry[condition.field] === condition.value : entry[condition.field] !== undefined);
  }
  const docs = entries.map(({id, ...data}) => ({ id, ref: { path: ref.path + '/' + id, id }, exists: () => true, data: () => structuredClone(data) }));
  return { docs, size: docs.length, metadata: { fromCache: sessionStorage.getItem('cached') === '1' }, forEach: callback => docs.forEach(callback) };
}
export const getDocs = async ref => snapshot(ref);
export const getDocsFromServer = async ref => snapshot(ref);
export const onSnapshot = (ref, optionsOrOnData, dataOrError, errorCallback) => {
  const onData = typeof optionsOrOnData === 'function' ? optionsOrOnData : dataOrError;
  const onError = typeof optionsOrOnData === 'function' ? dataOrError : errorCallback;
  let active = true;
  const notify = () => { if (!active) return; try { onData(snapshot(ref)); } catch(error) { onError(error); } };
  listeners.set(notify, ref);
  if (!(ref.path.endsWith('/clients') && sessionStorage.getItem('delay-clients')) && !(ref.path.endsWith('/products') && sessionStorage.getItem('delay-products'))) queueMicrotask(notify);
  return () => { active = false; listeners.delete(notify); };
};
window.__setTestSales = entries => { fixtures.sales = entries; for (const [notify, ref] of listeners) if (ref.path.endsWith('/sales')) notify(); };
window.__setTestSource = (key, entries) => { fixtures[key] = entries; for (const [notify, ref] of listeners) if (ref.path.endsWith('/' + key)) notify(); };
function blocked() { window.__writes++; throw new Error('Gravação bloqueada no teste'); }
function recordWrite(operation, ref, payload) {
  const parts = ref.path.split('/');
  const restartAllowed = window.__allowRestartWrites && (parts.length === 2 || ['products', 'sales', 'financeiroReceber', 'financeiroRecebimentos', 'receipts', 'payments'].includes(parts[2]));
  const allowed = restartAllowed || window.__allowSaleDeletionWrites && ['products', 'sales', 'financeiroReceber', 'financeiroRecebimentos', 'receipts', 'payments'].includes(parts[2]) || parts[2] === 'clients' && window.__allowClientWrites || parts[2] === 'products' && (window.__allowProductWrites || window.__allowSalesWrites) || ['sales', 'financeiroReceber'].includes(parts[2]) && window.__allowSalesWrites || ['sales', 'financeiroReceber', 'financeiroRecebimentos'].includes(parts[2]) && window.__allowFinancialWrites;
  if (!allowed || parts[0] !== 'users' || parts[1] !== 'test-jn-only' || ![2, 3, 4].includes(parts.length)) return blocked();
  if (sessionStorage.getItem(parts[2] === 'clients' ? 'fail-client-save' : 'fail-product-save')) throw Object.assign(new Error('Falha simulada ao salvar'), { code: 'unavailable' });
  if (window.__allowSalesWrites && sessionStorage.getItem('fail-sale-save')) throw Object.assign(new Error('Falha simulada ao salvar venda'), { code: 'unavailable' });
  if (window.__allowFinancialWrites && sessionStorage.getItem('fail-financial-save')) throw Object.assign(new Error('Falha simulada no recebimento'), { code: 'unavailable' });
  if (window.__allowRestartWrites && sessionStorage.getItem('fail-restart')) throw Object.assign(new Error('Falha simulada no reinício'), { code: 'unavailable' });
  if (window.__allowSaleDeletionWrites && sessionStorage.getItem('fail-sale-deletion')) throw Object.assign(new Error('Falha simulada na exclusão'), { code: 'unavailable' });
  window.__writes++;
  window.__mockWrites.push({ operation, path: ref.path, payload });
}
function notifySource(source) { for (const [notify, ref] of listeners) if (ref.path.endsWith('/' + source)) notify(); }
export async function addDoc(ref, data) { recordWrite('create', ref, data); const source = ref.path.split('/')[2]; const id = 'test-created-' + window.__mockWrites.length; fixtures[source].push({ id, ...data }); notifySource(source); return { id }; }
export async function updateDoc(ref, data) { recordWrite('update', ref, data); const source = ref.path.split('/')[2]; const entry = fixtures[source].find(record => record.id === ref.path.split('/').at(-1)); Object.assign(entry, data); notifySource(source); }
export async function deleteDoc(ref) { recordWrite('delete', ref); const source = ref.path.split('/')[2]; fixtures[source] = fixtures[source].filter(record => record.id !== ref.path.split('/').at(-1)); notifySource(source); }
export const serverTimestamp = () => ({ seconds: 1793102400 });
export async function runTransaction(_db, callback) {
  if (!window.__allowProductWrites && !window.__allowSalesWrites && !window.__allowFinancialWrites && !window.__allowRestartWrites && !window.__allowSaleDeletionWrites) return blocked();
  const pending = [];
  const result = await callback({
    get: async ref => { if (pending.length || !ref.path.startsWith('users/test-jn-only') || ref.conditions) throw new Error('Transação inválida no teste'); const entry = ref.path === 'users/test-jn-only' ? userDocument : fixtures[ref.path.split('/')[2]].find(record => record.id === ref.path.split('/').at(-1)); const { id, ...data } = entry || {}; return { ref, exists: () => Boolean(entry), data: () => structuredClone(data) }; },
    update: (ref, data) => pending.push([ref, data, false]),
    set: (ref, data) => pending.push([ref, data, true]),
    delete: ref => pending.push([ref, undefined, 'delete']),
  });
  for (const [ref, data, set] of pending) recordWrite(set === 'delete' ? 'delete' : set ? 'create' : 'update', ref, data);
  const changed = new Set();
  for (const [ref, data, set] of pending) { if (ref.path === 'users/test-jn-only') { userDocument = { ...userDocument, ...data }; continue; } const source = ref.path.split('/')[2]; const id = ref.path.split('/').at(-1); if (set === 'delete') { fixtures[source] = fixtures[source].filter(record => record.id !== id); changed.add(source); continue; } const entry = fixtures[source].find(record => record.id === id); if (set && !entry) fixtures[source].push({ id, ...data }); else Object.assign(entry, data); changed.add(source); }
  for (const source of changed) notifySource(source);
  return result;
}
export const writeBatch = blocked;
export async function getDoc(ref) { if (!ref.path.startsWith('users/test-jn-only')) return blocked(); const entry = ref.path === 'users/test-jn-only' ? userDocument : fixtures[ref.path.split('/')[2]].find(record => record.id === ref.path.split('/').at(-1)); const { id, ...data } = entry || {}; return { id: ref.id, ref, exists: () => Boolean(entry), data: () => structuredClone(data) }; }
export const getDocFromServer = getDoc;
export class Timestamp { static fromDate(date) { return { seconds: date.getTime() / 1000 }; } }
`

const browser = await (process.env.JN_TEST_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true })
const context = await browser.newContext({ ...(process.env.JN_TEST_BROWSER === 'webkit' ? devices['iPhone 13'] : {}), locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin !== origin) return route.abort()
  if (!['GET', 'HEAD'].includes(route.request().method())) throw new Error('Requisição de gravação bloqueada')
  let body
  if (url.pathname === '/src/firebase/config.js') body = 'export const db = {}; export const auth = { currentUser: { uid: "test-jn-only" } }; export const app = { options: { projectId: "jn-confeccoes" } }; export const hasFirebaseConfig = true; export const missingFirebaseEnvKeys = [];'
  if (url.pathname === '/src/services/authService.js') body = `
    export function observeAuthState(callback) { let active = true; queueMicrotask(() => { if (active) callback({ uid: 'test-jn-only', displayName: 'Teste isolado JN' }); }); return () => { active = false; }; }
    function blocked() { throw new Error('Autenticação real bloqueada'); }
    export const loginUser = blocked, logoutUser = blocked, registerUser = blocked, sendResetPassword = blocked;
  `
  if (url.pathname.includes('firebase_firestore')) body = firestoreMock
  if (body !== undefined) return route.fulfill({ contentType: 'text/javascript', body })
  return route.continue()
})

async function open(route) {
  await page.goto(`${baseUrl}${route}`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForFunction(() => window.__readPaths?.length > 0)
}

async function filter(label, value) {
  await page.getByLabel(label, { exact: true }).fill(value)
}

async function metric(title, expected) {
  await page.locator('.metric-card').filter({ has: page.locator('.metric-card-title', { hasText: title }) }).locator('.metric-card-value').filter({ hasText: expected }).waitFor()
}

async function productMetric(title, expected) {
  await page.locator('.products-summary article').filter({ has: page.locator('span', { hasText: title }) }).locator('strong').filter({ hasText: expected }).waitFor()
}

async function financialMetric(title, expected) {
  await page.locator('.financial-card').filter({ has: page.locator('p', { hasText: new RegExp('^' + title + '$') }) }).locator('strong').filter({ hasText: expected }).waitFor()
}

async function testSaleDeletionAndReceipt() {
  await open('/vendas')
  await page.evaluate(() => {
    window.__allowSaleDeletionWrites = true;
    window.__setTestSales([{ id: 'cancel-ui', clientId: 'c1', clientName: 'Cliente de teste', saleDate: '2026-10-27', totalAmount: 300, amountPaid: 50, paidAmount: 50, remainingAmount: 250, paymentMethod: 'Prazo', payments: [{ amount: 50, paymentDate: '2026-10-27' }], items: [{ productId: 'cancel-product', productDescription: 'Produto isolado', quantity: 3, unitPrice: 100, subtotal: 300 }], stockDebitProof: { version: 1, items: [{ productId: 'cancel-product', quantity: 3, before: 10, after: 7, eventId: 'cancel-proof' }] } }]);
    window.__setTestSource('products', [{ id: 'cancel-product', description: 'Produto isolado', stockQuantity: 7, salePrice: 100, stockMovementId: 'cancel-proof' }]);
    window.__setTestSource('financeiroReceber', [{ id: 'cancel-account', saleId: 'cancel-ui', clientId: 'c1', amount: 300, receivedAmount: 50, dueDate: '2026-11-27' }]);
    window.__setTestSource('financeiroRecebimentos', [{ id: 'cancel-payment', receivableId: 'cancel-account', amount: 50, paymentDate: '2026-10-27' }]);
    window.__setTestSource('receipts', [{ id: 'cancel-receipt', saleId: 'cancel-ui', originalField: 'preservado' }]);
    window.__setTestSource('payments', [{ id: 'cancel-other-payment', saleId: 'cancel-ui', amount: 50 }]);
  })
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('VAVA')
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('Parcialmente paga')
  await page.getByRole('button', { name: 'Excluir venda', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Excluir venda?', exact: true })
  await confirmation.getByRole('button', { name: 'Confirmar exclusão', exact: true }).waitFor({ state: 'visible' })
  await confirmation.getByText('3 unidade(s) · estoque 7 → 10', { exact: false }).waitFor()
  assert.match((await confirmation.innerText()).replace(/\u00a0/g, ' '), /Cliente de teste[\s\S]*27\/10\/2026[\s\S]*300,00/)
  await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__writes), 0)
  await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(size)
    await page.getByRole('button', { name: 'Recibo', exact: true }).click()
    const viewer = page.getByRole('dialog', { name: 'Recibo da venda', exact: true })
    const receipt = page.frameLocator('iframe[title="Documento do recibo"]')
    await receipt.locator('.receipt').waitFor()
    assert.match((await receipt.locator('body').innerText()).replace(/\u00a0/g, ' '), /300,00/)
    assert.equal(await receipt.getByRole('button').count(), 0)
    assert.equal(await viewer.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    assert.equal(await receipt.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Recibo legível sem transbordar a tela')
    assert.equal(await receipt.locator('td').evaluateAll(elements => elements.every(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= window.innerWidth })), true, 'Todas as colunas visíveis, sem corte pelo contêiner')
    await viewer.getByRole('button', { name: 'Imprimir recibo', exact: true }).waitFor()
    await page.emulateMedia({ media: 'print' })
    assert.equal(await page.locator('.sale-receipt-toolbar').isVisible(), false)
    await page.emulateMedia({ media: 'screen' })
    if (process.env.JN_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-receipt-${process.env.JN_TEST_BROWSER || 'chromium'}-${size.width}.png`, animations: 'disabled' })
    await viewer.getByRole('button', { name: 'Voltar', exact: true }).click()
    assert.equal(await page.getByRole('heading', { name: 'Detalhes da venda', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).inputValue(), 'VAVA')
    assert.equal(await page.getByRole('combobox', { name: 'Situação', exact: true }).inputValue(), 'Parcialmente paga')
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.getByRole('dialog', { name: 'Detalhes da venda', exact: true }).getByRole('button', { name: 'Excluir venda', exact: true }).click()
  await confirmation.getByText('3 unidade(s) · estoque 7 → 10', { exact: false }).waitFor()
  const getStock = () => page.evaluate(async () => (await (await import('/src/services/productsService.js')).listProductsByUser('test-jn-only')).find(product => product.id === 'cancel-product').stockQuantity)
  await page.evaluate(() => sessionStorage.setItem('fail-sale-deletion', '1'))
  await confirmation.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
  await confirmation.getByRole('alert').waitFor()
  assert.equal(await getStock(), 7)
  await page.evaluate(() => sessionStorage.removeItem('fail-sale-deletion'))
  await confirmation.getByRole('button', { name: 'Confirmar exclusão', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.getByText('Venda excluída das movimentações atuais.', { exact: false }).waitFor()
  assert.equal(await getStock(), 10)
  assert.equal(await page.locator('.sales-list-placeholder .sales-table tbody tr').count(), 0)
  assert.equal(await page.evaluate(() => window.__mockWrites.length), 6, 'Uma única gravação por documento, mesmo com clique duplo')
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption({ label: 'Excluídas (histórico)' })
  await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  assert.equal(await page.getByRole('dialog', { name: 'Detalhes da venda', exact: true }).getByRole('button', { name: 'Excluir venda', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Receber pagamento', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
  await financialMetric('Falta receber', '0,00')
  await financialMetric('Recebido', '0,00')
  await page.locator('.financial-accounts-table').getByText('Cancelada por exclusão de venda', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente de teste' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.locator('.client-balance strong').filter({ hasText: '0,00' }).waitFor()
  assert.deepEqual(pageErrors, [])
  console.log('OK: exclusão cancelável na lista/ficha, pagamento histórico, saldo zerado, falha atômica e clique duplo seguro; recibo desktop/390/320 retorna mantendo filtros e não imprime controles. Só dados simulados.')
}

try {
  await testSaleDeletionAndReceipt()
  if (process.env.JN_SALE_DELETION_ONLY !== '1') {
  await open('/clientes')
  await page.locator('.clients-table').getByText('Cliente antigo', { exact: true }).waitFor()
  assert.equal(await page.locator('.clients-table tbody tr').count(), 2)
  assert.match(await page.locator('.clients-table tbody tr').first().innerText(), /Cliente antigo/)
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('VAVA')
  await page.getByRole('combobox', { name: 'Cidade', exact: true }).selectOption('sao paulo')
  assert.equal(await page.locator('.clients-table tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.locator('.client-balance strong').filter({ hasText: '60,00' }).waitFor()
  assert.equal(await page.locator('.client-purchases-table tbody tr').count(), 2)
  assert.equal(await page.getByRole('button', { name: 'Excluir cliente', exact: true }).isDisabled(), true)
  if (process.env.JN_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.locator('.client-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-client-profile-320.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).inputValue(), 'VAVA')
  assert.equal(await page.getByRole('combobox', { name: 'Cidade', exact: true }).inputValue(), 'sao paulo')
  await page.getByRole('button', { name: 'Limpar', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('nome inexistente no teste')
  await page.getByText('Nenhum cliente encontrado.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Limpar', exact: true }).click()
  await page.evaluate(() => { window.__allowClientWrites = true })
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' }).getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#phone').inputValue(), legacyPhone)
  await page.getByText('Você pode editar os outros dados sem alterá-lo.', { exact: false }).waitFor()
  await page.locator('#city').fill('Londrina')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Cliente atualizado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => Object.hasOwn(window.__mockWrites[0].payload, 'phone')), false)
  assert.equal(await page.evaluate(() => window.__mockWrites[0].payload.city), 'Londrina')
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' }).getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#phone').inputValue(), legacyPhone)
  await page.locator('#phone').fill('11999992222')
  await page.getByRole('button', { name: 'Adicionar outro telefone', exact: true }).click()
  await page.locator('#secondaryPhone').fill('123')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Confira o outro telefone' }).waitFor()
  assert.equal(await page.locator('#phone').inputValue(), '(11) 99999-2222')
  await page.locator('#secondaryPhone').fill('21988883333')
  await page.locator('#secondaryPhoneLabel').fill('marido')
  await page.getByRole('button', { name: 'Remover outro telefone', exact: true }).click()
  assert.equal(await page.locator('#secondaryPhone').count(), 0)
  await page.getByRole('button', { name: 'Adicionar outro telefone', exact: true }).click()
  assert.equal(await page.locator('#secondaryPhone').inputValue(), '')
  await page.locator('#secondaryPhone').fill('21988883333')
  await page.locator('#secondaryPhoneLabel').fill('marido')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Cliente atualizado com sucesso.', { exact: true }).waitFor()
  const organizedRow = page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' })
  assert.equal(await organizedRow.locator('.clients-phone-warning').count(), 0)
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('21988883333')
  assert.equal(await page.locator('.clients-table tbody tr').count(), 1)
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('11999992222')
  assert.equal(await page.locator('.clients-table tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByText('Outro telefone (marido)', { exact: true }).waitFor()
  assert.equal(await page.getByText('Telefone antigo precisa de revisão.', { exact: false }).count(), 0)
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.getByRole('button', { name: 'Limpar', exact: true }).click()
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click()
  await page.locator('#name').fill('Cadastro isolado')
  if (process.env.JN_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.locator('.client-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-client-form-320.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.locator('#phone').fill('letras')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Confira o telefone' }).waitFor()
  await page.locator('#phone').fill('')
  await page.locator('#phone').fill('31977771234')
  await page.evaluate(() => sessionStorage.setItem('fail-client-save', '1'))
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'indisponível' }).waitFor()
  assert.equal(await page.locator('#name').inputValue(), 'Cadastro isolado')
  await page.evaluate(() => sessionStorage.removeItem('fail-client-save'))
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Cliente cadastrado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.locator('.clients-table tbody tr').count(), 3)
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click()
  await page.locator('#name').fill('Outro nome de teste')
  await page.locator('#cpf').fill('12345678900')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('heading', { name: 'Possível cadastro repetido', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__mockWrites.length), 3)
  await page.getByRole('button', { name: 'Revisar cadastro', exact: true }).click()
  await page.locator('#cpf').fill('')
  await page.locator('#name').fill('Cliente de teste')
  await page.locator('#phone').fill('11999991234')
  assert.equal(await page.locator('#phone').inputValue(), '(11) 99999-1234')
  await page.getByRole('button', { name: 'Adicionar outro telefone', exact: true }).click()
  await page.locator('#secondaryPhone').fill('41966664567')
  await page.locator('#secondaryPhoneLabel').fill('filho')
  if (process.env.JN_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 320, height: 740 })
    await page.locator('#secondaryPhone').scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.client-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-client-two-phones-320.png`, fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('heading', { name: 'Possível cadastro repetido', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cadastrar mesmo assim', exact: true }).click()
  await page.getByText('Cliente cadastrado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.locator('.clients-table tbody tr').count(), 4)
  assert.equal(await page.evaluate(() => window.__mockWrites.at(-1).payload.secondaryPhone), '(41) 96666-4567')
  assert.equal(await page.evaluate(() => window.__mockWrites.at(-1).payload.secondaryPhoneLabel), 'filho')
  await page.evaluate(() => {
    for (const key of ['sales', 'financeiroReceber', 'financeiroRecebimentos', 'receipts', 'payments']) window.__setTestSource(key, [])
  })
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Excluir cliente', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Ficha do cliente', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: 'Excluir cliente', exact: true }).click()
  await page.evaluate(() => window.__setTestSource('sales', [{ id: 'new-link', clientId: 'c2' }]))
  await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'não pode ser excluído' }).waitFor()
  assert.equal(await page.evaluate(() => window.__mockWrites.some(entry => entry.operation === 'delete')), false)
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.evaluate(() => window.__setTestSource('sales', []))
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Excluir cliente', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
  await page.getByText('Cliente excluído com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.locator('.clients-table tbody tr').count(), 3)
  await page.evaluate(() => window.__setTestSource('clients', Array.from({ length: 45 }, (_, index) => ({ id: 'page-' + index, name: 'Cliente de teste ' + String(index + 1).padStart(2, '0'), phone: '(11) 99999-1234', city: index % 2 ? 'São Paulo' : 'Curitiba' }))))
  assert.equal(await page.locator('.clients-table tbody tr').count(), 20)
  await page.getByRole('button', { name: 'Próxima', exact: true }).click()
  await page.getByText('Página 2 de 3', { exact: true }).waitFor()
  await page.locator('.clients-table tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.getByText('Página 2 de 3', { exact: true }).waitFor()
  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Clientes sem rolagem horizontal')
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-clients-${size.width}.png`, fullPage: true })
    }
  }
  await page.evaluate(() => window.__setTestSource('clients', []))
  await page.getByText('Nenhum cliente cadastrado.', { exact: false }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('fail-clients', '1'))
  await open('/clientes')
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os clientes' }).waitFor()
  assert.equal(await page.getByText('Quantidade indisponível', { exact: true }).isVisible(), true)
  await page.evaluate(() => sessionStorage.removeItem('fail-clients'))
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await page.locator('.clients-table').getByText('Cliente antigo', { exact: true }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('fail-client-profile', '1'))
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente antigo' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'exclusão permanece bloqueada' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Excluir cliente', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.evaluate(() => sessionStorage.removeItem('fail-client-profile'))
  await page.evaluate(() => sessionStorage.setItem('delay-clients', '1'))
  await page.goto(`${baseUrl}/clientes`)
  await page.getByText('Carregando clientes…', { exact: true }).waitFor()
  assert.equal(await page.locator('.clients-empty').count(), 0)
  await page.evaluate(() => sessionStorage.removeItem('delay-clients'))
  await open('/clientes')
  await page.setViewportSize({ width: 1440, height: 1000 })

  await open('/produtos')
  await productMetric('Produtos cadastrados', '2')
  await productMetric('Peças em estoque', '3')
  await productMetric('Produtos sem estoque', '1')
  await productMetric('Valor do estoque para venda', '690,00')
  await productMetric('Custo total do estoque', 'Cálculo incompleto')
  await productMetric('Lucro bruto estimado', 'Cálculo incompleto')
  await page.getByText('1 produto(s) precisam ter o custo preenchido ou revisado.', { exact: true }).waitFor()
  assert.equal(await page.locator('.products-table tbody tr').count(), 2)
  await page.getByRole('searchbox', { name: 'Buscar produto', exact: true }).fill('AGUA')
  await page.getByRole('combobox', { name: 'Categoria', exact: true }).selectOption('utensilios')
  await page.getByRole('combobox', { name: 'Situação do estoque', exact: true }).selectOption('available')
  assert.equal(await page.locator('.products-table tbody tr').count(), 1)
  await page.locator('.products-filter-value strong').filter({ hasText: '690,00' }).waitFor()
  await productMetric('Valor do estoque para venda', '690,00')
  await page.evaluate(() => window.__setTestSales([{ id: 'linked', items: [{ productId: 'product' }] }]))
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByText('Este produto aparece em 1 venda(s).', { exact: false }).waitFor()
  await page.locator('.product-profile .product-details > div').filter({ has: page.locator('dt', { hasText: /^Valor total para venda$/ }) }).locator('dd').filter({ hasText: '690,00' }).waitFor()
  await page.evaluate(async () => { const module = await import('/src/services/productsService.js'); const products = await module.listProductsByUser('test-jn-only'); window.__setTestSource('products', products.map(product => product.id === 'product' ? { ...product, stockQuantity: 4, salePrice: 240 } : product)); })
  await productMetric('Valor do estoque para venda', '960,00')
  await page.locator('.product-profile .product-details > div').filter({ has: page.locator('dt', { hasText: /^Valor total para venda$/ }) }).locator('dd').filter({ hasText: '960,00' }).waitFor()
  await page.evaluate(entries => window.__setTestSource('products', entries), fixtures.products)
  await productMetric('Valor do estoque para venda', '690,00')
  assert.equal(await page.getByRole('button', { name: 'Excluir produto', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar produto', exact: true }).inputValue(), 'AGUA')
  assert.equal(await page.getByRole('combobox', { name: 'Categoria', exact: true }).inputValue(), 'utensilios')
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.evaluate(() => { window.__allowProductWrites = true })
  await page.locator('.products-table tbody tr').filter({ hasText: 'LEG-1' }).getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#size').inputValue(), '  P, M, G e GG  ')
  assert.equal(await page.locator('#color').inputValue(), 'Azul / branco')
  await page.locator('#brand').fill('Marca alterada no teste')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Produto atualizado com sucesso.', { exact: true }).waitFor()
  const preservedFields = await page.evaluate(() => ['stockQuantity', 'salePrice', 'costPrice', 'size', 'color', 'category'].every(field => !Object.hasOwn(window.__mockWrites.at(-1).payload, field)))
  assert.equal(preservedFields, true)
  await page.locator('.products-table tbody tr').filter({ hasText: 'LEG-1' }).getByRole('button', { name: 'Editar', exact: true }).click()
  await page.locator('#stockQuantity').fill('8')
  await page.evaluate(async () => { const module = await import('/src/services/productsService.js'); const products = await module.listProductsByUser('test-jn-only'); window.__setTestSource('products', products.map(product => product.id === 'product' ? { ...product, stockQuantity: 2 } : product)); })
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'O estoque mudou' }).waitFor()
  assert.equal(await page.locator('#stockQuantity').inputValue(), '8')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.locator('.products-table tbody tr').filter({ hasText: 'LEG-1' }).getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#stockQuantity').inputValue(), '2')
  await page.locator('#stockQuantity').fill('6')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Produto atualizado com sucesso.', { exact: true }).waitFor()
  await productMetric('Peças em estoque', '6')
  await productMetric('Valor do estoque para venda', '1.380,00')
  await page.getByRole('combobox', { name: 'Situação do estoque', exact: true }).selectOption('empty')
  assert.equal(await page.locator('.products-table tbody tr').count(), 1)
  await page.locator('.products-filter-value strong').filter({ hasText: '0,00' }).waitFor()
  await productMetric('Valor do estoque para venda', '1.380,00')
  await page.getByRole('searchbox', { name: 'Buscar produto', exact: true }).fill('não existe este produto')
  await page.getByText('Nenhum produto encontrado.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByRole('button', { name: 'Novo produto', exact: true }).click()
  await page.locator('#description').fill('Panela isolada')
  await page.locator('#code').fill('LEG-1')
  await page.locator('#stockQuantity').fill('-1')
  await page.locator('#salePrice').fill('230,00')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'número inteiro' }).waitFor()
  await page.locator('#stockQuantity').fill('2')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('heading', { name: 'Este código já aparece no cadastro', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Revisar código', exact: true }).click()
  await page.locator('#code').fill('NOVO-TESTE')
  await page.evaluate(() => sessionStorage.setItem('fail-product-save', '1'))
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'indisponível' }).waitFor()
  assert.equal(await page.locator('#description').inputValue(), 'Panela isolada')
  assert.equal(await page.locator('#category').inputValue(), '')
  assert.equal(await page.locator('#size').inputValue(), '')
  assert.equal(await page.locator('#color').inputValue(), '')
  await page.evaluate(() => sessionStorage.removeItem('fail-product-save'))
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Produto cadastrado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.locator('.products-table tbody tr').count(), 3)
  assert.equal(await page.evaluate(() => window.__mockWrites.at(-1).payload.salePrice), 230)
  await page.evaluate(() => window.__setTestSales([]))
  await page.locator('.products-table tbody tr').filter({ hasText: 'NOVO-TESTE' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Excluir produto', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.getByRole('heading', { name: 'Ficha do produto', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Excluir produto', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
  await page.getByText('Produto excluído com sucesso.', { exact: true }).waitFor()
  await page.evaluate(() => window.__setTestSource('products', Array.from({ length: 45 }, (_, index) => ({ id: 'p-' + index, description: 'Produto isolado ' + String(index + 1).padStart(2, '0'), code: 'COD-' + index, category: 'Utensílios', size: 'P, M, G e GG', stockQuantity: index % 4, salePrice: 230 }))))
  assert.equal(await page.locator('.products-table tbody tr').count(), 20)
  await page.getByRole('button', { name: 'Próxima', exact: true }).click()
  await page.getByText('Página 2 de 3', { exact: true }).waitFor()
  await page.locator('.products-table tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.getByText('Página 2 de 3', { exact: true }).waitFor()
  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Produtos sem rolagem horizontal')
      assert.equal(await page.locator('.products-table tbody .products-mobile-value').first().isVisible(), size.width <= 1100)
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-products-${size.width}.png`, fullPage: true })
    }
    await page.locator('.products-table tbody tr').first().getByRole('button', { name: 'Ver', exact: true }).click()
    assert.equal(await page.locator('.product-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-product-profile-320.png` })
    await page.getByRole('button', { name: 'Editar', exact: true }).last().click()
    assert.equal(await page.locator('.product-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-product-form-320.png` })
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  }
  await page.evaluate(() => window.__setTestSource('products', [
    { id: 'value-1', description: 'Produto isolado A', stockQuantity: 3, salePrice: 230, costPrice: 100 },
    { id: 'value-2', description: 'Produto isolado B', stockQuantity: 2, salePrice: 125.5, costPrice: 80 },
    { id: 'value-0', description: 'Produto sem estoque', stockQuantity: 0, salePrice: 900, costPrice: 500 },
  ]))
  await productMetric('Valor do estoque para venda', '941,00')
  await productMetric('Custo total do estoque', '460,00')
  await productMetric('Lucro bruto estimado', '481,00')
  await page.getByRole('searchbox', { name: 'Buscar produto', exact: true }).fill('Produto isolado A')
  await page.locator('.products-filter-value strong').filter({ hasText: '690,00' }).waitFor()
  await productMetric('Valor do estoque para venda', '941,00')
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.evaluate(() => window.__setTestSource('products', [{ id: 'missing-cost', description: 'Custo a preencher', stockQuantity: 2, salePrice: 230, costPrice: '' }]))
  await productMetric('Valor do estoque para venda', '460,00')
  await productMetric('Custo total do estoque', 'Cálculo incompleto')
  await productMetric('Lucro bruto estimado', 'Cálculo incompleto')
  await page.evaluate(() => window.__setTestSource('products', [{ id: 'bad', description: 'Estoque antigo inválido', stockQuantity: -1 }]))
  await productMetric('Peças em estoque', 'Conferir dados')
  await productMetric('Valor do estoque para venda', 'Cálculo incompleto')
  await page.getByText('Cálculo de venda incompleto: 1 produto(s) precisam de revisão.', { exact: false }).waitFor()
  await page.evaluate(() => window.__setTestSource('products', []))
  await page.getByText('Nenhum produto cadastrado.', { exact: false }).waitFor()
  await productMetric('Produtos cadastrados', '0')
  await page.evaluate(() => sessionStorage.setItem('fail-products', '1'))
  await open('/produtos')
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os produtos' }).waitFor()
  await productMetric('Produtos cadastrados', 'Indisponível')
  await productMetric('Valor do estoque para venda', 'Indisponível')
  await page.evaluate(() => sessionStorage.removeItem('fail-products'))
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await productMetric('Produtos cadastrados', '2')
  await page.evaluate(() => sessionStorage.setItem('delay-products', '1'))
  await page.goto(`${baseUrl}/produtos`)
  await productMetric('Produtos cadastrados', 'Carregando')
  assert.equal(await page.locator('.products-empty').count(), 0)
  await page.evaluate(() => sessionStorage.removeItem('delay-products'))
  await page.setViewportSize({ width: 1440, height: 1000 })

  await open('/vendas')
  await page.getByRole('cell', { name: 'Cliente não identificado', exact: true }).waitFor()
  assert.equal(await page.locator('.sales-table tbody tr').count(), 3)
  await page.getByRole('cell', { name: '02/02/2020', exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Escolher datas', exact: true }).check()
  await filter('Data inicial', '2020-02-02')
  await filter('Data final', '2020-02-02')
  assert.equal(await page.locator('.sales-table tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByText('Pesquisar por vencimento', { exact: true }).click()
  await filter('Vencimento de', '2020-03-01')
  await filter('Vencimento até', '2020-03-01')
  assert.equal(await page.locator('.sales-table tbody tr').count(), 1)
  await page.getByText('Em atraso', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('VAVA')
  assert.equal(await page.locator('.sales-list-placeholder .sales-table tbody tr').count(), 2)
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('Paga')
  assert.equal(await page.locator('.sales-list-placeholder .sales-table tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  await page.getByRole('heading', { name: 'Detalhes da venda', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).inputValue(), 'VAVA')
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.evaluate(async () => { const module = await import('/src/services/productsService.js'); const products = await module.listProductsByUser('test-jn-only'); window.__setTestSource('products', products.map(product => product.id === 'product' ? { ...product, stockQuantity: 10 } : product)); window.__allowSalesWrites = true; })
  await page.getByRole('button', { name: 'Nova venda', exact: true }).click()
  await page.locator('#sale-client-search').fill('vava')
  await page.locator('#clientId').selectOption('c1')
  await page.locator('#saleDate').fill('2026-10-27')
  await page.locator('#paymentMethod').selectOption('Prazo')
  await page.locator('#installments').fill('2')
  await page.locator('#firstDueDate').fill('2026-11-27')
  await page.locator('#initialPaidAmount').fill('50')
  await page.locator('#initialPaymentDate').fill('2026-10-27')
  await page.locator('#sale-product-search').fill('agua')
  await page.locator('.sale-item-row select').first().selectOption('product')
  await page.locator('.sale-item-row').first().getByLabel('Quantidade', { exact: true }).fill('2')
  await page.locator('.sale-item-row').first().getByLabel('Preço unitário', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click()
  await page.locator('.sale-item-row select').last().selectOption('product')
  await page.locator('.sale-item-row').last().getByLabel('Preço unitário', { exact: true }).fill('100')
  await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click()
  await page.locator('.sale-item-row').last().getByRole('button', { name: 'Remover', exact: true }).click()
  assert.equal(await page.locator('.sale-item-row').count(), 2)
  await page.getByRole('button', { name: 'Conferir venda', exact: true }).click()
  await page.getByRole('heading', { name: 'Confira a venda', exact: true }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('fail-sale-save', '1'))
  await page.getByRole('button', { name: 'Confirmar venda', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'indisponível' }).waitFor()
  assert.equal(await page.locator('#initialPaidAmount').inputValue(), '50')
  await page.evaluate(() => sessionStorage.removeItem('fail-sale-save'))
  await page.getByRole('button', { name: 'Confirmar venda', exact: true }).click()
  await page.getByText('Venda registrada com sucesso.', { exact: true }).waitFor()
  const savedSales = await page.evaluate(async () => (await import('/src/services/salesService.js')).listSalesByUser('test-jn-only'))
  assert.equal(savedSales.length, 4)
  const newSale = savedSales.find(sale => sale.saleDate === '2026-10-27')
  assert.equal(newSale.totalAmount, 300)
  assert.equal(newSale.paidAmount, 50)
  assert.equal(newSale.remainingAmount, 250)
  assert.equal(newSale.payments.length, 1)
  assert.equal(await page.evaluate(async () => (await (await import('/src/services/productsService.js')).listProductsByUser('test-jn-only')).find(product => product.id === 'product').stockQuantity), 7)
  await page.evaluate(async () => { const module = await import('/src/services/productsService.js'); const products = await module.listProductsByUser('test-jn-only'); window.__setTestSource('products', products.map(product => product.id === 'product' ? { ...product, salePrice: 999 } : product)); })
  await page.locator('.sales-list-placeholder .sales-table tbody tr').first().getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('.sale-item-row').first().getByLabel('Preço unitário', { exact: true }).inputValue(), '100')
  await page.getByRole('button', { name: 'Conferir venda', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar venda', exact: true }).click()
  await page.getByText('Venda atualizada com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(async () => (await (await import('/src/services/productsService.js')).listProductsByUser('test-jn-only')).find(product => product.id === 'product').stockQuantity), 7)
  await page.locator('.sales-list-placeholder .sales-table tbody tr').first().getByRole('button', { name: 'Ver detalhes', exact: true }).click()
  await page.locator('.sale-payments').getByText('R$ 50,00', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Recibo', exact: true }).click()
  const receipt = page.frameLocator('iframe[title="Documento do recibo"]')
  await receipt.locator('.receipt').waitFor()
  assert.match((await receipt.locator('body').innerText()).replace(/\u00a0/g, ' '), /300,00/)
  assert.equal(await receipt.getByRole('button').count(), 0, 'Controles fora da área do recibo e da impressão')
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('.sale-receipt-toolbar').isVisible(), false)
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('dialog', { name: 'Recibo da venda', exact: true }).getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Detalhes da venda', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: 'Receber pagamento', exact: true }).click()
  await page.locator('#receiveAmount').fill('20')
  await page.locator('#receiveDate').fill('2026-10-27')
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await page.getByText('Pagamento registrado com sucesso.', { exact: true }).waitFor()
  const paidSale = await page.evaluate(async id => (await (await import('/src/services/salesService.js')).listSalesByUser('test-jn-only')).find(sale => sale.id === id), newSale.id)
  assert.equal(paidSale.paidAmount, 70)
  assert.equal(paidSale.payments.length, 2)
  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Vendas sem rolagem horizontal')
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-sales-${size.width}.png`, fullPage: true })
    }
    await page.locator('.sales-list-placeholder .sales-table tbody tr').first().getByRole('button', { name: 'Ver detalhes', exact: true }).click()
    assert.equal(await page.locator('.sale-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-sale-details-320.png` })
    await page.getByRole('button', { name: 'Voltar', exact: true }).click()
    await page.getByRole('button', { name: 'Nova venda', exact: true }).click()
    assert.equal(await page.locator('.sale-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-sale-form-320.png` })
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.evaluate(() => window.__setTestSales([]))
  await page.getByText('Nenhuma venda cadastrada.', { exact: true }).waitFor()
  assert.equal(await page.locator('.sales-list-placeholder .sales-table tbody tr').count(), 0)
  await page.evaluate(() => sessionStorage.setItem('fail-sales', '1'))
  await open('/vendas')
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar todos os dados' }).waitFor()
  assert.equal(await page.locator('.sales-summary strong').filter({ hasText: 'Indisponível' }).count(), 4)
  assert.equal(await page.getByText('Nenhuma venda cadastrada.', { exact: true }).count(), 0)
  await page.evaluate(() => sessionStorage.removeItem('fail-sales'))
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await page.locator('.sales-list-placeholder .sales-table tbody tr').first().waitFor()

  await open('/financeiro')
  await page.locator('.financial-list-count').filter({ hasText: '5 de 5 contas' }).waitFor()
  await page.getByText('3 em aberto', { exact: false }).waitFor()
  assert.match(await page.locator('.financial-card').filter({ hasText: 'Falta receber' }).innerText(), /Conferir dados/)
  assert.match(await page.locator('.financial-card').filter({ hasText: 'Recebido' }).innerText(), /90,00/)
  await page.getByRole('radio', { name: 'Escolher datas', exact: true }).check()
  await filter('Vencimento de', '2020-03-02')
  await filter('Vencimento até', '2020-03-02')
  const legacyRow = page.locator('.financial-table').first().locator('tbody tr')
  assert.equal(await legacyRow.count(), 1)
  assert.match(await legacyRow.innerText(), /Em atraso/)
  assert.equal(await legacyRow.getByRole('button', { name: 'Receber', exact: true }).isEnabled(), true)
  await legacyRow.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByText('Não há venda localizada pelo identificador desta conta.', { exact: false }).waitFor()
  await page.getByText('Dados para revisão', { exact: true }).click()
  await page.getByText('Situação salva: Pago.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByLabel('Vencimento de', { exact: true }).inputValue(), '2020-03-02')
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('cliente inexistente no teste')
  await page.getByText('Nenhuma conta encontrada com esses filtros.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  await page.evaluate(() => {
    window.__allowFinancialWrites = true;
    window.__setTestSales([]);
    window.__setTestSource('financeiroRecebimentos', [{ id: 'known-old-payment', receivableId: 'paid-test', clientId: 'c1', amount: 50, paymentDate: '2020-01-01' }]);
    window.__setTestSource('financeiroReceber', [
      { id: 'legacy-test', clientId: 'c1', amount: 100, receivedAmount: 0, dueDate: '2020-01-01' },
      { id: 'paid-test', clientId: 'c1', amount: 50, receivedAmount: 50, dueDate: '2020-01-01', status: 'Pago' },
      { id: 'future-test', clientId: 'c1', amount: 20, receivedAmount: 0, dueDate: '2026-11-01' },
    ]);
  })
  await financialMetric('Falta receber', '120,00')
  await financialMetric('Recebido', '50,00')
  await financialMetric('Clientes com saldo', '1')
  await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).fill('VAVA')
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('Paga')
  assert.equal(await page.locator('.financial-accounts-table tbody tr').count(), 1)
  assert.equal(await page.locator('.financial-accounts-table').getByRole('button', { name: 'Receber', exact: true }).count(), 0)
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('Em atraso')
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByText('Nenhum lançamento individual de pagamento localizado pelo ID desta conta.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: 'Buscar cliente', exact: true }).inputValue(), 'VAVA')
  await page.getByRole('button', { name: 'Receber', exact: true }).click()
  for (const value of ['0', '-1', '101']) {
    await page.locator('#receiveAmount').fill(value)
    await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
    await page.getByRole('alert').waitFor()
  }
  await page.locator('#receiveAmount').fill('30,00')
  await page.locator('#receiveDate').fill('2026-10-27')
  await page.locator('#receiveMethod').selectOption('Pix')
  await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
  await page.getByRole('heading', { name: 'Confira o recebimento', exact: true }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('fail-financial-save', '1'))
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'indisponível' }).waitFor()
  assert.equal(await page.locator('#receiveAmount').inputValue(), '30,00')
  await page.evaluate(() => sessionStorage.removeItem('fail-financial-save'))
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await page.getByText('Pagamento registrado com sucesso.', { exact: true }).waitFor()
  await financialMetric('Falta receber', '90,00')
  await financialMetric('Recebido', '80,00')
  const firstFinancialPayment = await page.evaluate(async () => (await (await import('/src/services/financialService.js')).listFinancialPaymentsByUser('test-jn-only')).find(payment => payment.receivableId === 'legacy-test'))
  await page.evaluate(async requestId => {
    const service = await import('/src/services/financialService.js');
    await service.registerFinancialPaymentByUser('test-jn-only', { id: 'legacy-test', receivedAmount: 0 }, { amount: 30, paymentDate: '2026-10-27', paymentMethod: 'Pix', requestId });
  }, firstFinancialPayment.id)
  await financialMetric('Recebido', '80,00')
  assert.equal(await page.evaluate(async () => (await (await import('/src/services/financialService.js')).listFinancialPaymentsByUser('test-jn-only')).length), 2)
  await page.getByRole('button', { name: 'Ver', exact: true }).click()
  await page.locator('.financial-account-history').getByText('R$ 30,00', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  await page.getByRole('button', { name: 'Receber', exact: true }).click()
  await page.locator('#receiveAmount').fill('70')
  await page.locator('#receiveDate').fill('2026-10-27')
  await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  await financialMetric('Falta receber', '20,00')
  await financialMetric('Recebido', '150,00')
  await page.getByText('Nenhuma conta encontrada com esses filtros.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  const reportPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click()
  const report = await reportPromise
  await report.waitForLoadState('domcontentloaded')
  assert.match((await report.locator('body').innerText()).replace(/\u00a0/g, ' '), /20,00/)
  await report.close()
  await page.getByText('Período dos recebimentos', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Recebimentos', exact: true }).selectOption('custom')
  await filter('Pagamento de', '2020-01-01')
  await filter('Pagamento até', '2020-01-31')
  await financialMetric('Recebido', '50,00')
  await financialMetric('Falta receber', '20,00')
  await page.getByRole('combobox', { name: 'Recebimentos', exact: true }).selectOption('all')
  await page.evaluate(() => {
    window.__setTestSource('financeiroRecebimentos', []);
    window.__setTestSales([{ id: 'financial-linked-sale', clientId: 'c1', totalAmount: 100, paidAmount: 0, amountPaid: 0, remainingAmount: 100, saleDate: '2026-10-27', paymentMethod: 'Prazo', payments: [], items: [{ productId: 'product', quantity: 1, unitPrice: 100, subtotal: 100 }] }]);
    window.__setTestSource('financeiroReceber', [
      { id: 'first', clientId: 'c1', saleId: 'financial-linked-sale', amount: 50, receivedAmount: 0, dueDate: '2026-11-01', installment: 1 },
      { id: 'second', clientId: 'c1', saleId: 'financial-linked-sale', amount: 50, receivedAmount: 0, dueDate: '2026-12-01', installment: 2 },
    ]);
  })
  await page.locator('.financial-accounts-table tbody tr').last().getByRole('button', { name: 'Receber', exact: true }).click()
  await page.locator('#receiveAmount').fill('20')
  await page.locator('#receiveDate').fill('2026-10-27')
  await page.getByRole('button', { name: 'Conferir pagamento', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar recebimento', exact: true }).click()
  const linkedAccounts = await page.evaluate(async () => (await (await import('/src/services/financialService.js')).listReceivablesByUser('test-jn-only')))
  assert.equal(linkedAccounts.find(account => account.id === 'first').receivedAmount, 0)
  assert.equal(linkedAccounts.find(account => account.id === 'second').receivedAmount, 20)
  await financialMetric('Recebido', '20,00')
  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      await page.evaluate(() => window.scrollTo(0, 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Financeiro sem rolagem horizontal')
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-financial-${size.width}.png`, fullPage: true })
    }
    await page.locator('.financial-accounts-table tbody tr').last().getByRole('button', { name: 'Ver', exact: true }).click()
    assert.equal(await page.locator('.financial-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-financial-details-320.png` })
    await page.getByRole('button', { name: 'Voltar', exact: true }).click()
    await page.locator('.financial-accounts-table tbody tr').last().getByRole('button', { name: 'Receber', exact: true }).click()
    assert.equal(await page.locator('.financial-modal').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-financial-receive-320.png` })
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.locator('.financial-accounts-table tbody tr').last().getByRole('button', { name: 'Ver', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir venda e recibo', exact: true }).click()
  await page.waitForURL('**/vendas')
  await page.getByRole('heading', { name: 'Detalhes da venda', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Recibo', exact: true }).click()
  const financialReceipt = page.frameLocator('iframe[title="Documento do recibo"]')
  await financialReceipt.locator('.receipt').waitFor()
  assert.match((await financialReceipt.locator('body').innerText()).replace(/\u00a0/g, ' '), /100,00/)
  await page.getByRole('dialog', { name: 'Recibo da venda', exact: true }).getByRole('button', { name: 'Voltar', exact: true }).click()

  await open('/produtos')
  await page.evaluate(() => {
    window.__allowProductWrites = true;
    window.__setTestSource('products', [{ id: 'preserve-catalog', description: '  PANELA   DE   Tramontina  GG  24cm ', code: 'ORIGINAL-01', category: 'Utensílios', size: 'P, M, G e GG', color: 'Azul / branco', stockQuantity: 2, salePrice: 230, costPrice: 100 }]);
  })
  await page.locator('.products-table').getByText('Panela de Tramontina GG 24cm', { exact: true }).waitFor()
  await productMetric('Peças em estoque', '2')
  await productMetric('Valor do estoque para venda', '460,00')
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#description').inputValue(), '  PANELA   DE   Tramontina  GG  24cm ')
  assert.equal(await page.locator('#code').inputValue(), 'ORIGINAL-01')
  await page.locator('#category').fill('Cozinha')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Produto atualizado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => ['description', 'code', 'size', 'color', 'stockQuantity', 'salePrice', 'costPrice'].every(key => !Object.hasOwn(window.__mockWrites.at(-1).payload, key))), true)
  await productMetric('Peças em estoque', '2')
  await productMetric('Valor do estoque para venda', '460,00')

  await open('/clientes')
  await page.evaluate(() => {
    window.__allowClientWrites = true;
    window.__setTestSource('clients', [{ id: 'preserve-client', name: '  MARIA   D’Ávila  ', nickname: '  Dona   Maria  ', phone: '', city: 'Curitiba' }]);
  })
  await page.locator('.clients-table').getByText('MARIA D’Ávila', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  assert.equal(await page.locator('#name').inputValue(), '  MARIA   D’Ávila  ')
  await page.locator('#city').fill('Londrina')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByText('Cliente atualizado com sucesso.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => !Object.hasOwn(window.__mockWrites.at(-1).payload, 'name') && !Object.hasOwn(window.__mockWrites.at(-1).payload, 'nickname')), true)

  await open('/financeiro')
  await page.evaluate(() => {
    window.__setTestSales([]);
    window.__setTestSource('financeiroReceber', [{ id: 'untraced-paid-test', clientId: 'c1', amount: 100, receivedAmount: 100, dueDate: '2020-01-01', status: 'Pago' }]);
    window.__setTestSource('financeiroRecebimentos', [{ id: 'known-only', amount: 10, paymentDate: '2026-10-27' }]);
  })
  await financialMetric('Recebido', 'Conferir dados')
  await page.getByRole('heading', { name: 'Por que Recebido mostra “Conferir dados”?', exact: true }).waitFor()
  assert.match(await page.locator('.financial-received-explanation').innerText(), /1 conta\(s\).*valor pago salvo/)
  assert.match(await page.locator('.financial-received-explanation').innerText(), /10,00/)
  await page.getByText('Cadastros antigos em atualização.', { exact: false }).waitFor()
  if (process.env.JN_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-recorded-data-390.png`, fullPage: true, animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }

  await open('/dashboard')
  await page.getByRole('heading', { name: 'Visão geral', exact: true }).waitFor()
  await metric('Vendas realizadas', '3')
  await metric('Total vendido', '175,00')
  await metric('Total recebido', '90,00')
  await metric('Falta receber', '85,00')
  await metric('Clientes cadastrados', '2')
  await metric('Produtos em estoque', '3')
  const summary = await page.evaluate(async () => {
    const service = await import('/src/services/salesService.js')
    return service.getSalesSummaryByUser('test-jn-only')
  })
  assert.deepEqual(summary, { totalSales: 3, totalSoldValue: 175, totalProductsSold: 2 })
  await page.evaluate(() => window.__setTestSales([]))
  await metric('Vendas realizadas', '0')
  await metric('Total vendido', '0,00')
  await page.evaluate(entries => window.__setTestSales(entries), fixtures.sales.map(sale => sale.id === 's3' ? { ...sale, totalAmount: 35 } : sale))
  await metric('Total vendido', '185,00')
  await page.getByRole('radio', { name: 'Escolher datas', exact: true }).check()
  await filter('Data inicial', '2020-02-01')
  await filter('Data final', '2020-02-01')
  await metric('Vendas realizadas', '1')
  await metric('Total vendido', '100,00')
  await metric('Total recebido', '0,00')
  await metric('Clientes cadastrados', '2')
  await metric('Produtos em estoque', '3')
  await filter('Data inicial', '2020-03-01')
  await filter('Data final', '2020-03-01')
  await metric('Total recebido', '40,00')
  await metric('Total vendido', '0,00')
  await page.getByRole('button', { name: 'Limpar filtro', exact: true }).click()
  await metric('Total vendido', '185,00')
  assert.equal(await page.getByRole('radio', { name: 'Todo o período', exact: true }).isChecked(), true)
  await page.getByRole('button', { name: 'Nova venda', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('#clientId').isVisible(), true)
  await page.reload()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await open('/dashboard')
  await page.getByRole('button', { name: 'Cadastrar cliente', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('#name').isVisible(), true)
  await page.reload()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await open('/dashboard')
  await page.getByRole('button', { name: 'Receber pagamento', exact: true }).click()
  await page.waitForURL('**/financeiro')
  await open('/dashboard')
  await page.getByRole('button', { name: 'Ver produtos', exact: true }).click()
  await page.waitForURL('**/produtos')

  await open('/dashboard')
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00-03:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const recentSales = [
    { id: 'current', saleDate: '2026-10-27', totalAmount: 1250, paidAmount: 250, payments: [{ amount: 250, paymentDate: '2026-10-27' }], dueDates: [{ dueDate: '2026-11-27', amount: 1250 }] },
    { id: 'earlier-month', saleDate: '2026-10-01', totalAmount: 200, paidAmount: 0, dueDates: [{ dueDate: '2026-10-10', amount: 200 }] },
    { id: 'earlier-year', saleDate: '2026-01-01', totalAmount: 300, paidAmount: 0, dueDates: [{ dueDate: '2026-12-01', amount: 300 }] },
  ]
  await page.evaluate(entries => window.__setTestSales(entries), recentSales)
  await metric('Total vendido', '1.750,00')
  await page.getByRole('radio', { name: 'Hoje', exact: true }).check()
  await metric('Total vendido', '1.250,00')
  await metric('Total recebido', '250,00')
  await page.getByRole('radio', { name: 'Este mês', exact: true }).check()
  await metric('Total vendido', '1.450,00')
  await page.getByRole('radio', { name: 'Este ano', exact: true }).check()
  await metric('Total vendido', '1.750,00')
  await page.getByRole('button', { name: 'Limpar filtro', exact: true }).click()
  await page.evaluate(() => window.__setTestSource('products', [{ id: 'stock', stockQuantity: 2087 }, { id: 'empty', stockQuantity: 0 }, { id: 'low', stockQuantity: 2 }]))
  await metric('Produtos em estoque', '2.089')
  await page.getByText('Unidades disponíveis · 3 produtos cadastrados', { exact: true }).waitFor()

  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-dashboard-${size.width}.png`, fullPage: true })
    }
  }
  await page.evaluate(() => {
    for (const key of ['sales', 'financeiroReceber', 'financeiroRecebimentos', 'clients', 'products']) window.__setTestSource(key, [])
  })
  await metric('Total vendido', '0,00')
  await metric('Total recebido', '0,00')
  await metric('Clientes cadastrados', '0')
  await page.getByText('Nenhuma venda encontrada neste período.', { exact: true }).waitFor()
  await page.getByText('Nenhum pagamento registrado neste período.', { exact: true }).waitFor()
  await page.evaluate(() => sessionStorage.setItem('cached', '1'))
  await open('/dashboard')
  await page.getByText('Aguardando confirmação da conexão', { exact: true }).waitFor()
  assert.equal(await page.locator('.metric-card-value').filter({ hasText: 'Carregando' }).count(), 6)
  await page.evaluate(() => sessionStorage.removeItem('cached'))

  for (const route of ['/dashboard', '/clientes', '/vendas', '/financeiro']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(route)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Sem transbordamento em ${route}`)
    assert.equal(await page.evaluate(() => window.__writes), 0)
    assert.ok((await page.evaluate(() => window.__readPaths)).every(path => path.startsWith('users/test-jn-only/')))
  }

  await page.setViewportSize({ width: 1366, height: 900 })
  await open('/dashboard')
  await page.evaluate(() => {
    window.__allowRestartWrites = true;
    window.__setTestSource('products', [{ id: 'proof-product', description: 'Produto comprovado de teste', stockQuantity: 7, stockMovementId: 'debit-proof', salePrice: 100 }, { id: 'legacy-product', description: 'Produto antigo de teste', stockQuantity: 3, salePrice: 100 }]);
    window.__setTestSales([
      { id: 'proof-sale', clientId: 'c1', saleDate: '2020-01-01', totalAmount: 300, paidAmount: 0, amountPaid: 0, remainingAmount: 300, items: [{ productId: 'proof-product', quantity: 3, unitPrice: 100 }], stockDebitProof: { version: 1, items: [{ productId: 'proof-product', quantity: 3, before: 10, after: 7, eventId: 'debit-proof' }] } },
      { id: 'legacy-sale', clientId: 'c2', saleDate: '2020-01-01', totalAmount: 200, paidAmount: 0, remainingAmount: 200, items: [{ productId: 'legacy-product', quantity: 2, unitPrice: 100 }] },
    ]);
    window.__setTestSource('financeiroReceber', [{ id: 'proof-account', clientId: 'c1', saleId: 'proof-sale', dueDate: '2020-01-01', amount: 300, receivedAmount: 0 }, { id: 'orphan-account', clientId: 'c2', dueDate: '2020-01-01', amount: 50, receivedAmount: 0 }]);
    window.__setTestSource('financeiroRecebimentos', [{ id: 'old-payment', amount: 330, paymentDate: '2020-01-01' }]);
    window.__setTestSource('receipts', [{ id: 'old-receipt', saleId: 'proof-sale' }]);
    window.__setTestSource('payments', [{ id: 'old-auxiliary-payment', amount: 12 }]);
  })
  await metric('Falta receber', '500,00')
  let downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Preparar sistema para recomeçar', exact: true }).click()
  const cancelledBackup = await downloadPromise
  assert.match(cancelledBackup.suggestedFilename(), /^jn-antes-da-limpeza-completa-.+\.json$/)
  await page.getByText('Já localizei a cópia nos meus downloads.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Confirmar limpeza completa', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__writes), 0)
  downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Preparar sistema para recomeçar', exact: true }).click()
  const backupDownload = await downloadPromise
  const backupPath = await backupDownload.path()
  const backupFile = JSON.parse(await (await import('node:fs/promises')).readFile(backupPath, 'utf8'))
  assert.equal(backupFile.projectId, 'jn-confeccoes')
  assert.equal(backupFile.uid, 'test-jn-only')
  assert.equal(backupFile.mode, 'cleanup')
  assert.equal(backupFile.plan.accountIds.length, 2)
  assert.equal(backupFile.plan.returns.length, 1)
  assert.equal(backupFile.plan.returns[0].before, 7)
  assert.equal(backupFile.plan.returns[0].after, 10)
  assert.equal(backupFile.plan.deleteCounts.payments, 1)
  assert.equal(backupFile.plan.deleteCounts.receipts, 1)
  assert.equal(backupFile.plan.deleteCounts.otherPayments, 1)
  if (process.env.JN_SCREENSHOT_DIR) {
    for (const size of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(size)
      assert.equal(await page.locator('.restart-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true)
      await page.screenshot({ path: `${process.env.JN_SCREENSHOT_DIR}/jn-restart-preview-${size.width}.png`, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1366, height: 900 })
  }
  await page.getByRole('checkbox', { name: 'Já localizei a cópia nos meus downloads.', exact: true }).check()
  await page.evaluate(() => sessionStorage.setItem('fail-restart', '1'))
  await page.getByRole('button', { name: 'Confirmar limpeza completa', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /Falha simulada no reinício/)
  await metric('Falta receber', '500,00')
  await page.evaluate(() => sessionStorage.removeItem('fail-restart'))
  await page.getByRole('button', { name: 'Confirmar limpeza completa', exact: true }).click()
  await page.getByRole('heading', { name: 'Resultado do reinício', exact: true }).waitFor()
  await page.getByText('Conferência final concluída:', { exact: false }).waitFor()
  await metric('Falta receber', '0,00')
  await metric('Total recebido', '0,00')
  await metric('Vendas realizadas', '0')
  await metric('Total vendido', '0,00')
  await metric('Produtos em estoque', '13')
  await metric('Clientes cadastrados', '2')
  const writesAfterRestart = await page.evaluate(() => window.__writes)
  await page.getByRole('button', { name: 'Concluir', exact: true }).click()
  await page.getByRole('button', { name: 'Preparar sistema para recomeçar', exact: true }).click()
  await page.getByText('A limpeza completa já estava registrada. Nenhuma exclusão ou devolução foi repetida.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__writes), writesAfterRestart)
  await page.getByRole('button', { name: 'Concluir', exact: true }).click()
  await page.getByRole('button', { name: 'Financeiro', exact: true }).click()
  await financialMetric('Falta receber', '0,00')
  await financialMetric('Em atraso', '0,00')
  await financialMetric('Clientes com saldo', '0')
  await financialMetric('Recebido', '0,00')
  await page.getByText('Nenhuma conta cadastrada.', { exact: true }).waitFor()
  assert.equal(await page.locator('.financial-accounts-table tbody tr').count(), 0)
  assert.equal(await page.locator('.financial-accounts-table').getByRole('button', { name: 'Receber', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Clientes', exact: true }).click()
  await page.locator('.clients-table tbody tr').filter({ hasText: 'Cliente de teste' }).getByRole('button', { name: 'Ver', exact: true }).click()
  await page.locator('.client-balance strong').filter({ hasText: '0,00' }).waitFor()
  await page.getByRole('button', { name: 'Voltar', exact: true }).click()
  assert.equal(await page.evaluate(async () => (await (await import('/src/services/financialService.js')).listFinancialPaymentsByUser('test-jn-only')).length), 0)
  await page.getByRole('button', { name: 'Vendas', exact: true }).click()
  await page.getByText('Nenhuma venda cadastrada.', { exact: true }).waitFor()
  assert.equal(await page.locator('.sales-summary strong').filter({ hasText: /0(?:,00)?/ }).count(), 4)

  await page.evaluate(() => sessionStorage.setItem('fail-sales', '1'))
  await open('/dashboard')
  await page.getByRole('alert').filter({ hasText: 'Permissão negada' }).waitFor()
  assert.equal(await page.locator('.metric-card-value').filter({ hasText: 'Indisponível' }).count(), 4)
  await page.evaluate(() => sessionStorage.removeItem('fail-sales'))
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await metric('Total vendido', '175,00')
  assert.equal(await page.locator('.dashboard-error').count(), 0)
  await page.evaluate(() => sessionStorage.setItem('fail-sales', '1'))
  await open('/financeiro')
  await page.locator('.financial-message.error').filter({ hasText: 'Permissão negada' }).waitFor()
  assert.equal(await page.locator('.financial-card strong').filter({ hasText: 'Indisponível' }).count(), 4)
  assert.equal(await page.evaluate(() => window.__writes), 0)
  assert.deepEqual(pageErrors, [])
  console.log('OK: quatro telas em desktop/mobile, leituras sem exclusão por data, filtros, contas órfãs, totais sem duplicação, atualização em tempo real e falha de permissão sem zero falso. Nenhuma gravação ou rede externa permitida.')
  }
} finally {
  await context.close()
  await browser.close()
}