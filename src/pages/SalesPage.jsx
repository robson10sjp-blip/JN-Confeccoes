import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import '../styles/sales-page.css'

function SalesPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('vendas')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

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
      <section className="sales-page">
        <header className="sales-page-header">
          <div>
            <h1>Vendas</h1>
            <p>Gerencie as vendas da JN Confecções.</p>
          </div>
          <button type="button" className="sales-primary-button">
            Nova Venda
          </button>
        </header>

        <section className="sales-list-placeholder" aria-label="Área de lista de vendas">
          <p>Área preparada para futura lista de vendas.</p>
        </section>
      </section>
    </DashboardLayout>
  )
}

export default SalesPage
