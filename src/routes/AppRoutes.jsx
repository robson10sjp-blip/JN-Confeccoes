import { Navigate, Route, Routes } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../hooks/useAuth'
import ClientsPage from '../pages/ClientsPage'
import DashboardPage from '../pages/DashboardPage'
import ForgotPasswordPage from '../pages/ForgotPasswordPage'
import LoginPage from '../pages/LoginPage'
import RegisterPage from '../pages/RegisterPage'

function AppRoutes() {
  const { loading } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/clientes"
        element={
          <ProtectedRoute>
            <ClientsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default AppRoutes