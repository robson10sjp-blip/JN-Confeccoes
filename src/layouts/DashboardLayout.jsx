import '../styles/dashboard-layout.css'

function DashboardLayout({ children }) {
  return (
    <div className="dashboard-layout">
      <header className="dashboard-layout-header">
        <h2>JN Confecções</h2>
      </header>

      <main className="dashboard-layout-main">{children}</main>

      <footer className="dashboard-layout-footer">
        <small>JN Confecções</small>
      </footer>
    </div>
  )
}

export default DashboardLayout