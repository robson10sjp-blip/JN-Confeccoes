export default function RecordFilters({ filters, onChange, showClient = true }) {
  const update = (field, value) => onChange(previous => ({ ...previous, [field]: value }))
  return (
    <section className="record-filters" aria-label="Filtros de consulta">
      {showClient ? <label>Cliente<input type="search" value={filters.client || ''} onChange={event => update('client', event.target.value)} /></label> : null}
      <label>Venda de<input type="date" lang="pt-BR" value={filters.saleFrom || ''} onChange={event => update('saleFrom', event.target.value)} /></label>
      <label>Venda até<input type="date" lang="pt-BR" value={filters.saleTo || ''} onChange={event => update('saleTo', event.target.value)} /></label>
      <label>Vencimento de<input type="date" lang="pt-BR" value={filters.dueFrom || ''} onChange={event => update('dueFrom', event.target.value)} /></label>
      <label>Vencimento até<input type="date" lang="pt-BR" value={filters.dueTo || ''} onChange={event => update('dueTo', event.target.value)} /></label>
      <label>Status<select value={filters.status || ''} onChange={event => update('status', event.target.value)}>
        <option value="">Todos</option>
        <option value="Pago">Pagos</option>
        <option value="Pendente">Pendentes (inclui parciais e atrasados)</option>
        <option value="Parcial">Parciais</option>
        <option value="Atrasado">Em atraso</option>
        <option value="Não informado">Não informado</option>
      </select></label>
      <button type="button" className="record-filters-reset" onClick={() => onChange({})}>Limpar filtros</button>
      {(filters.saleFrom && filters.saleTo && filters.saleFrom > filters.saleTo || filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo) ? <p role="alert">O início do período deve ser anterior ou igual ao fim.</p> : null}
    </section>
  )
}