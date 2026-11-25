<#
.SYNOPSIS
    Abre o Serial Monitor (porta COM virtual @ 115200 baud) para os módulos SwarmLoc DWM3001CDK.

.DESCRIPTION
    Permite ler o output dos módulos diretamente via porta série UART sem necessitar do SEGGER RTT Viewer.
    Deteta as portas COM associadas aos módulos e abre o monitor série (via pyserial / miniterm).

.PARAMETER Port
    Nome da porta COM (ex: 'COM4' ou 'COM5'). Se omitido, pergunta interativamente.

.PARAMETER Baud
    Velocidade da porta série (padrão: 115200).

.EXAMPLE
    .\scripts\serial_monitor.ps1
    Deteta as portas COM disponíveis e pergunta qual abrir.

.EXAMPLE
    .\scripts\serial_monitor.ps1 -Port COM4
    Abre diretamente a porta COM4 a 115200 baud.
#>

param(
    [string]$Port = "",
    [int]$Baud = 115200,
    [switch]$NonInteractive,
    [switch]$h,
    [switch]$help
)

$env:PYTHONIOENCODING = "utf-8"
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 >$null 2>&1
} catch {}

if ($h -or $help) {
    Write-Host "Abre o Serial Monitor para módulos SwarmLoc DWM3001CDK." -ForegroundColor Cyan
    Write-Host "`nParâmetros:" -ForegroundColor Yellow
    Write-Host "  -Port <COMx>    Porta COM a abrir (ex: COM4)"
    Write-Host "  -Baud <taxa>    Velocidade em baud (padrão: 115200)"
    exit 0
}

Write-Host "`n=== SwarmLoc Serial Monitor (UART @ $Baud baud) ===" -ForegroundColor Cyan

# 1. Detetar portas COM rapidamente via .NET (sem WMI pesado)
$availablePorts = @()
try {
    $allPorts = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
    foreach ($cp in $allPorts) {
        $availablePorts += [PSCustomObject]@{
            Port = $cp
            Name = "Porta Série ($cp)"
        }
    }
} catch {}

if ($availablePorts.Count -eq 0) {
    Write-Host "Nenhuma porta COM encontrada. Verifique se os módulos estão ligados às portas USB." -ForegroundColor Red
    exit 1
}

$SelectedPort = $Port

if ([string]::IsNullOrWhiteSpace($SelectedPort)) {
    Write-Host "`nPortas COM detetadas:" -ForegroundColor Yellow
    Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray
    for ($i = 0; $i -lt $availablePorts.Count; $i++) {
        Write-Host ("  [{0}] {1} -> {2}" -f $i, $availablePorts[$i].Port, $availablePorts[$i].Name) -ForegroundColor White
    }
    Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray

    if ($NonInteractive) {
        Write-Host "Modo -NonInteractive: a selecionar automaticamente a primeira porta ($($availablePorts[0].Port))..." -ForegroundColor Yellow
        $SelectedPort = $availablePorts[0].Port
    } else {
        $promptMsg = "Escolha a porta COM para abrir [0..$($availablePorts.Count - 1), ou nome da porta] (Enter = 0): "
        $userChoice = ""
        try {
            $userChoice = (Read-Host $promptMsg).Trim()
        } catch {
            Write-Host "Terminal sem suporte a Read-Host. A selecionar $($availablePorts[0].Port)..." -ForegroundColor Yellow
            $SelectedPort = $availablePorts[0].Port
        }

        if ([string]::IsNullOrEmpty($userChoice) -or $userChoice -eq '0') {
            $SelectedPort = $availablePorts[0].Port
        } elseif ($userChoice -match '^[qQ]$') {
            exit 0
        } else {
            $parsedIdx = -1
            if ([int]::TryParse($userChoice, [ref]$parsedIdx) -and $parsedIdx -ge 0 -and $parsedIdx -lt $availablePorts.Count) {
                $SelectedPort = $availablePorts[$parsedIdx].Port
            } else {
                $matchPort = $availablePorts | Where-Object { $_.Port -eq $userChoice -or $_.Port -like "*$userChoice*" } | Select-Object -First 1
                if ($matchPort) {
                    $SelectedPort = $matchPort.Port
                } else {
                    $SelectedPort = $userChoice
                }
            }
        }
    }
}

Write-Host "`nA ligar a $SelectedPort a $Baud baud (Ctrl+C para sair)..." -ForegroundColor Green
Write-Host "Dica: Prima 't' para testar, 'd' para descarregar em ficheiro, 'l' para modo Live e 'r' para reset!`n" -ForegroundColor Yellow

# 2. Localizar executável Python
$pythonExe = "python"
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    if (Get-Command "py" -ErrorAction SilentlyContinue) {
        $pythonExe = "py"
    } else {
        $localPy = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($localPy) {
            $pythonExe = $localPy.FullName
        } else {
            Write-Host "[ERRO] Python não foi encontrado no PATH nem no sistema." -ForegroundColor Red
            Write-Host "Instale o Python a partir de https://python.org e selecione 'Add python.exe to PATH'." -ForegroundColor Yellow
            exit 1
        }
    }
}

# 3. Verificar se o pyserial está instalado
$hasSerial = & $pythonExe -c "import serial" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[AVISO] O pacote 'pyserial' não foi detetado no Python ($pythonExe)." -ForegroundColor Yellow
    Write-Host "A instalar pyserial via pip..." -ForegroundColor Cyan
    & $pythonExe -m pip install pyserial
}

$projectRoot = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $projectRoot "python\serial_monitor.py"

if (Test-Path $scriptPath) {
    & $pythonExe $scriptPath -p $SelectedPort -b $Baud
} else {
    & $pythonExe -m serial.tools.miniterm $SelectedPort $Baud --encoding utf-8 --exit-char 3 --dtr 0 --rts 0
}

