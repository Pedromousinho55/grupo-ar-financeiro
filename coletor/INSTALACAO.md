# Instalação do coletor no PC do escritório (Windows)

Roteiro para quem instala: o Pedro ou uma sessão do Claude Code rodando **neste PC**.
Instalado pela primeira vez em 17/11/2026 — as notas "⚠️" abaixo vêm do que deu errado nesse dia.

## Regras de segurança (obrigatórias)
- Os arquivos **.pfx** ficam só em `C:\GrupoAR\certificados`. Nunca enviar para GitHub, e-mail, nuvem ou chat.
- **Senhas nunca são digitadas no chat do Claude.** Quem digita é o Pedro, numa janela do PowerShell
  (passo 4). Elas vão direto para o Cofre de Credenciais do Windows.
- O coletor desta versão **só lê** na SEFAZ. Não fazer nenhuma manifestação (Ciência, Confirmação etc.).
- A pasta `xml/` (cópia local das notas reais) e o `coletor\config.json` nunca vão para o Git (já estão no `.gitignore`).

## Passo 1 – Baixar o projeto
No PowerShell:
```
cd C:\GrupoAR
git clone https://github.com/Pedromousinho55/grupo-ar-financeiro.git
```
Se não houver `git`: `winget install --id Git.Git -e`, **feche e reabra o PowerShell** (senão ele não acha o `git`).

## Passo 2 – Instalar o coletor
```
cd C:\GrupoAR\grupo-ar-financeiro\coletor
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```
Instala o Python 3.12 (se faltar), cria o ambiente `.venv` e as dependências.
⚠️ Se o Python acabou de ser instalado, o script para com "`py` não é reconhecido": feche e reabra o
PowerShell e rode o mesmo comando de novo.

## Passo 3 – Conferir os testes
```
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest -q testes
```
Devem passar todos (16).

## Passo 4 – Configurar (o PEDRO digita, numa janela do PowerShell)
```
cd C:\GrupoAR\grupo-ar-financeiro\coletor
.\.venv\Scripts\python.exe -m grupoar_coletor configurar
```
Respostas:
- Endereço do Supabase: Enter (teste: `https://ijcglclttkhzygpecour.supabase.co`)
- Chave pública: a mesma de `web/src/config.ts` (começa com `sb_publishable_`)
- E-mail do coletor: `pedromousinho1805+coletor@gmail.com`
- "Definir/alterar a senha do usuário coletor?": `s` só na primeira vez ou para trocar; depois, `N`.
  Deve aparecer **✓ Conectado ao sistema**. Se der `Invalid login credentials`, a senha digitada não é a
  do usuário coletor no Supabase: rode de novo e responda `s`.
- Para cada loja são **duas perguntas seguidas**:
  1. `arquivo .pfx [...]` → o **caminho** (aparece na tela). Enter aceita a sugestão
     `C:\GrupoAR\certificados\<Loja sem espaços>.pfx` (ex.: `LaraJaqueira.pfx`); `-` pula a loja.
  2. `Senha do certificado ... (não aparece ao digitar)` → a **senha**.

  ⚠️ **Nunca digite a senha na pergunta do caminho** — ali ela aparece na tela. Se acontecer, limpe a tela
  com `cls` e considere trocar a senha do certificado.

O programa confere se cada certificado é mesmo do CNPJ da loja antes de guardar. Para cada loja deve aparecer
**✓ ... válido até ...**. Para trocar um certificado vencido: substitua o .pfx na pasta e rode o `configurar`
de novo, pulando (`-`) as lojas que não mudaram.

## Passo 5 – Certificados e primeira consulta (uma loja só)
```
.\.venv\Scripts\python.exe -m grupoar_coletor certificados
.\.venv\Scripts\python.exe -m grupoar_coletor coletar --loja Terra
```
Escolha uma loja com certificado **válido** (o comando `certificados` mostra a validade).

Erros conhecidos:
- **`new row violates row-level security policy for table "certificados"`**: falta a migração
  `20261117000011_certificados_coletor_ler.sql` no Supabase (SQL Editor → colar → Run).
- **`CERTIFICATE_VERIFY_FAILED`**: o Windows não tem a raiz do certificado do **servidor** da SEFAZ.
  Em 11/2026 ele é emitido pela **GlobalSign Root R46** (não pela ICP-Brasil). O Windows busca a raiz
  sozinho quando um programa *dele* abre o site; o Python não dispara isso. Resolve com:
  ```
  Invoke-WebRequest -UseBasicParsing https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
  ```
  (a resposta "403 Proibido" é esperada) e repita a coleta. Só se o emissor mudar para uma AC da ICP-Brasil:
  baixar as raízes oficiais do ITI (https://www.gov.br/iti/pt-br/assuntos/repositorio), juntar em
  `coletor\cadeia_icp.pem` e repetir.
- **403 Forbidden (página HTML) na consulta**: o certificado da loja está vencido.
- **cStat 656 – Consumo Indevido**: a SEFAZ bloqueou o CNPJ por 1 hora. Acontece se o CNPJ foi consultado há
  pouco (por este coletor **ou por outro programa**, ex.: sistema do contador/ERP) ou se a consulta não
  continuou do último NSU devolvido. O coletor registra o bloqueio e não consulta esse CNPJ antes de 1h05 —
  **não insista**, cada tentativa renova o bloqueio. Se o 656 aparecer em todas as execuções, pergunte ao
  contador se ele baixa as notas desses CNPJs pela SEFAZ.

Conferir no site (Início / Histórico) e em `coletor\logs\coletor.log`. Depois, as outras lojas:
```
.\.venv\Scripts\python.exe -m grupoar_coletor coletar
```

## Passo 6 – Agendar (2 vezes por dia)
```
.\.venv\Scripts\python.exe -m grupoar_coletor agendar
```
Cria as tarefas "GrupoAR-Coletor-manha" (08:10) e "GrupoAR-Coletor-tarde" (14:10) no Agendador de Tarefas.
- Se o PC estiver desligado ou dormindo no horário, a tarefa **roda assim que ele ligar**.
- Roda também na bateria (notebook).
- Só roda com o Pedro **logado no Windows** (rodar sem login exigiria guardar a senha do Windows na tarefa).

Para testar na hora: `Start-ScheduledTask -TaskName GrupoAR-Coletor-manha` e olhar o fim de `logs\coletor.log`.

## Atualizar o coletor depois de mudanças no GitHub
```
cd C:\GrupoAR\grupo-ar-financeiro
git pull
cd coletor
.\.venv\Scripts\python.exe -m pytest -q testes
```
Se a mudança mexeu no agendamento, rode o `agendar` de novo.
