import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import {
  createClientByUser,
  deleteClientByUser,
  subscribeClientsByUser,
  updateClientByUser,
} from '../services/clientsService'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import '../styles/clients-page.css'

const CLIENT_INITIAL_STATE = {
  name: '',
  nickname: '',
  phone: '',
  cpf: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  observation: '',
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatClientDate(dateValue) {
  if (!dateValue) {
    return '-'
  }

  if (typeof dateValue?.toDate === 'function') {
    return dateFormatter.format(dateValue.toDate())
  }

  if (dateValue?.seconds) {
    return dateFormatter.format(new Date(dateValue.seconds * 1000))
  }

  const parsedDate = new Date(dateValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return '-'
  }

  return dateFormatter.format(parsedDate)
}

function mapClientToForm(client) {
  return {
    name: client?.name || '',
    nickname: client?.nickname || '',
    phone: client?.phone || '',
    cpf: client?.cpf || '',
    street: client?.street || '',
    number: client?.number || '',
    neighborhood: client?.neighborhood || '',
    city: client?.city || '',
    observation: client?.observation || '',
  }
}

function ClientsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('clientes')
  const [clients, setClients] = useState([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [modalMode, setModalMode] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [formData, setFormData] = useState(CLIENT_INITIAL_STATE)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const filteredClients = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase()

    if (!normalizedTerm) {
      return clients
    }

    return clients.filter((client) => {
      const name = String(client.name || '').toLowerCase()
      const phone = String(client.phone || '').toLowerCase()
      return name.includes(normalizedTerm) || phone.includes(normalizedTerm)
    })
  }, [clients, searchTerm])

  useEffect(() => {
    if (!user?.uid) {
      setClients([])
      setLoadingClients(false)
      return () => {}
    }

    setLoadingClients(true)
    setErrorMessage('')

    const unsubscribe = subscribeClientsByUser(
      user.uid,
      (fetchedClients) => {
        setClients(fetchedClients)
        setLoadingClients(false)
      },
      (error) => {
        console.error('Erro ao observar clientes:', error)
        setErrorMessage(getFirebaseErrorMessage(error, 'Falha ao carregar clientes'))
        setLoadingClients(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

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
    setFormData(CLIENT_INITIAL_STATE)
    setModalMode('create')
  }

  const openViewModal = (client) => {
    setSelectedClient(client)
    setFormData(mapClientToForm(client))
    setModalMode('view')
  }

  const openEditModal = (client) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedClient(client)
    setFormData(mapClientToForm(client))
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode('')
    setSelectedClient(null)
    setFormData(CLIENT_INITIAL_STATE)
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setFormData((previousState) => ({
      ...previousState,
      [name]: value,
    }))
  }

  const validateClientForm = () => {
    if (!formData.name.trim()) {
      return 'Nome completo é obrigatório.'
    }

    if (!formData.phone.trim()) {
      return 'Telefone é obrigatório.'
    }

    return ''
  }

  const normalizePayload = () => ({
    name: formData.name.trim(),
    nickname: formData.nickname.trim(),
    phone: formData.phone.trim(),
    cpf: formData.cpf.trim(),
    street: formData.street.trim(),
    number: formData.number.trim(),
    neighborhood: formData.neighborhood.trim(),
    city: formData.city.trim(),
    observation: formData.observation.trim(),
  })

  const handleSubmitClient = async (event) => {
    event.preventDefault()

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
      const payload = normalizePayload()

      if (modalMode === 'create') {
        await createClientByUser(user.uid, payload)
        setSuccessMessage('Salvo com sucesso.')
      }

      if (modalMode === 'edit' && selectedClient?.id) {
        await updateClientByUser(user.uid, selectedClient.id, payload)
        setSuccessMessage('Atualizado com sucesso.')
      }

      closeModal()
    } catch (error) {
      console.error('Erro ao salvar cliente:', error)
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

    const hasConfirmed = window.confirm(`Deseja excluir o cliente ${client.name}?`)

    if (!hasConfirmed) {
      return
    }

    try {
      setErrorMessage('')
      await deleteClientByUser(user.uid, client.id)
      setSuccessMessage('Excluído com sucesso.')
    } catch (error) {
      console.error('Erro ao excluir cliente:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível excluir o cliente'))
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
            <h1>Clientes</h1>
            <p>Gerencie os clientes cadastrados no sistema.</p>
          </div>
          <button type="button" className="clients-primary-button" onClick={openCreateModal}>
            Novo cliente
          </button>
        </header>

        <section className="clients-toolbar">
          <input
            type="search"
            placeholder="Pesquisar por nome ou telefone"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </section>

        {successMessage ? <p className="clients-message success">{successMessage}</p> : null}
        {errorMessage ? <p className="clients-message error">{errorMessage}</p> : null}

        <section className="clients-list-panel">
          {loadingClients ? <p className="clients-loading">Carregando clientes...</p> : null}

          {!loadingClients && filteredClients.length === 0 ? (
            <p className="clients-empty">Nenhum cliente cadastrado</p>
          ) : null}

          {!loadingClients && filteredClients.length > 0 ? (
            <div className="clients-table-wrapper">
              <table className="clients-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Como é conhecido</th>
                    <th>Telefone</th>
                    <th>Cidade</th>
                    <th>Data de cadastro</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => (
                    <tr key={client.id}>
                      <td>{client.name || '-'}</td>
                      <td>{client.nickname || '-'}</td>
                      <td>{client.phone || '-'}</td>
                      <td>{client.city || '-'}</td>
                      <td>{formatClientDate(client.createdAt)}</td>
                      <td>
                        <div className="clients-row-actions">
                          <button type="button" onClick={() => openViewModal(client)}>
                            Ver
                          </button>
                          <button type="button" onClick={() => openEditModal(client)}>
                            Editar
                          </button>
                          <button type="button" className="danger" onClick={() => handleDeleteClient(client)}>
                            Excluir
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
      </section>

      {modalMode ? (
        <div className="client-modal-overlay" role="presentation" onClick={closeModal}>
          <section className="client-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="client-modal-header">
              <h2>
                {modalMode === 'create' ? 'Novo cliente' : null}
                {modalMode === 'edit' ? 'Editar cliente' : null}
                {modalMode === 'view' ? 'Visualizar cliente' : null}
              </h2>
              <button type="button" className="close-button" onClick={closeModal}>
                Fechar
              </button>
            </header>

            <form className="client-form" onSubmit={handleSubmitClient}>
              <label htmlFor="name">Nome completo</label>
              <input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="nickname">Como é conhecido</label>
              <input
                id="nickname"
                name="nickname"
                value={formData.nickname}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="phone">Telefone</label>
              <input
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="cpf">CPF</label>
              <input
                id="cpf"
                name="cpf"
                value={formData.cpf}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="street">Rua</label>
              <input
                id="street"
                name="street"
                value={formData.street}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="number">Número</label>
              <input
                id="number"
                name="number"
                value={formData.number}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="neighborhood">Bairro</label>
              <input
                id="neighborhood"
                name="neighborhood"
                value={formData.neighborhood}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="city">Cidade</label>
              <input
                id="city"
                name="city"
                value={formData.city}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              <label htmlFor="observation">Observação</label>
              <textarea
                id="observation"
                name="observation"
                rows="4"
                value={formData.observation}
                onChange={handleFormChange}
                disabled={modalMode === 'view'}
              />

              {modalMode !== 'view' ? (
                <button type="submit" className="clients-primary-button" disabled={submitting}>
                  {submitting ? 'Salvando...' : 'Salvar'}
                </button>
              ) : null}
            </form>
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default ClientsPage
