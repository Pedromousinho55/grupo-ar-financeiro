// Cadastros usados nas telas de lançamento de contas (carregados uma vez por janela).
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

export interface Opcao {
  id: string
  nome: string
}
export interface FornecedorOpcao extends Opcao {
  documento: string
  prazo_padrao_dias: number | null
}
export interface ContaBancariaOpcao extends Opcao {
  loja_id: string
}

export interface CadastrosConta {
  lojas: (Opcao & { cnpj: string })[]
  fornecedores: FornecedorOpcao[]
  planos: Opcao[]
  centros: Opcao[]
  formas: Opcao[]
  bancos: ContaBancariaOpcao[]
  pronto: boolean
}

const VAZIO: CadastrosConta = { lojas: [], fornecedores: [], planos: [], centros: [], formas: [], bancos: [], pronto: false }

export function useCadastrosConta(): CadastrosConta {
  const [c, setC] = useState<CadastrosConta>(VAZIO)
  useEffect(() => {
    Promise.all([
      supabase.from('lojas').select('id, apelido, cnpj').eq('ativo', true).order('apelido'),
      supabase.from('fornecedores').select('id, razao_social, nome_fantasia, documento, prazo_padrao_dias').eq('ativo', true).order('razao_social').limit(5000),
      supabase.from('plano_contas').select('id, codigo, nome').eq('ativo', true).order('ordem_codigo', { nullsFirst: false }).order('nome'),
      supabase.from('centros_custo').select('id, nome').eq('ativo', true).order('nome'),
      supabase.from('formas_pagamento').select('id, nome').eq('ativo', true).order('nome'),
      supabase.from('contas_bancarias').select('id, descricao, loja_id').eq('ativo', true).order('descricao'),
    ]).then(([l, f, p, cc, fp, b]) =>
      setC({
        lojas: (l.data ?? []).map(x => ({ id: x.id, nome: x.apelido, cnpj: x.cnpj })),
        fornecedores: (f.data ?? []).map(x => ({
          id: x.id,
          nome: x.nome_fantasia ? `${x.razao_social} (${x.nome_fantasia})` : x.razao_social,
          documento: x.documento,
          prazo_padrao_dias: x.prazo_padrao_dias,
        })),
        planos: (p.data ?? []).map(x => ({ id: x.id, nome: x.codigo ? `${x.codigo} · ${x.nome}` : x.nome })),
        centros: (cc.data ?? []).map(x => ({ id: x.id, nome: x.nome })),
        formas: (fp.data ?? []).map(x => ({ id: x.id, nome: x.nome })),
        bancos: (b.data ?? []).map(x => ({ id: x.id, nome: x.descricao, loja_id: x.loja_id })),
        pronto: true,
      }),
    )
  }, [])
  return c
}

/** Última classificação usada para um fornecedor (para sugerir no próximo lançamento). */
export async function ultimaClassificacao(fornecedorId: string | null) {
  if (!fornecedorId) return null
  const { data } = await supabase
    .from('contas_pagar')
    .select('plano_conta_id, centro_custo_id, forma_pagamento_id')
    .eq('fornecedor_id', fornecedorId)
    .neq('status', 'cancelada')
    .order('criado_em', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}
