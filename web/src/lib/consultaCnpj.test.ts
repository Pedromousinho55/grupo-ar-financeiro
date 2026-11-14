import { describe, expect, it } from 'vitest'
import { deBrasilApi, deCnpja } from './consultaCnpj'

// Amostras no formato real das duas fontes (consultadas em 15/11/2026 para o CNPJ do Arvo), só com os campos usados.
const BRASILAPI = {
  razao_social: 'ARVO RESTAURANTE LTDA',
  nome_fantasia: '',
  descricao_situacao_cadastral: 'ATIVA',
  ddd_telefone_1: '8134279437',
  email: null,
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DJALMA FARIAS',
  numero: '170',
  complemento: '',
  bairro: 'TORREAO',
  municipio: 'RECIFE',
  uf: 'PE',
  cep: '52030195',
  cnae_fiscal: 5611201,
  cnae_fiscal_descricao: 'Restaurantes e similares',
}
const CNPJA = {
  alias: null,
  company: { name: 'ARVO RESTAURANTE LTDA' },
  status: { id: 2, text: 'Ativa' },
  address: { street: 'Rua Djalma Farias', number: '170', district: 'Torreao', city: 'Recife', state: 'PE', details: null, zip: '52030195' },
  phones: [{ type: 'LANDLINE', area: '81', number: '34279437' }],
  emails: [{ address: 'arvorestaurante@gmail.com' }],
  mainActivity: { id: 5611201, text: 'Restaurantes e similares' },
}

describe('consulta de CNPJ', () => {
  it('converte a resposta da BrasilAPI', () => {
    const d = deBrasilApi(BRASILAPI)
    expect(d.razao_social).toBe('ARVO RESTAURANTE LTDA')
    expect(d.nome_fantasia).toBeNull()
    expect(d.endereco).toBe('RUA DJALMA FARIAS, 170')
    expect(d.telefone).toBe('(81) 3427-9437')
    expect(d.cnae_principal).toBe('56.11-2-01 Restaurantes e similares')
    expect(d.situacao_cadastral).toBe('ATIVA')
  })
  it('converte a resposta da CNPJá (reserva) no mesmo formato', () => {
    const d = deCnpja(CNPJA)
    expect(d.razao_social).toBe('ARVO RESTAURANTE LTDA')
    expect(d.endereco).toBe('Rua Djalma Farias, 170')
    expect(d.telefone).toBe('(81) 3427-9437')
    expect(d.email).toBe('arvorestaurante@gmail.com')
    expect(d.cnae_principal).toBe('56.11-2-01 Restaurantes e similares')
    expect(d.situacao_cadastral).toBe('ATIVA')
  })
})
