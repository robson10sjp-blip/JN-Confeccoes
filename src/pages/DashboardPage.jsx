import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeDollarSign, Banknote, CalendarDays, Check, CircleAlert, Package, PackageSearch, Plus, RefreshCw, RotateCcw, ShoppingBag, UserRoundPlus, Users, Wallet } from 'lucide-react'
import MetricCard from '../components/dashboard/MetricCard'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { subscribeDashboardSource } from '../services/dashboardService'
import { buildDashboardSummary, getDashboardPeriod } from '../utils/dashboardSummary'
import { formatRecordDate, toDateKey } from '../utils/recordFilters'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import '../styles/dashboard-page.css'

const SOURCES = { sales: 'vendas', payments: 'recebimentos', receivables: 'contas a receber', clients: 'clientes', products: 'estoque' }
const PERIODS = [{ key: 'today', label: 'Hoje' }, { key: 'month', label: 'Este mês' }, { key: 'year', label: 'Este ano' }, { key: 'all', label: 'Todo o período' }, { key: 'custom', label: 'Escolher datas' }]
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const shortcuts = [
  { title: 'Nova venda', path: '/vendas', action: 'new-sale', icon: Plus },
  { title: 'Receber pagamento', path: '/financeiro', icon: Banknote },
  { title: 'Cadastrar cliente', path: '/clientes', action: 'new-client', icon: UserRoundPlus },
  { title: 'Ver produtos', path: '/produtos', icon: PackageSearch },
]

function initialSources() {
  return Object.fromEntries(Object.keys(SOURCES).map(key => [key, { data: [], status: 'loading', error: '' }]))
}

function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState({ uid: '', sources: initialSources() })
  const [retry, setRetry] = useState(0)
  const [period, setPeriod] = useState('all')
  const [dates, setDates] = useState({ from: '', to: '' })
  const [today, setToday] = useState(() => toDateKey(new Date()))
  const [updatedAt, setUpdatedAt] = useState(null)
  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'
  const sources = snapshot.uid === user?.uid ? snapshot.sources : initialSources()
  const range = getDashboardPeriod(period, dates, today)
  const invalidRange = period === 'custom' && (!dates.from || !dates.to || dates.from > dates.to)
  const data = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.data]))
  const summary = buildDashboardSummary(data, range, today)
  const allReady = Object.values(sources).every(source => source.status === 'ready')
  const hasErrors = Object.values(sources).some(source => source.status === 'error')
  const hasCache = Object.values(sources).some(source => source.status === 'cached')
  const isReady = keys => keys.every(key => sources[key].status === 'ready')

  useEffect(() => {
    const updateToday = () => setToday(toDateKey(new Date()))
    const timer = window.setInterval(updateToday, 60000)
    window.addEventListener('focus', updateToday)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateToday) }
  }, [])

  useEffect(() => {
    let active = true
    const subscriptions = []
    setSnapshot({ uid: user?.uid || '', sources: initialSources() })
    setUpdatedAt(null)
    if (!user?.uid) return () => { active = false }
    const update = (key, source) => {
      if (active) setSnapshot(previous => ({ uid: user.uid, sources: { ...previous.sources, [key]: source } }))
    }
    for (const key of Object.keys(SOURCES)) {
      const onError = error => {
        console.error(`Falha ao carregar ${SOURCES[key]} do Dashboard:`, error?.code || 'unknown')
        update(key, { data: [], status: 'error', error: getFirebaseErrorMessage(error, `Não foi possível carregar ${SOURCES[key]}`) })
      }
      try {
        subscriptions.push(subscribeDashboardSource(user.uid, key, (entries, confirmed) => {
          update(key, { data: entries, status: confirmed ? 'ready' : 'cached', error: '' })
          if (active && confirmed) setUpdatedAt(new Date())
        }, onError))
      } catch (error) { onError(error) }
    }
    return () => { active = false; subscriptions.forEach(unsubscribe => unsubscribe()) }
  }, [user?.uid, retry])

  const valueFor = (keys, value, { money = false, incomplete = false, current = false } = {}) => {
    if (keys.some(key => sources[key].status === 'error')) return 'Indisponível'
    if (!isReady(keys)) return 'Carregando…'
    if (!current && invalidRange) return 'Escolha as datas'
    if (incomplete) return 'Conferir dados'
    return money ? currency.format(value) : integer.format(value)
  }
  const periodLabel = PERIODS.find(option => option.key === period).label
  const periodDescription = period === 'all' ? 'Todo o período' : invalidRange ? 'Escolha a data inicial e a final' : `${periodLabel} · ${formatRecordDate(range.from)} a ${formatRecordDate(range.to)}`
  const metrics = [
    { key: 'sold', title: 'Total vendido', icon: BadgeDollarSign, value: valueFor(['sales'], summary.totalSold, { money: true, incomplete: summary.incomplete.sold }), description: 'Valor das vendas do período' },
    { key: 'received', title: 'Total recebido', icon: Banknote, value: valueFor(['sales', 'payments', 'receivables'], summary.totalReceived, { money: true, incomplete: summary.incomplete.received }), description: 'Pagamentos registrados no período' },
    { key: 'outstanding', title: 'Falta receber', icon: Wallet, value: valueFor(['sales'], summary.outstanding, { money: true, incomplete: summary.incomplete.outstanding }), description: 'Saldo atual das vendas do período' },
    { key: 'count', title: 'Vendas realizadas', icon: ShoppingBag, value: valueFor(['sales'], summary.salesCount), description: 'Vendas feitas no período' },
  ]
  const handleSelectMenuItem = key => {
    const item = sidebarMenuItems.find(entry => entry.key === key)
    if (item?.enabled && item.path) navigate(item.path)
  }
  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }) }
  const clearPeriod = () => { setPeriod('all'); setDates({ from: '', to: '' }) }

  return (
    <DashboardLayout
      sidebarItems={sidebarMenuItems}
      activeItem="dashboard"
      onSelectItem={handleSelectMenuItem}
      userName={userName}
      onLogout={handleLogout}
    >
      <section className="dashboard-page">
        <header className="dashboard-page-header">
          <div><p className="dashboard-brand">JN Confecções</p><h1>Visão geral</h1><p className="dashboard-greeting">Olá, {userName}. Que bom ter você aqui.</p></div>
          <p className={`dashboard-sync ${allReady ? 'is-ready' : ''}`} role="status">
            {allReady ? <Check size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
            {hasErrors ? 'Alguns dados não foram carregados' : hasCache ? 'Aguardando confirmação da conexão' : allReady && updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Buscando seus dados…'}
          </p>
        </header>

        <section className="dashboard-period" aria-label="Período da consulta">
          <fieldset><legend>Qual período você quer ver?</legend><div className="dashboard-period-options">
            {PERIODS.map(option => <label key={option.key} className={period === option.key ? 'is-selected' : ''}>
              <input type="radio" name="dashboard-period" value={option.key} checked={period === option.key} onChange={() => setPeriod(option.key)} /><span>{option.label}</span>
            </label>)}
          </div></fieldset>
          {period === 'custom' ? <div className="dashboard-date-fields">
            <label>Data inicial<input type="date" lang="pt-BR" value={dates.from} max={dates.to || undefined} onChange={event => setDates(previous => ({ ...previous, from: event.target.value }))} /></label>
            <label>Data final<input type="date" lang="pt-BR" value={dates.to} min={dates.from || undefined} onChange={event => setDates(previous => ({ ...previous, to: event.target.value }))} /></label>
            {invalidRange ? <p role="alert">Informe as duas datas, com a data inicial antes ou igual à final.</p> : null}
          </div> : null}
          <div className="dashboard-period-summary"><p aria-live="polite"><CalendarDays size={20} aria-hidden="true" /><strong>{periodDescription}</strong></p><button type="button" className="dashboard-text-button" onClick={clearPeriod}><RotateCcw size={19} aria-hidden="true" />Limpar filtro</button></div>
        </section>

        {hasErrors ? <section className="dashboard-error" role="alert"><div><CircleAlert size={24} aria-hidden="true" /><h2>Não foi possível carregar todos os dados</h2></div>
          {Object.entries(sources).filter(([, source]) => source.status === 'error').map(([key, source]) => <p key={key}><strong>{SOURCES[key]}:</strong> {source.error}</p>)}
          <button type="button" onClick={() => setRetry(previous => previous + 1)}><RefreshCw size={20} aria-hidden="true" />Tentar novamente</button>
        </section> : null}

        <section aria-labelledby="dashboard-sales-heading"><div className="dashboard-section-heading"><h2 id="dashboard-sales-heading">Vendas e recebimentos</h2><span>No período selecionado</span></div>
          <div className="metrics-grid dashboard-sales-metrics" aria-label="Indicadores do período">{metrics.map(metric => <MetricCard key={metric.key} title={<><metric.icon size={22} aria-hidden="true" />{metric.title}</>} value={metric.value} description={metric.description} />)}</div>
          {!invalidRange && isReady(['sales']) && summary.salesCount === 0 ? <p className="dashboard-empty">Nenhuma venda encontrada neste período.</p> : null}
          {!invalidRange && isReady(['sales', 'payments', 'receivables']) && summary.selectedPaymentsCount === 0 ? <p className="dashboard-empty">Nenhum pagamento registrado neste período.</p> : null}
        </section>

        <section aria-labelledby="dashboard-current-heading"><div className="dashboard-section-heading"><h2 id="dashboard-current-heading">Seu negócio hoje</h2><span>Totais atuais · não mudam com o período</span></div>
          <div className="metrics-grid dashboard-current-metrics">
            <MetricCard title={<><Users size={22} aria-hidden="true" />Clientes cadastrados</>} value={valueFor(['clients'], summary.clientsCount, { current: true })} description="Total atual de clientes" />
            <MetricCard title={<><Package size={22} aria-hidden="true" />Produtos em estoque</>} value={valueFor(['products'], summary.stockUnits, { incomplete: summary.incomplete.stock, current: true })} description={isReady(['products']) ? `Unidades disponíveis · ${integer.format(summary.productCount)} produtos cadastrados` : 'Quantidade atual de unidades disponíveis'} />
          </div>
        </section>

        <section aria-labelledby="dashboard-shortcuts-heading"><div className="dashboard-section-heading"><h2 id="dashboard-shortcuts-heading">O que você quer fazer?</h2></div>
          <div className="dashboard-shortcuts">{shortcuts.map(shortcut => <button key={shortcut.title} type="button" onClick={() => navigate(shortcut.path, shortcut.action ? { state: { dashboardAction: shortcut.action } } : undefined)}>
            <shortcut.icon size={28} aria-hidden="true" /><span>{shortcut.title}</span><ArrowRight size={20} aria-hidden="true" />
          </button>)}</div>
        </section>

        <section aria-labelledby="dashboard-attention-heading"><div className="dashboard-section-heading"><h2 id="dashboard-attention-heading">Precisa de atenção</h2><span>Situação atual · todo o período</span></div>
          <div className="dashboard-attention-grid">
            <article className="dashboard-attention-item"><div className="dashboard-attention-title"><CircleAlert size={23} aria-hidden="true" /><h3>Vendas em atraso</h3></div>
              <strong>{valueFor(['sales', 'receivables'], summary.overdue.count, { incomplete: summary.overdue.incomplete, current: true })}</strong>
              <p>{isReady(['sales', 'receivables']) && !summary.overdue.incomplete ? `${currency.format(summary.overdue.amount)} em aberto nessas vendas` : 'Aguardando a conferência das vendas'}</p>
              <button type="button" className="dashboard-text-button" onClick={() => navigate('/vendas')}>Abrir vendas<ArrowRight size={19} aria-hidden="true" /></button>
            </article>
            <article className="dashboard-attention-item"><div className="dashboard-attention-title"><Package size={23} aria-hidden="true" /><h3>Estoque baixo</h3></div>
              <strong>{valueFor(['products'], summary.stockAttention.low.length, { incomplete: summary.incomplete.stock, current: true })}</strong><p>Produtos com 1 a 5 unidades disponíveis</p>
              <button type="button" className="dashboard-text-button" onClick={() => navigate('/produtos')}>Abrir produtos<ArrowRight size={19} aria-hidden="true" /></button>
            </article>
            <article className="dashboard-attention-item"><div className="dashboard-attention-title"><PackageSearch size={23} aria-hidden="true" /><h3>Produtos esgotados</h3></div>
              <strong>{valueFor(['products'], summary.stockAttention.empty.length, { incomplete: summary.incomplete.stock, current: true })}</strong><p>Produtos com estoque igual a zero</p>
              <button type="button" className="dashboard-text-button" onClick={() => navigate('/produtos')}>Abrir produtos<ArrowRight size={19} aria-hidden="true" /></button>
            </article>
          </div>
        </section>

        {allReady && summary.warnings.length ? <details className="dashboard-data-notes"><summary><CircleAlert size={21} aria-hidden="true" />Dados que precisam de conferência<span>{summary.warnings.length}</span></summary>
          <ul>{summary.warnings.map(warning => <li key={warning.code}><strong>{warning.count}</strong> {warning.message}</li>)}</ul>
          <p>Recebimentos: primeiro o histórico de pagamentos da venda; quando ele não existe, os lançamentos do Financeiro. Contas e valores acumulados não são somados novamente.</p>
        </details> : null}
      </section>
    </DashboardLayout>
  )
}

export default DashboardPage