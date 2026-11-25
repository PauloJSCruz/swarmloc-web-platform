@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0serial_monitor.ps1" %*
