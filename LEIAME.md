# Grupo AR – Sistema Financeiro

Sistema financeiro próprio do Grupo AR (independente do GRFood): notas fiscais da SEFAZ,
contas a pagar, bancos e relatórios das lojas Terra, Arvo, Lara Pina, Voar e Lara Jaqueira.

## Arquitetura (decidida em 14/11/2026)
- **Supabase** (servidor em São Paulo): banco de dados, logins, permissões e arquivos (XML/PDF/comprovantes).
- **Site** (interface no navegador), com login individual.
- **Coletor local** (Windows, no escritório): guarda os certificados A1 e conversa com a SEFAZ.
  Senhas no Cofre de Credenciais do Windows. Os certificados **nunca** vão para a nuvem.
- Estoque/CMV continuam no GRFood. Este sistema cuida só do financeiro.

## Usuários e permissões
| Pessoa | Papel | Pode |
|---|---|---|
| Pedro Mousinho | master | lançar, aprovar, consultar, administrar usuários |
| Marcio Victor | lancador | lançar e consultar |
| Assistente 1 | lancador | lançar e consultar |
| Eduardo Freyre | consulta | só consultar |

Todo login novo nasce como "consulta"; só o master promove. As regras ficam **no banco**
(segurança por linha), não só na tela. Toda inclusão/alteração/exclusão vai para o **Histórico**,
que ninguém consegue apagar.

## Etapas
- [x] Etapa 1a – Base de dados: lojas, usuários, plano de contas, grupos da DRE, centros de custo,
      fornecedores (banco/PIX), contas bancárias, formas de pagamento, histórico, alerta de certificado (30 dias)
- [x] Etapa 1b – Site com login e telas de cadastro; importação de Excel/CSV com tela de conferência (pasta `web/`)
- [x] Etapa 2b – Coletor local + SEFAZ (feita antes da 2a, a pedido do Pedro) — instalado no PC do escritório em 17/11/2026, agendado 08:10 e 14:10
- [ ] Etapa 2a – Cofre de notas: telas (lista de notas, status, upload de XML, foto/PDF do DANFE)
- [ ] Etapa 3 – Contas a pagar
- [ ] Etapa 4 – Bancos e conciliação (OFX; Santander via API a estudar)
- [ ] Etapa 5 – Painel, fluxo de caixa, DRE, fechamento semanal/mensal e pacote do contador

## Projetos no Supabase (região São Paulo, sa-east-1)
| Ambiente | Projeto | Ref |
|---|---|---|
| Teste | financeiro-teste | ijcglclttkhzygpecour |
| Produção | financeiro-producao | jxbpwkbxpascynflmtxi |

Aplicar mudanças do banco: `python3 supabase/aplicar_migracoes.py teste` (ou `producao`).
Sempre aplicar e testar primeiro no **teste**.

## Coletor de notas (pasta `coletor/`, roda no PC do escritório)
- Consulta a SEFAZ (NFeDistribuicaoDFe) para cada loja com o certificado A1 da própria loja.
- Senhas dos certificados e do usuário coletor: **Cofre de Credenciais do Windows** ("GrupoAR-Coletor").
- Guarda o último NSU de cada CNPJ e respeita o bloqueio de 1 hora (cStat 137/656).
- Grava resumos, notas completas (com duplicatas) e cancelamentos no Supabase; cópia local dos XMLs.
- **Não faz manifestação** nesta versão (só leitura). A Ciência automática será ligada após aprovação.
- Comandos: `configurar`, `certificados`, `coletar [--loja X]`, `agendar` (08:10 e 14:10).
- Testes: `cd coletor && python -m pytest -q testes`

## Como usar o site (Etapa 1)
1. Entre com seu e-mail e senha. A faixa amarela indica **ambiente de teste**.
2. **Início**: totais dos cadastros e situação dos certificados A1.
3. **Fornecedores / Plano de contas / Centros de custo / ...**: clique em "+ Incluir" ou numa linha para editar.
   CNPJ/CPF é conferido na hora (✓ válido / ✗ inválido). Para "apagar" algo já usado, prefira marcar como inativo.
   Fornecedor novo: ao digitar um CNPJ válido, os dados vêm sozinhos da Receita (BrasilAPI; reserva CNPJá).
   Só o CNPJ é enviado. CPF não tem consulta pública. Situação diferente de ATIVA gera alerta.
4. **Importar planilha**: escolha o tipo, envie o .xlsx/.csv do GRFood, confira as colunas sugeridas e as linhas
   (Novas / Já existem / Com problema) e só então clique em "Gravar". Linhas com problema nunca são gravadas.
5. **Histórico**: quem fez o quê e quando, com o antes → depois de cada alteração.
6. **Usuários**: o master define quem lança, aprova ou só consulta.

## Para desenvolvedores: rodar os testes
```
./supabase/tests/rodar_testes.sh
```
Cria um banco de teste do zero, aplica `supabase/migrations/` e roda `supabase/tests/`.

Site: `cd web && npm install && npm test && npm run dev`
