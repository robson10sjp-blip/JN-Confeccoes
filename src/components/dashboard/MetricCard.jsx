function MetricCard({ title, value, description }) {
  return (
    <article className="metric-card">
      <p className="metric-card-title">{title}</p>
      <strong className="metric-card-value">{value}</strong>
      {description ? <p className="metric-card-description">{description}</p> : null}
    </article>
  )
}

export default MetricCard
