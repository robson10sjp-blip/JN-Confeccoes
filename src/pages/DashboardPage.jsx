import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MetricCard from '../components/dashboard/MetricCard'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { countProductsByUser } from '../services/productsService'
import '../styles/dashboard-page.css'

function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('dashboard')
  const [productsCount, setProductsCount] = useState(0)

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const loadProductsCount = useCallback(async () => {
    if (!user?.uid) {
      setProductsCount(0)
      return
    }

    try {
      const totalProducts = await countProductsByUser(user.uid)
      setProductsCount(totalProducts)
    } catch (error) {
      console.error('Erro ao contar produtos:', error)
      setProductsCount(0)
    }
  }, [user?.uid])

  useEffect(() => {
    loadProductsCount()
  }, [loadProductsCount])

  const metrics = useMemo(
    () => [
      { key: 'clientes', title: 'Clientes', value: '0' },
      { key: 'produtos', title: 'Produtos', value: String(productsCount) },
      { key: 'producao', title: 'Em produção', value: '0' },
      { key: 'faturamento', title: 'Faturamento', value: 'R$ 0,00' },
    ],
    [productsCount],
  )

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

  return (
    <DashboardLayout
      sidebarItems={sidebarMenuItems}
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