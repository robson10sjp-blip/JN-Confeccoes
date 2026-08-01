import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sidebarMenuItems } from '../constants/sidebarMenu'
import { useAuth } from '../hooks/useAuth'
import DashboardLayout from '../layouts/DashboardLayout'
import {
  createProductByUser,
  deleteProductByUser,
  subscribeProductsByUser,
  updateProductByUser,
} from '../services/productsService'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import '../styles/products-page.css'

const PRODUCT_INITIAL_STATE = {
  code: '',
  description: '',
  category: '',
  size: '',
  color: '',
  brand: '',
  stockQuantity: '',
  costPrice: '',
  salePrice: '',
  observation: '',
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') {
    return 'R$ 0,00'
  }

  const numberValue = Number(value)

  if (Number.isNaN(numberValue)) {
    return 'R$ 0,00'
  }

  return currencyFormatter.format(numberValue)
}

function mapProductToForm(product) {
  return {
    code: product?.code || '',
    description: product?.description || '',
    category: product?.category || '',
    size: product?.size || '',
    color: product?.color || '',
    brand: product?.brand || '',
    stockQuantity: product?.stockQuantity === 0 ? '0' : String(product?.stockQuantity || ''),
    costPrice: product?.costPrice === 0 ? '0' : String(product?.costPrice || ''),
    salePrice: product?.salePrice === 0 ? '0' : String(product?.salePrice || ''),
    observation: product?.observation || '',
  }
}

function ProductsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeItem, setActiveItem] = useState('produtos')
  const [products, setProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [modalMode, setModalMode] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [formData, setFormData] = useState(PRODUCT_INITIAL_STATE)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'Usuário'

  const filteredProducts = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase()

    if (!normalizedTerm) {
      return products
    }

    return products.filter((product) => {
      const code = String(product.code || '').toLowerCase()
      const description = String(product.description || '').toLowerCase()
      return code.includes(normalizedTerm) || description.includes(normalizedTerm)
    })
  }, [products, searchTerm])

  useEffect(() => {
    if (!user?.uid) {
      setProducts([])
      setLoadingProducts(false)
      return () => {}
    }

    setLoadingProducts(true)
    setErrorMessage('')

    const unsubscribe = subscribeProductsByUser(
      user.uid,
      (fetchedProducts) => {
        setProducts(fetchedProducts)
        setLoadingProducts(false)
      },
      (error) => {
        console.error('Erro ao observar produtos:', error)
        setErrorMessage(getFirebaseErrorMessage(error, 'Falha ao carregar produtos'))
        setLoadingProducts(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

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
    setFormData(PRODUCT_INITIAL_STATE)
    setModalMode('create')
  }

  const openEditModal = (product) => {
    setErrorMessage('')
    setSuccessMessage('')
    setSelectedProduct(product)
    setFormData(mapProductToForm(product))
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode('')
    setSelectedProduct(null)
    setFormData(PRODUCT_INITIAL_STATE)
  }

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setFormData((previousState) => ({
      ...previousState,
      [name]: value,
    }))
  }

  const validateProductForm = () => {
    if (!formData.code.trim()) {
      return 'Código é obrigatório.'
    }

    if (!formData.description.trim()) {
      return 'Descrição é obrigatória.'
    }

    if (!formData.category.trim()) {
      return 'Categoria é obrigatória.'
    }

    if (!formData.stockQuantity.toString().trim()) {
      return 'Estoque é obrigatório.'
    }

    if (!formData.salePrice.toString().trim()) {
      return 'Preço de venda é obrigatório.'
    }

    const stockValue = Number(formData.stockQuantity)
    const saleValue = Number(formData.salePrice)
    const costValue = Number(formData.costPrice || 0)

    if (Number.isNaN(stockValue) || stockValue < 0) {
      return 'Estoque deve ser um número válido maior ou igual a zero.'
    }

    if (Number.isNaN(saleValue) || saleValue < 0) {
      return 'Preço de venda deve ser um valor válido.'
    }

    if (Number.isNaN(costValue) || costValue < 0) {
      return 'Preço de custo deve ser um valor válido.'
    }

    return ''
  }

  const normalizePayload = () => ({
    code: formData.code.trim(),
    description: formData.description.trim(),
    category: formData.category.trim(),
    size: formData.size.trim(),
    color: formData.color.trim(),
    brand: formData.brand.trim(),
    stockQuantity: Number(formData.stockQuantity),
    costPrice: Number(formData.costPrice || 0),
    salePrice: Number(formData.salePrice),
    observation: formData.observation.trim(),
  })

  const handleSubmitProduct = async (event) => {
    event.preventDefault()

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
      const payload = normalizePayload()

      if (modalMode === 'create') {
        await createProductByUser(user.uid, payload)
        setSuccessMessage('Salvo com sucesso.')
      }

      if (modalMode === 'edit' && selectedProduct?.id) {
        await updateProductByUser(user.uid, selectedProduct.id, payload)
        setSuccessMessage('Atualizado com sucesso.')
      }

      closeModal()
    } catch (error) {
      console.error('Erro ao salvar produto:', error)
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

    const hasConfirmed = window.confirm(`Deseja excluir o produto ${product.description}?`)

    if (!hasConfirmed) {
      return
    }

    try {
      setDeletingId(product.id)
      setErrorMessage('')
      await deleteProductByUser(user.uid, product.id)
      setSuccessMessage('Excluído com sucesso.')
    } catch (error) {
      console.error('Erro ao excluir produto:', error)
      setErrorMessage(getFirebaseErrorMessage(error, 'Não foi possível excluir o produto'))
    } finally {
      setDeletingId('')
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
            <h1>Produtos</h1>
            <p>Gerencie o catálogo de produtos da JN Confecções.</p>
          </div>
          <button type="button" className="products-primary-button" onClick={openCreateModal}>
            Novo Produto
          </button>
        </header>

        <section className="products-toolbar">
          <input
            type="search"
            placeholder="Pesquisar por código ou descrição"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </section>

        {successMessage ? <p className="products-message success">{successMessage}</p> : null}
        {errorMessage ? <p className="products-message error">{errorMessage}</p> : null}

        <section className="products-list-panel">
          {loadingProducts ? <p className="products-loading">Carregando produtos...</p> : null}

          {!loadingProducts && filteredProducts.length === 0 ? (
            <p className="products-empty">Nenhum produto cadastrado</p>
          ) : null}

          {!loadingProducts && filteredProducts.length > 0 ? (
            <div className="products-table-wrapper">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Tamanho</th>
                    <th>Cor</th>
                    <th>Estoque</th>
                    <th>Preço de venda</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id}>
                      <td>{product.code || '-'}</td>
                      <td>{product.description || '-'}</td>
                      <td>{product.category || '-'}</td>
                      <td>{product.size || '-'}</td>
                      <td>{product.color || '-'}</td>
                      <td>{product.stockQuantity ?? 0}</td>
                      <td>{formatCurrency(product.salePrice)}</td>
                      <td>
                        <div className="products-row-actions">
                          <button type="button" onClick={() => openEditModal(product)}>
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteProduct(product)}
                            disabled={deletingId === product.id}
                          >
                            {deletingId === product.id ? 'Excluindo...' : '🗑️ Excluir'}
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
      </section>

      {modalMode ? (
        <div className="product-modal-overlay" role="presentation" onClick={closeModal}>
          <section className="product-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="product-modal-header">
              <h2>{modalMode === 'create' ? 'Novo produto' : 'Editar produto'}</h2>
              <button type="button" className="close-button" onClick={closeModal}>
                Fechar
              </button>
            </header>

            <form className="product-form" onSubmit={handleSubmitProduct}>
              <label htmlFor="code">Código</label>
              <input id="code" name="code" value={formData.code} onChange={handleFormChange} />

              <label htmlFor="description">Descrição do produto</label>
              <input
                id="description"
                name="description"
                value={formData.description}
                onChange={handleFormChange}
              />

              <label htmlFor="category">Categoria</label>
              <select id="category" name="category" value={formData.category} onChange={handleFormChange}>
                <option value="">Selecione</option>
                <option value="Masculino">Masculino</option>
                <option value="Feminino">Feminino</option>
                <option value="Infantil">Infantil</option>
              </select>

              <label htmlFor="size">Tamanho</label>
              <input id="size" name="size" value={formData.size} onChange={handleFormChange} />

              <label htmlFor="color">Cor</label>
              <input id="color" name="color" value={formData.color} onChange={handleFormChange} />

              <label htmlFor="brand">Marca</label>
              <input id="brand" name="brand" value={formData.brand} onChange={handleFormChange} />

              <label htmlFor="stockQuantity">Quantidade em estoque</label>
              <input
                id="stockQuantity"
                name="stockQuantity"
                type="number"
                min="0"
                value={formData.stockQuantity}
                onChange={handleFormChange}
              />

              <label htmlFor="costPrice">Preço de custo</label>
              <input
                id="costPrice"
                name="costPrice"
                type="number"
                min="0"
                step="0.01"
                value={formData.costPrice}
                onChange={handleFormChange}
              />

              <label htmlFor="salePrice">Preço de venda</label>
              <input
                id="salePrice"
                name="salePrice"
                type="number"
                min="0"
                step="0.01"
                value={formData.salePrice}
                onChange={handleFormChange}
              />

              <label htmlFor="observation">Observação</label>
              <textarea
                id="observation"
                name="observation"
                rows="4"
                value={formData.observation}
                onChange={handleFormChange}
              />

              <button type="submit" className="products-primary-button" disabled={submitting}>
                {submitting ? 'Salvando...' : 'Salvar'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </DashboardLayout>
  )
}

export default ProductsPage
