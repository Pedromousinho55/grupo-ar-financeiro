// Regras de conciliação: mesma lógica da função regra_bate do banco (migração 15).

export interface Regra {
  id: string
  nome: string
  ativo: boolean
  prioridade: number
  conta_bancaria_id: string | null
  sentido: 'saida' | 'entrada' | 'ambos'
  texto: string
  modo_texto: 'comeca' | 'contem'
  valor_min: number | null
  valor_max: number | null
  acao: 'conta_pagar' | 'receita' | 'transferencia'
  plano_conta_id: string | null
  centro_custo_id: string | null
  fornecedor_id: string | null
  forma_pagamento_id: string | null
  descricao_conta: string | null
  automatica: boolean
  criado_em: string
}

export interface LinhaParaRegra {
  conta_bancaria_id: string
  valor: number
  descricao: string | null
}

export function regraBate(r: Regra, l: LinhaParaRegra): boolean {
  if (!r.ativo) return false
  if (r.conta_bancaria_id && r.conta_bancaria_id !== l.conta_bancaria_id) return false
  if (r.sentido === 'saida' && !(l.valor < 0)) return false
  if (r.sentido === 'entrada' && !(l.valor > 0)) return false
  const v = Math.abs(l.valor)
  if (r.valor_min !== null && v < Number(r.valor_min)) return false
  if (r.valor_max !== null && v > Number(r.valor_max)) return false
  const desc = (l.descricao ?? '').toUpperCase()
  const t = r.texto.trim().toUpperCase()
  return r.modo_texto === 'comeca' ? desc.startsWith(t) : desc.includes(t)
}

/** A regra que decide a linha: a primeira (por prioridade, depois a mais antiga) que bate. */
export function regraDaLinha(regras: Regra[], l: LinhaParaRegra): Regra | null {
  return [...regras].sort((a, b) => a.prioridade - b.prioridade || a.criado_em.localeCompare(b.criado_em)).find(r => regraBate(r, l)) ?? null
}

export const NOME_ACAO: Record<Regra['acao'], string> = {
  transferencia: 'Transferência / aplicação',
  receita: 'Receita',
  conta_pagar: 'Conta a pagar (já paga)',
}

export const NOME_SENTIDO: Record<Regra['sentido'], string> = { saida: 'Saídas', entrada: 'Entradas', ambos: 'Saídas e entradas' }
