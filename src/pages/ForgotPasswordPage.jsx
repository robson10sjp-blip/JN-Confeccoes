import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import { useAuth } from '../hooks/useAuth'
import '../styles/auth-pages.css'
import { getAuthErrorMessage } from '../utils/authErrors'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const { user, resetPassword } = useAuth()

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!email) {
      setErrorMessage('Informe seu e-mail para recuperar a senha.')
      return
    }

    try {
      setSubmitting(true)
      await resetPassword(email)
      setSuccessMessage('Enviamos o link de recuperação para seu e-mail.')
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="forgot-title">
        <header className="auth-header">
          <BrandLogo />
          <h1 id="forgot-title">Esqueci minha senha</h1>
          <p>Digite seu e-mail para receber o link de recuperação.</p>
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

          {errorMessage && <p className="form-message error">{errorMessage}</p>}
          {successMessage && <p className="form-message success">{successMessage}</p>}

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Enviando...' : 'Enviar link de recuperação'}
          </button>
        </form>

        <footer className="auth-footer auth-footer-center">
          <Link to="/login">Voltar para login</Link>
        </footer>
      </section>
    </main>
  )
}

export default ForgotPasswordPage