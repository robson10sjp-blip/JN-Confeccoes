import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MetricCard from '../components/dashboard/MetricCard'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import '../styles/dashboard-page.css'

const MENU_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'configuracoes', label: 'Configurações' },
]

function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('dashboard')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const metrics = [
    { key: 'clientes', title: 'Clientes', value: '0' },
    { key: 'pedidos', title: 'Pedidos', value: '0' },
    { key: 'producao', title: 'Em produção', value: '0' },
    { key: 'faturamento', title: 'Faturamento', value: 'R$ 0,00' },
  ]

  const handleSelectMenuItem = (itemKey) => {
    if (itemKey === 'dashboard') {
      setActiveItem(itemKey)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <DashboardLayout
      sidebarItems={MENU_ITEMS}
      activeItem={activeItem}
      onSelectItem={handleSelectMenuItem}
      userName={userName}
      onLogout={handleLogout}
    >
      <section className="dashboard-page">
        <header className="dashboard-page-header">
          <h1>Dashboard</h1>
          <p>Bem-vindo ao JN Confecções</p>
          {userName ? <small className="dashboard-user-inline">Usuário: {userName}</small> : null}
        </header>

        <section className="metrics-grid" aria-label="Indicadores principais">
          {metrics.map((metric) => (
            <MetricCard key={metric.key} title={metric.title} value={metric.value} />
          ))}
        </section>
      </section>
    </DashboardLayout>
  )
}

export default DashboardPage