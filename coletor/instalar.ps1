# Instalação do coletor Grupo AR (Windows). Rodar no PowerShell, dentro da pasta do coletor.
# Instala o Python (se faltar), cria um ambiente isolado e instala as dependências.
$ErrorActionPreference = "Stop"
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
}
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Write-Host "Instalado. Próximo passo: .\.venv\Scripts\python.exe -m grupoar_coletor configurar"
