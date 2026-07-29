import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listClientsByUser } from '../services/clientsService'
import { listProductsByUser } from '../services/productsService'
import {
  createSaleByUser,
  deleteSaleByUser,
  listSalesByUser,
  registerSalePaymentByUser,
  updateSaleByUser,
} from '../services/salesService'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
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

  const loadPageData = useCallback(async () => {
    if (!user?.uid) {
      setLoadingData(false)
      return
    }

    try {
      setLoadingData(true)
      setErrorMessage('')

      const [salesList, clientsList, productsList] = await Promise.all([
        listSalesByUser(user.uid),
        listClientsByUser(user.uid),
        listProductsByUser(user.uid),
      ])

      setSales(salesList)
      setClients(clientsList)
      setProducts(productsList)
    } catch (error) {
      console.error('Erro ao carregar dados de vendas:', error)
      setErrorMessage('Não foi possível carregar os dados de vendas. Tente novamente.')
    } finally {
      setLoadingData(false)
    }
  }, [user?.uid])

  useEffect(() => {
    loadPageData()
  }, [loadPageData])

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
        setSuccessMessage('Venda cadastrada com sucesso.')
      }

      if (modalState.type === 'edit' && modalState.saleId) {
        await updateSaleByUser(user.uid, modalState.saleId, payload)
        setSuccessMessage('Venda atualizada com sucesso.')
      }

      await loadPageData()
      resetSaleModal()
    } catch (error) {
      console.error('Erro ao salvar venda:', error)
      setErrorMessage(error?.message || 'Não foi possível salvar a venda. Tente novamente.')
    } finally {
      setSubmittingSale(false)
    }
  }

  const handleDeleteSale = async (sale) => {
    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    const confirmed = window.confirm(`Deseja excluir a venda de ${sale.clientName || 'cliente'}?`)

    if (!confirmed) {
      return
    }

    try {
      setDeletingSaleId(sale.id)
      setErrorMessage('')
      await deleteSaleByUser(user.uid, sale.id)
      setSuccessMessage('Venda excluída com sucesso.')
      await loadPageData()
    } catch (error) {
      console.error('Erro ao excluir venda:', error)
      setErrorMessage(error?.message || 'Não foi possível excluir a venda. Tente novamente.')
    } finally {
      setDeletingSaleId('')
    }
  }

  const handleSubmitReceive = async (event) => {
    event.preventDefault()

    if (!user?.uid || !modalState.saleId) {
      setErrorMessage('Não foi possível identificar a venda selecionada.')
      return
    }

    const amount = parseNumber(receiveForm.amount)

    if (amount <= 0) {
      setErrorMessage('Informe um valor válido para recebimento.')
      return
    }

    try {
      setReceivingSaleId(modalState.saleId)
      setErrorMessage('')

      await registerSalePaymentByUser(
        user.uid,
        modalState.saleId,
        amount,
        receiveForm.paymentDate,
      )

      setSuccessMessage('Recebimento registrado com sucesso.')
      await loadPageData()
      setModalState({ type: '', saleId: '' })
    } catch (error) {
      console.error('Erro ao registrar recebimento:', error)
      setErrorMessage(error?.message || 'Não foi possível registrar o recebimento.')
    } finally {
      setReceivingSaleId('')
    }
  }

  const handleOpenReceipt = (sale) => {
    const receiptHtml = `
      <html>
        <head>
          <title>Recibo de Venda</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
            h1 { margin: 0 0 12px; }
            p { margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          </style>
        </head>
        <body>
          <h1>Recibo de Venda</h1>
          <p><strong>Cliente:</strong> ${sale.clientName || '-'}</p>
          <p><strong>Data:</strong> ${sale.saleDate || '-'}</p>
          <p><strong>Forma de pagamento:</strong> ${sale.paymentMethod || '-'}</p>
          <p><strong>Status:</strong> ${sale.status || '-'}</p>
          <p><strong>Valor total:</strong> ${formatCurrency(sale.totalAmount)}</p>
          <table>
            <thead>
              <tr><th>Produto</th><th>Qtd</th><th>Valor</th></tr>
            </thead>
            <tbody>
              ${(sale.items || [])
                .map(
                  (item) =>
                    `<tr><td>${item.productDescription || '-'}</td><td>${item.quantity || 0}</td><td>${formatCurrency(item.subtotal)}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
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
                            onClick={() => handleDeleteSale(sale)}
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
