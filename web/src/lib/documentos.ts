// Validação e formatação de CNPJ, CPF e chave de acesso NF-e.
// As mesmas regras existem no banco (defesa em dobro).

export const soDigitos = (t: string | null | undefined): string => (t ?? '').replace(/\D/g, '')

export function cnpjValido(doc: string): boolean {
  const d = soDigitos(doc)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (base: string, pesos: number[]) => {
    const s = pesos.reduce((acc, p, i) => acc + Number(base[i]) * p, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  const dv1 = calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const dv2 = calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return dv1 === Number(d[12]) && dv2 === Number(d[13])
}

export function cpfValido(doc: string): boolean {
  const d = soDigitos(doc)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const calc = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export const documentoValido = (doc: string) => cnpjValido(doc) || cpfValido(doc)

export function formatarDocumento(doc: string | null | undefined): string {
  const d = soDigitos(doc)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return doc ?? ''
}

/** Chave NF-e: 44 dígitos; o último é DV módulo 11 com pesos 2..9 da direita para a esquerda. */
export function chaveNfeValida(chave: string): boolean {
  const d = soDigitos(chave)
  if (d.length !== 44) return false
  let soma = 0
  let peso = 2
  for (let i = 42; i >= 0; i--) {
    soma += Number(d[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  let dv = 11 - (soma % 11)
  if (dv >= 10) dv = 0
  return dv === Number(d[43])
}
