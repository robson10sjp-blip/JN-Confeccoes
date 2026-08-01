import { chromium } from 'playwright'

const baseUrl = 'http://localhost:4173'
const runId = Date.now()
const email = `teste.receber.${runId}@example.com`
const password = 'Senha123!'
const today = new Date().toISOString().slice(0, 10)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const consoleEntries = []
const pageErrors = []

async function collectPageMessages(page) {
  const selectors = [
    '.clients-message.error',
    '.products-message.error',
    '.sales-message.error',
    '.financial-message.error',
    '.form-message.error',
    '.login-form-message.error',
  ]

  const messages = []
  for (const selector of selectors) {
    const values = await page.locator(selector).allTextContents()
    messages.push(...values.filter(Boolean))
  }

  return messages
}

page.on('console', async (msg) => {
  const values = []
  for (const arg of msg.args()) {
    try {
      values.push(await arg.jsonValue())
    } catch {
      values.push('[unserializable]')
    }
  }

  consoleEntries.push({
    type: msg.type(),
    text: msg.text(),
    values,
  })
})

page.on('pageerror', (error) => {
  pageErrors.push({
    message: error.message,
    stack: error.stack,
  })
})

try {
  await page.goto(`${baseUrl}/register`, { waitUntil: 'domcontentloaded' })

  await page.fill('#name', 'Teste Receber')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.fill('#confirm-password', password)
  await page.getByRole('button', { name: 'Cadastrar' }).click()

  await page.waitForURL('**/dashboard', { timeout: 30000 })

  await page.goto(`${baseUrl}/clientes`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Novo cliente' }).click()
  await page.fill('#name', `Cliente ${runId}`)
  await page.fill('#phone', '11999999999')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.locator('.clients-message.success').filter({ hasText: 'Salvo com sucesso.' }).waitFor({ timeout: 20000 })

  const clientErrors = await collectPageMessages(page)
  if (clientErrors.length) {
    throw new Error(`Erro ao salvar cliente: ${clientErrors.join(' | ')}`)
  }

  await page.goto(`${baseUrl}/produtos`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Novo Produto' }).click()
  await page.fill('#code', `COD-${runId}`)
  await page.fill('#description', `Produto ${runId}`)
  await page.selectOption('#category', 'Masculino')
  await page.fill('#stockQuantity', '5')
  await page.fill('#salePrice', '100')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.locator('.products-message.success').filter({ hasText: 'Salvo com sucesso.' }).waitFor({ timeout: 20000 })

  const productErrors = await collectPageMessages(page)
  if (productErrors.length) {
    throw new Error(`Erro ao salvar produto: ${productErrors.join(' | ')}`)
  }

  await page.goto(`${baseUrl}/vendas`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Nova Venda' }).click()

  await page.waitForFunction(() => {
    const select = document.querySelector('#clientId')
    if (!select) {
      return false
    }
    return select.querySelectorAll('option').length > 1
  }, { timeout: 20000 }).catch(() => {})

  const clientOptions = await page.locator('#clientId option').allTextContents()
  if (clientOptions.length < 2) {
    const saleErrors = await collectPageMessages(page)
    throw new Error(
      `Sem cliente no select de venda. Opcoes: ${JSON.stringify(clientOptions)}. Erros: ${saleErrors.join(' | ')}`,
    )
  }

  await page.selectOption('#clientId', { index: 1 })
  await page.selectOption('#paymentMethod', 'Prazo')
  await page.fill('#installments', '2')
  await page.fill('#firstDueDate', today)

  const firstProductSelect = page.locator('.sale-item-row select').first()
  await firstProductSelect.selectOption({ index: 1 })

  await page.locator('.sale-item-row input[placeholder="Qtd"]').first().fill('1')
  await page.locator('.sale-item-row input[placeholder="Preço"]').first().fill('100')
  await page.locator('.sale-item-row input[placeholder="Desconto"]').first().fill('0')

  await page.getByRole('button', { name: 'Salvar venda' }).click()
  await page.waitForTimeout(1800)

  const saleErrorsAfterSave = await collectPageMessages(page)
  if (saleErrorsAfterSave.length) {
    throw new Error(`Erro ao salvar venda: ${saleErrorsAfterSave.join(' | ')}`)
  }

  const receiveButton = page.getByRole('button', { name: /Receber/ }).first()
  await receiveButton.click()

  await page.fill('#receiveAmount', '10')
  await page.fill('#receiveDate', today)
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await page.waitForTimeout(2200)

  let salesMessages = await page.locator('.sales-message').allTextContents().catch(() => [])
  if (!salesMessages.join(' | ').includes('Salvo com sucesso.')) {
    throw new Error(`Recebimento parcial não confirmou sucesso: ${salesMessages.join(' | ')}`)
  }

  const rowAfterPartial = page.locator('.sales-table tbody tr').first()
  const rowTextPartial = await rowAfterPartial.innerText()
  if (!rowTextPartial.includes('Parcial')) {
    throw new Error(`Status parcial não atualizado após recebimento parcial. Linha: ${rowTextPartial}`)
  }

  await receiveButton.click()
  await page.fill('#receiveAmount', '90')
  await page.fill('#receiveDate', today)
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await page.waitForTimeout(2200)

  salesMessages = await page.locator('.sales-message').allTextContents().catch(() => [])
  if (!salesMessages.join(' | ').includes('Salvo com sucesso.')) {
    throw new Error(`Recebimento total não confirmou sucesso: ${salesMessages.join(' | ')}`)
  }

  const rowAfterTotal = page.locator('.sales-table tbody tr').first()
  const rowTextTotal = await rowAfterTotal.innerText()
  if (!rowTextTotal.includes('Pago')) {
    throw new Error(`Status pago não atualizado após recebimento total. Linha: ${rowTextTotal}`)
  }

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: /Recibo/ }).first().click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  const popupContent = await popup.content()
  if (!popupContent.includes('RECIBO')) {
    throw new Error('Recibo não foi gerado corretamente.')
  }
  await popup.close()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const rowAfterReload = page.locator('.sales-table tbody tr').first()
  const rowTextReload = await rowAfterReload.innerText()
  if (!rowTextReload.includes('Pago')) {
    throw new Error(`Status pago não persistiu após recarregar. Linha: ${rowTextReload}`)
  }

  const messageText = await page.locator('.sales-message').allTextContents().catch(() => [])

  const invalidArgumentEntries = consoleEntries.filter((entry) => {
    const serialized = JSON.stringify(entry)
    return serialized.includes('invalid-argument') || serialized.includes('FirebaseError')
  })

  const errorConsoleEntries = consoleEntries.filter((entry) => entry.type === 'error')

  const output = {
    ok: true,
    email,
    today,
    pageErrors,
    messageText,
    invalidArgumentEntries,
    errorConsoleEntries,
    recentConsole: consoleEntries.slice(-20),
  }

  console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: {
          message: error.message,
          stack: error.stack,
        },
        pageErrors,
        recentConsole: consoleEntries.slice(-30),
      },
      null,
      2,
    ),
  )
} finally {
  await context.close()
  await browser.close()
}
