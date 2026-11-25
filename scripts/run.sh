#!/usr/bin/env bash
# ==============================================================================
# SwarmLoc - Script unificado de execucao (Linux / POSIX)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PYTHONDONTWRITEBYTECODE=1

PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null; then
    if command -v python &> /dev/null; then
        PYTHON_CMD="python"
    else
        echo -e "\033[0;31m[ERRO] Python 3 nao encontrado no sistema.\033[0m" >&2
        exit 1
    fi
fi

# Ativar venv local se existir
if [ -d "${PROJECT_ROOT}/venv" ] && [ -f "${PROJECT_ROOT}/venv/bin/activate" ]; then
    source "${PROJECT_ROOT}/venv/bin/activate"
elif [ -d "${PROJECT_ROOT}/.venv" ] && [ -f "${PROJECT_ROOT}/.venv/bin/activate" ]; then
    source "${PROJECT_ROOT}/.venv/bin/activate"
fi

echo -e "\033[0;36m[SwarmLoc] A iniciar plataforma cientifica (Linux)... \033[0m"
cd "${PROJECT_ROOT}"
exec ${PYTHON_CMD} "python/data_analysis.py" "$@"
