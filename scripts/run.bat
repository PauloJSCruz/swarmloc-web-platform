@echo off
setlocal
cd /d "%~dp0.."
set PYTHONDONTWRITEBYTECODE=1

python python\data_analysis.py %*

