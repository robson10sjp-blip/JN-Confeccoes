import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MetricCard from '../components/dashboard/MetricCard'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { subscribeProductsByUser } from '../services/productsService'
import { getSalesSummaryByUser } from '../services/salesService'
import '../styles/dashboard-page.css'

function parseNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('dashboard')
  const [totalProductsInStock, setTotalProductsInStock] = useState(0)
  const [salesSummary, setSalesSummary] = useState({
    totalSales: 0,
    totalSoldValue: 0,
    totalProductsSold: 0,
  })

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  useEffect(() => {
    if (!user?.uid) {
      setTotalProductsInStock(0)
      return () => {}
    }

    const unsubscribe = subscribeProductsByUser(
      user.uid,
      (products) => {
        const totalInStock = products.reduce(
          (accumulator, product) => accumulator + Math.max(0, parseNumber(product?.stockQuantity)),
          0,
        )

        setTotalProductsInStock(totalInStock)
      },
      (error) => {
        console.error('Erro ao observar total de produtos:', error)
        setTotalProductsInStock(0)
      },
    )

    return unsubscribe
  }, [user?.uid])

  const loadSalesSummary = useCallback(async () => {
    if (!user?.uid) {
      setSalesSummary({
        totalSales: 0,
        totalSoldValue: 0,
        totalProductsSold: 0,
      })
      return
    }

    try {
      const summary = await getSalesSummaryByUser(user.uid)
      setSalesSummary(summary)
    } catch (error) {
      console.error('Erro ao carregar resumo de vendas:', error)
      setSalesSummary({
        totalSales: 0,
        totalSoldValue: 0,
        totalProductsSold: 0,
      })
    }
  }, [user?.uid])

  useEffect(() => {
    loadSalesSummary()
  }, [loadSalesSummary])

  const metrics = useMemo(
    () => [
      { key: 'vendas', title: 'Total de vendas', value: String(salesSummary.totalSales) },
      {
        key: 'valorVendido',
        title: 'Valor vendido',
        value: new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }).format(salesSummary.totalSoldValue),
      },
      { key: 'produtosVendidos', title: 'Produtos vendidos', value: String(salesSummary.totalProductsSold) },
      { key: 'produtos', title: 'Total de Produtos', value: String(totalProductsInStock) },
    ],
    [salesSummary.totalProductsSold, salesSummary.totalSales, salesSummary.totalSoldValue, totalProductsInStock],
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