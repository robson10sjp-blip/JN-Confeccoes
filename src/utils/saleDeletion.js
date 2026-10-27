import { buildRestartPlan } from './systemRestart.js'

export const SALE_CANCELLATION_KIND = 'jn-sale-cancellation-v1'
export const SALE_CANCELLATION_LABEL = 'Cancelada por exclusão de venda'

export function isSaleCancelled(record) {
  return record?.saleCancellation?.kind === SALE_CANCELLATION_KIND
}

export function planSaleStockReturn(sale, products, previouslyReturned = false) {
  if (isSaleCancelled(sale)) return { returns: [], warnings: [], alreadyCancelled: true }
  if (previouslyReturned || sale.stockReturn?.completed) return { returns: [], warnings: ['A devolução desta venda já está registrada. Nenhuma quantidade será devolvida novamente.'], alreadyReturned: true }
  const plan = buildRestartPlan({ sales: [{ ...sale, restartClosure: null }], products })
  return {
    returns: plan.returns,
    warnings: plan.reviews.map(entry => entry.reason),
    needsStockReview: plan.returns.length === 0,
  }
}