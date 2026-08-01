import { chromium } from 'playwright'

const baseUrl = 'http://localhost:4173'
const runId = Date.now()
const email = `teste.recibo.${runId}@example.com`
const password = 'Senha123!'
const today = new Date().toISOString().slice(0, 10)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

const pageErrors = []
const consoleErrors = []

page.on('pageerror', (error) => {
  pageErrors.push({ message: error.message, stack: error.stack })
})

page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text())
  }
})

async function openReceiptAndGetText(pageRef) {
  const popupPromise = pageRef.waitForEvent('popup')
  await pageRef.getByRole('button', { name: /Recibo/ }).first().click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  const text = await popup.locator('body').innerText()
  await popup.close()
  return text.replace(/\u00a0/g, ' ')
}

try {
  await page.goto(`${baseUrl}/register`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', 'Teste Recibo Atualizado')
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

  await page.goto(`${baseUrl}/produtos`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Novo Produto' }).click()
  await page.fill('#code', `RC-${runId}`)
  await page.fill('#description', `Produto ${runId}`)
  await page.selectOption('#category', 'Masculino')
  await page.fill('#stockQuantity', '5')
  await page.fill('#salePrice', '1000')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.locator('.products-message.success').filter({ hasText: 'Salvo com sucesso.' }).waitFor({ timeout: 20000 })

  await page.goto(`${baseUrl}/vendas`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Nova Venda' }).click()
  await page.waitForFunction(() => document.querySelectorAll('#clientId option').length > 1, { timeout: 20000 })

  await page.selectOption('#clientId', { index: 1 })
  await page.selectOption('#paymentMethod', 'Prazo')
  await page.fill('#installments', '2')
  await page.fill('#firstDueDate', today)
  await page.locator('.sale-item-row select').first().selectOption({ index: 1 })
  await page.locator('.sale-item-row input[placeholder="Qtd"]').first().fill('1')
  await page.locator('.sale-item-row input[placeholder="Preço"]').first().fill('1000')
  await page.locator('.sale-item-row input[placeholder="Desconto"]').first().fill('0')
  await page.getByRole('button', { name: 'Salvar venda' }).click()
  await page.waitForTimeout(1800)

  await page.getByRole('button', { name: /Receber/ }).first().click()
  await page.fill('#receiveAmount', '200')
  await page.fill('#receiveDate', today)
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await page.waitForTimeout(2000)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)

  const partialReceiptText = await openReceiptAndGetText(page)

  const partialChecks = {
    hasTotal: partialReceiptText.includes('Valor total da venda') && partialReceiptText.includes('R$ 1.000,00'),
    hasReceived: partialReceiptText.includes('Valor recebido acumulado') && partialReceiptText.includes('R$ 200,00'),
    hasRemaining: partialReceiptText.includes('Saldo a receber') && partialReceiptText.includes('R$ 800,00'),
    hasPartialStatus: partialReceiptText.includes('Status: Parcial'),
  }

  if (!Object.values(partialChecks).every(Boolean)) {
    throw new Error(`Recibo parcial inválido: ${JSON.stringify(partialChecks)} | texto: ${partialReceiptText}`)
  }

  await page.getByRole('button', { name: /Receber/ }).first().click()
  await page.fill('#receiveAmount', '800')
  await page.fill('#receiveDate', today)
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await page.waitForTimeout(2200)

  const totalReceiptText = await openReceiptAndGetText(page)
  const totalChecks = {
    hasTotal: totalReceiptText.includes('Valor total da venda') && totalReceiptText.includes('R$ 1.000,00'),
    hasReceived: totalReceiptText.includes('Valor recebido acumulado') && totalReceiptText.includes('R$ 1.000,00'),
    hasRemaining: totalReceiptText.includes('Saldo a receber') && totalReceiptText.includes('R$ 0,00'),
    hasPaidStatus: totalReceiptText.includes('Status: Pago'),
  }

  if (!Object.values(totalChecks).every(Boolean)) {
    throw new Error(`Recibo pago inválido: ${JSON.stringify(totalChecks)} | texto: ${totalReceiptText}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        partialChecks,
        totalChecks,
        pageErrors,
        consoleErrors,
      },
      null,
      2,
    ),
  )
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
        consoleErrors,
      },
      null,
      2,
    ),
  )
} finally {
  await context.close()
  await browser.close()
}
