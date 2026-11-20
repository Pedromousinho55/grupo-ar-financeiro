// Leitor mínimo de .xlsx (primeira planilha → linhas de texto), sem dependências.
// Necessário porque as planilhas exportadas pelo Santander usam um formato de zip
// ("data descriptor") que a biblioteca de Excel do site não abre.

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

interface Entrada {
  nome: string
  metodo: number
  tamanho: number
  inicioLocal: number
}

function diretorio(b: Uint8Array): Entrada[] {
  // fim do diretório central: assinatura 0x06054b50, procurada de trás para frente
  let fim = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (u32(b, i) === 0x06054b50) {
      fim = i
      break
    }
  if (fim < 0) throw new Error('Arquivo .xlsx inválido (não é um zip).')
  const total = u16(b, fim + 10)
  let p = u32(b, fim + 16)
  const dec = new TextDecoder()
  const res: Entrada[] = []
  for (let i = 0; i < total; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('Arquivo .xlsx corrompido.')
    const metodo = u16(b, p + 10)
    const tamanho = u32(b, p + 20)
    const nLen = u16(b, p + 28)
    const extra = u16(b, p + 30)
    const coment = u16(b, p + 32)
    const inicioLocal = u32(b, p + 42)
    res.push({ nome: dec.decode(b.subarray(p + 46, p + 46 + nLen)), metodo, tamanho, inicioLocal })
    p += 46 + nLen + extra + coment
  }
  return res
}

async function conteudo(b: Uint8Array, e: Entrada): Promise<string> {
  const o = e.inicioLocal
  const dados = b.subarray(o + 30 + u16(b, o + 26) + u16(b, o + 28), o + 30 + u16(b, o + 26) + u16(b, o + 28) + e.tamanho)
  if (e.metodo === 0) return new TextDecoder().decode(dados)
  if (e.metodo !== 8) throw new Error('Compressão do .xlsx não suportada.')
  const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new TextDecoder().decode(await new Response(fluxo).arrayBuffer())
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const texto = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTIDADES[e] ?? m),
  )
const juntarT = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => texto(m[1])).join('')

const coluna = (ref: string) => {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  return [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
}

/** Linhas da primeira planilha do .xlsx, como texto (números ficam como estão na célula). */
export async function lerXlsx(bytes: ArrayBuffer): Promise<string[][]> {
  const b = new Uint8Array(bytes)
  const entradas = diretorio(b)
  const achar = (nome: string) => entradas.find(e => e.nome === nome)
  const comp = achar('xl/sharedStrings.xml')
  const compartilhadas = comp ? [...(await conteudo(b, comp)).matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => juntarT(m[1])) : []
  const planilha = entradas.filter(e => /^xl\/worksheets\/sheet\d*\.xml$/.test(e.nome)).sort((a, z) => a.nome.localeCompare(z.nome, 'en', { numeric: true }))[0]
  if (!planilha) throw new Error('Planilha vazia.')
  const xml = await conteudo(b, planilha)
  const linhas: string[][] = []
  for (const r of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const linha: string[] = []
    for (const c of r[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = c[1]
      const corpo = c[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
      const tipo = /\bt="(\w+)"/.exec(attrs)?.[1]
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(corpo)?.[1]
      let valor = ''
      if (tipo === 's' && v !== undefined) valor = compartilhadas[Number(v)] ?? ''
      else if (tipo === 'inlineStr') valor = juntarT(corpo)
      else if (v !== undefined) valor = texto(v)
      const i = ref ? coluna(ref) : linha.length
      while (linha.length < i) linha.push('')
      linha[i] = valor.trim()
    }
    linhas.push(linha)
  }
  return linhas
}
