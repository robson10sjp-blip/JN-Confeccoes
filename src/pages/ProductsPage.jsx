import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import { ArrowLeft, BadgeDollarSign, ChevronLeft, ChevronRight, CircleAlert, Eye, Layers, Package, PackageX, Pencil, Plus, RefreshCw, Save, Search, Trash2, TrendingUp, Wallet, X } from 'lucide-react'
import {
  createProductByUser,
  deleteProductByUser,
  listProductsByUser,
  loadProductSalesByUser,
  subscribeProductsByUser,
  updateProductByUser,
} from '../services/productsService'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { recordNumber } from '../utils/recordFilters'
import { buildProductChanges, filterProductRecords, findProductCodeDuplicates, getProductCategories, mapProductDraft, productDescription, productStock, productValuation, summarizeProducts, validateProductDraft, valueProductStock } from '../utils/productRecords'
import '../styles/products-page.css'

const PRODUCT_INITIAL_STATE = mapProductDraft()
const PAGE_SIZE = 20
const present = value => String(value ?? '').trim() ? String(value) : 'Não informado'
const PRODUCT_FORM_GROUPS = [
  { title: 'Identificação', fields: [['description', 'Descrição do produto', true], ['code', 'Código', true], ['category', 'Categoria'], ['brand', 'Marca']] },
  { title: 'Características', fields: [['size', 'Tamanho'], ['color', 'Cor']] },
  { title: 'Estoque e preços', fields: [['stockQuantity', 'Quantidade em estoque', true], ['salePrice', 'Preço de venda', true], ['costPrice', 'Preço de custo']] },
]

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatCurrency(value) {
  const amount = recordNumber(value)
  return amount !== null && amount >= 0 ? currencyFormatter.format(amount) : 'Não informado'
}

function ProductsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('produtos')
  const [products, setProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [modalMode, setModalMode] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [formData, setFormData] = useState(PRODUCT_INITIAL_STATE)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [ownerUid, setOwnerUid] = useState(user?.uid)
  const [duplicates, setDuplicates] = useState([])
  const [relations, setRelations] = useState({ status: 'loading', data: null, error: '' })
  const dialogRef = useRef(null)

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const visibleProducts = ownerUid === user?.uid ? products : []
  const filteredProducts = useMemo(() => filterProductRecords(visibleProducts, searchTerm, categoryFilter, stockFilter), [products, ownerUid, user?.uid, searchTerm, categoryFilter, stockFilter])
  const categories = getProductCategories(visibleProducts)
  const summary = summarizeProducts(visibleProducts)
  const valuation = valueProductStock(visibleProducts)
  const filteredValuation = valueProductStock(filteredProducts)
  const hasFilters = Boolean(searchTerm || categoryFilter || stockFilter)
  const profileProduct = visibleProducts.find(product => product.id === selectedProduct?.id) || selectedProduct
  const profileValue = profileProduct ? productValuation(profileProduct) : null
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const shownProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const statistic = (value, incomplete = false) => loadError ? 'Indisponível' : loadingProducts ? 'Carregando…' : incomplete ? 'Conferir dados' : value.toLocaleString('pt-BR')
  const estimatedValue = (value, incomplete = false) => loadError ? 'Indisponível' : loadingProducts ? 'Carregando…' : incomplete || value === null ? 'Cálculo incompleto' : currencyFormatter.format(value)

  useEffect(() => {
    let active = true
    if (ownerUid !== user?.uid) {
      setModalMode('')
      setSelectedProduct(null)
      setSearchTerm('')
      setCategoryFilter('')
      setStockFilter('')
      setPage(1)
    }
    setOwnerUid(user?.uid)
    setProducts([])
    setLoadError('')
    if (!user?.uid) {
      setProducts([])
      setLoadingProducts(false)
      return () => { active = false }
    }

    setLoadingProducts(true)
    setErrorMessage('')

    const unsubscribe = subscribeProductsByUser(
      user.uid,
      (fetchedProducts, confirmed = true) => {
        if (!active) return
        setProducts(fetchedProducts)
        setLoadError('')
        setLoadingProducts(!confirmed)
      },
      (error) => {
        if (!active) return
        console.error('Erro ao observar produtos:', error?.code || 'unknown')
        setProducts([])
        setLoadError(getFirebaseErrorMessage(error, 'Não foi possível carregar os produtos'))
        setLoadingProducts(false)
      },
    )

    return () => { active = false; unsubscribe() }
  }, [user?.uid, retry])

  useEffect(() => {
    if (!selectedProduct?.id || !['view', 'delete'].includes(modalMode)) return
    let active = true
    setRelations({ status: 'loading', data: null, error: '' })
    loadProductSalesByUser(user?.uid, selectedProduct.id).then(data => {
      if (active) setRelations({ status: 'ready', data, error: '' })
    }).catch(error => {
      if (active) setRelations({ status: 'error', data: null, error: getFirebaseErrorMessage(error, 'Não foi possível conferir as vendas vinculadas') })
    })
    return () => { active = false }
  }, [user?.uid, selectedProduct?.id, modalMode])

  useEffect(() => {
    if (!modalMode || !dialogRef.current) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog.querySelector('input, button')?.focus()
    const handleKeys = event => {
      if (event.key !== 'Tab') return
      const elements = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
    }
    dialog.addEventListener('keydown', handleKeys)
    return () => { document.body.style.overflow = previousOverflow; dialog.removeEventListener('keydown', handleKeys); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [modalMode])

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

  const openCreateModal = () => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedProduct(null)
    setDuplicates([])
    setFormData(PRODUCT_INITIAL_STATE)
    setModalMode('create')
  }

  const openEditModal = (product) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedProduct(product)
    setDuplicates([])
    setFormData(mapProductDraft(product))
    setModalMode('edit')
  }

  const closeModal = () => {
    if (submitting) return
    setModalMode('')
    setSelectedProduct(null)
    setFormData(PRODUCT_INITIAL_STATE)
    setDuplicates([])
  }

  const openViewModal = product => {
    setSelectedProduct(product)
    setErrorMessage('')
    setRelations({ status: 'loading', data: null, error: '' })
    setModalMode('view')
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setFormData((previousState) => ({
      ...previousState,
      [name]: value,
    }))
    setErrorMessage('')
    setDuplicates([])
  }

  const validateProductForm = () => {
    return validateProductDraft(formData, modalMode === 'edit' ? selectedProduct : null)
  }

  const handleSubmitProduct = async (event, allowDuplicate = false) => {
    event?.preventDefault()
    if (submitting) return

    const validationMessage = validateProductForm()

    if (validationMessage) {
      setErrorMessage(validationMessage)
      return
    }

    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage('')
      const payload = buildProductChanges(formData, modalMode === 'edit' ? selectedProduct : null)
      if (!allowDuplicate && (modalMode === 'create' || Object.hasOwn(payload, 'code'))) {
        const latestProducts = await listProductsByUser(user.uid)
        const matches = findProductCodeDuplicates(latestProducts, { ...formData, id: selectedProduct?.id })
        if (matches.length) { setDuplicates(matches); return }
      }

      if (modalMode === 'create') {
        await createProductByUser(user.uid, payload)
        setSuccessMessage('Produto cadastrado com sucesso.')
      }

      if (modalMode === 'edit' && selectedProduct?.id) {
        if (Object.keys(payload).length) await updateProductByUser(user.uid, selectedProduct.id, payload, selectedProduct.stockQuantity)
        setSuccessMessage(Object.keys(payload).length ? 'Produto atualizado com sucesso.' : 'Nenhuma informação foi alterada.')
      }

      setModalMode('')
      setSelectedProduct(null)
      setFormData(PRODUCT_INITIAL_STATE)
      setDuplicates([])
    } catch (error) {
      console.error('Erro ao salvar produto:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível salvar o produto'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteProduct = async (product) => {
    if (!user?.uid) {
      setErrorMessage('Não foi possível identificar o usuário logado.')
      return
    }

    if (submitting || relations.status !== 'ready' || relations.data.salesCount || relations.data.unresolvedCount) return

    try {
      setSubmitting(true)
      setErrorMessage('')
      await deleteProductByUser(user.uid, product.id)
      setSuccessMessage('Produto excluído com sucesso.')
      setModalMode('')
      setSelectedProduct(null)
    } catch (error) {
      console.error('Erro ao excluir produto:', error?.code || 'unknown')
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível excluir o produto'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DashboardLayout
      sidebarItems={sidebarMenuItems}
      activeItem={activeItem}
      onSelectItem={handleSelectMenuItem}
      userName={userName}
      onLogout={handleLogout}
    >
      <section className="products-page">
        <header className="products-page-header">
          <div>
            <p className="products-brand">JN Confecções</p>
            <h1>Produtos</h1>
            <p>Consulte e organize seus produtos e estoque</p>
          </div>
          <button type="button" className="products-primary-button" onClick={openCreateModal}>
            <Plus size={23} aria-hidden="true" />Novo produto
          </button>
        </header>

        <section className="products-summary" aria-label="Totais atuais de produtos">
          <div className="products-summary-heading"><h2>Resumo geral do estoque</h2><p>Todos os produtos cadastrados, independentemente dos filtros.</p></div>
          <article><span><Layers size={23} aria-hidden="true" />Produtos cadastrados</span><strong>{statistic(summary.count)}</strong><p>Produtos diferentes no cadastro</p></article>
          <article><span><Package size={23} aria-hidden="true" />Peças em estoque</span><strong>{statistic(summary.units, summary.incomplete)}</strong><p>Unidades disponíveis no total</p></article>
          <article><span><PackageX size={23} aria-hidden="true" />Produtos sem estoque</span><strong>{statistic(summary.empty, summary.incomplete)}</strong><p>Produtos com quantidade igual a zero</p></article>
          <article className="product-sale-estimate"><span><BadgeDollarSign size={23} aria-hidden="true" />Valor do estoque para venda</span><strong>{estimatedValue(valuation.saleValue, valuation.saleIncomplete)}</strong><p>Valor estimado se todos os produtos forem vendidos pelos preços cadastrados.</p><p>Estimativa de vendas, não é lucro nem dinheiro recebido.</p></article>
          <article><span><Wallet size={23} aria-hidden="true" />Custo total do estoque</span><strong>{estimatedValue(valuation.costValue, valuation.costIncomplete)}</strong><p>Quantidade disponível × custo cadastrado</p>{!loadingProducts && !loadError && valuation.costMissingCount ? <p>{valuation.costMissingCount} produto(s) precisam ter o custo preenchido ou revisado.</p> : null}</article>
          <article><span><TrendingUp size={23} aria-hidden="true" />Lucro bruto estimado</span><strong>{estimatedValue(valuation.profitValue)}</strong><p>Venda estimada menos custo cadastrado; não desconta despesas ou impostos.</p></article>
        </section>
        {!loadingProducts && !loadError && valuation.saleIncomplete ? <p className="products-review-note" role="status"><CircleAlert size={20} aria-hidden="true" /><span>Cálculo de venda incompleto: {valuation.saleReviewCount} produto(s) precisam de revisão. Quantidade ausente ou inválida: {valuation.invalidQuantityCount}. Preço de venda ausente ou inválido: {valuation.invalidSalePriceCount}.{valuation.saleValue !== null ? ` Subtotal conhecido: ${currencyFormatter.format(valuation.saleValue)}, sem considerar valores não confirmados.` : ' Os valores excedem o limite de cálculo seguro.'}</span></p> : null}
        {!loadingProducts && !loadError && summary.incomplete ? <p className="products-review-note" role="status"><CircleAlert size={20} aria-hidden="true" />Há quantidades antigas ausentes ou inválidas. Os totais de estoque precisam de conferência; nenhum cadastro foi corrigido automaticamente.</p> : null}
        <section className="products-toolbar" aria-label="Pesquisa e filtros de produtos">
          <label><span><Search size={20} aria-hidden="true" />Buscar produto</span><input type="search" placeholder="Nome, descrição ou código" value={searchTerm} onChange={event => { setSearchTerm(event.target.value); setPage(1) }} /></label>
          <label>Categoria<select value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setPage(1) }}><option value="">Todas as categorias</option>{categories.map(category => <option value={category.value} key={category.value}>{category.label}</option>)}</select></label>
          <label>Situação do estoque<select value={stockFilter} onChange={event => { setStockFilter(event.target.value); setPage(1) }}><option value="">Todos</option><option value="available">Em estoque</option><option value="empty">Sem estoque</option></select></label>
          {searchTerm || categoryFilter || stockFilter ? <button type="button" className="products-secondary-button" onClick={() => { setSearchTerm(''); setCategoryFilter(''); setStockFilter(''); setPage(1) }}><X size={20} aria-hidden="true" />Limpar filtros</button> : null}
        </section>

        {hasFilters && !loadingProducts && !loadError ? <section className="products-filter-value" aria-label="Valor dos produtos encontrados" role="status"><div><h2>Valor dos produtos encontrados</h2><p>{filteredProducts.length} produto(s) encontrados · o resumo geral permanece igual.</p></div><strong>{estimatedValue(filteredValuation.saleValue, filteredValuation.saleIncomplete)}</strong>{filteredValuation.saleIncomplete ? <p>{filteredValuation.saleReviewCount} produto(s) encontrados precisam de revisão de quantidade ou preço.</p> : null}</section> : null}

        {successMessage ? <p className="products-message success" role="status">{successMessage}</p> : null}
        {errorMessage && !modalMode ? <p className="products-message error" role="alert">{errorMessage}</p> : null}
        {loadError ? <section className="products-message error" role="alert"><h2>Não foi possível carregar os produtos</h2><p>{loadError}</p><button type="button" className="products-secondary-button" onClick={() => setRetry(previous => previous + 1)}><RefreshCw size={20} aria-hidden="true" />Tentar novamente</button></section> : null}

        <section className="products-list-panel">
          {loadingProducts ? <p className="products-loading">Carregando produtos...</p> : null}

          {!loadingProducts && !loadError && filteredProducts.length === 0 ? (
            <p className="products-empty">{visibleProducts.length ? 'Nenhum produto encontrado. Confira a pesquisa ou os filtros.' : 'Nenhum produto cadastrado. Cadastre o primeiro produto quando precisar.'}</p>
          ) : null}

          {!loadingProducts && !loadError && filteredProducts.length > 0 ? (
            <div className="products-table-wrapper">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th>Código</th>
                    <th>Categoria</th>
                    <th>Tamanho</th>
                    <th>Cor</th>
                    <th>Estoque</th>
                    <th>Preço de venda</th>
                    <th className="products-mobile-value">Valor total para venda</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {shownProducts.map((product) => (
                    <tr key={product.id}>
                      <td data-label="Descrição">{productDescription(product)}</td>
                      <td data-label="Código">{present(product.code)}</td>
                      <td data-label="Categoria">{present(product.category)}</td>
                      <td data-label="Tamanho">{present(product.size)}</td>
                      <td data-label="Cor">{present(product.color)}</td>
                      <td data-label="Peças em estoque"><span className={productStock(product) === 0 ? 'product-stock-empty' : ''}>{productStock(product) === null ? 'Não informado' : productStock(product).toLocaleString('pt-BR')}{productStock(product) === 0 ? ' · Sem estoque' : ''}</span></td>
                      <td data-label="Preço de venda">{formatCurrency(product.salePrice)}</td>
                      <td className="products-mobile-value" data-label="Valor total para venda">{productValuation(product).saleCents === null ? 'Não confirmado' : currencyFormatter.format(productValuation(product).saleCents / 100)}</td>
                      <td data-label="Ações">
                        <div className="products-row-actions">
                          <button type="button" onClick={() => openViewModal(product)}><Eye size={20} aria-hidden="true" />Ver</button>
                          <button type="button" onClick={() => openEditModal(product)}>
                            <Pencil size={20} aria-hidden="true" />Editar
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
        {!loadingProducts && !loadError && filteredProducts.length ? <nav className="products-pagination" aria-label="Páginas de produtos"><p aria-live="polite">Mostrando {(currentPage - 1) * PAGE_SIZE + 1} a {Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} de {filteredProducts.length} produtos</p><div><button type="button" className="products-secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={22} aria-hidden="true" />Anterior</button><span>Página {currentPage} de {totalPages}</span><button type="button" className="products-secondary-button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Próxima<ChevronRight size={22} aria-hidden="true" /></button></div></nav> : null}
      </section>

      {modalMode && ownerUid === user?.uid ? (
        <div className="product-modal-overlay" role="presentation">
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title" ref={dialogRef}>
            <header className="product-modal-header">
              <h2 id="product-dialog-title">{modalMode === 'create' ? 'Novo produto' : modalMode === 'edit' ? 'Editar produto' : modalMode === 'view' ? 'Ficha do produto' : 'Excluir produto?'}</h2>
              <button type="button" className="products-secondary-button" onClick={closeModal} disabled={submitting}>
                <X size={20} aria-hidden="true" />Fechar
              </button>
            </header>

            {['create', 'edit'].includes(modalMode) ? <form className="product-form" onSubmit={handleSubmitProduct} noValidate aria-busy={submitting}>
              {PRODUCT_FORM_GROUPS.map(group => <fieldset disabled={submitting} key={group.title}><legend>{group.title}</legend><div className="product-form-grid">{group.fields.map(([field, label, required]) => <label htmlFor={field} key={field}>{label} <span>{required ? '(obrigatório)' : '(opcional)'}</span><input id={field} name={field} value={formData[field]} onChange={handleFormChange} required={Boolean(required)} inputMode={field === 'stockQuantity' ? 'numeric' : ['salePrice', 'costPrice'].includes(field) ? 'decimal' : 'text'} list={field === 'category' ? 'product-categories' : undefined} /></label>)}</div></fieldset>)}
              <datalist id="product-categories">{categories.map(category => <option value={category.label} key={category.value} />)}</datalist>
              <label htmlFor="observation">Observações <span>(opcional)</span><textarea id="observation" name="observation" rows="4" value={formData.observation} onChange={handleFormChange} disabled={submitting} /></label>
              {duplicates.length ? <section className="product-duplicate-warning" role="alert"><h3>Este código já aparece no cadastro</h3><p>Há {duplicates.length} produto(s) com esse código. Confira antes de continuar.</p><ul>{duplicates.map(product => <li key={product.id}>{productDescription(product)}</li>)}</ul><div className="product-form-actions"><button type="button" className="products-secondary-button" onClick={() => { setDuplicates([]); document.getElementById('code')?.focus() }} disabled={submitting}>Revisar código</button><button type="button" className="products-secondary-button" onClick={() => handleSubmitProduct(null, true)} disabled={submitting}>Salvar mesmo assim</button></div></section> : null}
              {errorMessage ? <p className="products-message error" role="alert">{errorMessage}</p> : null}
              <footer className="product-form-actions"><button type="button" className="products-secondary-button" onClick={closeModal} disabled={submitting}>Cancelar</button><button type="submit" className="products-primary-button" disabled={submitting}><Save size={21} aria-hidden="true" />{submitting ? 'Salvando…' : 'Salvar'}</button></footer>
            </form> : null}
            {modalMode === 'view' && profileProduct ? <div className="product-profile"><h3 className="product-profile-name">{productDescription(profileProduct)}</h3>
              <dl className="product-details">{[['Código', present(profileProduct.code)], ['Categoria', present(profileProduct.category)], ['Tamanho', present(profileProduct.size)], ['Cor', present(profileProduct.color)], ['Marca', present(profileProduct.brand)], ['Peças em estoque', productStock(profileProduct) === null ? 'Não informado' : productStock(profileProduct).toLocaleString('pt-BR')], ['Preço de venda por unidade', formatCurrency(profileProduct.salePrice)], ['Valor total para venda', profileValue.saleCents === null ? 'Não confirmado' : currencyFormatter.format(profileValue.saleCents / 100)], ['Preço de custo por unidade', formatCurrency(profileProduct.costPrice)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <p className="product-estimate-caption">Valor estimado se todas as unidades disponíveis forem vendidas pelo preço cadastrado. Não representa dinheiro recebido.</p>
              {profileValue.invalidQuantity || profileValue.invalidSalePrice ? <p className="products-review-note">Quantidade ou preço de venda precisa de revisão. Nenhum dado foi alterado.</p> : null}
              {profileProduct.observation ? <section><h3>Observações</h3><p className="product-observation">{profileProduct.observation}</p></section> : null}
              {relations.status === 'loading' ? <p role="status">Conferindo vendas vinculadas…</p> : null}
              {relations.status === 'error' ? <p className="products-message error" role="alert">{relations.error} A exclusão permanece bloqueada.</p> : null}
              {relations.status === 'ready' && relations.data.salesCount ? <p className="products-review-note">Este produto aparece em {relations.data.salesCount} venda(s). A exclusão está bloqueada para preservar o histórico.</p> : null}
              {relations.status === 'ready' && relations.data.unresolvedCount ? <p className="products-review-note">Há {relations.data.unresolvedCount} venda(s) ou item(ns) antigo(s) sem vínculo confiável. A exclusão fica bloqueada até a revisão, sem associar produtos pelo nome.</p> : null}
              {errorMessage ? <p className="products-message error" role="alert">{errorMessage}</p> : null}
              <footer className="product-form-actions"><button type="button" className="products-secondary-button" onClick={closeModal}><ArrowLeft size={21} aria-hidden="true" />Voltar</button><button type="button" className="products-primary-button" onClick={() => openEditModal(profileProduct)}><Pencil size={21} aria-hidden="true" />Editar</button><button type="button" className="products-danger-button" disabled={relations.status !== 'ready' || relations.data.salesCount > 0 || relations.data.unresolvedCount > 0} onClick={() => { setErrorMessage(''); setModalMode('delete') }}><Trash2 size={20} aria-hidden="true" />Excluir produto</button></footer>
            </div> : null}
            {modalMode === 'delete' ? <div className="product-profile"><p>Excluir o cadastro de <strong>{productDescription(selectedProduct)}</strong>?</p><p>Esta ação não pode ser desfeita. As vendas serão conferidas novamente antes de excluir.</p>{relations.status === 'loading' ? <p role="status">Conferindo vínculos…</p> : null}{relations.status === 'error' ? <p className="products-message error" role="alert">{relations.error}</p> : null}{errorMessage ? <p className="products-message error" role="alert">{errorMessage}</p> : null}{relations.data?.salesCount || relations.data?.unresolvedCount ? <p className="products-review-note">Exclusão bloqueada: há vínculos ou itens antigos que precisam de revisão.</p> : null}<footer className="product-form-actions"><button type="button" className="products-secondary-button" disabled={submitting} onClick={() => { setErrorMessage(''); setModalMode('view') }}>Cancelar</button><button type="button" className="products-danger-button" disabled={submitting || relations.status !== 'ready' || relations.data.salesCount > 0 || relations.data.unresolvedCount > 0} onClick={() => handleDeleteProduct(selectedProduct)}><Trash2 size={20} aria-hidden="true" />{submitting ? 'Excluindo…' : 'Confirmar exclusão'}</button></footer></div> : null}
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default ProductsPage
