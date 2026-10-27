import { useEffect, useRef, useState } from 'react'
import { ArchiveRestore, ArrowDownToLine, Check, CircleAlert, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { executeSystemRestartByUser, prepareSystemRestartByUser } from '../services/systemRestartService'
import '../styles/system-restart.css'

function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function SystemRestartControl() {
  const { user } = useAuth()
  const [opened, setOpened] = useState(false)
  const [ownerUid, setOwnerUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [prepared, setPrepared] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const running = useRef(false)
  const generation = useRef(0)
  const dialogRef = useRef(null)

  useEffect(() => {
    generation.current += 1
    setOpened(false)
    setPrepared(null)
    setResult(null)
    setError('')
    setBusy(false)
    running.current = false
  }, [user?.uid])

  useEffect(() => {
    if (!opened || !dialogRef.current) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog.querySelector('button')?.focus()
    const handleKeys = event => {
      if (event.key !== 'Tab') return
      const elements = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), summary')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
    dialog.addEventListener('keydown', handleKeys)
    return () => { document.body.style.overflow = previousOverflow; dialog.removeEventListener('keydown', handleKeys); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [opened])

  const prepare = async () => {
    if (!user?.uid || running.current) return
    const version = ++generation.current
    running.current = true
    setOwnerUid(user.uid)
    setOpened(true)
    setBusy(true)
    setError('')
    setPrepared(null)
    setResult(null)
    setBackupConfirmed(false)
    try {
      const data = await prepareSystemRestartByUser(user.uid, 'cleanup')
      if (generation.current !== version) return
      if (data.alreadyCompleted) setResult({ ...data.result, alreadyCompleted: true })
      else {
        setPrepared(data)
        downloadJson(data.backupText, data.filename)
      }
    } catch (failure) {
      if (generation.current === version) setError(failure.message || 'Não foi possível preparar a cópia. Nenhuma alteração foi solicitada.')
    } finally {
      if (generation.current === version) { setBusy(false); running.current = false }
    }
  }

  const confirm = async () => {
    if (!backupConfirmed || !prepared || running.current) return
    const version = generation.current
    running.current = true
    setBusy(true)
    setError('')
    try {
      const outcome = await executeSystemRestartByUser(user.uid, prepared, backupConfirmed)
      if (generation.current === version) setResult(outcome)
    } catch (failure) {
      if (generation.current === version) setError(failure.message || 'A gravação não foi confirmada. Mantenha a cópia e tente novamente para conferir a operação, sem iniciar outra devolução.')
    } finally {
      if (generation.current === version) { setBusy(false); running.current = false }
    }
  }

  if (!user?.uid) return null
  return (
    <section className="restart-control" aria-label="Preparação temporária para reinício">
      <button type="button" className="restart-entry" onClick={prepare}><ArchiveRestore size={22} aria-hidden="true" />Preparar sistema para recomeçar</button>
      {opened && ownerUid === user.uid ? <div className="restart-overlay" role="presentation"><section className="restart-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-title" ref={dialogRef} aria-busy={busy}>
        <header><h2 id="restart-title">{result ? 'Resultado do reinício' : 'Preparar sistema para recomeçar'}</h2><button type="button" className="restart-secondary" onClick={() => setOpened(false)} disabled={busy}><X size={20} aria-hidden="true" />Fechar</button></header>
        {busy ? <p role="status" className="restart-status"><RefreshCw size={22} aria-hidden="true" />{prepared ? 'Confirmando a operação no servidor… Não feche esta tela.' : 'Conferindo os registros e preparando a cópia…'}</p> : null}
        {error ? <p role="alert" className="restart-error"><CircleAlert size={22} aria-hidden="true" />{error}</p> : null}
        {prepared && !result ? <>
          <p className="restart-note"><strong>Limpeza completa das movimentações.</strong> Serão apagados os históricos desta cópia: vendas, contas, recebimentos e registros auxiliares. As clientes e os produtos serão mantidos. Isso remove o histórico antigo, em vez de apenas encerrar contas.</p>
          <dl className="restart-counts"><div><dt>Vendas a apagar</dt><dd>{prepared.plan.deleteCounts.sales}</dd></div><div><dt>Contas a apagar</dt><dd>{prepared.plan.deleteCounts.receivables}</dd></div><div><dt>Recebimentos a apagar</dt><dd>{prepared.plan.deleteCounts.payments}</dd></div><div><dt>Recibos e pagamentos auxiliares</dt><dd>{prepared.plan.deleteCounts.receipts + prepared.plan.deleteCounts.otherPayments}</dd></div><div><dt>Clientes mantidos</dt><dd>{prepared.plan.counts.clients}</dd></div><div><dt>Produtos mantidos</dt><dd>{prepared.plan.counts.products}</dd></div></dl>
          <section className="restart-backup"><h3>Cópia antes da limpeza</h3><p>Download solicitado: <strong>{prepared.filename}</strong></p><p>Guarde nos Downloads ou em uma pasta pessoal fora do projeto. Não envie essa cópia ao Git; ela contém os registros originais.</p><button type="button" className="restart-secondary" onClick={() => downloadJson(prepared.backupText, prepared.filename)} disabled={busy}><ArrowDownToLine size={21} aria-hidden="true" />Baixar cópia novamente</button><label><input type="checkbox" checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)} disabled={busy} />Já localizei a cópia nos meus downloads.</label></section>
          <section><h3>Mercadorias com devolução comprovada</h3>{prepared.plan.returns.length ? <table className="restart-table"><thead><tr><th>Produto</th><th>Antes</th><th>Devolver</th><th>Depois</th></tr></thead><tbody>{prepared.plan.returns.map(entry => <tr key={entry.productId}><td data-label="Produto">{entry.description}</td><td data-label="Antes">{entry.before}</td><td data-label="Devolver">{entry.quantity}</td><td data-label="Depois">{entry.after}</td></tr>)}</tbody></table> : <p>Nenhuma quantidade pôde ser comprovada para devolução automática. O estoque permanecerá como está.</p>}</section>
          <p>{prepared.plan.alreadyReturnedSales} venda(s) já tiveram devolução identificada no reinício anterior. Essas quantidades não serão devolvidas novamente.</p>
          <details className="restart-review" open><summary>Registros que precisam de conferência</summary><p>{prepared.plan.unverifiedAccounts} conta(s) sem venda ou itens localizados · {prepared.plan.unverifiedSales} venda(s) sem devolução comprovada.</p>{prepared.plan.reviews.length ? <ul>{prepared.plan.reviews.map((entry, index) => <li key={`${entry.type}-${entry.id}-${index}`}><strong>{entry.type === 'account' ? 'Conta' : 'Venda'} {entry.id}</strong>{entry.productId ? ` · Produto ${entry.productId}` : ''}: {entry.reason}</li>)}</ul> : <p>Nenhuma pendência neste plano.</p>}</details>
          <p className="restart-note">A operação considera os registros desta cópia e não pode ser desfeita pela tela. Guarde o arquivo para recuperação assistida. Se algo mudar, uma nova conferência será necessária. Não serão criados pagamentos.</p>
          <footer><button type="button" className="restart-secondary" onClick={() => setOpened(false)} disabled={busy}>Cancelar</button><button type="button" className="restart-confirm" onClick={confirm} disabled={busy || !backupConfirmed}><Check size={22} aria-hidden="true" />Confirmar limpeza completa</button></footer>
        </> : null}
        {result ? <>
          <p className="restart-success"><Check size={24} aria-hidden="true" />{result.alreadyCompleted ? 'A limpeza completa já estava registrada. Nenhuma exclusão ou devolução foi repetida.' : 'Limpeza completa registrada no sistema.'}</p>
          <dl className="restart-counts"><div><dt>Vendas apagadas</dt><dd>{result.deletedCounts?.sales ?? 0}</dd></div><div><dt>Contas apagadas</dt><dd>{result.deletedCounts?.receivables ?? 0}</dd></div><div><dt>Recebimentos apagados</dt><dd>{result.deletedCounts?.payments ?? 0}</dd></div><div><dt>Vendas com devolução</dt><dd>{result.returnedSales}</dd></div><div><dt>Unidades devolvidas</dt><dd>{result.returnedUnits}</dd></div><div><dt>Vendas já devolvidas anteriormente</dt><dd>{result.alreadyReturnedSales ?? 0}</dd></div><div><dt>Contas sem itens localizados</dt><dd>{result.unverifiedAccounts}</dd></div><div><dt>Vendas a conferir</dt><dd>{result.unverifiedSales}</dd></div></dl>
          <p>Clientes mantidos: {result.clientsPreserved}. Produtos mantidos: {result.productsPreserved}. Os recebimentos antigos foram removidos conforme a conferência, sem criar pagamentos fictícios.</p>
          {result.verified === true ? <p>Conferência final concluída: históricos de movimentação vazios, estoque comprovado e cadastros preservados.</p> : result.verified === false ? <p className="restart-note">A operação foi registrada, mas a conferência final não pôde confirmar todos os dados. Guarde a cópia e não repita devoluções. Outras movimentações podem ter sido feitas; confira antes de qualquer ajuste manual.</p> : null}
          <p>Cópia original: <strong>{result.backupFilename}</strong>. Guarde esse arquivo em local seguro; ele contém IDs e valores originais para restauração assistida.</p>
          {result.returns?.length ? <section><h3>Estoque devolvido nesta limpeza</h3><table className="restart-table"><thead><tr><th>Produto</th><th>Antes</th><th>Devolvido</th><th>Depois</th></tr></thead><tbody>{result.returns.map(entry => <tr key={entry.productId}><td data-label="Produto">{entry.description}</td><td data-label="Antes">{entry.before}</td><td data-label="Devolvido">{entry.quantity}</td><td data-label="Depois">{entry.after}</td></tr>)}</tbody></table></section> : <p>Nenhuma quantidade de mercadoria foi devolvida nesta limpeza. Confira o estoque manualmente para os itens sem prova ou já devolvidos.</p>}
          <button type="button" className="restart-secondary" onClick={() => downloadJson(JSON.stringify(result, null, 2), `jn-resultado-reinicio-${result.operationId}.json`)}><ArrowDownToLine size={21} aria-hidden="true" />Baixar resultado</button>
          {result.reviews?.length ? <details className="restart-review"><summary>Ver itens que precisam de conferência</summary><ul>{result.reviews.map((entry, index) => <li key={index}>{entry.type === 'account' ? 'Conta' : 'Venda'} {entry.id}: {entry.reason}</li>)}</ul></details> : null}
          <footer><button type="button" className="restart-confirm" onClick={() => setOpened(false)}>Concluir</button></footer>
        </> : null}
        {!busy && !prepared && !result ? <button type="button" className="restart-secondary" onClick={prepare}><RefreshCw size={21} aria-hidden="true" />Tentar preparar novamente</button> : null}
      </section></div> : null}
    </section>
  )
}