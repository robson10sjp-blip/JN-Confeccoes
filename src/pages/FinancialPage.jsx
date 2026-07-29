import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import {
  buildFinancialIndicators,
  buildFinancialReports,
  buildPriorities,
  computeReceivableBalance,
  computeReceivableStatus,
  getTodayDateString,
  loadFinancialModuleData,
  registerFinancialPaymentByUser,
} from '../services/financialService'
import '../styles/financial-page.css'

const QUICK_FILTERS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Esta Semana' },
  { key: 'month', label: 'Este Mês' },
  { key: 'overdue', label: 'Em Atraso' },
  { key: 'paid', label: 'Pagos' },
  { key: 'pending', label: 'Pendentes' },
]

const RECEIVE_INITIAL_FORM = {
  amount: '',
  paymentDate: getTodayDateString(),
  paymentMethod: 'Pix',
  observation: '',
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0))
}

function getDateRangeForFilter(quickFilter) {
  const today = new Date()
  const toIso = (dateValue) => {
    const timezoneOffset = dateValue.getTimezoneOffset() * 60000
    return new Date(dateValue.getTime() - timezoneOffset).toISOString().slice(0, 10)
  }

  if (quickFilter === 'today') {
    const iso = toIso(today)
    return { from: iso, to: iso }
  }

  if (quickFilter === 'week') {
    const day = today.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + diffToMonday)

    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    return { from: toIso(monday), to: toIso(sunday) }
  }

  if (quickFilter === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1)
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { from: toIso(first), to: toIso(last) }
  }

  return null
}

function matchesQuickFilter(receivable, quickFilter, status) {
  if (!quickFilter) {
    return true
  }

  if (quickFilter === 'overdue') {
    return status === 'Atrasado'
  }

  if (quickFilter === 'paid') {
    return status === 'Pago'
  }

  if (quickFilter === 'pending') {
    return status === 'Pendente' || status === 'Parcial'
  }

  const range = getDateRangeForFilter(quickFilter)

  if (!range || !receivable.dueDate) {
    return false
  }

  return receivable.dueDate >= range.from && receivable.dueDate <= range.to
}

function FinancialPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('financeiro')
  const [loadingData, setLoadingData] = useState(true)
  const [receivables, setReceivables] = useState([])
  const [payments, setPayments] = useState([])
  const [sales, setSales] = useState([])
  const [clientsById, setClientsById] = useState({})
  const [salesSummary, setSalesSummary] = useState({
    totalSales: 0,
    totalSoldValue: 0,
    totalProductsSold: 0,
  })
  const [filters, setFilters] = useState({
    client: '',
    date: '',
    status: '',
    quick: '',
  })
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [modalState, setModalState] = useState({ type: '', receivableId: '' })
  const [receiveForm, setReceiveForm] = useState(RECEIVE_INITIAL_FORM)
  const [submittingReceive, setSubmittingReceive] = useState(false)

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const indicators = useMemo(
    () => buildFinancialIndicators(receivables, payments, salesSummary),
    [payments, receivables, salesSummary],
  )

  const reports = useMemo(
    () => buildFinancialReports(receivables, payments, sales),
    [payments, receivables, sales],
  )

  const priorities = useMemo(
    () => buildPriorities(receivables, clientsById),
    [clientsById, receivables],
  )

  const receivablesById = useMemo(
    () =>
      receivables.reduce((acc, receivable) => {
        acc[receivable.id] = receivable
        return acc
      }, {}),
    [receivables],
  )

  const salesById = useMemo(
    () =>
      sales.reduce((acc, sale) => {
        acc[sale.id] = sale
        return acc
      }, {}),
    [sales],
  )

  const selectedReceivable = modalState.receivableId ? receivablesById[modalState.receivableId] : null

  const filteredReceivables = useMemo(() => {
    const normalizedClientTerm = filters.client.trim().toLowerCase()

    return receivables.filter((receivable) => {
      const status = computeReceivableStatus(receivable)
      const clientName = String(receivable.clientName || '').toLowerCase()
      const hasClient = normalizedClientTerm ? clientName.includes(normalizedClientTerm) : true
      const hasDate = filters.date ? receivable.dueDate === filters.date : true
      const hasStatus = filters.status ? status === filters.status : true
      const hasQuickFilter = matchesQuickFilter(receivable, filters.quick, status)

      return hasClient && hasDate && hasStatus && hasQuickFilter
    })
  }, [filters.client, filters.date, filters.quick, filters.status, receivables])

  const displayReceivables = useMemo(
    () =>
      filteredReceivables.map((entry) => ({
        ...entry,
        saleDate: entry.saleDate || salesById[entry.saleId]?.saleDate || '-',
      })),
    [filteredReceivables, salesById],
  )

  const loadData = useCallback(async () => {
    if (!user?.uid) {
      setLoadingData(false)
      return
    }

    try {
      setLoadingData(true)
      setErrorMessage('')

      const response = await loadFinancialModuleData(user.uid)

      setReceivables(response.receivables)
      setPayments(response.payments)
      setSales(response.sales)
      setClientsById(response.clientsById)
      setSalesSummary(response.salesSummary)
    } catch (error) {
      console.error('Erro ao carregar financeiro:', error)
      setErrorMessage('Não foi possível carregar os dados do financeiro. Tente novamente.')
    } finally {
      setLoadingData(false)
    }
  }, [user?.uid])

  useEffect(() => {
    loadData()
  }, [loadData])

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

  const openReceiveModal = (receivable) => {
    setErrorMessage('')
    setSuccessMessage('')
    setReceiveForm(RECEIVE_INITIAL_FORM)
    setModalState({ type: 'receive', receivableId: receivable.id })
  }

  const closeModal = () => {
    setModalState({ type: '', receivableId: '' })
    setReceiveForm(RECEIVE_INITIAL_FORM)
  }

  const handleExportPdf = () => {
    const content = `
      <html>
        <head>
          <title>Relatório Financeiro</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
            h1, h2 { margin-bottom: 10px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-bottom: 16px; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>
          <h1>Relatório Financeiro</h1>
          <div class="grid">
            <div class="card"><strong>Total a Receber:</strong> ${formatCurrency(indicators.totalToReceive)}</div>
            <div class="card"><strong>Total Recebido:</strong> ${formatCurrency(indicators.totalReceived)}</div>
            <div class="card"><strong>Total em Atraso:</strong> ${formatCurrency(indicators.totalOverdue)}</div>
            <div class="card"><strong>Valor das Vendas:</strong> ${formatCurrency(indicators.totalSalesValue)}</div>
          </div>
          <h2>Contas a Receber</h2>
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Pago</th>
                <th>Saldo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${displayReceivables
                .map((entry) => {
                  const status = computeReceivableStatus(entry)
                  const balance = computeReceivableBalance(entry)
                  return `<tr><td>${entry.clientName || '-'}</td><td>${entry.dueDate || '-'}</td><td>${formatCurrency(entry.amount)}</td><td>${formatCurrency(entry.receivedAmount)}</td><td>${formatCurrency(balance)}</td><td>${status}</td></tr>`
                })
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `

    const win = window.open('', '_blank')

    if (!win) {
      setErrorMessage('Não foi possível abrir a janela para exportação.')
      return
    }

    win.document.write(content)
    win.document.close()
    win.focus()
    win.print()
  }

  const handleSubmitReceive = async (event) => {
    event.preventDefault()

    if (!user?.uid || !selectedReceivable) {
      setErrorMessage('Não foi possível identificar a conta a receber selecionada.')
      return
    }

    try {
      setSubmittingReceive(true)
      setErrorMessage('')

      await registerFinancialPaymentByUser(user.uid, selectedReceivable, receiveForm)

      setSuccessMessage('Recebimento registrado com sucesso.')
      await loadData()
      closeModal()
    } catch (error) {
      console.error('Erro ao registrar recebimento financeiro:', error)
      setErrorMessage(error?.message || 'Não foi possível registrar o recebimento.')
    } finally {
      setSubmittingReceive(false)
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
      <section className="financial-page">
        <header className="financial-page-header">
          <div>
            <h1>Financeiro</h1>
            <p>Controle de contas a receber da JN Confecções.</p>
          </div>
          <button type="button" className="financial-primary-button" onClick={handleExportPdf}>
            Exportar PDF
          </button>
        </header>

        <section className="financial-indicators-grid">
          <article className="financial-card">
            <p>Total a Receber</p>
            <strong>{formatCurrency(indicators.totalToReceive)}</strong>
          </article>
          <article className="financial-card">
            <p>Total Recebido</p>
            <strong>{formatCurrency(indicators.totalReceived)}</strong>
          </article>
          <article className="financial-card">
            <p>Total em Atraso</p>
            <strong>{formatCurrency(indicators.totalOverdue)}</strong>
          </article>
          <article className="financial-card">
            <p>Recebimentos do Dia</p>
            <strong>{formatCurrency(indicators.paymentsToday)}</strong>
          </article>
          <article className="financial-card">
            <p>Recebimentos da Semana</p>
            <strong>{formatCurrency(indicators.paymentsWeek)}</strong>
          </article>
          <article className="financial-card">
            <p>Recebimentos do Mês</p>
            <strong>{formatCurrency(indicators.paymentsMonth)}</strong>
          </article>
          <article className="financial-card">
            <p>Valor das Vendas</p>
            <strong>{formatCurrency(indicators.totalSalesValue)}</strong>
          </article>
          <article className="financial-card">
            <p>Clientes Devendo</p>
            <strong>{indicators.clientsInDebt}</strong>
          </article>
        </section>

        <section className="financial-filters-panel">
          <input
            type="search"
            placeholder="Pesquisar por cliente"
            value={filters.client}
            onChange={(event) => setFilters((previous) => ({ ...previous, client: event.target.value }))}
          />
          <input
            type="date"
            value={filters.date}
            onChange={(event) => setFilters((previous) => ({ ...previous, date: event.target.value }))}
          />
          <select
            value={filters.status}
            onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
          >
            <option value="">Todos os status</option>
            <option value="Pendente">Pendente</option>
            <option value="Parcial">Parcial</option>
            <option value="Pago">Pago</option>
            <option value="Atrasado">Atrasado</option>
          </select>
        </section>

        <section className="financial-quick-filters">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={filters.quick === filter.key ? 'is-active' : ''}
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  quick: previous.quick === filter.key ? '' : filter.key,
                }))
              }
            >
              {filter.label}
            </button>
          ))}
        </section>

        {successMessage ? <p className="financial-message success">{successMessage}</p> : null}
        {errorMessage ? <p className="financial-message error">{errorMessage}</p> : null}

        <section className="financial-list-panel">
          <h2>Contas a Receber</h2>

          {loadingData ? <p className="financial-loading">Carregando financeiro...</p> : null}

          {!loadingData && displayReceivables.length === 0 ? (
            <p className="financial-empty">Nenhuma conta a receber encontrada.</p>
          ) : null}

          {!loadingData && displayReceivables.length > 0 ? (
            <div className="financial-table-wrapper">
              <table className="financial-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Data da Venda</th>
                    <th>Data de Vencimento</th>
                    <th>Valor</th>
                    <th>Valor Pago</th>
                    <th>Saldo</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayReceivables.map((entry) => {
                    const balance = computeReceivableBalance(entry)
                    const status = computeReceivableStatus(entry)

                    return (
                      <tr key={entry.id}>
                        <td>{entry.clientName || '-'}</td>
                        <td>{entry.saleDate || '-'}</td>
                        <td>{entry.dueDate || '-'}</td>
                        <td>{formatCurrency(entry.amount)}</td>
                        <td>{formatCurrency(entry.receivedAmount)}</td>
                        <td>{formatCurrency(balance)}</td>
                        <td>{status}</td>
                        <td>
                          <button
                            type="button"
                            className="financial-receive-button"
                            onClick={() => openReceiveModal(entry)}
                            disabled={status === 'Pago'}
                          >
                            💰 Receber
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="financial-priorities-panel">
          <h2>Prioridades do Dia</h2>

          {priorities.length === 0 ? (
            <p className="financial-empty">Nenhuma prioridade para hoje.</p>
          ) : (
            <div className="financial-table-wrapper">
              <table className="financial-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Cidade</th>
                    <th>Telefone</th>
                    <th>Valor</th>
                    <th>Dias de atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {priorities.map((priority) => (
                    <tr key={priority.id}>
                      <td>{priority.clientName}</td>
                      <td>{priority.city}</td>
                      <td>{priority.phone}</td>
                      <td>{formatCurrency(priority.amount)}</td>
                      <td>{priority.daysLate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="financial-reports-panel">
          <h2>Relatórios</h2>

          <div className="financial-reports-grid">
            {[
              { key: 'day', label: 'Recebimentos do dia' },
              { key: 'week', label: 'Recebimentos da semana' },
              { key: 'month', label: 'Recebimentos do mês' },
              { key: 'year', label: 'Recebimentos do ano' },
            ].map((reportInfo) => {
              const report = reports[reportInfo.key]

              return (
                <article key={reportInfo.key} className="financial-report-card">
                  <h3>{reportInfo.label}</h3>
                  <p>
                    <strong>Total vendido:</strong> {formatCurrency(report.sold)}
                  </p>
                  <p>
                    <strong>Total recebido:</strong> {formatCurrency(report.received)}
                  </p>
                  <p>
                    <strong>Total pendente:</strong> {formatCurrency(report.pending)}
                  </p>
                  <p>
                    <strong>Total em atraso:</strong> {formatCurrency(report.overdue)}
                  </p>
                </article>
              )
            })}
          </div>
        </section>
      </section>

      {modalState.type === 'receive' && selectedReceivable ? (
        <div className="financial-modal-overlay" role="presentation" onClick={closeModal}>
          <section className="financial-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="financial-modal-header">
              <h2>Receber conta</h2>
              <button type="button" className="close-button" onClick={closeModal}>
                Fechar
              </button>
            </header>

            <form className="financial-form" onSubmit={handleSubmitReceive}>
              <p>
                <strong>Cliente:</strong> {selectedReceivable.clientName || '-'}
              </p>
              <p>
                <strong>Saldo atual:</strong> {formatCurrency(computeReceivableBalance(selectedReceivable))}
              </p>

              <label htmlFor="receiveAmount">Valor recebido</label>
              <input
                id="receiveAmount"
                type="number"
                min="0.01"
                step="0.01"
                value={receiveForm.amount}
                onChange={(event) =>
                  setReceiveForm((previous) => ({
                    ...previous,
                    amount: event.target.value,
                  }))
                }
              />

              <label htmlFor="receiveDate">Data</label>
              <input
                id="receiveDate"
                type="date"
                value={receiveForm.paymentDate}
                onChange={(event) =>
                  setReceiveForm((previous) => ({
                    ...previous,
                    paymentDate: event.target.value,
                  }))
                }
              />

              <label htmlFor="receiveMethod">Forma de pagamento</label>
              <select
                id="receiveMethod"
                value={receiveForm.paymentMethod}
                onChange={(event) =>
                  setReceiveForm((previous) => ({
                    ...previous,
                    paymentMethod: event.target.value,
                  }))
                }
              >
                <option value="Pix">Pix</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Cartão">Cartão</option>
                <option value="Transferência">Transferência</option>
                <option value="Boleto">Boleto</option>
              </select>

              <label htmlFor="receiveObservation">Observação</label>
              <textarea
                id="receiveObservation"
                rows="3"
                value={receiveForm.observation}
                onChange={(event) =>
                  setReceiveForm((previous) => ({
                    ...previous,
                    observation: event.target.value,
                  }))
                }
              />

              <button type="submit" className="financial-primary-button" disabled={submittingReceive}>
                {submittingReceive ? 'Registrando...' : 'Confirmar recebimento'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default FinancialPage
