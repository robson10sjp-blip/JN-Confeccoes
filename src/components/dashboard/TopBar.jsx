import BrandLogo from '../BrandLogo'

function TopBar({ userName, onLogout, onToggleMenu }) {
  return (
    <header className="dashboard-topbar">
      <button type="button" className="dashboard-menu-button" onClick={onToggleMenu}>
        Menu
      </button>

      <div className="dashboard-topbar-brand">
        <BrandLogo className="dashboard-brand-logo" showName />
      </div>

      <div className="dashboard-topbar-actions">
        <p className="dashboard-user-name">{userName}</p>
        <button type="button" className="dashboard-logout-button" onClick={onLogout}>
          Sair
        </button>
      </div>
    </header>
  )
}

export default TopBar
