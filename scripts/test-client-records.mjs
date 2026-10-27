import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { buildClientChanges, filterClientRecords, findClientDuplicates, formatClientPhoneInput, getClientCities, inspectClientRelations, isValidClientPhone, validateClientDraft } from '../src/utils/clientRecords.js'

const clients = [
  { id: 'a', name: 'Álvaro', nickname: 'Vavá', phone: '(11) 99999-1234', secondaryPhone: '(21) 98888-4567', secondaryPhoneLabel: 'marido', city: 'São Paulo', cpf: '123.456.789-00' },
  { id: 'b', name: 'Beatriz', phone: 'telefone antigo', city: 'Curitiba' },
  { id: 'c', name: 'Álvaro', phone: '(21) 98888-1234', city: 'SÃO PAULO' },
]
assert.equal(filterClientRecords(clients, 'vava').length, 1)
assert.equal(filterClientRecords(clients, 'ALVARO').length, 2)
assert.equal(filterClientRecords(clients, '11999991234').length, 1)
assert.equal(filterClientRecords(clients, '21988884567').length, 1)
assert.equal(filterClientRecords(clients, '(21) 98888-4567').length, 1)
assert.equal(filterClientRecords(clients, '', 'sao paulo').length, 2)
assert.equal(getClientCities(clients).length, 2)
assert.equal(isValidClientPhone(''), true)
assert.equal(isValidClientPhone('telefone antigo'), false)
assert.equal(isValidClientPhone('(11) 99999-1234'), true)
assert.equal(isValidClientPhone('(11) 3333-1234'), true)
assert.equal(formatClientPhoneInput('11999991234'), '(11) 99999-1234')
assert.equal(formatClientPhoneInput('telefone antigo'), 'telefone antigo')
assert.equal(validateClientDraft({ name: 'Beatriz', phone: 'telefone antigo', cpf: '' }, clients[1]), '')
assert.equal(validateClientDraft({ name: 'Teste', phone: '(11) 99999-1234', secondaryPhone: '(21) 98888-4567', secondaryPhoneLabel: 'marido' }), '')
assert.equal(validateClientDraft({ name: 'Teste', phone: '(11) 99999-1234', secondaryPhone: '(21) 98888-4567', secondaryPhoneLabel: '' }), '')
assert.match(validateClientDraft({ name: 'Teste', phone: '', secondaryPhone: 'marido 123' }), /outro telefone/)
assert.match(validateClientDraft({ name: 'Teste', phone: '', secondaryPhone: '', secondaryPhoneLabel: 'marido' }), /Informe o outro telefone/)
const legacyContacts = { name: 'Antigo', phone: '  (11) 99999-1234 / marido (21) 98888-4567  ', city: 'Curitiba' }
const unrelatedEdit = { ...legacyContacts, city: 'Londrina', secondaryPhone: '', secondaryPhoneLabel: '' }
assert.equal(validateClientDraft(unrelatedEdit, legacyContacts), '')
assert.deepEqual(buildClientChanges(unrelatedEdit, legacyContacts), { city: 'Londrina' })
const organized = { ...legacyContacts, phone: '(11) 99999-1234', secondaryPhone: '(21) 98888-4567', secondaryPhoneLabel: 'marido' }
assert.equal(validateClientDraft(organized, legacyContacts), '')
assert.deepEqual(buildClientChanges(organized, legacyContacts), { phone: '(11) 99999-1234', secondaryPhone: '(21) 98888-4567', secondaryPhoneLabel: 'marido' })
assert.deepEqual(buildClientChanges({ ...organized, city: 'Londrina' }, organized), { city: 'Londrina' })
assert.deepEqual(buildClientChanges({ ...organized, secondaryPhone: '', secondaryPhoneLabel: '' }, organized), { secondaryPhone: '', secondaryPhoneLabel: '' })
assert.match(validateClientDraft({ name: 'Beatriz', phone: 'novo inválido', cpf: '' }, clients[1]), /Confira o telefone/)
assert.deepEqual(buildClientChanges({ name: 'Beatriz', phone: 'telefone antigo', city: 'Londrina' }, clients[1]), { city: 'Londrina' })
assert.equal(findClientDuplicates(clients, { name: 'Outro nome', cpf: '12345678900' }).length, 1)
assert.equal(findClientDuplicates(clients, { name: 'ALVARO', phone: '11999991234' }).length, 1)
assert.equal(findClientDuplicates(clients, { name: 'Álvaro', phone: '31988881234' }).length, 0)
const records = {
  sales: [{ id: 'sale', clientId: 'a', totalAmount: 100, paidAmount: 40 }],
  receivables: [{ id: 'account', clientId: 'a', saleId: 'sale', amount: 100, receivedAmount: 40 }, { id: 'old', amount: 10 }],
  payments: [{ id: 'payment', saleId: 'sale', amount: 40 }],
}
const before = JSON.stringify({ clients, records })
const profile = inspectClientRelations('a', records)
assert.equal(profile.hasRelated, true)
assert.equal(profile.balance, 60)
assert.equal(profile.payments.length, 1)
assert.equal(profile.unresolvedCount, 1)
assert.equal(inspectClientRelations('b', records).sales.length, 0)
assert.equal(inspectClientRelations('b', records).hasRelated, false)
assert.equal(inspectClientRelations('a', { sales: [{ clientId: 'a', totalAmount: 100 }] }).balance, null)
assert.equal(inspectClientRelations('a', { sales: [{ id: 's1', clientId: 'a', totalAmount: 100, paidAmount: 40, remainingAmount: 0 }] }).balance, null)
assert.equal(inspectClientRelations('a', { sales: [{ id: 's1', clientId: 'a', totalAmount: 100, paidAmount: 40 }], payments: [{ saleId: 's1', clientId: 'b' }] }).balance, null)
assert.equal(inspectClientRelations('a', { sales: [{ id: 's1', clientId: 'a', totalAmount: 100, paidAmount: 40 }], receivables: [{ saleId: 's1', clientId: 'a', amount: 100, receivedAmount: 0 }] }).balance, null)
assert.equal(JSON.stringify({ clients, records }), before)
console.log('OK: busca sem acentos, cidades, telefone opcional/legado, duplicidade, vínculo por ID e saldo sem duplicação; registros preservados.')

const serviceSource = (await readFile(new URL('../src/services/clientsService.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  .replace(/export /g, '')
const deleted = []
let serverRecords = { sales: [{ id: 's1', clientId: 'linked' }] }
const service = vm.runInNewContext(`${serviceSource}\n;({ deleteClientByUser, loadClientRelationsByUser })`, {
  db: {},
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  getDocsFromServer: async ref => ({ docs: (serverRecords[ref.path.split('/').at(-1)] || []).map(({ id, ...data }) => ({ id, data: () => data })) }),
  deleteDoc: async ref => deleted.push(ref.path),
  inspectClientRelations,
})
await assert.rejects(service.deleteClientByUser('test-only', 'linked'), error => error.code === 'clients/delete-blocked')
assert.equal(deleted.length, 0)
serverRecords = { financeiroRecebimentos: [{ id: 'p1', clientId: 'paid-client' }] }
await assert.rejects(service.deleteClientByUser('test-only', 'paid-client'), error => error.code === 'clients/delete-blocked')
assert.equal(deleted.length, 0)
serverRecords = { sales: [{ id: 'orphan', clientName: 'Nome não utilizado para vincular' }] }
await assert.rejects(service.deleteClientByUser('test-only', 'any-client'), error => error.code === 'clients/delete-blocked')
assert.equal(deleted.length, 0)
serverRecords = {}
await service.deleteClientByUser('test-only', 'unlinked')
assert.deepEqual(deleted, ['users/test-only/clients/unlinked'])
console.log('OK: serviço bloqueia exclusão com vendas, pagamentos ou registros sem vínculo; exclusão simulada sem relações afeta somente o cliente de teste.')