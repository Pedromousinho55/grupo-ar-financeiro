# Instalação do coletor no PC do escritório (Windows)

Roteiro para quem instala: o Pedro ou uma sessão do Claude Code rodando **neste PC**.

## Regras de segurança (obrigatórias)
- Os arquivos **.pfx** ficam só em `C:\GrupoAR\certificados`. Nunca enviar para GitHub, e-mail, nuvem ou chat.
- **Senhas nunca são digitadas no chat do Claude.** Quem digita é o Pedro, numa janela do PowerShell
  (passo 4). Elas vão direto para o Cofre de Credenciais do Windows.
- O coletor desta versão **só lê** na SEFAZ. Não fazer nenhuma manifestação (Ciência, Confirmação etc.).

## Passo 1 – Baixar o projeto
No PowerShell:
```
cd C:\GrupoAR
git clone https://github.com/Pedromousinho55/grupo-ar-financeiro.git
```
Se não houver `git`: `winget install --id Git.Git -e`, feche e reabra o PowerShell.

## Passo 2 – Instalar o coletor
```
cd C:\GrupoAR\grupo-ar-financeiro\coletor
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```
Instala o Python 3.12 (se faltar), cria o ambiente `.venv` e as dependências.

## Passo 3 – Conferir os testes
```
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest -q testes
```
Devem passar todos (14).

## Passo 4 – Configurar (o PEDRO digita, numa janela do PowerShell)
```
cd C:\GrupoAR\grupo-ar-financeiro\coletor
.\.venv\Scripts\python.exe -m grupoar_coletor configurar
```
Respostas:
- Endereço do Supabase: Enter (teste: `https://ijcglclttkhzygpecour.supabase.co`)
- Chave pública: a mesma de `web/src/config.ts` (começa com `sb_publishable_`)
- E-mail do coletor: `pedromousinho1805+coletor@gmail.com`
- Senha do coletor e de cada certificado: digitadas pelo Pedro (não aparecem na tela)
- Caminho de cada .pfx: `C:\GrupoAR\certificados\Terra.pfx` etc.

O programa confere se cada certificado é mesmo do CNPJ da loja antes de guardar.

## Passo 5 – Certificados e primeira consulta (uma loja só)
```
.\.venv\Scripts\python.exe -m grupoar_coletor certificados
.\.venv\Scripts\python.exe -m grupoar_coletor coletar --loja Terra
```
Se aparecer erro de certificado do servidor (`CERTIFICATE_VERIFY_FAILED`), o Windows não tem a cadeia
ICP-Brasil: baixar as raízes oficiais do ITI (https://www.gov.br/iti/pt-br/assuntos/repositorio),
juntar em `coletor\cadeia_icp.pem` e repetir.

Conferir no site (Início / Histórico) e em `coletor\logs\coletor.log`. Depois, as outras lojas:
```
.\.venv\Scripts\python.exe -m grupoar_coletor coletar
```

## Passo 6 – Agendar (2 vezes por dia)
```
.\.venv\Scripts\python.exe -m grupoar_coletor agendar
```
Cria as tarefas "GrupoAR-Coletor-manha" (08:10) e "GrupoAR-Coletor-tarde" (14:10) no Agendador de Tarefas.
O PC precisa estar ligado nesses horários.
