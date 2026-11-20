import { describe, expect, it } from 'vitest'
import { regraBate, regraDaLinha, type Regra } from './regras'

const base: Regra = {
  id: 'r',
  nome: 'r',
  ativo: true,
  prioridade: 100,
  conta_bancaria_id: null,
  sentido: 'ambos',
  texto: 'APLICACAO CONTAMAX',
  modo_texto: 'comeca',
  valor_min: null,
  valor_max: null,
  acao: 'transferencia',
  plano_conta_id: null,
  centro_custo_id: null,
  fornecedor_id: null,
  forma_pagamento_id: null,
  descricao_conta: null,
  automatica: true,
  criado_em: '2026-11-20T10:00:00Z',
}
const linha = (descricao: string, valor = -10, conta = 'c1') => ({ descricao, valor, conta_bancaria_id: conta })

describe('regras de conciliação', () => {
  it('começa com / contém, sem diferenciar maiúsculas', () => {
    expect(regraBate(base, linha('APLICACAO CONTAMAX'))).toBe(true)
    expect(regraBate(base, linha('aplicacao contamax extra'))).toBe(true)
    expect(regraBate(base, linha('RESGATE APLICACAO CONTAMAX'))).toBe(false)
    expect(regraBate({ ...base, modo_texto: 'contem' }, linha('RESGATE APLICACAO CONTAMAX'))).toBe(true)
  })
  it('sentido, faixa de valor, conta e regra inativa', () => {
    const r = { ...base, texto: 'PIX', sentido: 'saida' as const, valor_min: 10, valor_max: 100, conta_bancaria_id: 'c1' }
    expect(regraBate(r, linha('PIX ENVIADO', -50))).toBe(true)
    expect(regraBate(r, linha('PIX RECEBIDO', 50))).toBe(false)
    expect(regraBate(r, linha('PIX ENVIADO', -150))).toBe(false)
    expect(regraBate(r, linha('PIX ENVIADO', -5))).toBe(false)
    expect(regraBate(r, linha('PIX ENVIADO', -50, 'c2'))).toBe(false)
    expect(regraBate({ ...r, ativo: false }, linha('PIX ENVIADO', -50))).toBe(false)
  })
  it('a regra de menor prioridade decide', () => {
    const geral = { ...base, id: 'geral', texto: 'PIX', prioridade: 100 }
    const especifica = { ...base, id: 'especifica', texto: 'PIX ENVIADO · RECEITA FEDERAL', prioridade: 10 }
    expect(regraDaLinha([geral, especifica], linha('PIX ENVIADO · RECEITA FEDERAL'))?.id).toBe('especifica')
    expect(regraDaLinha([geral, especifica], linha('PIX ENVIADO · OUTRO'))?.id).toBe('geral')
    expect(regraDaLinha([especifica], linha('TED'))).toBeNull()
  })
})
