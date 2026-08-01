const firestoreErrorDictionary = {
  'firestore/not-configured': 'Firebase Firestore não está configurado corretamente.',
  'auth/not-authenticated': 'Usuário não autenticado. Faça login novamente.',
  'permission-denied': 'Permissão negada pelo Firestore para esta operação.',
  unavailable: 'Serviço do Firestore indisponível no momento.',
  'failed-precondition': 'Pré-condição inválida para operação no Firestore.',
  'resource-exhausted': 'Limite de recursos do Firestore atingido.',
  cancelled: 'Operação cancelada no Firestore.',
  aborted: 'Operação abortada no Firestore.',
  'deadline-exceeded': 'Tempo de resposta do Firestore excedido.',
  'not-found': 'Registro não encontrado no Firestore.',
  'already-exists': 'Registro já existe no Firestore.',
  'invalid-argument': 'Dados inválidos para operação no Firestore.',
  internal: 'Erro interno do Firestore.',
  unknown: 'Erro desconhecido no Firestore.',
}

function normalizeFirebaseCode(error) {
  if (!error) {
    return 'unknown'
  }

  if (error.code) {
    return String(error.code).replace('Firebase: Error ', '').replace(/[().]/g, '')
  }

  if (error.message) {
    const message = String(error.message)
    const codeMatch = message.match(/\(([^)]+)\)/)

    if (codeMatch?.[1]) {
      return codeMatch[1]
    }
  }

  return 'unknown'
}

export function getFirebaseErrorMessage(error, fallbackMessage = 'Ocorreu um erro ao comunicar com o Firebase.') {
  const code = normalizeFirebaseCode(error)
  const codeWithoutPrefix = code.includes('/') ? code.split('/').pop() : code
  const mapped = firestoreErrorDictionary[code] || firestoreErrorDictionary[codeWithoutPrefix]

  if (mapped) {
    return `${mapped} (${code})`
  }

  if (error?.message) {
    return `${fallbackMessage} (${code}): ${error.message}`
  }

  return `${fallbackMessage} (${code})`
}
