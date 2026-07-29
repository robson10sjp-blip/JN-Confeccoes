import { createContext, useEffect, useMemo, useState } from 'react'
import {
  loginUser,
  logoutUser,
  observeAuthState,
  registerUser,
  sendResetPassword,
} from '../services/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = observeAuthState((currentUser) => {
      setUser(currentUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      login: (email, password) => loginUser(email, password),
      register: (name, email, password) => registerUser(name, email, password),
      resetPassword: (email) => sendResetPassword(email),
      logout: () => logoutUser(),
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { AuthContext }