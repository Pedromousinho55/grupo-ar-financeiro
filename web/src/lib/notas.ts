// Nomes e regras do cofre de notas usados pelas telas.

export type StatusNota = 'na_sefaz' | 'recebida' | 'lancada' | 'problema' | 'nao_reconhecida'
export type SituacaoSefaz = 'autorizada' | 'cancelada' | 'denegada'

export const NOME_STATUS: Record<StatusNota, string> = {
  na_sefaz: 'A conferir',
  recebida: 'Recebida',
  lancada: 'Lançada',
  problema: 'Com problema',
  nao_reconhecida: 'Não reconhecida',
}

export const EXPLICA_STATUS: Record<StatusNota, string> = {
  na_sefaz: 'Nota emitida contra a loja; ninguém confirmou ainda o recebimento.',
  recebida: 'Mercadoria/serviço conferido e recebido pela loja.',
  lancada: 'Já lançada no contas a pagar (Etapa 3).',
  problema: 'Recebida com divergência (quantidade, preço, avaria…). Explique na observação.',
  nao_reconhecida: 'A loja não fez essa compra. Avise a contabilidade (não manifestamos pelo sistema).',
}

/** Status que o usuário pode escolher na tela. "Lançada" virá do contas a pagar (Etapa 3). */
export const STATUS_ESCOLHA: StatusNota[] = ['na_sefaz', 'recebida', 'problema', 'nao_reconhecida']

export const CLASSE_STATUS: Record<StatusNota, string> = {
  na_sefaz: 'neutro',
  recebida: 'ok',
  lancada: 'ok',
  problema: 'erro',
  nao_reconhecida: 'erro',
}

export const NOME_SITUACAO: Record<SituacaoSefaz, string> = {
  autorizada: 'Autorizada',
  cancelada: 'Cancelada',
  denegada: 'Denegada',
}

export const FORMA_PAGAMENTO: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '05': 'Crédito loja',
  '10': 'Vale alimentação',
  '11': 'Vale refeição',
  '15': 'Boleto',
  '16': 'Depósito',
  '17': 'PIX',
  '18': 'Transferência',
  '90': 'Sem pagamento',
  '99': 'Outros',
}

export const dinheiro = (v: number | string | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const dataBr = (v: string | null | undefined): string => {
  if (!v) return '—'
  // datas sem hora (vencimentos) não podem "voltar um dia" pelo fuso
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' })
}

/** Primeiro e último dia do mês (AAAA-MM-DD) de uma data. */
export function mesDe(d = new Date()): { de: string; ate: string } {
  const p = (n: number) => String(n).padStart(2, '0')
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { de: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, ate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(ultimo)}` }
}

/** Intervalo de emissão no fuso de Recife, para o filtro do banco (fim exclusivo). */
export function intervaloEmissao(de: string, ate: string): { inicio: string | null; fimExclusivo: string | null } {
  const proximoDia = (dia: string) => {
    const d = new Date(dia + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  return {
    inicio: de ? `${de}T00:00:00-03:00` : null,
    fimExclusivo: ate ? `${proximoDia(ate)}T00:00:00-03:00` : null,
  }
}

/** Texto de busca seguro para o filtro "or" do PostgREST (vírgula e parênteses quebram a sintaxe). */
export const limparBusca = (t: string): string => t.replace(/[,()*%\\"]/g, ' ').trim()
