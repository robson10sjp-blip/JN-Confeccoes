import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import '../styles/login-premium.css'
import { getAuthErrorMessage } from '../utils/authErrors'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = location.state?.from?.pathname || '/dashboard'

  if (user) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')

    if (!email || !password) {
      setErrorMessage('Preencha e-mail e senha para entrar.')
      return
    }

    try {
      setSubmitting(true)
      await login(email, password)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-premium-page">
      <section className="login-premium-card" aria-labelledby="login-title">
        <header className="login-premium-header">
          <div className="login-premium-logo" aria-label="Espaco para logo JN Confeccoes">
            JN
          </div>
          <h1 id="login-title">Bem-vindo</h1>
          <p>Acesse sua conta para continuar.</p>
        </header>

        <form className="login-premium-form" onSubmit={handleSubmit}>
          <label htmlFor="email">E-mail</label>
          <div className="login-input-wrapper">
            <span className="login-input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6H20V18H4V6Z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M4 8L12 13L20 8" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="seuemail@exemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <label htmlFor="password">Senha</label>
          <div className="login-input-wrapper password-field-premium">
            <span className="login-input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 11V8.5C8 6.57 9.57 5 11.5 5H12.5C14.43 5 16 6.57 16 8.5V11" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Digite sua senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((previous) => !previous)}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>

          {errorMessage && <p className="login-form-message error">{errorMessage}</p>}

          <button type="submit" className="login-submit-button" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <footer className="login-premium-footer">
          <Link to="/forgot-password">Esqueci minha senha</Link>
          <Link to="/register">Criar conta</Link>
        </footer>
      </section>
    </main>
  )
}

export default LoginPage