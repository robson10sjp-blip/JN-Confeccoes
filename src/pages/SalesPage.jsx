import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  createSaleByUser,
  deleteSaleByUser,
  getSaleReceiptDataByUser,
  registerSalePaymentByUser,
  subscribeSalesModuleSource,
  updateSaleByUser,
} from '../services/salesService'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import receiptLogo from '../assets/logo.png'
import SaleReceiptViewer from '../components/SaleReceiptViewer'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { prepareSaleDeletionByUser } from '../services/saleDeletionService'
import { isSaleCancelled, SALE_CANCELLATION_LABEL } from '../utils/saleDeletion'
import { displayText } from '../utils/displayText'
import { formatRecordDate, recordNumber, toDateKey } from '../utils/recordFilters'
import { buildDashboardSummary, getDashboardPeriod } from '../utils/dashboardSummary'
import { buildSaleDueDates, buildSalesView, normalizeSalesText, saleRecordedPayments } from '../utils/salesRecords'
import { parseProductPrice, productDescription, productStock } from '../utils/productRecords'
import { ArrowLeft, BadgeDollarSign, Banknote, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Eye, Pencil, Plus, Printer, RefreshCw, RotateCcw, Search, ShoppingBag, Trash2, Wallet, X } from 'lucide-react'
import '../styles/sales-page.css'

const PAYMENT_OPTIONS = ['À Vista', 'Prazo']

const SALE_INITIAL_FORM = {
  clientId: '',
  saleDate: toDateKey(new Date()),
  paymentMethod: 'À Vista',
  installments: '1',
  firstDueDate: '',
  items: [],
  initialPaidAmount: '0',
  initialPaymentDate: toDateKey(new Date()),
}

const RECEIVE_INITIAL_FORM = {
  amount: '',
  paymentDate: toDateKey(new Date()),
}

function createEmptyItem() {
  return {
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productId: '',
    quantity: '1',
    unitPrice: '0',
    discount: '0',
  }
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function getSaleItemSubtotal(item) {
  const quantity = parseNumber(item.quantity)
  const unitPrice = parseProductPrice(item.unitPrice)
  const discount = parseProductPrice(item.discount || '0')
  if (unitPrice === null || discount === null) return NaN
  return quantity * unitPrice - discount
}

function formatCurrency(value) {
  const amount = recordNumber(value)
  if (amount === null) return 'Não informado'

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)
}

function buildDueDates(installmentsValue, firstDueDateValue, totalAmount) {
  return buildSaleDueDates(installmentsValue, firstDueDateValue, totalAmount)
}

function mapSaleToForm(sale) {
  return {
    clientId: sale?.clientId || '',
    saleDate: toDateKey(sale?.saleDate),
    paymentMethod: sale?.paymentMethod || 'À Vista',
    installments: String(sale?.installments || 1),
    firstDueDate: toDateKey(sale?.firstDueDate),
    items: (Array.isArray(sale?.items) ? sale.items : []).map((item) => ({
      localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: item.productId || item.id || item.product?.id || '',
      productCode: item.productCode,
      productDescription: item.productDescription,
      quantity: String(item.quantity || 0),
      unitPrice: String(item.unitPrice || 0),
      discount: String(item.discount || 0),
    })),
  }
}

function SalesPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeItem, setActiveItem] = useState('vendas')
  const [sales, setSales] = useState([])
  const [clients, setClients] = useState([])
  const [products, setProducts] = useState([])
  const [receivables, setReceivables] = useState([])
  const [payments, setPayments] = useState([])
  const [isLoadingData, setLoadingData] = useState(true)
  const [loadedUid, setLoadedUid] = useState('')
  const [sourceErrors, setSourceErrors] = useState({})
  const [retry, setRetry] = useState(0)
  const [period, setPeriod] = useState('all')
  const [dates, setDates] = useState({ from: '', to: '' })
  const [clientSearch, setClientSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [reviewSale, setReviewSale] = useState(false)
  const [page, setPage] = useState(1)
  const requests = useRef({ sale: '', payment: '' })
  const dialogRef = useRef(null)
  const [deletion, setDeletion] = useState({ status: 'idle', preview: null, error: '' })
  const [deletingSale, setDeletingSale] = useState(false)
  const deletionRunning = useRef(false)
  const deletionRequest = useRef(0)
  const [receiptHtml, setReceiptHtml] = useState('')
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [submittingSale, setSubmittingSale] = useState(false)
  const [receivingSaleId, setReceivingSaleId] = useState('')
  const [filters, setFilters] = useState({
    client: '',
    saleFrom: '',
    saleTo: '',
    dueFrom: '',
    dueTo: '',
    status: '',
  })
  const [modalState, setModalState] = useState({ type: '', saleId: '' })
  const [saleForm, setSaleForm] = useState(SALE_INITIAL_FORM)
  const [receiveForm, setReceiveForm] = useState(RECEIVE_INITIAL_FORM)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'
  const loadingData = isLoadingData || loadedUid !== user?.uid
  const loadFailed = Object.values(sourceErrors).some(Boolean)
  const range = getDashboardPeriod(period, dates)
  const invalidRange = Boolean(period === 'custom' && (!dates.from || !dates.to || dates.from > dates.to) || filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo)
  const salesView = buildSalesView(sales, clients, receivables, payments, filters, range)
  const filteredSales = salesView.rows
  const diagnostics = buildDashboardSummary({ sales, receivables, payments })
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / 20))
  const currentPage = Math.min(page, totalPages)
  const listedSales = filteredSales.slice((currentPage - 1) * 20, currentPage * 20)
  const selectableClients = clients.filter(client => [client.name, client.nickname].some(value => normalizeSalesText(value).includes(normalizeSalesText(clientSearch))) || client.id === saleForm.clientId)
  const selectableProducts = products.filter(product => [product.description, product.name, product.code].some(value => normalizeSalesText(value).includes(normalizeSalesText(productSearch))))

  const productsById = useMemo(
    () =>
      products.reduce((accumulator, product) => {
        accumulator[product.id] = product
        return accumulator
      }, {}),
    [products],
  )

  const salesById = useMemo(
    () =>
      sales.reduce((accumulator, sale) => {
        accumulator[sale.id] = sale
        return accumulator
      }, {}),
    [sales],
  )

  const currentSale = loadedUid === user?.uid && modalState.saleId ? salesById[modalState.saleId] : null
  const currentSaleDisplay = currentSale ? salesView.allRows.find(sale => sale.id === currentSale.id) : null
  const currentPayments = currentSale ? saleRecordedPayments(currentSale, payments, receivables) : []

  const saleItemsWithSubtotal = useMemo(
    () =>
      saleForm.items.map((item) => ({
        ...item,
        subtotal: getSaleItemSubtotal(item),
      })),
    [saleForm.items],
  )

  const totals = useMemo(() => {
    const totalDiscount = saleItemsWithSubtotal.reduce((acc, item) => acc + (parseProductPrice(item.discount || '0') ?? NaN), 0)
    const totalAmount = saleItemsWithSubtotal.reduce((acc, item) => acc + item.subtotal, 0)

    return {
      totalDiscount,
      totalAmount,
    }
  }, [saleItemsWithSubtotal])

  useEffect(() => {
    let active = true
    const finished = new Set()
    const unsubscribes = []
    setLoadedUid(user?.uid || '')
    setLoadingData(true)
    setErrorMessage('')
    setSourceErrors({})
    setSales([])
    setClients([])
    setReceivables([])
    setProducts([])
    setPayments([])
    setModalState({ type: '', saleId: '' })
    setReceiptHtml('')
    deletionRequest.current += 1
    if (!user?.uid) { setLoadingData(false); return () => { active = false } }
    const setters = { sales: setSales, clients: setClients, products: setProducts, receivables: setReceivables, payments: setPayments }
    for (const [source, setData] of Object.entries(setters)) {
      const onError = error => {
        if (!active) return
        console.error(`Falha na leitura de ${source} em Vendas:`, error?.code || 'unknown')
        setData([])
        setSourceErrors(previous => ({ ...previous, [source]: getFirebaseErrorMessage(error, 'Não foi possível carregar os dados de vendas') }))
        finished.add(source)
        setLoadingData(finished.size < 5)
      }
      try {
        unsubscribes.push(subscribeSalesModuleSource(user.uid, source, (entries, confirmed) => {
          if (!active) return
          setData(entries)
          setSourceErrors(previous => ({ ...previous, [source]: '' }))
          if (confirmed) finished.add(source)
          else finished.delete(source)
          setLoadingData(finished.size < 5)
        }, onError))
      } catch (error) { onError(error) }
    }
    return () => { active = false; unsubscribes.forEach(unsubscribe => unsubscribe()) }
  }, [user?.uid, retry])

  useEffect(() => {
    if (!modalState.type || !dialogRef.current) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog.querySelector('input, button')?.focus()
    const handleKeys = event => {
      if (event.key !== 'Tab') return
      const elements = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
    dialog.addEventListener('keydown', handleKeys)
    return () => { document.body.style.overflow = previousOverflow; dialog.removeEventListener('keydown', handleKeys); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [modalState.type])

  const resetSaleModal = () => {
    if (submittingSale || receivingSaleId) return
    setSaleForm({ ...SALE_INITIAL_FORM, items: [createEmptyItem()] })
    setModalState({ type: '', saleId: '' })
  }

  const openCreateSaleModal = () => {
    setErrorMessage('')
    setSuccessMessage('')
    setSaleForm({ ...SALE_INITIAL_FORM, saleDate: toDateKey(new Date()), initialPaymentDate: toDateKey(new Date()), items: [createEmptyItem()] })
    requests.current.sale = crypto.randomUUID()
    setReviewSale(false)
    setClientSearch('')
    setProductSearch('')
    setModalState({ type: 'create', saleId: '' })
  }

  useEffect(() => {
    if (location.state?.dashboardAction !== 'new-sale') return
    openCreateSaleModal()
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
  }, [location.key, location.state?.dashboardAction, location.pathname, location.search, location.hash, navigate])

  const openEditSaleModal = (sale) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSaleForm(mapSaleToForm(sale))
    setReviewSale(false)
    setClientSearch('')
    setProductSearch('')
    setModalState({ type: 'edit', saleId: sale.id })
  }

  const openViewSaleModal = (sale) => {
    setErrorMessage('')
    setModalState({ type: 'view', saleId: sale.id })
  }

  const openDeleteSaleModal = async sale => {
    if (deletionRunning.current || !sale?.id || isSaleCancelled(sale)) return
    const requestId = ++deletionRequest.current
    setErrorMessage('')
    setDeletion({ status: 'loading', preview: null, error: '' })
    setModalState({ type: 'delete', saleId: sale.id })
    try {
      const preview = await prepareSaleDeletionByUser(user.uid, sale.id)
      if (requestId !== deletionRequest.current) return
      setDeletion({ status: 'ready', preview, error: '' })
    } catch (error) {
      if (requestId !== deletionRequest.current) return
      setDeletion({ status: 'error', preview: null, error: error?.code ? getFirebaseErrorMessage(error, 'Não foi possível conferir a exclusão') : error?.message || 'Não foi possível conferir a exclusão.' })
    }
  }

  const confirmDeleteSale = async () => {
    if (deletionRunning.current || deletion.status !== 'ready' || !deletion.preview || deletion.preview.saleId !== modalState.saleId) return
    deletionRunning.current = true
    setDeletingSale(true)
    setErrorMessage('')
    try {
      const result = await deleteSaleByUser(user.uid, deletion.preview.saleId, deletion.preview)
      setSuccessMessage(result.alreadyCancelled ? 'A venda já estava excluída. Nenhuma quantidade foi devolvida novamente.' : `Venda excluída das movimentações atuais. ${result.returnedUnits} unidade(s) devolvida(s). Contas e pagamentos vinculados foram cancelados, com histórico preservado.${result.stockNeedsReview ? ' Estoque antigo precisa de conferência; nenhuma quantidade sem prova foi inventada.' : ''}`)
      setModalState({ type: '', saleId: '' })
    } catch (error) {
      setErrorMessage(error?.code ? getFirebaseErrorMessage(error, 'Não foi possível excluir a venda') : error?.message || 'Não foi possível excluir a venda.')
    } finally { deletionRunning.current = false; setDeletingSale(false) }
  }

  useEffect(() => {
    const saleId = location.state?.financialSaleId
    if (!saleId || loadingData || loadFailed) return
    const sale = sales.find(entry => entry.id === saleId)
    if (sale) openViewSaleModal(sale)
    else setErrorMessage('A venda informada pelo Financeiro não foi localizada neste usuário. Nenhum registro foi alterado.')
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
  }, [location.state?.financialSaleId, loadingData, loadFailed, sales, navigate, location.pathname, location.search, location.hash])

  const openReceiveModal = (sale) => {
    setErrorMessage('')
    requests.current.payment = crypto.randomUUID()
    setReceiveForm({ ...RECEIVE_INITIAL_FORM, paymentDate: toDateKey(new Date()) })
    setModalState({ type: 'receive', saleId: sale.id })
  }

  const handleAddSaleItem = () => {
    setReviewSale(false)
    setSaleForm((previous) => ({
      ...previous,
      items: [...previous.items, createEmptyItem()],
    }))
  }

  const handleRemoveSaleItem = (localId) => {
    setReviewSale(false)
    setSaleForm((previous) => {
      const nextItems = previous.items.filter((item) => item.localId !== localId)
      return {
        ...previous,
        items: nextItems.length > 0 ? nextItems : [createEmptyItem()],
      }
    })
  }

  const handleSaleInputChange = (event) => {
    setReviewSale(false)
    setErrorMessage('')
    const { name, value } = event.target
    setSaleForm((previous) => ({
      ...previous,
      [name]: value,
    }))
  }

  const handleSaleItemChange = (localId, field, value) => {
    setReviewSale(false)
    setErrorMessage('')
    setSaleForm((previous) => ({
      ...previous,
      items: previous.items.map((item) => {
        if (item.localId !== localId) {
          return item
        }

        if (field === 'productId') {
          const selectedProduct = productsById[value]
          return {
            ...item,
            productId: value,
            productCode: selectedProduct?.code || '',
            productDescription: selectedProduct ? productDescription(selectedProduct) : '',
            unitPrice: selectedProduct ? String(selectedProduct.salePrice || 0) : '0',
          }
        }

        return {
          ...item,
          [field]: value,
        }
      }),
    }))
  }

  const validateSaleForm = () => {
    if (!saleForm.clientId) {
      return 'Selecione um cliente para a venda.'
    }

    if (!saleForm.saleDate || toDateKey(saleForm.saleDate) !== saleForm.saleDate) {
      return 'Informe a data da venda.'
    }

    if (!saleForm.items?.length) {
      return 'Adicione ao menos um produto na venda.'
    }

    const originalItemsByProduct = new Map()

    if (modalState.type === 'edit' && Array.isArray(currentSale?.items)) {
      for (const existingItem of currentSale.items) {
        const productId = existingItem.productId || existingItem.id || existingItem.product?.id || ''
        const previousValue = originalItemsByProduct.get(productId) || 0
        originalItemsByProduct.set(productId, previousValue + parseNumber(existingItem.quantity))
      }
    }

    for (const item of saleItemsWithSubtotal) {
      if (!item.productId) {
        return 'Selecione todos os produtos da venda.'
      }

      const quantity = Number(item.quantity)
      const unitPrice = parseProductPrice(item.unitPrice)
      const discount = parseProductPrice(item.discount || '0')

      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return 'Informe uma quantidade inteira maior que zero.'
      }

      if (unitPrice === null || discount === null || !Number.isFinite(item.subtotal) || item.subtotal < 0) {
        return 'Confira preços e descontos. Use valores válidos, iguais ou maiores que zero.'
      }

      const selectedProduct = productsById[item.productId]
      const previousQuantity = originalItemsByProduct.get(item.productId) || 0
      const requestedQuantity = saleForm.items.filter(entry => entry.productId === item.productId).reduce((sum, entry) => sum + Number(entry.quantity), 0)
      if (modalState.type === 'edit' && requestedQuantity === previousQuantity) continue
      if (!selectedProduct) {
        return 'Um dos produtos selecionados não existe mais.'
      }

      const stock = productStock(selectedProduct)
      if (stock === null) return 'O estoque de um dos produtos precisa de conferência antes da venda.'
      const availableStock = stock + previousQuantity

      if (requestedQuantity > availableStock) {
        return `Estoque insuficiente para o produto ${selectedProduct.description}.`
      }
    }

    if (saleForm.paymentMethod === 'Prazo') {
      if (!Number.isSafeInteger(Number(saleForm.installments)) || Number(saleForm.installments) <= 0) {
        return 'Informe a quantidade de parcelas.'
      }

      if (!saleForm.firstDueDate) {
        return 'Informe a data do primeiro vencimento.'
      }
    }
    if (modalState.type === 'create' && saleForm.paymentMethod === 'Prazo') {
      const initial = parseProductPrice(saleForm.initialPaidAmount || '0')
      if (initial === null || initial > totals.totalAmount) return 'Confira o pagamento inicial: ele não pode ser negativo nem maior que o total.'
      if (initial > 0 && toDateKey(saleForm.initialPaymentDate) !== saleForm.initialPaymentDate) return 'Informe a data do pagamento inicial.'
    }

    return ''
  }

  const buildSalePayload = () => {
    const selectedClient = clients.find((client) => client.id === saleForm.clientId)

    const items = saleItemsWithSubtotal.map((item) => {
      const selectedProduct = productsById[item.productId]

      return {
        productId: item.productId,
        productCode: item.productCode ?? selectedProduct?.code ?? '',
        productDescription: item.productDescription ?? (selectedProduct ? productDescription(selectedProduct) : ''),
        quantity: parseNumber(item.quantity),
        unitPrice: parseProductPrice(item.unitPrice),
        discount: parseProductPrice(item.discount || '0'),
      }
    })

    const payload = {
      clientId: saleForm.clientId,
      clientName: selectedClient?.name || '',
      saleDate: saleForm.saleDate,
      paymentMethod: saleForm.paymentMethod,
      items,
    }

    if (saleForm.paymentMethod === 'Prazo') {
      payload.installments = parseNumber(saleForm.installments, 1)
      payload.firstDueDate = saleForm.firstDueDate
      payload.dueDates = modalState.type === 'edit' && Array.isArray(currentSale?.dueDates) ? currentSale.dueDates.map(entry => ({ ...entry, dueDate: toDateKey(entry.dueDate), amount: Number(entry.amount) })) : buildDueDates(payload.installments, payload.firstDueDate, totals.totalAmount)
      if (modalState.type === 'create') {
        payload.initialPaidAmount = parseProductPrice(saleForm.initialPaidAmount || '0')
        payload.initialPaymentDate = saleForm.initialPaymentDate
      }
    }

    return payload
  }

  const handleSubmitSale = async (event) => {
    event.preventDefault()
    if (submittingSale || loadingData || loadFailed) return

    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    const validationError = validateSaleForm()

    if (validationError) {
      setErrorMessage(validationError)
      return
    }
    if (!reviewSale) { setReviewSale(true); setErrorMessage(''); return }

    try {
      setSubmittingSale(true)
      setErrorMessage('')
      const payload = buildSalePayload()

      if (modalState.type === 'create') {
        await createSaleByUser(user.uid, payload, requests.current.sale || (requests.current.sale = crypto.randomUUID()))
        setSuccessMessage('Venda registrada com sucesso.')
      }

      if (modalState.type === 'edit' && modalState.saleId) {
        await updateSaleByUser(user.uid, modalState.saleId, payload)
        setSuccessMessage('Venda atualizada com sucesso.')
      }

      setModalState({ type: '', saleId: '' })
      setSaleForm({ ...SALE_INITIAL_FORM, items: [] })
      setReviewSale(false)
    } catch (error) {
      console.error('Erro ao salvar venda:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível salvar a venda'))
    } finally {
      setSubmittingSale(false)
    }
  }

  const handleSubmitReceive = async (event) => {
    event.preventDefault()
    if (receivingSaleId) return

    if (!user?.uid || !modalState.saleId || !currentSale) {
      setErrorMessage('Não foi possível identificar a venda selecionada.')
      return
    }

    const rawAmount = String(receiveForm.amount ?? '').trim()
    const amount = parseNumber(rawAmount)
    const totalAmount = parseNumber(currentSale?.totalAmount)
    const paidAmount = parseNumber(currentSale?.paidAmount ?? currentSale?.amountPaid)
    const remainingAmount = Math.max(0, totalAmount - paidAmount)
    const paymentDate = String(receiveForm.paymentDate ?? '').trim()

    if (!rawAmount) {
      console.error('[sales/receive] Campo invalido:', {
        field: 'amount',
        rawAmount,
      })
      setErrorMessage('Informe um valor válido para recebimento.')
      return
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      console.error('[sales/receive] Campo invalido:', {
        field: 'amount',
        rawAmount,
        amount,
      })
      setErrorMessage('Informe um valor válido para recebimento.')
      return
    }

    if (amount > remainingAmount) {
      console.error('[sales/receive] Campo invalido:', {
        field: 'amount',
        amount,
        remainingAmount,
      })
      setErrorMessage('O valor informado ultrapassa o saldo da venda.')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      console.error('[sales/receive] Campo invalido:', {
        field: 'paymentDate',
        paymentDate,
      })
      setErrorMessage('Informe uma data de recebimento válida.')
      return
    }

    const parsedPaymentDate = new Date(`${paymentDate}T12:00:00`)

    if (Number.isNaN(parsedPaymentDate.getTime())) {
      console.error('[sales/receive] Campo invalido:', {
        field: 'paymentDate',
        paymentDate,
      })
      setErrorMessage('Informe uma data de recebimento válida.')
      return
    }

    try {
      setReceivingSaleId(modalState.saleId)
      setErrorMessage('')

      await registerSalePaymentByUser(
        user.uid,
        modalState.saleId,
        amount,
        paymentDate,
        requests.current.payment || (requests.current.payment = crypto.randomUUID()),
      )

      setSuccessMessage('Pagamento registrado com sucesso.')
      setModalState({ type: '', saleId: '' })
    } catch (error) {
      console.error('Erro ao registrar recebimento:', {
        error,
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        field: error?.field,
        amount,
        paymentDate,
        saleId: modalState.saleId,
      })
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível registrar o recebimento'))
    } finally {
      setReceivingSaleId('')
    }
  }

  const handleOpenReceipt = async (sale) => {
    if (loadingReceipt) return
    if (!user?.uid || !sale?.id) {
      setErrorMessage('Não foi possível identificar a venda para gerar o recibo.')
      return
    }

    let latestSale = sale
    let paymentsHistory = []

    try {
      setLoadingReceipt(true)
      const receiptData = await getSaleReceiptDataByUser(user.uid, sale.id)
      latestSale = receiptData.sale
      paymentsHistory = receiptData.payments || []
    } catch (error) {
      console.error('Erro ao carregar dados atualizados do recibo:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível carregar os dados do recibo'))
      setLoadingReceipt(false)
      return
    }

    const receiptNumber = latestSale?.id ? String(latestSale.id).toUpperCase() : '-'
    const saleDate = formatRecordDate(latestSale?.saleDate)
    const formatAnyDate = formatRecordDate

    const totalValue = parseNumber(latestSale?.totalAmount ?? latestSale?.total)
    const amountPaid = parseNumber(latestSale?.amountPaid ?? latestSale?.paidAmount)
    const remainingAmount = isSaleCancelled(latestSale) ? 0 : Math.max(
      0,
      parseNumber(latestSale?.remainingAmount, totalValue - amountPaid),
    )
    const saleStatus = isSaleCancelled(latestSale) ? SALE_CANCELLATION_LABEL : latestSale?.status || (remainingAmount <= 0 ? 'Pago' : amountPaid > 0 ? 'Parcial' : 'Pendente')
    const salePaymentsHistory = Array.isArray(latestSale?.payments) ? latestSale.payments : []
    const normalizedPaymentsHistory = paymentsHistory.length > 0 ? paymentsHistory : salePaymentsHistory
    const lastPaymentDate =
      normalizedPaymentsHistory[0]?.paymentDate
      || latestSale?.lastPaymentDate
      || latestSale?.paymentDate
      || latestSale?.updatedAt
      || ''

    const paymentsHistoryRows =
      normalizedPaymentsHistory.length > 0
        ? normalizedPaymentsHistory
            .map(
              (payment) =>
                `<tr>
                  <td data-label="Data do recebimento">${formatAnyDate(payment.paymentDate)}</td>
                  <td data-label="Valor">${formatCurrency(payment.amount)}</td>
                  <td data-label="Forma">${payment.paymentMethod || '-'}</td>
                  <td data-label="Observação">${payment.observation || '-'}</td>
                </tr>`,
            )
            .join('')
        : '<tr><td colspan="4" class="empty-row">Nenhum recebimento registrado.</td></tr>'

    const generatedReceiptHtml = `
      <html>
        <head>
          <title>Recibo de Venda</title>
          <style>
            @page {
              size: A4;
              margin: 14mm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: #f3f4f6;
              color: #111827;
              padding: 18px;
            }

            .receipt {
              width: 100%;
              max-width: 794px;
              margin: 0 auto;
              background: #ffffff;
              border: 1px solid #e5e7eb;
              border-radius: 18px;
              box-shadow: 0 16px 40px rgba(17, 24, 39, 0.12);
              overflow: hidden;
              position: relative;
            }

            .watermark {
              position: absolute;
              inset: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              pointer-events: none;
              opacity: 0.04;
            }

            .watermark img {
              width: 360px;
              max-width: 80%;
            }

            .receipt-content {
              position: relative;
              z-index: 1;
              padding: 28px;
            }

            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 16px;
              border-bottom: 1px solid #d1d5db;
              padding-bottom: 16px;
            }

            .brand {
              display: flex;
              align-items: center;
              gap: 12px;
            }

            .brand img {
              width: 68px;
              height: 68px;
              object-fit: contain;
              border-radius: 12px;
              border: 1px solid #e5e7eb;
              padding: 6px;
              background: #ffffff;
            }

            .brand h2 {
              margin: 0;
              font-size: 22px;
              letter-spacing: 0.4px;
              color: #111111;
            }

            .brand p {
              margin: 4px 0 0;
              color: #4b5563;
              font-size: 13px;
            }

            .receipt-badge {
              background: #111111;
              color: #ffffff;
              padding: 10px 14px;
              border-radius: 12px;
              text-align: right;
              min-width: 190px;
            }

            .receipt-badge .title {
              margin: 0;
              font-size: 24px;
              font-weight: 800;
              letter-spacing: 2px;
            }

            .receipt-badge .meta {
              margin-top: 6px;
              font-size: 12px;
              line-height: 1.5;
              color: #e5e7eb;
            }

            .sections {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 14px;
              margin-top: 18px;
            }

            .card {
              border: 1px solid #e5e7eb;
              background: linear-gradient(180deg, #ffffff, #f9fafb);
              border-radius: 14px;
              padding: 14px;
              box-shadow: 0 6px 16px rgba(17, 24, 39, 0.06);
            }

            .card h3 {
              margin: 0 0 10px;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #374151;
            }

            .detail-line {
              margin: 6px 0;
              font-size: 14px;
              color: #1f2937;
            }

            .detail-line strong {
              color: #111111;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
              font-size: 13px;
              border-radius: 12px;
              overflow: hidden;
            }

            thead tr {
              background: #111111;
              color: #ffffff;
            }

            th,
            td {
              border: 1px solid #e5e7eb;
              padding: 10px;
              text-align: left;
            }

            tbody tr:nth-child(even) {
              background: #f9fafb;
            }

            .empty-row {
              text-align: center;
              color: #6b7280;
              padding: 18px;
            }

            .totals-and-pix {
              display: grid;
              grid-template-columns: 1.2fr 1fr;
              gap: 14px;
              margin-top: 18px;
            }

            .totals-card,
            .pix-card,
            .notes-card {
              border: 1px solid #e5e7eb;
              border-radius: 14px;
              padding: 14px;
              background: #ffffff;
              box-shadow: 0 6px 16px rgba(17, 24, 39, 0.06);
            }

            .totals-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 8px 0;
              border-bottom: 1px dashed #d1d5db;
              color: #374151;
              font-size: 14px;
            }

            .totals-row:last-child {
              border-bottom: 0;
              padding-bottom: 0;
            }

            .total-highlight {
              color: #111111;
              font-size: 18px;
              font-weight: 800;
            }

            .pix-title {
              margin: 0 0 8px;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #374151;
            }

            .pix-key {
              border: 1px dashed #9ca3af;
              border-radius: 12px;
              padding: 12px;
              font-weight: 700;
              font-size: 20px;
              text-align: center;
              color: #111111;
              background: #f9fafb;
              margin: 8px 0;
            }

            .pix-info {
              margin: 0;
              color: #4b5563;
              font-size: 12px;
              line-height: 1.5;
            }

            .notes-card {
              margin-top: 14px;
            }

            .notes-card h3 {
              margin: 0 0 8px;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #374151;
            }

            .notes-card p {
              margin: 0;
              color: #374151;
              line-height: 1.6;
              font-size: 13px;
            }

            .footer {
              margin-top: 20px;
              border-top: 1px solid #d1d5db;
              padding-top: 14px;
              text-align: center;
              color: #111111;
              font-size: 13px;
              line-height: 1.8;
            }

            @media print {
              body {
                background: #ffffff;
                padding: 0;
              }

              .receipt {
                border: 0;
                border-radius: 0;
                box-shadow: none;
                max-width: none;
              }

              .receipt-content {
                padding: 8mm;
              }
            }

            @media screen and (max-width: 768px) {
              .receipt-content {
                padding: 20px;
              }

              .header,
              .totals-and-pix,
              .sections {
                grid-template-columns: 1fr;
                display: grid;
              }

              .receipt-badge {
                text-align: left;
                min-width: 0;
                overflow-wrap: anywhere;
              }
            }

            @media screen and (max-width: 600px) {
              table, tbody, tr, td { display: block; width: 100%; }
              thead { display: none; }
              tbody tr { border: 1px solid #d1d5db; margin-bottom: 12px; }
              td:not(.empty-row) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; border: 0; border-bottom: 1px solid #e5e7eb; overflow-wrap: anywhere; }
              td:not(.empty-row)::before { content: attr(data-label); font-weight: 700; }
              .sections, .totals-and-pix { grid-template-columns: minmax(0, 1fr); }
              .brand, .brand > div, .card, .pix-card, .totals-card { min-width: 0; overflow-wrap: anywhere; }
              .pix-key { font-size: 17px; }
              .totals-row { gap: 8px; align-items: start; }
              .totals-row strong { text-align: right; }
              .receipt-content { padding: 16px; }
              body { padding: 10px; }
              .brand h2 { font-size: 20px; letter-spacing: 0; }
              .brand img { flex: 0 0 60px; width: 60px; height: 60px; }
              .brand p { overflow-wrap: anywhere; }
              .receipt-badge .title { letter-spacing: 0; }
            }
          </style>
        </head>
        <body>
          <article class="receipt">
            <div class="watermark">
              <img src="${receiptLogo}" alt="Marca d'água JN Confecções" />
            </div>

            <section class="receipt-content">
              <header class="header">
                <div class="brand">
                  <img src="${receiptLogo}" alt="Logo JN Confecções" />
                  <div>
                    <h2>JN Confecções</h2>
                    <p>Documento comercial de venda</p>
                  </div>
                </div>

                <div class="receipt-badge">
                  <p class="title">RECIBO</p>
                  <div class="meta">
                    <div><strong>No:</strong> ${receiptNumber}</div>
                    <div><strong>Data:</strong> ${saleDate}</div>
                  </div>
                </div>
              </header>

              <div class="sections">
                <section class="card">
                  <h3>Dados do cliente</h3>
                  <p class="detail-line"><strong>Cliente:</strong> ${latestSale.clientName || '-'}</p>
                </section>

                <section class="card">
                  <h3>Condição de pagamento</h3>
                  <p class="detail-line"><strong>Condição:</strong> ${latestSale.paymentMethod || '-'}</p>
                  <p class="detail-line"><strong>Status:</strong> ${saleStatus}</p>
                  <p class="detail-line"><strong>Último recebimento:</strong> ${formatAnyDate(lastPaymentDate)}</p>
                </section>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Qtd</th>
                    <th>Unitário</th>
                    <th>Desconto</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${(Array.isArray(latestSale.items) ? latestSale.items : [])
                    .map(
                      (item) =>
                        `<tr>
                          <td data-label="Produto">${item.productDescription || '-'}</td>
                          <td data-label="Quantidade">${item.quantity || 0}</td>
                          <td data-label="Unitário">${formatCurrency(item.unitPrice)}</td>
                          <td data-label="Desconto">${formatCurrency(item.discount)}</td>
                          <td data-label="Subtotal">${formatCurrency(item.subtotal)}</td>
                        </tr>`,
                    )
                    .join('') || '<tr><td colspan="5" class="empty-row">Nenhum produto informado.</td></tr>'}
                </tbody>
              </table>

              <section class="totals-and-pix">
                <div class="totals-card">
                  <div class="totals-row">
                    <span>Total de descontos</span>
                    <strong>${formatCurrency(latestSale.totalDiscount)}</strong>
                  </div>
                  <div class="totals-row">
                    <span>Valor total da venda</span>
                    <strong>${formatCurrency(totalValue)}</strong>
                  </div>
                  <div class="totals-row">
                    <span>Valor recebido acumulado</span>
                    <strong>${formatCurrency(amountPaid)}</strong>
                  </div>
                  <div class="totals-row">
                    <span>Saldo a receber</span>
                    <strong class="total-highlight">${formatCurrency(remainingAmount)}</strong>
                  </div>
                </div>

                <div class="pix-card">
                  <p class="pix-title">Pagamento via PIX</p>
                  <div class="pix-key">49.185.965/0001-95</div>
                  <p class="pix-info">Chave PIX (CNPJ): 49.185.965/0001-95</p>
                </div>
              </section>

              <section class="notes-card">
                <h3>Observações</h3>
                <p>Recibo emitido pela JN Confecções referente ao fornecimento dos itens listados acima.</p>
              </section>

              <table>
                <thead>
                  <tr>
                    <th>Data do recebimento</th>
                    <th>Valor</th>
                    <th>Forma</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  ${paymentsHistoryRows}
                </tbody>
              </table>

              <footer class="footer">
                <div>CNPJ: 49.185.965/0001-95</div>
                <div>JN Confecções</div>
                <div>Qualidade você encontra aqui!</div>
              </footer>
            </section>
          </article>
        </body>
      </html>
    `

    setReceiptHtml(generatedReceiptHtml)
    setLoadingReceipt(false)
  }

  const handleSelectMenuItem = (itemKey) => {
    const menuItem = sidebarMenuItems.find((item) => item.key === itemKey)

    if (!menuItem?.enabled || !menuItem.path) {
      return
    }

    setActiveItem(itemKey)
    navigate(menuItem.path)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const metricValue = (value, incomplete = false, money = true) => loadFailed ? 'Indisponível' : loadingData ? 'Carregando…' : invalidRange ? 'Escolha as datas' : incomplete ? 'Conferir dados' : money ? formatCurrency(value) : String(value)
  const clearFilters = () => { setFilters({ client: '', status: '', dueFrom: '', dueTo: '' }); setPeriod('all'); setDates({ from: '', to: '' }); setPage(1) }
  const initialPaid = modalState.type === 'edit' ? currentSaleDisplay?.received : saleForm.paymentMethod === 'À Vista' ? totals.totalAmount : parseProductPrice(saleForm.initialPaidAmount || '0')

  return (
    <DashboardLayout
      sidebarItems={sidebarMenuItems}
      activeItem={activeItem}
      onSelectItem={handleSelectMenuItem}
      userName={userName}
      onLogout={handleLogout}
    >
      <section className="sales-page">
        <header className="sales-page-header">
          <div>
            <p className="sales-brand">JN Confecções</p>
            <h1>Vendas</h1>
            <p>Consulte e registre suas vendas</p>
          </div>
          <button type="button" className="sales-primary-button" onClick={openCreateSaleModal} disabled={loadingData || loadFailed}>
            <Plus size={23} aria-hidden="true" />Nova venda
          </button>
        </header>

        <section className="sales-period" aria-label="Período da consulta"><fieldset><legend>Qual período você quer ver?</legend><div className="sales-period-options">{[['today', 'Hoje'], ['month', 'Este mês'], ['year', 'Este ano'], ['all', 'Todo o período'], ['custom', 'Escolher datas']].map(([key, label]) => <label key={key} className={period === key ? 'is-selected' : ''}><input type="radio" name="sales-period" checked={period === key} onChange={() => { setPeriod(key); setPage(1) }} /><span>{label}</span></label>)}</div></fieldset>
          {period === 'custom' ? <div className="sales-date-fields"><label>Data inicial<input type="date" lang="pt-BR" value={dates.from} onChange={event => { setDates(previous => ({ ...previous, from: event.target.value })); setPage(1) }} /></label><label>Data final<input type="date" lang="pt-BR" value={dates.to} onChange={event => { setDates(previous => ({ ...previous, to: event.target.value })); setPage(1) }} /></label>{invalidRange ? <p role="alert">Informe as duas datas, com a inicial antes ou igual à final.</p> : null}</div> : null}
          <p className="sales-period-caption" aria-live="polite"><CalendarDays size={20} aria-hidden="true" />{period === 'all' ? 'Todo o período' : invalidRange ? 'Escolha as datas' : `${formatRecordDate(range.from)} a ${formatRecordDate(range.to)}`}</p>
        </section>
        <section className="sales-filters" aria-label="Busca e situação"><label><span><Search size={20} aria-hidden="true" />Buscar cliente</span><input type="search" value={filters.client} placeholder="Nome ou como é conhecido" onChange={event => { setFilters(previous => ({ ...previous, client: event.target.value })); setPage(1) }} /></label><label>Situação<select value={filters.status} onChange={event => { setFilters(previous => ({ ...previous, status: event.target.value })); setPage(1) }}><option value="">Todas as atuais</option><option value="Em aberto">Em aberto</option><option value="Parcialmente paga">Parcialmente paga</option><option value="Paga">Paga</option><option value="Encerrada para reinício">Encerradas para reinício</option><option value={SALE_CANCELLATION_LABEL}>Excluídas (histórico)</option></select></label><button type="button" className="sales-secondary-button" onClick={clearFilters}><RotateCcw size={20} aria-hidden="true" />Limpar filtros</button></section>
        <details className="sales-due-filters"><summary>Pesquisar por vencimento</summary><div className="sales-date-fields"><label>Vencimento de<input type="date" value={filters.dueFrom} onChange={event => { setFilters(previous => ({ ...previous, dueFrom: event.target.value })); setPage(1) }} /></label><label>Vencimento até<input type="date" value={filters.dueTo} onChange={event => { setFilters(previous => ({ ...previous, dueTo: event.target.value })); setPage(1) }} /></label></div></details>
        <section className="sales-summary" aria-label="Indicadores do período">{[
          { title: 'Quantidade de vendas', icon: ShoppingBag, value: metricValue(filteredSales.length, false, false), caption: 'Data da venda, busca e situação selecionadas' },
          { title: 'Valor vendido', icon: BadgeDollarSign, value: metricValue(salesView.summary.totalSold, salesView.summary.incomplete.sold), caption: 'Valor das vendas apresentadas no período' },
          { title: 'Valor recebido', icon: Banknote, value: metricValue(salesView.summary.totalReceived, salesView.summary.incomplete.received), caption: 'Data do pagamento; pode incluir vendas antigas' },
          { title: 'Saldo a receber', icon: Wallet, value: metricValue(salesView.summary.outstanding, salesView.summary.incomplete.outstanding), caption: 'Saldo atual das vendas apresentadas' },
        ].map(metric => <article key={metric.title}><span><metric.icon size={22} aria-hidden="true" />{metric.title}</span><strong>{metric.value}</strong><p>{metric.caption}</p></article>)}</section>
        {loadFailed ? <section className="sales-message error" role="alert"><h2>Não foi possível carregar todos os dados</h2>{Object.entries(sourceErrors).filter(([, error]) => error).map(([source, error]) => <p key={source}>{error}</p>)}<button type="button" className="sales-secondary-button" onClick={() => setRetry(previous => previous + 1)}><RefreshCw size={20} aria-hidden="true" />Tentar novamente</button></section> : null}
        {!loadingData && !loadFailed && diagnostics.warnings.length ? <details className="sales-data-notes"><summary><CircleAlert size={20} aria-hidden="true" />Dados que precisam de conferência</summary><ul>{diagnostics.warnings.map(warning => <li key={warning.code}>{warning.count} {warning.message}</li>)}</ul><p>Contas e pagamentos do Financeiro não são convertidos em vendas. Vínculos antigos precisam ser conferidos pelo identificador.</p></details> : null}

        {successMessage ? <p className="sales-message success" role="status">{successMessage}</p> : null}
        {errorMessage && !modalState.type ? <p className="sales-message error" role="alert">{errorMessage}</p> : null}

        <section className="sales-list-placeholder" aria-label="Lista de vendas">
          {loadingData ? <p>Carregando vendas...</p> : null}

          {!loadingData && !loadFailed && !invalidRange && filteredSales.length === 0 ? <p>{sales.length ? 'Nenhuma venda encontrada com esses filtros.' : 'Nenhuma venda cadastrada.'}</p> : null}

          {!loadingData && !loadFailed && !invalidRange && filteredSales.length > 0 ? (
            <div className="sales-table-wrapper">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Data da venda</th>
                    <th>Cliente</th>
                    <th>Valor</th>
                    <th>Recebido na venda</th>
                    <th>Falta receber</th>
                    <th>Situação</th>
                    <th>Vencimentos</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {listedSales.map((sale) => (
                    <tr key={sale.id}>
                      <td data-label="Data da venda">{formatRecordDate(sale.saleDate)}</td>
                      <td data-label="Cliente">{displayText(sale.clientName)}{sale.nickname ? <small>{displayText(sale.nickname)}</small> : null}</td>
                      <td data-label="Valor total">{formatCurrency(sale.totalAmount)}</td>
                      <td data-label="Recebido na venda">{formatCurrency(sale.received)}</td>
                      <td data-label="Falta receber">{formatCurrency(sale.balance)}</td>
                      <td data-label="Situação">{sale.situation}{sale.displayStatus === 'Atrasado' ? <small className="sales-late">Em atraso</small> : null}</td>
                      <td data-label="Vencimentos">{sale.filterDueDates.length ? sale.filterDueDates.map(formatRecordDate).join(', ') : 'Não informado'}</td>
                      <td data-label="Ações">
                        <div className="sales-row-actions">
                          <button type="button" onClick={() => openViewSaleModal(sale)}>
                            <Eye size={20} aria-hidden="true" />Ver detalhes
                          </button>
                          <button type="button" onClick={() => openEditSaleModal(sale)} disabled={isSaleCancelled(sale)}>
                            <Pencil size={20} aria-hidden="true" />Editar
                          </button>
                          <button type="button" className="sales-delete-button" onClick={() => openDeleteSaleModal(sale)} disabled={isSaleCancelled(sale)}><Trash2 size={20} aria-hidden="true" />Excluir venda</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        {!loadingData && !loadFailed && !invalidRange && filteredSales.length ? <nav className="sales-pagination" aria-label="Páginas de vendas"><p>Mostrando {(currentPage - 1) * 20 + 1} a {Math.min(currentPage * 20, filteredSales.length)} de {filteredSales.length} vendas</p><div><button type="button" className="sales-secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={22} aria-hidden="true" />Anterior</button><span>Página {currentPage} de {totalPages}</span><button type="button" className="sales-secondary-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Próxima<ChevronRight size={22} aria-hidden="true" /></button></div></nav> : null}

        {modalState.type === 'create' || modalState.type === 'edit' ? (
          <div className="sale-modal-overlay" role="presentation">
            <section className="sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title" ref={dialogRef}>
              <header className="sale-modal-header">
                <h2 id="sale-dialog-title">{reviewSale ? 'Confira a venda' : modalState.type === 'create' ? 'Nova venda' : 'Editar venda'}</h2>
                <button type="button" className="sales-secondary-button" onClick={resetSaleModal} disabled={submittingSale}>
                  <X size={20} aria-hidden="true" />Fechar
                </button>
              </header>

              <form className="sale-form" onSubmit={handleSubmitSale} noValidate aria-busy={submittingSale}>
                <fieldset disabled={submittingSale}><legend>1. Cliente e data</legend>
                <label htmlFor="sale-client-search">Buscar cliente por nome ou apelido</label><input id="sale-client-search" type="search" value={clientSearch} onChange={event => setClientSearch(event.target.value)} />
                <label htmlFor="clientId">Cliente</label>
                <select
                  id="clientId"
                  name="clientId"
                  value={saleForm.clientId}
                  onChange={handleSaleInputChange}
                  disabled={modalState.type === 'edit'}
                >
                  <option value="">Selecione</option>
                  {saleForm.clientId && !clients.some(client => client.id === saleForm.clientId) ? <option value={saleForm.clientId}>Cliente antigo não localizado ({currentSale?.clientName || 'sem nome'})</option> : null}
                  {selectableClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}{client.nickname ? ` · ${client.nickname}` : ''}
                    </option>
                  ))}
                </select>

                <label htmlFor="saleDate">Data da venda</label>
                <input
                  id="saleDate"
                  name="saleDate"
                  type="date"
                  value={saleForm.saleDate}
                  onChange={handleSaleInputChange}
                />
                </fieldset>

                <fieldset disabled={submittingSale}><legend>2. Pagamento</legend>
                <label htmlFor="paymentMethod">Forma de pagamento</label>
                <select
                  id="paymentMethod"
                  name="paymentMethod"
                  value={saleForm.paymentMethod}
                  onChange={handleSaleInputChange}
                  disabled={modalState.type === 'edit'}
                >
                  {PAYMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                {saleForm.paymentMethod === 'Prazo' ? (
                  <>
                    <label htmlFor="installments">Quantidade de parcelas</label>
                    <input
                      id="installments"
                      name="installments"
                      type="number"
                      min="1"
                      value={saleForm.installments}
                      onChange={handleSaleInputChange}
                      disabled={modalState.type === 'edit'}
                    />

                    <label htmlFor="firstDueDate">Data do primeiro vencimento</label>
                    <input
                      id="firstDueDate"
                      name="firstDueDate"
                      type="date"
                      value={saleForm.firstDueDate}
                      onChange={handleSaleInputChange}
                      disabled={modalState.type === 'edit'}
                    />
                    {modalState.type === 'create' ? <div className="sale-initial-payment"><label htmlFor="initialPaidAmount">Pagamento inicial (opcional)</label><input id="initialPaidAmount" name="initialPaidAmount" inputMode="decimal" value={saleForm.initialPaidAmount} onChange={handleSaleInputChange} /><label htmlFor="initialPaymentDate">Data do pagamento inicial</label><input id="initialPaymentDate" name="initialPaymentDate" type="date" value={saleForm.initialPaymentDate} onChange={handleSaleInputChange} /></div> : null}
                  </>
                ) : null}
                {modalState.type === 'edit' ? <p className="sales-review-note">Pagamentos, cliente e condições financeiras anteriores serão preservados. Mudanças que exigem refazer parcelas precisam de uma revisão específica.</p> : null}
                </fieldset>

                <div className="sale-items-header">
                  <h3>3. Produtos da venda</h3>
                  <button type="button" className="sales-secondary-button" onClick={handleAddSaleItem} disabled={submittingSale}>
                    <Plus size={20} aria-hidden="true" />Adicionar produto
                  </button>
                </div>
                <label htmlFor="sale-product-search">Buscar produto por nome ou código</label><input id="sale-product-search" type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} />

                {saleItemsWithSubtotal.map((item) => (
                  <div key={item.localId} className="sale-item-row">
                    <label>Produto
                    <select
                      disabled={submittingSale}
                      value={item.productId}
                      onChange={(event) => handleSaleItemChange(item.localId, 'productId', event.target.value)}
                    >
                      <option value="">Produto</option>
                      {item.productId && !productsById[item.productId] ? <option value={item.productId}>{item.productDescription || 'Produto antigo não localizado'}</option> : null}
                      {products.filter(product => selectableProducts.includes(product) || product.id === item.productId).map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.code} - {productDescription(product)} · {productStock(product) === null ? 'estoque a conferir' : `${productStock(product)} unidades`}
                        </option>
                      ))}
                    </select></label>

                    <label>Quantidade
                    <input
                      type="number"
                      min="1"
                      placeholder="Qtd"
                      value={item.quantity}
                      onChange={(event) => handleSaleItemChange(item.localId, 'quantity', event.target.value)}
                      disabled={submittingSale}
                    /></label>

                    <label>Preço unitário
                    <input
                      inputMode="decimal"
                      placeholder="Preço"
                      value={item.unitPrice}
                      onChange={(event) => handleSaleItemChange(item.localId, 'unitPrice', event.target.value)}
                      disabled={submittingSale}
                    /></label>

                    <label>Desconto do item
                    <input
                      inputMode="decimal"
                      placeholder="Desconto"
                      value={item.discount}
                      onChange={(event) => handleSaleItemChange(item.localId, 'discount', event.target.value)}
                      disabled={submittingSale}
                    /></label>

                    <div className="sale-item-subtotal"><span>Total do item</span>{formatCurrency(item.subtotal)}</div>

                    <button type="button" className="sales-secondary-button" onClick={() => handleRemoveSaleItem(item.localId)} disabled={submittingSale}>
                      <X size={20} aria-hidden="true" />Remover
                    </button>
                  </div>
                ))}

                <div className="sale-totals">
                  <p>
                    <strong>Desconto total:</strong> {formatCurrency(totals.totalDiscount)}
                  </p>
                  <p>
                    <strong>Valor total:</strong> {formatCurrency(totals.totalAmount)}
                  </p>
                  <p><strong>{modalState.type === 'edit' ? 'Recebido já registrado:' : 'Pagamento inicial:'}</strong> {formatCurrency(initialPaid)}</p>
                  <p><strong>Ficará pendente:</strong> {initialPaid === null ? 'Não confirmado' : formatCurrency(Math.max(0, totals.totalAmount - initialPaid))}</p>
                </div>
                {reviewSale ? <section className="sale-confirmation" aria-label="Resumo antes de confirmar"><h3>Confira antes de confirmar</h3><p><strong>Cliente:</strong> {clients.find(client => client.id === saleForm.clientId)?.name || currentSale?.clientName || 'Não identificado'}</p><p><strong>Data:</strong> {formatRecordDate(saleForm.saleDate)}</p><p><strong>Pagamento:</strong> {saleForm.paymentMethod === 'Prazo' ? `${saleForm.installments} parcela(s), primeiro vencimento ${formatRecordDate(saleForm.firstDueDate)}` : 'À vista'}</p><p><strong>Total:</strong> {formatCurrency(totals.totalAmount)}</p><p><strong>Pago:</strong> {formatCurrency(initialPaid)} · <strong>Pendente:</strong> {formatCurrency(Math.max(0, totals.totalAmount - initialPaid))}</p><button type="button" className="sales-secondary-button" onClick={() => setReviewSale(false)} disabled={submittingSale}>Revisar dados</button></section> : null}
                {errorMessage ? <p className="sales-message error" role="alert">{errorMessage}</p> : null}
                <footer className="sale-form-actions"><button type="button" className="sales-secondary-button" onClick={resetSaleModal} disabled={submittingSale}>Cancelar</button><button type="submit" className="sales-primary-button" disabled={submittingSale || loadingData || loadFailed}><ShoppingBag size={21} aria-hidden="true" />{submittingSale ? 'Salvando…' : reviewSale ? 'Confirmar venda' : 'Conferir venda'}</button></footer>
              </form>
            </section>
          </div>
        ) : null}

        {modalState.type === 'view' && currentSale ? (
          <div className="sale-modal-overlay" role="presentation">
            <section className="sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-details-title" ref={dialogRef}>
              <header className="sale-modal-header">
                <h2 id="sale-details-title">Detalhes da venda</h2>
                <button type="button" className="sales-secondary-button" onClick={() => setModalState({ type: '', saleId: '' })}>
                  <X size={20} aria-hidden="true" />Fechar
                </button>
              </header>

              <div className="sale-view-grid">
                <p>
                  <strong>Cliente:</strong> {displayText(currentSaleDisplay.clientName)}
                </p>
                <p>
                  <strong>Data da venda:</strong> {formatRecordDate(currentSale.saleDate)}
                </p>
                <p>
                  <strong>Forma de pagamento:</strong> {currentSale.paymentMethod || '-'}
                </p>
                <p>
                  <strong>Situação:</strong> {currentSaleDisplay.situation}
                </p>
                <p>
                  <strong>Valor total:</strong> {formatCurrency(currentSale.totalAmount)}
                </p>
                <p>
                  <strong>Desconto:</strong> {formatCurrency(currentSale.totalDiscount)}
                </p>
              </div>
              <div className="sale-view-grid"><p><strong>Recebido:</strong> {formatCurrency(currentSaleDisplay.received)}</p><p><strong>Falta receber:</strong> {formatCurrency(currentSaleDisplay.balance)}</p><p><strong>Vencimentos:</strong> {currentSaleDisplay.filterDueDates.length ? currentSaleDisplay.filterDueDates.map(formatRecordDate).join(', ') : 'Não informado'}</p></div>

              <div className="sales-table-wrapper">
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Quantidade</th>
                      <th>Preço unitário</th>
                      <th>Desconto</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(currentSale.items) ? currentSale.items : []).map((item, index) => (
                      <tr key={`${item.productId}-${index}`}>
                        <td data-label="Produto">{item.productDescription || 'Não informado'}</td>
                        <td data-label="Quantidade">{item.quantity ?? 'Não informada'}</td>
                        <td data-label="Preço registrado">{formatCurrency(item.unitPrice)}</td>
                        <td data-label="Desconto">{formatCurrency(item.discount)}</td>
                        <td data-label="Subtotal">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="sale-payments"><h3>Pagamentos registrados</h3>{currentPayments.length ? <ul>{currentPayments.map((payment, index) => <li key={payment.paymentId || payment.id || index}><strong>{formatCurrency(payment.amount)}</strong> · {formatRecordDate(payment.paymentDate)}</li>)}</ul> : <p>Nenhum lançamento de pagamento localizado. Valores acumulados antigos não são convertidos em novos pagamentos.</p>}</section>
              {errorMessage ? <p className="sales-message error" role="alert">{errorMessage}</p> : null}
              <footer className="sale-form-actions"><button type="button" className="sales-secondary-button" onClick={() => setModalState({ type: '', saleId: '' })}><ArrowLeft size={21} aria-hidden="true" />Voltar</button><button type="button" className="sales-secondary-button" onClick={() => handleOpenReceipt(currentSale)} disabled={loadingReceipt}><Printer size={21} aria-hidden="true" />{loadingReceipt ? 'Abrindo recibo…' : 'Recibo'}</button><button type="button" className="sales-primary-button" onClick={() => openReceiveModal(currentSale)} disabled={!(currentSaleDisplay.balance > 0)}><Banknote size={21} aria-hidden="true" />Receber pagamento</button><button type="button" className="sales-delete-button" onClick={() => openDeleteSaleModal(currentSale)} disabled={isSaleCancelled(currentSale)}><Trash2 size={20} aria-hidden="true" />Excluir venda</button></footer>
            </section>
          </div>
        ) : null}

        {modalState.type === 'delete' ? <div className="sale-modal-overlay" role="presentation"><section className="sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-delete-title" ref={dialogRef}><header className="sale-modal-header"><h2 id="sale-delete-title">Excluir venda?</h2><button type="button" className="sales-secondary-button" onClick={() => setModalState({ type: '', saleId: '' })} disabled={deletingSale}><X size={20} aria-hidden="true" />Fechar</button></header>
          {deletion.status === 'loading' ? <p role="status">Conferindo venda, estoque e pagamentos…</p> : null}
          {deletion.error ? <p className="sales-message error" role="alert">{deletion.error}</p> : null}
          {deletion.preview ? <><div className="sale-view-grid"><p><strong>Cliente:</strong> {displayText(clients.find(client => client.id === deletion.preview.sale.clientId)?.name || deletion.preview.sale.clientName)}</p><p><strong>Data:</strong> {formatRecordDate(deletion.preview.sale.saleDate)}</p><p><strong>Valor da venda:</strong> {formatCurrency(deletion.preview.sale.totalAmount)}</p></div><p>A venda será retirada das movimentações atuais. Contas deixarão de ser cobradas e pagamentos vinculados ficarão cancelados no histórico, sem apagar os valores nem simular devolução de dinheiro.</p><p>Vínculos encontrados: {deletion.preview.counts.accounts} conta(s), {deletion.preview.counts.payments + deletion.preview.counts.otherPayments} pagamento(s) e {deletion.preview.counts.receipts} recibo(s).</p>{deletion.preview.plan.returns.length ? <section><h3>Devolução comprovada ao estoque</h3><ul>{deletion.preview.plan.returns.map(entry => <li key={entry.productId}>{entry.description}: {entry.quantity} unidade(s) · estoque {entry.before} → {entry.after}</li>)}</ul></section> : <p className="sales-review-note">Nenhuma quantidade será devolvida automaticamente.</p>}{deletion.preview.plan.warnings.map((warning, index) => <p className="sales-review-note" key={index}>{warning}</p>)}</> : null}
          {errorMessage ? <p className="sales-message error" role="alert">{errorMessage}</p> : null}<footer className="sale-form-actions"><button type="button" className="sales-secondary-button" onClick={() => setModalState({ type: '', saleId: '' })} disabled={deletingSale}>Cancelar</button><button type="button" className="sales-delete-button" onClick={confirmDeleteSale} disabled={deletingSale || deletion.status !== 'ready'}><Trash2 size={21} aria-hidden="true" />{deletingSale ? 'Excluindo…' : 'Confirmar exclusão'}</button></footer>
        </section></div> : null}

        {receiptHtml ? <SaleReceiptViewer html={receiptHtml} onClose={() => setReceiptHtml('')} /> : null}

        {modalState.type === 'receive' && currentSale ? (
          <div className="sale-modal-overlay" role="presentation">
            <section className="sale-modal sale-modal-small" role="dialog" aria-modal="true" aria-labelledby="sale-receive-title" ref={dialogRef}>
              <header className="sale-modal-header">
                <h2 id="sale-receive-title">Receber pagamento</h2>
                <button type="button" className="sales-secondary-button" onClick={() => setModalState({ type: '', saleId: '' })} disabled={Boolean(receivingSaleId)}>
                  <X size={20} aria-hidden="true" />Fechar
                </button>
              </header>

              <form className="sale-form" onSubmit={handleSubmitReceive}>
                <p>
                  <strong>Cliente:</strong> {currentSale.clientName || '-'}
                </p>
                <p>
                  <strong>Saldo atual:</strong>{' '}
                  {formatCurrency(parseNumber(currentSale.totalAmount) - parseNumber(currentSale.paidAmount))}
                </p>

                <label htmlFor="receiveAmount">Valor recebido</label>
                <input
                  id="receiveAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={receiveForm.amount}
                  onChange={(event) =>
                    setReceiveForm((previous) => ({
                      ...previous,
                      amount: event.target.value,
                    }))
                  }
                />

                <label htmlFor="receiveDate">Data de recebimento</label>
                <input
                  id="receiveDate"
                  type="date"
                  value={receiveForm.paymentDate}
                  onChange={(event) =>
                    setReceiveForm((previous) => ({
                      ...previous,
                      paymentDate: event.target.value,
                    }))
                  }
                />

                {errorMessage ? <p className="sales-message error" role="alert">{errorMessage}</p> : null}
                <button type="submit" className="sales-primary-button" disabled={receivingSaleId === currentSale.id}>
                  {receivingSaleId === currentSale.id ? 'Registrando...' : 'Confirmar recebimento'}
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </section>
    </DashboardLayout>
  )
}

export default SalesPage
