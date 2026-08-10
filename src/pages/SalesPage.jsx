import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeProductsByUser } from '../services/productsService'
import {
  createSaleByUser,
  deleteSaleByUser,
  getSaleReceiptDataByUser,
  registerSalePaymentByUser,
  subscribeSalesByUser,
  updateSaleByUser,
} from '../services/salesService'
import { subscribeClientsByUser } from '../services/clientsService'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import receiptLogo from '../assets/logo.png'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import '../styles/sales-page.css'

const PAYMENT_OPTIONS = ['À Vista', 'Prazo']
const SALE_STATUS_OPTIONS = ['Pendente', 'Parcial', 'Pago']

const SALE_INITIAL_FORM = {
  clientId: '',
  saleDate: new Date().toISOString().slice(0, 10),
  paymentMethod: 'À Vista',
  installments: '1',
  firstDueDate: '',
  items: [],
}

const RECEIVE_INITIAL_FORM = {
  amount: '',
  paymentDate: new Date().toISOString().slice(0, 10),
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
  const unitPrice = parseNumber(item.unitPrice)
  const discount = parseNumber(item.discount)
  return quantity * unitPrice - discount
}

function formatCurrency(value) {
  const amount = parseNumber(value)

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount)
}

function buildDueDates(installmentsValue, firstDueDateValue, totalAmount) {
  const installments = Math.max(1, parseNumber(installmentsValue, 1))
  const perInstallment = Math.floor((totalAmount / installments) * 100) / 100
  const dueDates = []
  let accumulatedAmount = 0

  for (let index = 0; index < installments; index += 1) {
    const dueDate = new Date(firstDueDateValue)
    dueDate.setMonth(dueDate.getMonth() + index)
    dueDate.setHours(12, 0, 0, 0)

    const amount =
      index === installments - 1
        ? Number((totalAmount - accumulatedAmount).toFixed(2))
        : Number(perInstallment.toFixed(2))

    accumulatedAmount += amount

    dueDates.push({
      installment: index + 1,
      dueDate: dueDate.toISOString().slice(0, 10),
      amount,
    })
  }

  return dueDates
}

function mapSaleToForm(sale) {
  return {
    clientId: sale?.clientId || '',
    saleDate: sale?.saleDate || new Date().toISOString().slice(0, 10),
    paymentMethod: sale?.paymentMethod || 'À Vista',
    installments: String(sale?.installments || 1),
    firstDueDate: sale?.firstDueDate || '',
    items: (sale?.items || []).map((item) => ({
      localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: item.productId,
      quantity: String(item.quantity || 0),
      unitPrice: String(item.unitPrice || 0),
      discount: String(item.discount || 0),
    })),
  }
}

function SalesPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('vendas')
  const [sales, setSales] = useState([])
  const [clients, setClients] = useState([])
  const [products, setProducts] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [submittingSale, setSubmittingSale] = useState(false)
  const [deletingSaleId, setDeletingSaleId] = useState('')
  const [receivingSaleId, setReceivingSaleId] = useState('')
  const [filters, setFilters] = useState({
    client: '',
    date: '',
    status: '',
  })
  const [modalState, setModalState] = useState({ type: '', saleId: '' })
  const [saleForm, setSaleForm] = useState(SALE_INITIAL_FORM)
  const [receiveForm, setReceiveForm] = useState(RECEIVE_INITIAL_FORM)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

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

  const currentSale = modalState.saleId ? salesById[modalState.saleId] : null

  const saleItemsWithSubtotal = useMemo(
    () =>
      saleForm.items.map((item) => ({
        ...item,
        subtotal: getSaleItemSubtotal(item),
      })),
    [saleForm.items],
  )

  const totals = useMemo(() => {
    const totalDiscount = saleItemsWithSubtotal.reduce((acc, item) => acc + parseNumber(item.discount), 0)
    const totalAmount = saleItemsWithSubtotal.reduce((acc, item) => acc + item.subtotal, 0)

    return {
      totalDiscount,
      totalAmount,
    }
  }, [saleItemsWithSubtotal])

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const clientTerm = filters.client.trim().toLowerCase()
      const hasClientMatch = clientTerm
        ? (sale.clientName || '').toLowerCase().includes(clientTerm)
        : true

      const hasDateMatch = filters.date ? sale.saleDate === filters.date : true
      const hasStatusMatch = filters.status ? sale.status === filters.status : true

      return hasClientMatch && hasDateMatch && hasStatusMatch
    })
  }, [filters.client, filters.date, filters.status, sales])

  useEffect(() => {
    if (!user?.uid) {
      setSales([])
      setClients([])
      setProducts([])
      setLoadingData(false)
      return () => {}
    }

    let hasSalesLoaded = false
    let hasClientsLoaded = false
    let hasProductsLoaded = false

    const syncLoadingState = () => {
      if (hasSalesLoaded && hasClientsLoaded && hasProductsLoaded) {
        setLoadingData(false)
      }
    }

    setLoadingData(true)
    setErrorMessage('')

    const unsubscribeSales = subscribeSalesByUser(
      user.uid,
      (salesList) => {
        setSales(salesList)
        hasSalesLoaded = true
        syncLoadingState()
      },
      (error) => {
        console.error('Erro ao observar vendas:', error)
        setErrorMessage(getFirebaseErrorMessage(error, 'Falha ao carregar vendas'))
        hasSalesLoaded = true
        syncLoadingState()
      },
    )

    const unsubscribeClients = subscribeClientsByUser(
      user.uid,
      (clientsList) => {
        setClients(clientsList)
        hasClientsLoaded = true
        syncLoadingState()
      },
      (error) => {
        console.error('Erro ao observar clientes de vendas:', error)
        setErrorMessage(getFirebaseErrorMessage(error, 'Falha ao carregar clientes'))
        hasClientsLoaded = true
        syncLoadingState()
      },
    )

    const unsubscribeProducts = subscribeProductsByUser(
      user.uid,
      (productsList) => {
        setProducts(productsList)
        hasProductsLoaded = true
        syncLoadingState()
      },
      (error) => {
        console.error('Erro ao observar produtos de vendas:', error)
        setErrorMessage(getFirebaseErrorMessage(error, 'Falha ao carregar produtos'))
        hasProductsLoaded = true
        syncLoadingState()
      },
    )

    return () => {
      unsubscribeSales()
      unsubscribeClients()
      unsubscribeProducts()
    }
  }, [user?.uid])

  const resetSaleModal = () => {
    setSaleForm({ ...SALE_INITIAL_FORM, items: [createEmptyItem()] })
    setModalState({ type: '', saleId: '' })
  }

  const openCreateSaleModal = () => {
    setErrorMessage('')
    setSuccessMessage('')
    setSaleForm({ ...SALE_INITIAL_FORM, items: [createEmptyItem()] })
    setModalState({ type: 'create', saleId: '' })
  }

  const openEditSaleModal = (sale) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSaleForm(mapSaleToForm(sale))
    setModalState({ type: 'edit', saleId: sale.id })
  }

  const openViewSaleModal = (sale) => {
    setModalState({ type: 'view', saleId: sale.id })
  }

  const openReceiveModal = (sale) => {
    setReceiveForm(RECEIVE_INITIAL_FORM)
    setModalState({ type: 'receive', saleId: sale.id })
  }

  const handleAddSaleItem = () => {
    setSaleForm((previous) => ({
      ...previous,
      items: [...previous.items, createEmptyItem()],
    }))
  }

  const handleRemoveSaleItem = (localId) => {
    setSaleForm((previous) => {
      const nextItems = previous.items.filter((item) => item.localId !== localId)
      return {
        ...previous,
        items: nextItems.length > 0 ? nextItems : [createEmptyItem()],
      }
    })
  }

  const handleSaleInputChange = (event) => {
    const { name, value } = event.target
    setSaleForm((previous) => ({
      ...previous,
      [name]: value,
    }))
  }

  const handleSaleItemChange = (localId, field, value) => {
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

    if (!saleForm.saleDate) {
      return 'Informe a data da venda.'
    }

    if (!saleForm.items?.length) {
      return 'Adicione ao menos um produto na venda.'
    }

    const originalItemsByProduct = new Map()

    if (modalState.type === 'edit' && currentSale?.items) {
      for (const existingItem of currentSale.items) {
        const previousValue = originalItemsByProduct.get(existingItem.productId) || 0
        originalItemsByProduct.set(existingItem.productId, previousValue + parseNumber(existingItem.quantity))
      }
    }

    for (const item of saleItemsWithSubtotal) {
      if (!item.productId) {
        return 'Selecione todos os produtos da venda.'
      }

      const quantity = parseNumber(item.quantity)
      const unitPrice = parseNumber(item.unitPrice)
      const discount = parseNumber(item.discount)

      if (quantity <= 0) {
        return 'Quantidade deve ser maior que zero.'
      }

      if (unitPrice < 0 || discount < 0 || item.subtotal < 0) {
        return 'Valores negativos não são permitidos na venda.'
      }

      const selectedProduct = productsById[item.productId]
      if (!selectedProduct) {
        return 'Um dos produtos selecionados não existe mais.'
      }

      const previousQuantity = originalItemsByProduct.get(item.productId) || 0
      const availableStock = parseNumber(selectedProduct.stockQuantity) + previousQuantity

      if (quantity > availableStock) {
        return `Estoque insuficiente para o produto ${selectedProduct.description}.`
      }
    }

    if (saleForm.paymentMethod === 'Prazo') {
      if (!saleForm.installments || parseNumber(saleForm.installments) <= 0) {
        return 'Informe a quantidade de parcelas.'
      }

      if (!saleForm.firstDueDate) {
        return 'Informe a data do primeiro vencimento.'
      }
    }

    return ''
  }

  const buildSalePayload = () => {
    const selectedClient = clients.find((client) => client.id === saleForm.clientId)

    const items = saleItemsWithSubtotal.map((item) => {
      const selectedProduct = productsById[item.productId]

      return {
        productId: item.productId,
        productCode: selectedProduct?.code || '',
        productDescription: selectedProduct?.description || '',
        quantity: parseNumber(item.quantity),
        unitPrice: parseNumber(item.unitPrice),
        discount: parseNumber(item.discount),
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
      payload.dueDates = buildDueDates(payload.installments, payload.firstDueDate, totals.totalAmount)
    }

    return payload
  }

  const handleSubmitSale = async (event) => {
    event.preventDefault()

    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    const validationError = validateSaleForm()

    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    try {
      setSubmittingSale(true)
      setErrorMessage('')
      const payload = buildSalePayload()

      if (modalState.type === 'create') {
        await createSaleByUser(user.uid, payload)
        setSuccessMessage('Salvo com sucesso.')
      }

      if (modalState.type === 'edit' && modalState.saleId) {
        await updateSaleByUser(user.uid, modalState.saleId, payload)
        setSuccessMessage('Atualizado com sucesso.')
      }

      resetSaleModal()
    } catch (error) {
      console.error('Erro ao salvar venda:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível salvar a venda'))
    } finally {
      setSubmittingSale(false)
    }
  }

  const handleDeleteSale = async (saleId, sale) => {
    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    if (!saleId) {
      console.error('Venda sem ID:', sale)
      window.alert('Esta venda antiga não possui um ID válido para exclusão.')
      return
    }

    const confirmed = window.confirm(`Deseja excluir a venda de ${sale.clientName || 'cliente'}?`)

    if (!confirmed) {
      return
    }

    try {
      setDeletingSaleId(saleId)
      setErrorMessage('')
      await deleteSaleByUser(user.uid, saleId)
      setSuccessMessage('Excluído com sucesso.')
    } catch (error) {
      console.error('Erro ao excluir venda:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível excluir a venda'))
    } finally {
      setDeletingSaleId('')
    }
  }

  const handleSubmitReceive = async (event) => {
    event.preventDefault()

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
      )

      setSuccessMessage('Salvo com sucesso.')
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
    if (!user?.uid || !sale?.id) {
      setErrorMessage('Não foi possível identificar a venda para gerar o recibo.')
      return
    }

    let latestSale = sale
    let paymentsHistory = []

    try {
      const receiptData = await getSaleReceiptDataByUser(user.uid, sale.id)
      latestSale = receiptData.sale
      paymentsHistory = receiptData.payments || []
    } catch (error) {
      console.error('Erro ao carregar dados atualizados do recibo:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível carregar os dados do recibo'))
      return
    }

    const receiptNumber = latestSale?.id ? String(latestSale.id).toUpperCase() : '-'
    const saleDate = latestSale?.saleDate
      ? new Date(`${latestSale.saleDate}T12:00:00`).toLocaleDateString('pt-BR')
      : '-'

    const formatAnyDate = (value) => {
      if (!value) {
        return '-'
      }

      if (typeof value?.toDate === 'function') {
        return value.toDate().toLocaleDateString('pt-BR')
      }

      if (value?.seconds) {
        return new Date(value.seconds * 1000).toLocaleDateString('pt-BR')
      }

      if (typeof value === 'string') {
        const parsed = new Date(`${value}T12:00:00`)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString('pt-BR')
        }
      }

      return '-'
    }

    const totalValue = parseNumber(latestSale?.totalAmount ?? latestSale?.total)
    const amountPaid = parseNumber(latestSale?.amountPaid ?? latestSale?.paidAmount)
    const remainingAmount = Math.max(
      0,
      parseNumber(latestSale?.remainingAmount, totalValue - amountPaid),
    )
    const saleStatus = latestSale?.status || (remainingAmount <= 0 ? 'Pago' : amountPaid > 0 ? 'Parcial' : 'Pendente')
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
                  <td>${formatAnyDate(payment.paymentDate)}</td>
                  <td>${formatCurrency(payment.amount)}</td>
                  <td>${payment.paymentMethod || '-'}</td>
                  <td>${payment.observation || '-'}</td>
                </tr>`,
            )
            .join('')
        : '<tr><td colspan="4" class="empty-row">Nenhum recebimento registrado.</td></tr>'

    const receiptHtml = `
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

            @media (max-width: 768px) {
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
              }
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
                  ${(latestSale.items || [])
                    .map(
                      (item) =>
                        `<tr>
                          <td>${item.productDescription || '-'}</td>
                          <td>${item.quantity || 0}</td>
                          <td>${formatCurrency(item.unitPrice)}</td>
                          <td>${formatCurrency(item.discount)}</td>
                          <td>${formatCurrency(item.subtotal)}</td>
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

    const newWindow = window.open('', '_blank')

    if (!newWindow) {
      setErrorMessage('Não foi possível abrir o recibo no navegador.')
      return
    }

    newWindow.document.write(receiptHtml)
    newWindow.document.close()
    newWindow.focus()
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
            <h1>Vendas</h1>
            <p>Gerencie as vendas da JN Confecções.</p>
          </div>
          <button type="button" className="sales-primary-button" onClick={openCreateSaleModal}>
            Nova Venda
          </button>
        </header>

        <section className="sales-filters">
          <input
            type="search"
            placeholder="Pesquisar por cliente"
            value={filters.client}
            onChange={(event) => setFilters((previous) => ({ ...previous, client: event.target.value }))}
          />

          <input
            type="date"
            value={filters.date}
            onChange={(event) => setFilters((previous) => ({ ...previous, date: event.target.value }))}
          />

          <select
            value={filters.status}
            onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
          >
            <option value="">Todos os status</option>
            {SALE_STATUS_OPTIONS.map((statusOption) => (
              <option key={statusOption} value={statusOption}>
                {statusOption}
              </option>
            ))}
          </select>
        </section>

        {successMessage ? <p className="sales-message success">{successMessage}</p> : null}
        {errorMessage ? <p className="sales-message error">{errorMessage}</p> : null}

        <section className="sales-list-placeholder" aria-label="Lista de vendas">
          {loadingData ? <p>Carregando vendas...</p> : null}

          {!loadingData && filteredSales.length === 0 ? <p>Nenhuma venda cadastrada.</p> : null}

          {!loadingData && filteredSales.length > 0 ? (
            <div className="sales-table-wrapper">
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Valor</th>
                    <th>Forma de pagamento</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{sale.saleDate || '-'}</td>
                      <td>{sale.clientName || '-'}</td>
                      <td>{formatCurrency(sale.totalAmount)}</td>
                      <td>{sale.paymentMethod || '-'}</td>
                      <td>{sale.status || '-'}</td>
                      <td>
                        <div className="sales-row-actions">
                          <button type="button" onClick={() => openViewSaleModal(sale)}>
                            👁 Ver
                          </button>
                          <button type="button" onClick={() => openEditSaleModal(sale)}>
                            ✏️ Editar
                          </button>
                          <button type="button" onClick={() => openReceiveModal(sale)}>
                            💰 Receber
                          </button>
                          <button type="button" onClick={() => handleOpenReceipt(sale)}>
                            🧾 Recibo
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteSale(sale.id, sale)}
                            disabled={deletingSaleId === sale.id}
                          >
                            {deletingSaleId === sale.id ? 'Excluindo...' : '🗑 Excluir'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {modalState.type === 'create' || modalState.type === 'edit' ? (
          <div className="sale-modal-overlay" role="presentation" onClick={resetSaleModal}>
            <section className="sale-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="sale-modal-header">
                <h2>{modalState.type === 'create' ? 'Nova venda' : 'Editar venda'}</h2>
                <button type="button" className="close-button" onClick={resetSaleModal}>
                  Fechar
                </button>
              </header>

              <form className="sale-form" onSubmit={handleSubmitSale}>
                <label htmlFor="clientId">Cliente</label>
                <select
                  id="clientId"
                  name="clientId"
                  value={saleForm.clientId}
                  onChange={handleSaleInputChange}
                >
                  <option value="">Selecione</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
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

                <label htmlFor="paymentMethod">Forma de pagamento</label>
                <select
                  id="paymentMethod"
                  name="paymentMethod"
                  value={saleForm.paymentMethod}
                  onChange={handleSaleInputChange}
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
                    />

                    <label htmlFor="firstDueDate">Data do primeiro vencimento</label>
                    <input
                      id="firstDueDate"
                      name="firstDueDate"
                      type="date"
                      value={saleForm.firstDueDate}
                      onChange={handleSaleInputChange}
                    />
                  </>
                ) : null}

                <div className="sale-items-header">
                  <h3>Produtos da venda</h3>
                  <button type="button" className="sales-secondary-button" onClick={handleAddSaleItem}>
                    + Adicionar produto
                  </button>
                </div>

                {saleItemsWithSubtotal.map((item) => (
                  <div key={item.localId} className="sale-item-row">
                    <select
                      value={item.productId}
                      onChange={(event) => handleSaleItemChange(item.localId, 'productId', event.target.value)}
                    >
                      <option value="">Produto</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.code} - {product.description}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min="1"
                      placeholder="Qtd"
                      value={item.quantity}
                      onChange={(event) => handleSaleItemChange(item.localId, 'quantity', event.target.value)}
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Preço"
                      value={item.unitPrice}
                      onChange={(event) => handleSaleItemChange(item.localId, 'unitPrice', event.target.value)}
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Desconto"
                      value={item.discount}
                      onChange={(event) => handleSaleItemChange(item.localId, 'discount', event.target.value)}
                    />

                    <div className="sale-item-subtotal">{formatCurrency(item.subtotal)}</div>

                    <button type="button" className="danger" onClick={() => handleRemoveSaleItem(item.localId)}>
                      Remover
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
                </div>

                <button type="submit" className="sales-primary-button" disabled={submittingSale}>
                  {submittingSale ? 'Salvando...' : 'Salvar venda'}
                </button>
              </form>
            </section>
          </div>
        ) : null}

        {modalState.type === 'view' && currentSale ? (
          <div className="sale-modal-overlay" role="presentation" onClick={() => setModalState({ type: '', saleId: '' })}>
            <section className="sale-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="sale-modal-header">
                <h2>Detalhes da venda</h2>
                <button type="button" className="close-button" onClick={() => setModalState({ type: '', saleId: '' })}>
                  Fechar
                </button>
              </header>

              <div className="sale-view-grid">
                <p>
                  <strong>Cliente:</strong> {currentSale.clientName || '-'}
                </p>
                <p>
                  <strong>Data:</strong> {currentSale.saleDate || '-'}
                </p>
                <p>
                  <strong>Forma de pagamento:</strong> {currentSale.paymentMethod || '-'}
                </p>
                <p>
                  <strong>Status:</strong> {currentSale.status || '-'}
                </p>
                <p>
                  <strong>Valor total:</strong> {formatCurrency(currentSale.totalAmount)}
                </p>
                <p>
                  <strong>Desconto:</strong> {formatCurrency(currentSale.totalDiscount)}
                </p>
              </div>

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
                    {(currentSale.items || []).map((item, index) => (
                      <tr key={`${item.productId}-${index}`}>
                        <td>{item.productDescription || '-'}</td>
                        <td>{item.quantity || 0}</td>
                        <td>{formatCurrency(item.unitPrice)}</td>
                        <td>{formatCurrency(item.discount)}</td>
                        <td>{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {modalState.type === 'receive' && currentSale ? (
          <div className="sale-modal-overlay" role="presentation" onClick={() => setModalState({ type: '', saleId: '' })}>
            <section className="sale-modal sale-modal-small" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="sale-modal-header">
                <h2>Receber venda</h2>
                <button type="button" className="close-button" onClick={() => setModalState({ type: '', saleId: '' })}>
                  Fechar
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
