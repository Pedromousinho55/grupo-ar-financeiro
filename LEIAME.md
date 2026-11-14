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
- [ ] Etapa 1b – Site com login e telas de cadastro; importação de Excel/CSV com tela de conferência
- [ ] Etapa 2a – Cofre de notas (upload de XML, foto/PDF do DANFE)
- [ ] Etapa 2b – Coletor local + SEFAZ
- [ ] Etapa 3 – Contas a pagar
- [ ] Etapa 4 – Bancos e conciliação (OFX; Santander via API a estudar)
- [ ] Etapa 5 – Painel, fluxo de caixa, DRE, fechamento semanal/mensal e pacote do contador

## Para desenvolvedores: rodar os testes
```
./supabase/tests/rodar_testes.sh
```
Cria um banco de teste do zero, aplica `supabase/migrations/` e roda `supabase/tests/`.
