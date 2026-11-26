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
- [x] Etapa 2a – Cofre de notas: telas (lista de notas, status, upload de XML, foto/PDF do DANFE)
- [x] Etapa 3 – Contas a pagar (lançamento a partir da nota ou à mão, aprovação do master, baixa com comprovante)
- [x] Etapa 4 – Bancos e conciliação: importação de extrato (planilha do Santander ou OFX), conciliação e regras automáticas (Santander via API a estudar)
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
- **API do Klaus** (contabilidade SATIERF): `klaus [--dias 7] [--loja X]` busca notas e eventos recebidos pela API (só leitura,
  nunca os envios) e importa como no `importar` (não duplica). Com `"klaus_automatico": true` no `config.json`, a rotina das
  08:10 e 14:10 também busca no Klaus os últimos `klaus_dias` dias. Token no Cofre do Windows ("GrupoAR-Coletor" / "klaus-token");
  para guardar: `Read-Host -AsSecureString` (o PowerShell não cola na pergunta escondida do Python). Cada execução fica registrada em
  `coletor_execucoes` (cstat = KLAUS). A API limita chamadas seguidas: o coletor espera e tenta de novo.
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

## Cofre de notas (Etapa 2a)
1. **Notas fiscais**: notas emitidas contra as lojas, com filtro por loja, período de emissão, status, situação na SEFAZ
   e busca por fornecedor, nº da nota, CNPJ ou chave. O total soma só as notas válidas; canceladas aparecem riscadas.
   "Resumo" = só temos o resumo da SEFAZ (sem itens/duplicatas); o XML completo chega pelo Klaus ou por "Enviar XML".
2. Clique numa nota para ver itens, duplicatas (vencimentos), eventos (cancelamento, carta de correção) e baixar o XML.
3. **Conferência** (lançador/master): A conferir → Recebida, Com problema ou Não reconhecida (as duas últimas exigem
   observação). Fica registrado quem recebeu e quando, e tudo vai para o Histórico. "Lançada" virá do contas a pagar (Etapa 3).
4. **Anexar DANFE**: foto ou PDF (até 20 MB). Arquivo enviado não é substituído nem apagado (guarda de 5 anos);
   para corrigir, anexe outro.
5. **Enviar XML**: escolha um ou vários .xml, confira (Nova / Completar resumo / Já existe / Outra empresa / Erro)
   e só então grave. Notas de outras empresas e repetidas são ignoradas.

## Contas a pagar (Etapa 3)
1. **Lançar a partir da nota**: na nota fiscal, botão "Lançar no contas a pagar". Cada duplicata do XML vira uma conta
   (sem duplicatas: uma conta com o valor total, vencendo na emissão + prazo padrão do fornecedor). Plano de contas,
   centro de custo e forma de pagamento vêm sugeridos pelo último lançamento do mesmo fornecedor. A nota fica "Lançada".
2. **Lançar à mão** (aluguel, folha, impostos…): "+ Nova conta". "Repetir por N meses" cria uma conta por mês
   (mesmo valor, ou o valor dividido em parcelas).
3. **Aprovação**: conta lançada pelo lançador entra "A aprovar"; só o master aprova (uma a uma ou marcando várias).
   Conta do master já nasce aprovada. Se o lançador mudar valor, vencimento ou classificação de uma conta aprovada,
   ela volta para a aprovação.
4. **Pagamento (baixa)**: só de conta aprovada, com data, valor pago (juros/desconto), conta bancária e comprovante.
   Conta paga fica travada; só o master estorna. Comprovante enviado não é apagado nem substituído.
5. **Cancelar** exige motivo (lançador cancela só o que ainda está "A aprovar"). Nada é apagado; tudo vai para o Histórico.
   Se todas as contas de uma nota forem canceladas, a nota volta para "Recebida".
6. **Início**: cartões de contas vencidas, que vencem hoje, nos próximos 7 dias e a aprovar.

## Bancos e conciliação (Etapa 4)
1. **Bancos**: saldo de cada conta calculado pelo sistema (saldo inicial + extratos) comparado com o saldo do banco no último
   arquivo; "confere" quando bate. O saldo inicial (31/10/2026 = R$ 0,00, porque a Contamax zera a conta corrente) fica em Contas bancárias.
2. **Importar extrato**: planilha exportada do Santander (.xlsx, nomeada "Extrato_<empresa>.xlsx" — a conta é reconhecida pelo nome)
   ou OFX. Reimportar não duplica; lançamentos agendados para depois de hoje ficam para o próximo extrato.
3. **Conciliação**: cada linha do extrato é explicada como
   - saída ligada a uma conta a pagar (sugestão por valor igual e data próxima; dá para confirmar várias de uma vez) — a conta vira "Paga"
     com a data e o valor do banco;
   - saída sem conta lançada (tarifa, folha, imposto): vira na hora uma conta a pagar já paga;
   - entrada classificada como receita no plano de contas;
   - transferência entre contas do grupo ou aplicação/resgate Contamax.
4. Master e lançador conciliam; conta "a aprovar" só o master concilia (vale como aprovação); só o master desfaz.
   Pagamento conciliado não é estornado pela tela da conta: desfaz-se pela conciliação.
5. **Regras de conciliação** (só o master cria/altera): "histórico começa com/contém TEXTO" (+ saída/entrada, conta, faixa de valor)
   → transferência, receita ou conta a pagar já paga. A primeira regra que bate (menor prioridade) decide. Regra "automática" concilia
   sozinha ao importar o extrato; "só sugere" aparece na Conciliação para confirmar em lote. A tela mostra quantas linhas pendentes
   cada regra pega. Pagamentos entre empresas do grupo (ex.: Arvo → SFC para cobrir folha/impostos) não têm regra: tratar caso a caso.
6. **Pagamento de nota fiscal**: saída que casa com uma parcela (duplicata de mesmo valor, vencimento até 7 dias) ou com o total de
   uma nota sem duplicata (paga até 45 dias após a emissão) aparece como "nota fiscal"; ao confirmar, a conta a pagar da nota é criada
   já paga e a nota fica "Lançada". O plano de contas vem do **plano padrão do fornecedor** (cadastro de Fornecedores) → último usado
   → 2.1.1 Insumos cozinha.

## Para desenvolvedores: rodar os testes
```
./supabase/tests/rodar_testes.sh
```
Cria um banco de teste do zero, aplica `supabase/migrations/` e roda `supabase/tests/`.

Site: `cd web && npm install && npm test && npm run dev`
