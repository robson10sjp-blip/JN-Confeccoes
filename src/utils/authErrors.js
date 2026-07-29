const authErrorDictionary = {
  'auth/invalid-credential': 'E-mail ou senha inválidos.',
  'auth/wrong-password': 'E-mail ou senha inválidos.',
  'auth/user-not-found': 'E-mail ou senha inválidos.',
  'auth/invalid-email': 'Digite um e-mail válido.',
  'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
  'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet e tente novamente.',
}

export function getAuthErrorMessage(error) {
  const normalizedCode = error?.code || error?.message || 'auth/unknown'
  const code = String(normalizedCode).replace('Firebase: Error ', '').replace(/[().]/g, '')
  const mappedMessage = authErrorDictionary[code]

  if (mappedMessage) {
    return `${mappedMessage} (${code})`
  }

  return `Erro de autenticação: ${code}`
}