import { useState } from 'react'
import SidebarNav from '../components/dashboard/SidebarNav'
import TopBar from '../components/dashboard/TopBar'
import '../styles/dashboard-layout.css'

function DashboardLayout({ children, sidebarItems, activeItem, onSelectItem, userName, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSelectItem = (itemKey) => {
    onSelectItem(itemKey)
    setMenuOpen(false)
  }

  return (
    <div className="dashboard-layout">
      <aside className={`dashboard-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <p className="dashboard-sidebar-title">Gestão JN</p>
        <SidebarNav items={sidebarItems} activeKey={activeItem} onSelect={handleSelectItem} />
      </aside>

      <div className="dashboard-workspace">
        <TopBar
          userName={userName}
          onLogout={onLogout}
          onToggleMenu={() => setMenuOpen((currentState) => !currentState)}
        />

        <main className="dashboard-layout-main">{children}</main>
      </div>
    </div>
  )
}

export default DashboardLayout