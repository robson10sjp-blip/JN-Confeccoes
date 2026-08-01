const dashboardSummaryMock = {
  totalClientes: 382,
  pedidosAndamento: 46,
  pedidosEntregues: 129,
  faturamentoMes: 128450.9,
  producaoDia: 214,
}

export async function getDashboardSummary() {
  // Estrutura pronta para futura substituicao por consulta Firebase.
  return Promise.resolve(dashboardSummaryMock)
}
