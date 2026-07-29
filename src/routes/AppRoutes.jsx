import { Navigate, Route, Routes } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../hooks/useAuth'
import ClientsPage from '../pages/ClientsPage'
import DashboardPage from '../pages/DashboardPage'
import FinancialPage from '../pages/FinancialPage'
import ForgotPasswordPage from '../pages/ForgotPasswordPage'
import LoginPage from '../pages/LoginPage'
import ProductsPage from '../pages/ProductsPage'
import RegisterPage from '../pages/RegisterPage'
import SalesPage from '../pages/SalesPage'

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
      <Route
        path="/produtos"
        element={
          <ProtectedRoute>
            <ProductsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vendas"
        element={
          <ProtectedRoute>
            <SalesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/financeiro"
        element={
          <ProtectedRoute>
            <FinancialPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default AppRoutes