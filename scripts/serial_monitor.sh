#!/usr/bin/env bash
# ==============================================================================
# SwarmLoc - Serial Monitor para modulos UWB (Linux / POSIX)
# ==============================================================================
set -e

BAUD="${1:-115200}"
PORT="$2"

PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    if command -v python &> /dev/null; then
        PYTHON_CMD="python"
    else
        echo -e "\033[0;31m[ERRO] Python 3 nao encontrado no sistema.\033[0m" >&2
        exit 1
    fi
fi

# Verificar pyserial
if ! ${PYTHON_CMD} -c "import serial" 2>/dev/null; then
    echo -e "\033[0;33m[AVISO] Modulo 'pyserial' nao encontrado. A tentar instalar via pip...\033[0m"
    ${PYTHON_CMD} -m pip install pyserial
fi

# Detecao de portas serie no Linux (/dev/ttyACM*, /dev/ttyUSB*)
if [ -z "$PORT" ]; then
    PORTS=($(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || true))
    if [ ${#PORTS[@]} -eq 0 ]; then
        echo -e "\033[0;31m[ERRO] Nenhuma porta serie detetada (/dev/ttyACM* ou /dev/ttyUSB*).\033[0m"
        echo "Verifique as permissoes do utilizador (ex: sudo usermod -a -G dialout \$USER)."
        exit 1
    elif [ ${#PORTS[@]} -eq 1 ]; then
        PORT="${PORTS[0]}"
        echo -e "\033[0;32m[SwarmLoc] Porta unica detetada: ${PORT}\033[0m"
    else
        echo -e "\033[0;36m=== Portas serie disponiveis ===\033[0m"
        for i in "${!PORTS[@]}"; do
            echo "  [$i] ${PORTS[$i]}"
        done
        read -p "Escolha a porta [0-$((${#PORTS[@]}-1))] (Padrao: 0): " CHOICE
        CHOICE="${CHOICE:-0}"
        PORT="${PORTS[$CHOICE]}"
    fi
fi

echo -e "\033[0;32m[SwarmLoc] A ligar a ${PORT} @ ${BAUD} baud (Ctrl+C para sair)...\033[0m"
exec ${PYTHON_CMD} -m serial.tools.miniterm "$PORT" "$BAUD" --encoding utf-8 --exit-char 3
