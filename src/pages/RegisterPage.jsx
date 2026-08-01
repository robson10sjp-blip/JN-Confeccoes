import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import { useAuth } from '../hooks/useAuth'
import '../styles/auth-pages.css'
import { getAuthErrorMessage } from '../utils/authErrors'

function RegisterPage() {
  const redirectTimerRef = useRef(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const { user, register } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) {
      setErrorMessage('Informe seu nome para continuar.')
      return
    }

    if (!trimmedEmail) {
      setErrorMessage('Informe seu e-mail para continuar.')
      return
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)

    if (!isValidEmail) {
      setErrorMessage('Digite um e-mail válido.')
      return
    }

    if (!password || !confirmPassword) {
      setErrorMessage('Preencha senha e confirmação para continuar.')
      return
    }

    if (password.length < 6) {
      setErrorMessage('A senha deve ter pelo menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('A confirmação de senha deve ser igual à senha.')
      return
    }

    try {
      setSubmitting(true)
      await register(trimmedName, trimmedEmail, password)
      setSuccessMessage('Cadastro realizado com sucesso. Redirecionando para o Dashboard...')
      redirectTimerRef.current = setTimeout(() => {
        navigate('/dashboard', { replace: true })
      }, 900)
    } catch (error) {
      console.error('Erro Firebase Auth no cadastro:', error?.code || 'auth/unknown', error)
      setErrorMessage(getAuthErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <header className="auth-header">
          <BrandLogo />
          <h1 id="register-title">Criar conta</h1>
          <p>Cadastre-se para acessar o sistema.</p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="name">Nome</label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Seu nome"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="seuemail@exemplo.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="password">Senha</label>
          <div className="password-field">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Crie uma senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setShowPassword((previous) => !previous)}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>

          <label htmlFor="confirm-password">Confirmar senha</label>
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Repita a senha"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />

          {errorMessage && <p className="form-message error">{errorMessage}</p>}
          {successMessage && <p className="form-message success">{successMessage}</p>}

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Criando conta...' : 'Cadastrar'}
          </button>
        </form>

        <footer className="auth-footer auth-footer-center">
          <Link to="/login">Já tenho uma conta</Link>
        </footer>
      </section>
    </main>
  )
}

export default RegisterPage