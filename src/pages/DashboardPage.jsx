import DashboardLayout from '../layouts/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import '../styles/dashboard-page.css'

function DashboardPage() {
  const { logout } = useAuth()

  return (
    <DashboardLayout>
      <section className="dashboard-panel">
        <h1>Bem-vindo ao JN Confecções</h1>
        <button type="button" className="secondary-button" onClick={logout}>
          Sair
        </button>
      </section>
    </DashboardLayout>
  )
}

export default DashboardPage