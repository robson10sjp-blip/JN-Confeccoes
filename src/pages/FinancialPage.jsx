import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import { registerFinancialPaymentByUser, subscribeFinancialSource } from '../services/financialService'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatRecordDate, recordNumber, toDateKey } from '../utils/recordFilters'
import { buildFinancialView, accountPaymentHistory, financialAccountValues, financialDueRange } from '../utils/financialRecords'
import { getDashboardPeriod } from '../utils/dashboardSummary'
import { parseProductPrice } from '../utils/productRecords'
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Eye, Printer, RefreshCw, RotateCcw, Search, Users, Wallet, X } from 'lucide-react'
import '../styles/financial-page.css'

const DUE_FILTERS = [['all', 'Todos os vencimentos'], ['today', 'Hoje'], ['week', 'Esta semana'], ['month', 'Este mês'], ['custom', 'Escolher datas']]

const RECEIVE_INITIAL_FORM = {
  amount: '',
  paymentDate: toDateKey(new Date()),
  paymentMethod: 'Pix',
  observation: '',
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatCurrency(value) {
  const amount = recordNumber(value)
  return amount === null ? 'Não informado' : currencyFormatter.format(amount)
}

function FinancialPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('financeiro')
  const [isLoadingData, setLoadingData] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadedUid, setLoadedUid] = useState('')
  const [retry, setRetry] = useState(0)
  const [receivables, setReceivables] = useState([])
  const [payments, setPayments] = useState([])
  const [sales, setSales] = useState([])
  const [clientsById, setClientsById] = useState({})
  const [clients, setClients] = useState([])
  const [filters, setFilters] = useState({
    client: '',
    status: '',
  })
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [modalState, setModalState] = useState({ type: '', receivableId: '' })
  const [receiveForm, setReceiveForm] = useState(RECEIVE_INITIAL_FORM)
  const [submittingReceive, setSubmittingReceive] = useState(false)
  const [dueMode, setDueMode] = useState('all')
  const [dueDates, setDueDates] = useState({ from: '', to: '' })
  const [paymentPeriod, setPaymentPeriod] = useState('all')
  const [paymentDates, setPaymentDates] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const [reviewPayment, setReviewPayment] = useState(false)
  const [reviewedAccount, setReviewedAccount] = useState(null)
  const paymentRequest = useRef('')
  const dialogRef = useRef(null)

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'
  const loadingData = isLoadingData || loadedUid !== user?.uid
  const dueRange = financialDueRange(dueMode, dueDates)
  const paymentRange = getDashboardPeriod(paymentPeriod, paymentDates)
  const invalidDueRange = dueMode === 'custom' && (!dueDates.from || !dueDates.to || dueDates.from > dueDates.to)
  const invalidPaymentRange = paymentPeriod === 'custom' && (!paymentDates.from || !paymentDates.to || paymentDates.from > paymentDates.to)
  const view = buildFinancialView({ receivables, payments, sales, clients }, filters, dueRange, paymentRange)
  const totalPages = Math.max(1, Math.ceil(view.selected.length / 20))
  const currentPage = Math.min(page, totalPages)
  const displayReceivables = view.selected.slice((currentPage - 1) * 20, currentPage * 20)
  const selectedReceivable = loadedUid === user?.uid ? view.rows.find(entry => entry.id === modalState.receivableId) : null
  const selectedPayments = selectedReceivable ? accountPaymentHistory(selectedReceivable, payments) : []
  const selectedSale = selectedReceivable ? sales.find(sale => sale.id === selectedReceivable.saleId) : null
  const formatIndicator = (value, incomplete = false, money = true) => loadFailed ? 'Indisponível' : loadingData ? 'Carregando…' : incomplete ? 'Conferir dados' : money ? formatCurrency(value) : String(value)
  const loadData = () => setRetry(previous => previous + 1)

  useEffect(() => {
    let active = true
    const finished = new Set()
    const unsubscribes = []
    setLoadedUid(user?.uid || '')
    setReceivables([])
    setPayments([])
    setSales([])
    setClients([])
    setClientsById({})
    setLoadFailed(false)
    setErrorMessage('')
    setLoadingData(true)
    setModalState({ type: '', receivableId: '' })
    if (!user?.uid) { setLoadingData(false); return () => { active = false } }
    const setters = { receivables: setReceivables, payments: setPayments, sales: setSales, clients: entries => { setClients(entries); setClientsById(Object.fromEntries(entries.map(client => [client.id, client]))) } }
    for (const [source, setter] of Object.entries(setters)) {
      const onError = error => {
        if (!active) return
        console.error(`Falha na leitura de ${source} no Financeiro:`, error?.code || 'unknown')
        setter([])
        setLoadFailed(true)
        setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível carregar todos os dados financeiros'))
        finished.add(source)
        setLoadingData(finished.size < 4)
      }
      try {
        unsubscribes.push(subscribeFinancialSource(user.uid, source, (entries, confirmed) => {
          if (!active) return
          setter(entries)
          if (confirmed) finished.add(source)
          else finished.delete(source)
          setLoadingData(finished.size < 4)
        }, onError))
      } catch (error) { onError(error) }
    }
    return () => { active = false; unsubscribes.forEach(unsubscribe => unsubscribe()) }
  }, [user?.uid, retry])

  useEffect(() => {
    if (!modalState.type || !dialogRef.current) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog.querySelector('input, button')?.focus()
    const handleKeys = event => {
      if (event.key !== 'Tab') return
      const elements = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
    dialog.addEventListener('keydown', handleKeys)
    return () => { document.body.style.overflow = previousOverflow; dialog.removeEventListener('keydown', handleKeys); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [modalState.type])

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
    setReceiveForm({ ...RECEIVE_INITIAL_FORM, paymentDate: toDateKey(new Date()) })
    setReviewPayment(false)
    setReviewedAccount(null)
    paymentRequest.current = crypto.randomUUID()
    setModalState({ type: 'receive', receivableId: receivable.id })
  }

  const closeModal = () => {
    if (submittingReceive) return
    setModalState({ type: '', receivableId: '' })
    setReceiveForm(RECEIVE_INITIAL_FORM)
  }

  const handleExportPdf = () => {
    const win = window.open('', '_blank')
    if (!win) {
      setErrorMessage('Não foi possível abrir a janela para exportação.')
      return
    }
    const report = win.document
    report.title = 'Relatório Financeiro · JN Confecções'
    report.body.replaceChildren()
    const style = report.createElement('style')
    style.textContent = 'body{font:16px sans-serif;padding:20px;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}h1{font-size:24px}li{margin:8px 0}'
    report.head.append(style)
    const append = (parent, tag, text) => { const element = report.createElement(tag); element.textContent = text; parent.append(element); return element }
    append(report.body, 'h1', 'Relatório Financeiro · JN Confecções')
    append(report.body, 'p', 'Resumo geral de todas as contas; a tabela contém todos os resultados dos filtros, sem limitar à página visível.')
    const totals = append(report.body, 'ul', '')
    append(totals, 'li', `Falta receber (saldo atual): ${formatIndicator(view.pending, view.invalidAccounts > 0)}`)
    append(totals, 'li', `Recebido (${paymentPeriod === 'all' ? 'todo o período' : `${formatRecordDate(paymentRange.from)} a ${formatRecordDate(paymentRange.to)}`}): ${formatIndicator(view.received, view.receivedIncomplete || invalidPaymentRange)}`)
    append(totals, 'li', `Em atraso (saldo atual): ${formatIndicator(view.overdue, view.invalidAccounts > 0 || view.unknownDueDates > 0)}`)
    append(totals, 'li', `Clientes com saldo: ${formatIndicator(view.debtors, view.invalidAccounts > 0 || view.unknownOwners > 0, false)}`)
    append(report.body, 'h2', `Contas encontradas: ${view.selected.length}`)
    const table = append(report.body, 'table', '')
    const header = append(append(table, 'thead', ''), 'tr', '')
    for (const label of ['Cliente', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situação']) append(header, 'th', label)
    const body = append(table, 'tbody', '')
    for (const entry of view.selected) {
      const row = append(body, 'tr', '')
      for (const text of [entry.clientName, formatRecordDate(entry.dueDate), formatCurrency(entry.amount), formatCurrency(entry.paid), formatCurrency(entry.balance), entry.status]) append(row, 'td', text)
    }
    win.focus()
    win.print()
  }

  const handleSubmitReceive = async (event) => {
    event.preventDefault()
    if (submittingReceive) return

    if (!user?.uid || !selectedReceivable) {
      setErrorMessage('Não foi possível identificar a conta a receber selecionada.')
      return
    }
    const amount = parseProductPrice(receiveForm.amount)
    if (amount === null || amount <= 0) { setErrorMessage('Informe um valor recebido maior que zero.'); return }
    if (selectedReceivable.balance === null || amount > selectedReceivable.balance) { setErrorMessage('O valor recebido não pode ultrapassar o saldo desta conta.'); return }
    if (toDateKey(receiveForm.paymentDate) !== receiveForm.paymentDate || !receiveForm.paymentDate) { setErrorMessage('Informe uma data de pagamento válida.'); return }
    if (!reviewPayment) { setReviewedAccount({ ...selectedReceivable }); setReviewPayment(true); setErrorMessage(''); return }

    try {
      setSubmittingReceive(true)
      setErrorMessage('')

      await registerFinancialPaymentByUser(user.uid, reviewedAccount, { ...receiveForm, amount, requestId: paymentRequest.current })

      setSuccessMessage('Pagamento registrado com sucesso.')
      setModalState({ type: '', receivableId: '' })
      setReceiveForm(RECEIVE_INITIAL_FORM)
    } catch (error) {
      console.error('Erro ao registrar recebimento financeiro:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível registrar o recebimento'))
    } finally {
      setSubmittingReceive(false)
    }
  }

  const clearFilters = () => { setFilters({ client: '', status: '' }); setDueMode('all'); setDueDates({ from: '', to: '' }); setPage(1) }
  const openDetails = account => { setErrorMessage(''); setModalState({ type: 'view', receivableId: account.id }) }
  const paymentAmount = parseProductPrice(receiveForm.amount)
  const clearReview = () => { setReviewPayment(false); setReviewedAccount(null); setErrorMessage('') }

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
            <p className="financial-brand">JN Confecções</p>
            <h1>Financeiro</h1>
            <p>Consulte suas contas e registre os recebimentos</p>
          </div>
          <button type="button" className="financial-primary-button" onClick={handleExportPdf} disabled={loadingData || loadFailed}>
            <Printer size={22} aria-hidden="true" />Exportar PDF
          </button>
        </header>
        <p className="financial-legacy-context">Cadastros antigos em atualização. As contas exibem os valores e a situação registrados no sistema. O proprietário informou que as contas antigas já foram pagas e ainda fará a revisão; nenhum saldo foi alterado automaticamente.</p>

        <section className="financial-indicators-grid">
          <article className="financial-card"><p><Wallet size={22} aria-hidden="true" />Falta receber</p><strong>{formatIndicator(view.pending, view.invalidAccounts > 0)}</strong><small>Saldo atual de todas as contas em aberto</small></article>
          <article className="financial-card"><p><Banknote size={22} aria-hidden="true" />Recebido</p><strong>{formatIndicator(view.received, view.receivedIncomplete || invalidPaymentRange)}</strong><small>{paymentPeriod === 'all' ? 'Todos os pagamentos registrados' : `Pagamentos de ${formatRecordDate(paymentRange.from)} a ${formatRecordDate(paymentRange.to)}`}</small></article>
          <article className="financial-card"><p><CircleAlert size={22} aria-hidden="true" />Em atraso</p><strong>{formatIndicator(view.overdue, view.invalidAccounts > 0 || view.unknownDueDates > 0)}</strong><small>Saldo atual das contas vencidas e ainda em aberto</small></article>
          <article className="financial-card"><p><Users size={22} aria-hidden="true" />Clientes com saldo</p><strong>{formatIndicator(view.debtors, view.invalidAccounts > 0 || view.unknownOwners > 0, false)}</strong><small>Clientes distintos pelo identificador · saldo atual</small></article>
        </section>

        {!loadingData && !loadFailed && (view.receivedIncomplete || invalidPaymentRange) ? <section className="financial-review-note financial-received-explanation" aria-labelledby="financial-received-explanation-title"><div><h2 id="financial-received-explanation-title">Por que Recebido mostra “Conferir dados”?</h2><ul>{view.receivedIssues.map(issue => <li key={issue.code}><strong>{issue.count}</strong> {issue.message}</li>)}{invalidPaymentRange ? <li>As datas escolhidas para os recebimentos estão incompletas ou invertidas.</li> : null}</ul><p><strong>Subtotal dos pagamentos localizados no período:</strong> {formatCurrency(view.received)}. É um subtotal, não a confirmação de que todas as contas antigas foram quitadas.</p><p>Os cadastros continuam disponíveis. O dono pode atualizar os dados quando souber os valores corretos; pagamentos e datas ausentes não serão criados automaticamente.</p></div></section> : null}
        <details className="financial-payment-period"><summary>Período dos recebimentos</summary><div className="financial-date-fields"><label>Recebimentos<select value={paymentPeriod} onChange={event => setPaymentPeriod(event.target.value)}><option value="all">Todo o período</option><option value="today">Hoje</option><option value="month">Este mês</option><option value="year">Este ano</option><option value="custom">Escolher datas</option></select></label>{paymentPeriod === 'custom' ? <><label>Pagamento de<input type="date" value={paymentDates.from} onChange={event => setPaymentDates(previous => ({ ...previous, from: event.target.value }))} /></label><label>Pagamento até<input type="date" value={paymentDates.to} onChange={event => setPaymentDates(previous => ({ ...previous, to: event.target.value }))} /></label></> : null}</div>{invalidPaymentRange ? <p role="alert">Informe as duas datas do pagamento, com a inicial antes ou igual à final.</p> : null}</details>
        <section className="financial-filters-panel" aria-label="Busca e situação das contas"><label><span><Search size={20} aria-hidden="true" />Buscar cliente</span><input type="search" value={filters.client} placeholder="Nome ou como é conhecido" onChange={event => { setFilters(previous => ({ ...previous, client: event.target.value })); setPage(1) }} /></label><label>Situação<select value={filters.status} onChange={event => { setFilters(previous => ({ ...previous, status: event.target.value })); setPage(1) }}><option value="">Todas</option><option value="Em aberto">Em aberto</option><option value="Em atraso">Em atraso</option><option value="Paga">Pagas</option><option value="Encerrada para reinício">Encerradas para reinício</option></select></label><button type="button" className="financial-secondary-button" onClick={clearFilters}><RotateCcw size={20} aria-hidden="true" />Limpar filtros</button></section>
        <section className="financial-due-period" aria-label="Vencimento das contas"><fieldset><legend>Vencimento das contas</legend><div className="financial-due-options">{DUE_FILTERS.map(([key, label]) => <label key={key} className={dueMode === key ? 'is-selected' : ''}><input type="radio" name="financial-due" checked={dueMode === key} onChange={() => { setDueMode(key); setPage(1) }} /><span>{label}</span></label>)}</div></fieldset>{dueMode === 'custom' ? <div className="financial-date-fields"><label>Vencimento de<input type="date" value={dueDates.from} onChange={event => { setDueDates(previous => ({ ...previous, from: event.target.value })); setPage(1) }} /></label><label>Vencimento até<input type="date" value={dueDates.to} onChange={event => { setDueDates(previous => ({ ...previous, to: event.target.value })); setPage(1) }} /></label>{invalidDueRange ? <p role="alert">Informe as duas datas de vencimento, com a inicial antes ou igual à final.</p> : null}</div> : null}<p className="financial-period-caption" aria-live="polite"><CalendarDays size={20} aria-hidden="true" />{dueMode === 'all' ? 'Todos os vencimentos, incluindo contas antigas sem data da venda' : invalidDueRange ? 'Escolha as datas de vencimento' : `${formatRecordDate(dueRange.from)} a ${formatRecordDate(dueRange.to)}`}</p></section>

        {loadFailed ? <section className="financial-message error" role="alert"><h2>Não foi possível carregar todos os dados financeiros</h2><p>{errorMessage}</p><button type="button" className="financial-secondary-button" onClick={loadData}><RefreshCw size={20} aria-hidden="true" />Tentar novamente</button></section> : null}
        {!loadingData && !loadFailed && (view.invalidAccounts || view.unknownOwners || view.unknownDueDates) ? <p className="financial-review-note" role="status"><CircleAlert size={20} aria-hidden="true" />Valores de contas a conferir: {view.invalidAccounts}. Contas em aberto sem cliente confiável: {view.unknownOwners}. Contas em aberto sem vencimento válido: {view.unknownDueDates}. Nenhum dado foi corrigido automaticamente.</p> : null}

        {successMessage ? <p className="financial-message success" role="status">{successMessage}</p> : null}
        {errorMessage && !modalState.type && !loadFailed ? <p className="financial-message error" role="alert">{errorMessage}</p> : null}

        <section className="financial-list-panel">
          <div className="financial-section-heading"><h2>Contas a receber</h2><span>Resumo geral acima · filtros aplicados à lista</span></div>
          {!loadingData && !loadFailed ? <p className="financial-list-count" role="status">{view.selected.length} de {receivables.length} contas · {view.pendingCount} em aberto no total</p> : null}
          {loadingData ? <p className="financial-loading">Carregando contas e pagamentos…</p> : null}
          {!loadingData && !loadFailed && !invalidDueRange && view.selected.length === 0 ? <p className="financial-empty">{receivables.length ? 'Nenhuma conta encontrada com esses filtros.' : 'Nenhuma conta cadastrada.'}</p> : null}
          {!loadingData && !loadFailed && !invalidDueRange && displayReceivables.length ? <div className="financial-table-wrapper"><table className="financial-table financial-accounts-table"><thead><tr><th>Cliente</th><th>Vencimento</th><th>Valor da conta</th><th>Valor pago</th><th>Falta receber</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{displayReceivables.map(entry => <tr key={entry.id}>
            <td data-label="Cliente">{entry.clientName}{entry.nickname ? <small>{entry.nickname}</small> : null}</td><td data-label="Vencimento">{formatRecordDate(entry.dueDate)}</td><td data-label="Valor da conta">{formatCurrency(entry.amount)}</td><td data-label="Valor pago">{formatCurrency(entry.paid)}</td><td data-label="Falta receber">{formatCurrency(entry.balance)}</td><td data-label="Situação"><span className={entry.status === 'Em atraso' ? 'financial-late' : ''}>{entry.status}</span></td><td data-label="Ações"><div className="financial-row-actions"><button type="button" onClick={() => openDetails(entry)}><Eye size={20} aria-hidden="true" />Ver</button>{entry.balance > 0 ? <button type="button" onClick={() => openReceiveModal(entry)} disabled={entry.conflicting}><Banknote size={20} aria-hidden="true" />Receber</button> : null}</div></td>
          </tr>)}</tbody></table></div> : null}
          {!loadingData && !loadFailed && !invalidDueRange && view.selected.length ? <nav className="financial-pagination" aria-label="Páginas de contas"><p>Mostrando {(currentPage - 1) * 20 + 1} a {Math.min(currentPage * 20, view.selected.length)} de {view.selected.length} contas</p><div><button type="button" className="financial-secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={22} aria-hidden="true" />Anterior</button><span>Página {currentPage} de {totalPages}</span><button type="button" className="financial-secondary-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Próxima<ChevronRight size={22} aria-hidden="true" /></button></div></nav> : null}
        </section>

        {!loadingData && !loadFailed ? <details className="financial-data-notes"><summary><CircleAlert size={20} aria-hidden="true" />Conferência dos registros antigos</summary><p>{view.unlinkedAccounts} conta(s) sem venda localizada. Isso significa ausência de um ID de venda correspondente nos dados lidos, não prova de falta de pagamento.</p><p>{view.statusConflicts} conta(s) com situação paga salva, mas saldo positivo nos valores. {view.historyDifferences} conta(s) com histórico diferente do valor pago salvo.</p><p>{view.untracedPaidCount} conta(s) com valor pago salvo sem lançamento identificável. Subtotal dos pagamentos localizados no período: {formatCurrency(view.received)}; não confirma a quitação de contas sem histórico.</p>{view.paymentWarnings.map(warning => <p key={warning.code}>{warning.count} {warning.message}</p>)}<p>Não é possível comprovar pelo código se uma conta antiga foi cadastrada diretamente ou se sua venda foi removida. A revisão deve comparar IDs e comprovantes, sem criar vendas ou pagamentos retroativos presumidos.</p></details> : null}
        <details className="financial-payment-history"><summary>Histórico geral de recebimentos</summary>{!loadingData && !loadFailed && !payments.length ? <p>Nenhum lançamento financeiro de recebimento localizado.</p> : null}{payments.length ? <div className="financial-table-wrapper"><table className="financial-table financial-history-table"><thead><tr><th>Cliente</th><th>Data do pagamento</th><th>Valor registrado</th><th>Forma</th></tr></thead><tbody>{payments.map(payment => <tr key={payment.id}><td data-label="Cliente">{clientsById[payment.clientId]?.name || payment.clientName || 'Cliente não identificado'}</td><td data-label="Data do pagamento">{formatRecordDate(payment.paymentDate)}</td><td data-label="Valor registrado">{formatCurrency(payment.amount)}</td><td data-label="Forma">{payment.paymentMethod || 'Não informada'}</td></tr>)}</tbody></table></div> : null}</details>
      </section>

      {modalState.type === 'view' && selectedReceivable ? <div className="financial-modal-overlay" role="presentation"><section className="financial-modal" role="dialog" aria-modal="true" aria-labelledby="financial-details-title" ref={dialogRef}><header className="financial-modal-header"><h2 id="financial-details-title">Detalhes da conta</h2><button type="button" className="financial-secondary-button" onClick={closeModal}><X size={20} aria-hidden="true" />Fechar</button></header>
        <h3 className="financial-client-name">{selectedReceivable.clientName}</h3>{selectedReceivable.nickname ? <p>{selectedReceivable.nickname}</p> : null}<dl className="financial-details">{[['Vencimento', formatRecordDate(selectedReceivable.dueDate)], ['Data da venda', formatRecordDate(selectedReceivable.saleDate)], ['Valor original', formatCurrency(selectedReceivable.amount)], ['Valor pago salvo', formatCurrency(selectedReceivable.paid)], ['Falta receber', formatCurrency(selectedReceivable.balance)], ['Situação', selectedReceivable.status]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {!selectedReceivable.saleFound ? <p className="financial-review-note">Não há venda localizada pelo identificador desta conta. A conta e seus pagamentos continuam preservados.</p> : <p className="financial-sale-link">Venda localizada, de {formatRecordDate(selectedSale.saleDate)} · total {formatCurrency(selectedSale.totalAmount)}<button type="button" className="financial-secondary-button" onClick={() => navigate('/vendas', { state: { financialSaleId: selectedSale.id } })}>Abrir venda e recibo<ArrowRight size={20} aria-hidden="true" /></button></p>}
        {selectedReceivable.conflicting ? <p className="financial-review-note">Os identificadores do cliente da conta e da venda divergem. Revise os vínculos antes de receber.</p> : null}
        <section className="financial-account-history"><h3>Pagamentos desta conta</h3>{selectedPayments.length ? <ul>{selectedPayments.map(payment => <li key={payment.id}><strong>{formatCurrency(payment.amount)}</strong> · {formatRecordDate(payment.paymentDate)} · {payment.paymentMethod || 'Forma não informada'}{payment.observation ? <p>{payment.observation}</p> : null}</li>)}</ul> : <p>Nenhum lançamento individual de pagamento localizado pelo ID desta conta.</p>}{selectedReceivable.paid > 0 && !selectedPayments.length ? <p className="financial-review-note">Há um valor pago salvo, mas não há histórico individual para confirmar a data e os pagamentos desta conta.</p> : null}</section>
        <details className="financial-data-notes"><summary>Dados para revisão</summary><p>Situação salva: {selectedReceivable.savedStatus || 'Não informada'}.</p><p>Identificador da conta: {selectedReceivable.id}.</p><p>Venda informada: {selectedReceivable.saleId || 'Não informada'}.</p></details><footer className="financial-form-actions"><button type="button" className="financial-secondary-button" onClick={closeModal}><ArrowLeft size={21} aria-hidden="true" />Voltar</button>{selectedReceivable.balance > 0 ? <button type="button" className="financial-primary-button" onClick={() => openReceiveModal(selectedReceivable)} disabled={selectedReceivable.conflicting}><Banknote size={21} aria-hidden="true" />Receber</button> : null}</footer></section></div> : null}

      {modalState.type === 'receive' && selectedReceivable ? (
        <div className="financial-modal-overlay" role="presentation">
          <section className="financial-modal" role="dialog" aria-modal="true" aria-labelledby="financial-receive-title" ref={dialogRef}>
            <header className="financial-modal-header">
              <h2 id="financial-receive-title">{reviewPayment ? 'Confira o recebimento' : 'Receber pagamento'}</h2>
              <button type="button" className="financial-secondary-button" onClick={closeModal} disabled={submittingReceive}>
                <X size={20} aria-hidden="true" />Fechar
              </button>
            </header>

            <form className="financial-form" onSubmit={handleSubmitReceive} noValidate aria-busy={submittingReceive}>
              <p>
                <strong>Cliente:</strong> {selectedReceivable.clientName || '-'}
              </p>
              <div className="financial-receive-summary"><p><strong>Valor original:</strong> {formatCurrency(selectedReceivable.amount)}</p><p><strong>Já foi pago:</strong> {formatCurrency(selectedReceivable.paid)}</p><p><strong>Saldo antes deste pagamento:</strong> {formatCurrency(selectedReceivable.balance)}</p></div>

              <label htmlFor="receiveAmount">Valor recebido</label>
              <input
                id="receiveAmount"
                inputMode="decimal"
                disabled={submittingReceive}
                value={receiveForm.amount}
                onChange={(event) => { clearReview();
                  setReceiveForm((previous) => ({
                    ...previous,
                    amount: event.target.value,
                  }))
                }}
              />

              <label htmlFor="receiveDate">Data do pagamento</label>
              <input
                id="receiveDate"
                type="date"
                disabled={submittingReceive}
                value={receiveForm.paymentDate}
                onChange={(event) => { clearReview();
                  setReceiveForm((previous) => ({
                    ...previous,
                    paymentDate: event.target.value,
                  }))
                }}
              />

              <label htmlFor="receiveMethod">Forma de pagamento</label>
              <select
                id="receiveMethod"
                disabled={submittingReceive}
                value={receiveForm.paymentMethod}
                onChange={(event) => { clearReview();
                  setReceiveForm((previous) => ({
                    ...previous,
                    paymentMethod: event.target.value,
                  }))
                }}
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
                disabled={submittingReceive}
                value={receiveForm.observation}
                onChange={(event) => { clearReview();
                  setReceiveForm((previous) => ({
                    ...previous,
                    observation: event.target.value,
                  }))
                }}
              />

              <p className="financial-remaining"><strong>Saldo após este pagamento:</strong> {paymentAmount === null || selectedReceivable.balance === null || paymentAmount > selectedReceivable.balance ? 'Confira o valor informado' : formatCurrency(selectedReceivable.balance - paymentAmount)}</p>
              {reviewPayment ? <section className="financial-confirmation"><h3>Confira antes de confirmar</h3><p><strong>Cliente:</strong> {selectedReceivable.clientName}</p><p><strong>Valor:</strong> {formatCurrency(paymentAmount)}</p><p><strong>Data:</strong> {formatRecordDate(receiveForm.paymentDate)}</p><p><strong>Forma:</strong> {receiveForm.paymentMethod}</p><button type="button" className="financial-secondary-button" onClick={clearReview} disabled={submittingReceive}>Revisar dados</button></section> : null}
              {errorMessage ? <p className="financial-message error" role="alert">{errorMessage}</p> : null}
              <footer className="financial-form-actions"><button type="button" className="financial-secondary-button" onClick={closeModal} disabled={submittingReceive}>Cancelar</button><button type="submit" className="financial-primary-button" disabled={submittingReceive}><Banknote size={21} aria-hidden="true" />{submittingReceive ? 'Registrando…' : reviewPayment ? 'Confirmar recebimento' : 'Conferir pagamento'}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default FinancialPage
