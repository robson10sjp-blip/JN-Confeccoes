const authErrorDictionary = {
  'auth/not-configured': 'O Firebase do JN não foi configurado neste ambiente. Preencha as variáveis VITE_FIREBASE_* e reinicie o servidor local ou gere uma nova versão do site.',
  'auth/initialization-failed': 'Não foi possível inicializar a autenticação do JN. Confira a configuração Firebase deste ambiente.',
  'auth/firebase-project-mismatch': 'O projeto Firebase inicializado não corresponde à configuração deste ambiente. Confira os dados do JN e reinicie a aplicação.',
  'auth/invalid-api-key': 'A configuração Firebase deste ambiente contém uma chave inválida. Confira os dados do aplicativo web do JN.',
  'auth/operation-not-allowed': 'O login por e-mail e senha não está habilitado no projeto Firebase. Confira Authentication no projeto do JN.',
  'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication do JN.',
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
    if (code === 'auth/not-configured' && Array.isArray(error?.missingEnvKeys)) {
      const missingKeys = error.missingEnvKeys.filter(key => /^VITE_FIREBASE_[A-Z_]+$/.test(key))
      return `${mappedMessage} Variáveis ausentes: ${missingKeys.join(', ')} (${code})`
    }
    return `${mappedMessage} (${code})`
  }

  return `Erro de autenticação: ${code}`
}