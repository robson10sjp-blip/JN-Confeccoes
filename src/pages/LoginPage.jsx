import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import { useAuth } from '../hooks/useAuth'
import '../styles/auth-pages.css'
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
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <header className="auth-header">
          <BrandLogo />
          <h1 id="login-title">Acessar conta</h1>
          <p>Entre para continuar no sistema.</p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
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
              autoComplete="current-password"
              placeholder="Digite sua senha"
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

          {errorMessage && <p className="form-message error">{errorMessage}</p>}

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <footer className="auth-footer">
          <Link to="/register">Criar conta</Link>
          <Link to="/forgot-password">Esqueci minha senha</Link>
        </footer>
      </section>
    </main>
  )
}

export default LoginPage