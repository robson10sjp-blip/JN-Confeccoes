function SidebarNav({ items, activeKey, onSelect }) {
  return (
    <nav className="dashboard-sidebar-nav" aria-label="Menu principal">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`dashboard-nav-item ${activeKey === item.key ? 'is-active' : ''}`}
          disabled={!item.enabled}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export default SidebarNav
