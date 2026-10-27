export function displayText(value, fallback = 'Não informado') {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim()
  return text || fallback
}

const productWords = new Set(['panela', 'panelas', 'camisa', 'camisas', 'camiseta', 'camisetas', 'calça', 'calças', 'utensílio', 'utensílios', 'jogo', 'jogos', 'de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem'])

export function displayProductDescription(value) {
  const text = displayText(value, '')
  if (!text) return 'Não informado'
  return text.split(' ').map((word, index) => {
    const lower = word.toLocaleLowerCase('pt-BR')
    if (!productWords.has(lower)) return word
    return index === 0 ? lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1) : lower
  }).join(' ')
}