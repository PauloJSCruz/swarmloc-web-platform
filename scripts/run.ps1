<#
.SYNOPSIS
    Inicia a aplicação Web da plataforma SwarmLoc.

.DESCRIPTION
    Script unificado de execução. Inicia o servidor Web com suporte a catálogo,
    análise científica, envio de comandos e telemetria em tempo real (padrão: porta 8080).

.PARAMETER Port
    Porta HTTP personalizada (padrão: 8080).

.EXAMPLE
    .\scripts\run.ps1
    Inicia a aplicação em http://localhost:8080

.EXAMPLE
    .\scripts\run.ps1 -Port 8090
    Inicia a aplicação na porta personalizada 8090
#>

param(
    [int]$Port = 0,
    [switch]$h,
    [switch]$help
)

if ($h -or $help) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

$projectRoot = Split-Path $PSScriptRoot -Parent
$env:PYTHONDONTWRITEBYTECODE = "1"

$script = Join-Path $projectRoot "python\data_analysis.py"
Write-Host "[SwarmLoc] A iniciar plataforma científica com telemetria e controlo..." -ForegroundColor Cyan

if ($Port -gt 0) {
    python $script --port $Port
} else {
    python $script
}


