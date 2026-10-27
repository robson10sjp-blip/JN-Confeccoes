import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, ImageDown, Printer } from 'lucide-react'

export default function SaleReceiptViewer({ html, onClose }) {
  const frame = useRef(null)
  const dialog = useRef(null)
  const request = useRef(0)
  const imageUrl = useRef('')
  const [image, setImage] = useState(null)
  const [preparing, setPreparing] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showDownload, setShowDownload] = useState(false)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('button')?.focus()
    const onKey = event => {
      if (event.key === 'Escape') dialog.current?.querySelector('button')?.click()
      if (event.key !== 'Tab') return
      const elements = [...dialog.current.querySelectorAll('button:not(:disabled), iframe')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      request.current += 1
      URL.revokeObjectURL(imageUrl.current)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  const prepareImage = async () => {
    const currentRequest = ++request.current
    setPreparing(true)
    setImage(null)
    setError('')
    try {
      const receiptDocument = frame.current?.contentDocument
      const receipt = receiptDocument?.querySelector('.receipt')
      if (!receipt) throw new Error('Não foi possível localizar o documento do recibo.')
      await receiptDocument.fonts?.ready
      await Promise.all([...receipt.querySelectorAll('img')].map(async image => {
        await image.decode()
        if (!image.naturalWidth) throw new Error('A logo não foi carregada. Abra o recibo novamente.')
      }))
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(receipt, {
        scale: 2,
        windowWidth: 900,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        onclone: clonedDocument => {
          const clonedReceipt = clonedDocument.querySelector('.receipt')
          if (!clonedReceipt || clonedReceipt.getBoundingClientRect().height > 3750) throw new Error('Este recibo é muito longo para uma imagem legível neste aparelho. Use Imprimir recibo para salvar em PDF.')
        },
      })
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível gerar o PNG. Tente novamente.')), 'image/png'))
      if (currentRequest !== request.current) return
      const number = receiptDocument.querySelector('.receipt-badge .meta div')?.textContent?.replace(/^No:\s*/i, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'venda'
      const file = new File([blob], `recibo-jn-${number}.png`, { type: 'image/png' })
      URL.revokeObjectURL(imageUrl.current)
      imageUrl.current = URL.createObjectURL(file)
      setImage(file)
    } catch (error) {
      if (currentRequest === request.current) setError(error.message || 'Não foi possível gerar a imagem. Use Imprimir recibo ou tente novamente.')
    } finally {
      if (currentRequest === request.current) setPreparing(false)
    }
  }

  const downloadImage = () => {
    if (!image || !imageUrl.current) return
    const link = document.createElement('a')
    link.href = imageUrl.current
    link.download = image.name
    document.body.append(link)
    link.click()
    link.remove()
    setMessage('Imagem PNG baixada. Abra o WhatsApp e envie o arquivo como foto ou documento.')
  }

  const saveImage = () => {
    if (!image || sharing) return
    setError('')
    let canShare = false
    try { canShare = Boolean(navigator.share && navigator.canShare?.({ files: [image] })) } catch { canShare = false }
    if (!canShare) { downloadImage(); return }
    setSharing(true)
    setShowDownload(true)
    try {
      const operation = navigator.share({ files: [image] })
      Promise.resolve(operation).then(() => setMessage('Imagem enviada para o aplicativo escolhido.'), error => {
        if (error.name === 'AbortError') setMessage('Compartilhamento cancelado. Você pode tentar novamente ou baixar a imagem e enviar pelo WhatsApp.')
        else setMessage('Não foi possível compartilhar neste navegador. Baixe a imagem e envie pelo WhatsApp.')
      }).finally(() => setSharing(false))
    } catch {
      setSharing(false)
      setMessage('Não foi possível compartilhar neste navegador. Baixe a imagem e envie pelo WhatsApp.')
    }
  }

  return <div className="sale-receipt-overlay" role="dialog" aria-modal="true" aria-label="Recibo da venda" ref={dialog}>
    <div className="sale-receipt-controls" data-receipt-controls>
      <div className="sale-receipt-toolbar">
        <button type="button" className="sales-secondary-button" onClick={onClose}><ArrowLeft size={22} aria-hidden="true" />Voltar</button>
        <div className="sale-receipt-actions">
          <button type="button" className="sales-primary-button" onClick={saveImage} disabled={!image || preparing || sharing} aria-busy={preparing || sharing}><ImageDown size={22} aria-hidden="true" />Salvar imagem</button>
          {showDownload && image ? <button type="button" className="sales-secondary-button" onClick={downloadImage}><Download size={22} aria-hidden="true" />Baixar imagem</button> : null}
          <button type="button" className="sales-secondary-button" title="Imprimir ou salvar em PDF" onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() }}><Printer size={22} aria-hidden="true" />Imprimir recibo</button>
        </div>
      </div>
      {preparing ? <p className="sale-receipt-message" role="status">Preparando imagem…</p> : null}
      {message ? <p className="sale-receipt-message" role="status">{message}</p> : null}
      {error ? <div className="sale-receipt-message" role="alert"><p>{error}</p><button type="button" className="sales-secondary-button" onClick={prepareImage}>Tentar gerar imagem novamente</button></div> : null}
    </div>
    <iframe title="Documento do recibo" ref={frame} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={prepareImage} />
  </div>
}