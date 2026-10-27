import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, Eye, MapPin, Pencil, Plus, RefreshCw, Save, Search, Trash2, Users, X } from 'lucide-react'
import {
  createClientByUser,
  deleteClientByUser,
  listClientsByUser,
  loadClientRelationsByUser,
  subscribeClientsByUser,
  updateClientByUser,
} from '../services/clientsService'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatRecordDate } from '../utils/recordFilters'
import { displayText } from '../utils/displayText'
import { buildClientChanges, filterClientRecords, findClientDuplicates, formatClientPhoneInput, getClientCities, isValidClientPhone, validateClientDraft } from '../utils/clientRecords'
import '../styles/clients-page.css'

const CLIENT_INITIAL_STATE = {
  name: '',
  nickname: '',
  phone: '',
  secondaryPhone: '',
  secondaryPhoneLabel: '',
  cpf: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  observation: '',
}

const formatClientDate = formatRecordDate

function mapClientToForm(client) {
  return Object.fromEntries(Object.keys(CLIENT_INITIAL_STATE).map(field => [field, String(client?.[field] ?? '')]))
}

const PAGE_SIZE = 20
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const present = value => String(value ?? '').trim() ? String(value) : 'Não informado'
const CLIENT_FIELDS = [
  { title: 'Identificação e contato', fields: [['name', 'Nome completo'], ['nickname', 'Como é conhecido'], ['phone', 'Telefone principal'], ['cpf', 'CPF']] },
  { title: 'Endereço', fields: [['city', 'Cidade'], ['neighborhood', 'Bairro'], ['street', 'Rua'], ['number', 'Número']] },
]

function ClientsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeItem, setActiveItem] = useState('clientes')
  const [clients, setClients] = useState([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [ownerUid, setOwnerUid] = useState(user?.uid)
  const [submitting, setSubmitting] = useState(false)
  const [modalMode, setModalMode] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [formData, setFormData] = useState(CLIENT_INITIAL_STATE)
  const [showSecondaryPhone, setShowSecondaryPhone] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [duplicates, setDuplicates] = useState([])
  const [profile, setProfile] = useState({ status: 'loading', data: null, error: '' })
  const dialogRef = useRef(null)

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const visibleClients = ownerUid === user?.uid ? clients : []
  const filteredClients = useMemo(() => filterClientRecords(visibleClients, searchTerm, cityFilter), [clients, ownerUid, user?.uid, searchTerm, cityFilter])
  const cities = getClientCities(visibleClients)
  const totalPages = Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const shownClients = filteredClients.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const legacyPhoneUnchanged = modalMode === 'edit' && selectedClient && !isValidClientPhone(selectedClient.phone) && formData.phone === String(selectedClient.phone ?? '')
  const legacySecondaryPhoneUnchanged = modalMode === 'edit' && selectedClient && !isValidClientPhone(selectedClient.secondaryPhone) && formData.secondaryPhone === String(selectedClient.secondaryPhone ?? '')

  useEffect(() => {
    let active = true
    if (ownerUid !== user?.uid) {
      setModalMode('')
      setSelectedClient(null)
      setSearchTerm('')
      setCityFilter('')
      setPage(1)
    }
    setOwnerUid(user?.uid)
    setClients([])
    setLoadError('')
    if (!user?.uid) {
      setClients([])
      setLoadingClients(false)
      return () => { active = false }
    }

    setLoadingClients(true)
    setErrorMessage('')

    const unsubscribe = subscribeClientsByUser(
      user.uid,
      (fetchedClients) => {
        if (!active) return
        setClients(fetchedClients)
        setLoadError('')
        setLoadingClients(false)
      },
      (error) => {
        if (!active) return
        console.error('Erro ao observar clientes:', error?.code || 'unknown')
        setClients([])
        setLoadError(getFirebaseErrorMessage(error, 'Não foi possível carregar os clientes'))
        setLoadingClients(false)
      },
    )

    return () => { active = false; unsubscribe() }
  }, [user?.uid, retry])

  useEffect(() => {
    if (!selectedClient?.id || !['view', 'delete'].includes(modalMode)) return
    let active = true
    setProfile({ status: 'loading', data: null, error: '' })
    loadClientRelationsByUser(user?.uid, selectedClient.id).then(data => {
      if (active) setProfile({ status: 'ready', data, error: '' })
    }).catch(error => {
      if (active) setProfile({ status: 'error', data: null, error: getFirebaseErrorMessage(error, 'Não foi possível conferir os vínculos deste cliente') })
    })
    return () => { active = false }
  }, [user?.uid, selectedClient?.id, modalMode])

  useEffect(() => {
    if (!modalMode || !dialogRef.current) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog.querySelector('input, button')?.focus()
    const handleKeys = event => {
      if (event.key !== 'Tab') return
      const buttons = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    dialog.addEventListener('keydown', handleKeys)
    return () => {
      document.body.style.overflow = previousOverflow
      dialog.removeEventListener('keydown', handleKeys)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [modalMode])

  const handleSelectMenuItem = (itemKey) => {
    const menuItem = sidebarMenuItems.find((item) => item.key === itemKey)

    if (!menuItem?.enabled || !menuItem.path) {
      return
    }

    setActiveItem(itemKey)
    navigate(menuItem.path)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const openCreateModal = () => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedClient(null)
    setDuplicates([])
    setFormData(CLIENT_INITIAL_STATE)
    setShowSecondaryPhone(false)
    setModalMode('create')
  }

  useEffect(() => {
    if (location.state?.dashboardAction !== 'new-client') return
    openCreateModal()
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
  }, [location.key, location.state?.dashboardAction, location.pathname, location.search, location.hash, navigate])

  const openViewModal = (client) => {
    setErrorMessage('')
    setProfile({ status: 'loading', data: null, error: '' })
    setSelectedClient(client)
    setDuplicates([])
    setFormData(mapClientToForm(client))
    setModalMode('view')
  }

  const openEditModal = (client) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedClient(client)
    setFormData(mapClientToForm(client))
    setShowSecondaryPhone(Boolean(client.secondaryPhone || client.secondaryPhoneLabel))
    setModalMode('edit')
  }

  const closeModal = () => {
    if (submitting) return
    setModalMode('')
    setSelectedClient(null)
    setFormData(CLIENT_INITIAL_STATE)
    setShowSecondaryPhone(false)
    setDuplicates([])
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setFormData((previousState) => ({
      ...previousState,
      [name]: ['phone', 'secondaryPhone'].includes(name) ? formatClientPhoneInput(value) : value,
    }))
    setDuplicates([])
    setErrorMessage('')
  }

  const removeSecondaryPhone = () => {
    setFormData(previous => ({ ...previous, secondaryPhone: '', secondaryPhoneLabel: '' }))
    setShowSecondaryPhone(false)
    setDuplicates([])
    setErrorMessage('')
  }

  const validateClientForm = () => {
    return validateClientDraft(formData, modalMode === 'edit' ? selectedClient : null)
  }

  const handleSubmitClient = async (event, allowDuplicate = false) => {
    event?.preventDefault()
    if (submitting) return

    const validationMessage = validateClientForm()

    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      const payload = buildClientChanges(formData, modalMode === 'edit' ? selectedClient : null)

      if (modalMode === 'create') {
        const latestClients = await listClientsByUser(user.uid)
        const matches = findClientDuplicates(latestClients, formData)
        if (matches.length && !allowDuplicate) { setDuplicates(matches); return }
        await createClientByUser(user.uid, payload)
        setSuccessMessage('Cliente cadastrado com sucesso.')
      }

      if (modalMode === 'edit' && selectedClient?.id) {
        if (Object.keys(payload).length) await updateClientByUser(user.uid, selectedClient.id, payload)
        setSuccessMessage(Object.keys(payload).length ? 'Cliente atualizado com sucesso.' : 'Nenhuma informação foi alterada.')
      }

      setModalMode('')
      setSelectedClient(null)
      setFormData(CLIENT_INITIAL_STATE)
      setShowSecondaryPhone(false)
      setDuplicates([])
    } catch (error) {
      console.error('Erro ao salvar cliente:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível salvar o cliente'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteClient = async (client) => {
    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    if (submitting || profile.status !== 'ready' || profile.data.hasRelated || profile.data.unresolvedCount) return

    try {
      setSubmitting(true)
      setErrorMessage('')
      await deleteClientByUser(user.uid, client.id)
      setSuccessMessage('Cliente excluído com sucesso.')
      setModalMode('')
      setSelectedClient(null)
    } catch (error) {
      console.error('Erro ao excluir cliente:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível excluir o cliente'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DashboardLayout
      sidebarItems={sidebarMenuItems}
      activeItem={activeItem}
      onSelectItem={handleSelectMenuItem}
      userName={userName}
      onLogout={handleLogout}
    >
      <section className="clients-page">
        <header className="clients-page-header">
          <div>
            <p className="clients-brand">JN Confecções</p>
            <h1>Clientes</h1>
            <p>Encontre e cadastre seus clientes</p>
          </div>
          <button type="button" className="clients-primary-button" onClick={openCreateModal}>
            <Plus size={23} aria-hidden="true" />Novo cliente
          </button>
        </header>

        <div className="clients-count" role="status"><Users size={24} aria-hidden="true" /><strong>{loadingClients ? 'Carregando clientes…' : loadError ? 'Quantidade indisponível' : `${visibleClients.length.toLocaleString('pt-BR')} clientes cadastrados`}</strong></div>
        <section className="clients-toolbar" aria-label="Pesquisa de clientes">
          <label><span><Search size={20} aria-hidden="true" />Buscar cliente</span><input type="search" placeholder="Nome, como é conhecido ou telefone" value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setPage(1) }} /></label>
          <label><span><MapPin size={20} aria-hidden="true" />Cidade</span><select value={cityFilter} onChange={event => { setCityFilter(event.target.value); setPage(1) }}><option value="">Todas as cidades</option>{cities.map(city => <option value={city.value} key={city.value}>{city.label}</option>)}</select></label>
          {searchTerm || cityFilter ? <button type="button" className="clients-secondary-button" onClick={() => { setSearchTerm(''); setCityFilter(''); setPage(1) }}><X size={20} aria-hidden="true" />Limpar</button> : null}
        </section>

        {successMessage ? <p className="clients-message success" role="status">{successMessage}</p> : null}
        {errorMessage && !modalMode ? <p className="clients-message error" role="alert">{errorMessage}</p> : null}
        {loadError ? <section className="clients-message error" role="alert"><h2>Não foi possível carregar os clientes</h2><p>{loadError}</p><button type="button" className="clients-secondary-button" onClick={() => setRetry(previous => previous + 1)}><RefreshCw size={20} aria-hidden="true" />Tentar novamente</button></section> : null}

        <section className="clients-list-panel">
          {loadingClients ? <p className="clients-loading">Carregando clientes...</p> : null}

          {!loadingClients && !loadError && filteredClients.length === 0 ? (
            <p className="clients-empty">{visibleClients.length ? 'Nenhum cliente encontrado. Confira a pesquisa ou escolha outra cidade.' : 'Nenhum cliente cadastrado. Cadastre o primeiro cliente quando precisar.'}</p>
          ) : null}

          {!loadingClients && !loadError && filteredClients.length > 0 ? (
            <div className="clients-table-wrapper">
              <table className="clients-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Como é conhecido</th>
                    <th>Telefones</th>
                    <th>Cidade</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {shownClients.map((client) => (
                    <tr key={client.id}>
                      <td data-label="Nome">{displayText(client.name)}</td>
                      <td data-label="Como é conhecido">{displayText(client.nickname)}</td>
                      <td data-label="Telefones">{present(client.phone)}{client.secondaryPhone ? <span className="clients-secondary-phone"><strong>{client.secondaryPhoneLabel || 'Outro telefone'}:</strong> {client.secondaryPhone}</span> : null}{!isValidClientPhone(client.phone) || !isValidClientPhone(client.secondaryPhone) ? <span className="clients-phone-warning"><CircleAlert size={16} aria-hidden="true" />Revisar telefone</span> : null}</td>
                      <td data-label="Cidade">{present(client.city)}</td>
                      <td data-label="Ações">
                        <div className="clients-row-actions">
                          <button type="button" onClick={() => openViewModal(client)}>
                            <Eye size={20} aria-hidden="true" />Ver
                          </button>
                          <button type="button" onClick={() => openEditModal(client)}>
                            <Pencil size={20} aria-hidden="true" />Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        {!loadingClients && !loadError && filteredClients.length ? <nav className="clients-pagination" aria-label="Páginas de clientes">
          <p aria-live="polite">Mostrando {(currentPage - 1) * PAGE_SIZE + 1} a {Math.min(currentPage * PAGE_SIZE, filteredClients.length)} de {filteredClients.length} clientes{searchTerm || cityFilter ? ' encontrados' : ''}</p>
          <div><button type="button" className="clients-secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={22} aria-hidden="true" />Anterior</button><span>Página {currentPage} de {totalPages}</span><button type="button" className="clients-secondary-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Próxima<ChevronRight size={22} aria-hidden="true" /></button></div>
        </nav> : null}
      </section>

      {modalMode && ownerUid === user?.uid ? (
        <div className="client-modal-overlay" role="presentation">
          <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-dialog-title" ref={dialogRef}>
            <header className="client-modal-header">
              <h2 id="client-dialog-title">
                {modalMode === 'create' ? 'Novo cliente' : null}
                {modalMode === 'edit' ? 'Editar cliente' : null}
                {modalMode === 'view' ? 'Ficha do cliente' : null}
                {modalMode === 'delete' ? 'Excluir cliente?' : null}
              </h2>
              <button type="button" className="clients-secondary-button" onClick={closeModal} disabled={submitting}>
                <X size={20} aria-hidden="true" />Fechar
              </button>
            </header>

            {['create', 'edit'].includes(modalMode) ? <form className="client-form" onSubmit={handleSubmitClient} noValidate aria-busy={submitting}>
              {CLIENT_FIELDS.map(group => <fieldset disabled={submitting} key={group.title}><legend>{group.title}</legend><div className="client-form-grid">
                {group.fields.map(([field, label]) => <label htmlFor={field} key={field}>{label} <span>{field === 'name' ? '(obrigatório)' : '(opcional)'}</span><input id={field} name={field} type={field === 'phone' ? 'tel' : 'text'} autoComplete={field === 'name' ? 'name' : field === 'phone' ? 'tel-national' : 'off'} value={formData[field]} onChange={handleFormChange} required={field === 'name'} aria-describedby={field === 'phone' && legacyPhoneUnchanged ? 'client-phone-review' : undefined} /></label>)}
              </div>{group.title === 'Identificação e contato' ? <div className="client-additional-contact">
                {modalMode === 'edit' && selectedClient && !isValidClientPhone(selectedClient.phone) ? <div className="clients-review-note" id="client-phone-review"><CircleAlert size={20} aria-hidden="true" /><div><strong>Conteúdo antigo do telefone principal</strong><p className="client-legacy-phone">{selectedClient.phone}</p><p>{legacyPhoneUnchanged ? 'Você pode editar os outros dados sem alterá-lo. Para organizar os números, preencha os campos manualmente.' : 'O texto acima permanece salvo até você confirmar em Salvar.'}</p></div></div> : null}
                {!showSecondaryPhone ? <button type="button" className="clients-secondary-button" onClick={() => setShowSecondaryPhone(true)}><Plus size={21} aria-hidden="true" />Adicionar outro telefone</button> : <>
                  <div className="client-secondary-heading"><h3>Outro telefone</h3><button type="button" className="clients-secondary-button" onClick={removeSecondaryPhone}><X size={20} aria-hidden="true" />Remover outro telefone</button></div>
                  <div className="client-form-grid"><label htmlFor="secondaryPhone">Outro telefone <span>(opcional)</span><input id="secondaryPhone" name="secondaryPhone" type="tel" autoComplete="off" value={formData.secondaryPhone} onChange={handleFormChange} aria-describedby={legacySecondaryPhoneUnchanged ? 'client-secondary-phone-review' : undefined} /></label>
                    <label htmlFor="secondaryPhoneLabel">De quem é este número? <span>(opcional)</span><input id="secondaryPhoneLabel" name="secondaryPhoneLabel" placeholder="Ex.: marido, esposa ou filho" value={formData.secondaryPhoneLabel} onChange={handleFormChange} /></label></div>
                  {legacySecondaryPhoneUnchanged ? <p className="clients-review-note" id="client-secondary-phone-review">Este outro telefone precisa de revisão. O conteúdo existente será preservado se você editar somente outros dados.</p> : null}
                </>}
              </div> : null}</fieldset>)}
              <label htmlFor="observation">Observações <span>(opcional)</span><textarea id="observation" name="observation" rows="4" value={formData.observation} onChange={handleFormChange} disabled={submitting} /></label>
              {duplicates.length ? <section className="client-duplicate-warning" role="alert"><h3>Possível cadastro repetido</h3><p>Há {duplicates.length} cadastro(s) com o mesmo CPF ou a mesma combinação de nome e telefone. Confira antes de continuar.</p><ul>{duplicates.map(client => <li key={client.id}>{present(client.name)}</li>)}</ul><div className="client-form-actions"><button type="button" className="clients-secondary-button" onClick={() => { setDuplicates([]); document.getElementById('name')?.focus() }} disabled={submitting}>Revisar cadastro</button><button type="button" className="clients-secondary-button" onClick={() => handleSubmitClient(null, true)} disabled={submitting}>Cadastrar mesmo assim</button></div></section> : null}
              {errorMessage ? <p className="clients-message error" role="alert">{errorMessage}</p> : null}
              <footer className="client-form-actions"><button type="button" className="clients-secondary-button" onClick={closeModal} disabled={submitting}>Cancelar</button><button type="submit" className="clients-primary-button" disabled={submitting}><Save size={21} aria-hidden="true" />{submitting ? 'Salvando…' : 'Salvar'}</button></footer>
            </form> : null}

            {modalMode === 'view' && selectedClient ? <div className="client-profile">
              <h3 className="client-profile-name">{displayText(selectedClient.name)}</h3>
              <dl className="client-details">{[['Como é conhecido', selectedClient.nickname], ['Telefone principal', selectedClient.phone], ...(selectedClient.secondaryPhone ? [[selectedClient.secondaryPhoneLabel ? `Outro telefone (${selectedClient.secondaryPhoneLabel})` : 'Outro telefone', selectedClient.secondaryPhone]] : []), ['CPF', selectedClient.cpf], ['Data de cadastro', formatClientDate(selectedClient.createdAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{present(value)}</dd></div>)}</dl>
              {!isValidClientPhone(selectedClient.phone) || !isValidClientPhone(selectedClient.secondaryPhone) ? <p className="clients-review-note"><CircleAlert size={20} aria-hidden="true" />Telefone antigo precisa de revisão. O valor foi preservado.</p> : null}
              <h3>Endereço</h3><dl className="client-details">{[['Cidade', selectedClient.city], ['Bairro', selectedClient.neighborhood], ['Rua', selectedClient.street], ['Número', selectedClient.number]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{present(value)}</dd></div>)}</dl>
              {selectedClient.observation ? <section><h3>Observações</h3><p className="client-observation">{selectedClient.observation}</p></section> : null}
              <section className="client-purchases"><h3>Compras deste cliente</h3>
                {profile.status === 'loading' ? <p role="status">Conferindo compras e pagamentos…</p> : null}
                {profile.status === 'error' ? <p className="clients-message error" role="alert">{profile.error} A exclusão permanece bloqueada.</p> : null}
                {profile.status === 'ready' ? <>
                  <div className="client-balance"><span>Saldo pendente dos registros vinculados</span><strong>{profile.data.balance === null || !profile.data.hasRelated && profile.data.unresolvedDebtCount ? 'Não confirmado' : currency.format(profile.data.balance)}</strong></div>
                  {profile.data.conflicting ? <p className="clients-review-note">Existem vínculos conflitantes. Confira os registros antes de usar o saldo.</p> : null}
                  {profile.data.unresolvedCount ? <p className="clients-review-note">Há {profile.data.unresolvedCount} registro(s) antigo(s) sem vínculo confiável no sistema. Eles não foram associados a este cliente e precisam de revisão.</p> : null}
                  {profile.data.sales.length ? <table className="client-purchases-table"><thead><tr><th>Data da venda</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{profile.data.sales.map(sale => <tr key={sale.id}><td data-label="Data da venda">{formatClientDate(sale.saleDate)}</td><td data-label="Valor">{Number.isFinite(Number(sale.totalAmount)) && sale.totalAmount !== undefined && sale.totalAmount !== null && sale.totalAmount !== '' ? currency.format(Number(sale.totalAmount)) : 'Não informado'}</td><td data-label="Situação">{sale.displayStatus}</td></tr>)}</tbody></table> : <p>Nenhuma compra vinculada pelo identificador deste cliente.</p>}
                  {profile.data.hasRelated ? <p className="clients-review-note">Este cliente tem vendas, contas ou pagamentos vinculados. A exclusão está bloqueada para preservar o histórico.</p> : null}
                </> : null}
              </section>
              {errorMessage ? <p className="clients-message error" role="alert">{errorMessage}</p> : null}
              <footer className="client-form-actions"><button type="button" className="clients-secondary-button" onClick={closeModal}><ArrowLeft size={21} aria-hidden="true" />Voltar</button><button type="button" className="clients-primary-button" onClick={() => openEditModal(selectedClient)}><Pencil size={21} aria-hidden="true" />Editar</button><button type="button" className="clients-danger-button" disabled={profile.status !== 'ready' || profile.data.hasRelated || profile.data.unresolvedCount > 0} onClick={() => { setErrorMessage(''); setModalMode('delete') }}><Trash2 size={20} aria-hidden="true" />Excluir cliente</button></footer>
            </div> : null}

            {modalMode === 'delete' ? <div className="client-profile"><p>Excluir o cadastro de <strong>{present(selectedClient?.name)}</strong>?</p><p>Esta ação não pode ser desfeita. Os vínculos serão conferidos novamente antes da exclusão.</p>{profile.status === 'loading' ? <p role="status">Conferindo vínculos…</p> : null}{profile.status === 'error' ? <p className="clients-message error" role="alert">{profile.error}</p> : null}{errorMessage ? <p className="clients-message error" role="alert">{errorMessage}</p> : null}{profile.data?.hasRelated || profile.data?.unresolvedCount ? <p className="clients-review-note">Exclusão bloqueada: há vínculos ou registros antigos que precisam de revisão.</p> : null}<footer className="client-form-actions"><button type="button" className="clients-secondary-button" onClick={() => { setErrorMessage(''); setModalMode('view') }} disabled={submitting}>Cancelar</button><button type="button" className="clients-danger-button" disabled={submitting || profile.status !== 'ready' || profile.data.hasRelated || profile.data.unresolvedCount > 0} onClick={() => handleDeleteClient(selectedClient)}><Trash2 size={20} aria-hidden="true" />{submitting ? 'Excluindo…' : 'Confirmar exclusão'}</button></footer></div> : null}
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default ClientsPage
