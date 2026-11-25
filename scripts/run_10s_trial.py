#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para executar o ensaio de gravação de 10 segundos ('t 10')
e descarregar os dados de todos os módulos UWB.
"""

import sys
import time
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8080"

def post_json(endpoint, payload):
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))

def get_json(endpoint):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    print("=" * 70)
    print("ENSAIO DE GRAVAÇÃO EM RAM (10 SEGUNDOS - 't 10')")
    print("=" * 70)

    # 1. Verificar estado inicial da telemetria
    print("\n[1/4] Verificando estado dos módulos...")
    status = get_json("/api/live/status")
    connected_ports = status.get("connected_ports", [])
    nodes = list(status.get("nodes", {}).keys())
    print(f"  Portas ligadas ({len(connected_ports)}): {connected_ports}")
    print(f"  Nós detetados ({len(nodes)}): {nodes}")

    if not connected_ports:
        print("[ERRO] Nenhuma porta COM ligada!")
        sys.exit(1)

    # 2. Enviar comando 't 10' para todos os módulos
    print("\n[2/4] Enviando comando 't 10' para todos os módulos...")
    cmd_resp = post_json("/api/live/command", {"command": "t 10", "target": "all"})
    print(f"  Resposta do comando: {cmd_resp.get('status')}")
    print(f"  Portas enviadas: {cmd_resp.get('ports')}")

    # 3. Aguardar os 10 segundos de gravação (+2 segundos de margem)
    test_duration = 10
    margin = 2
    total_wait = test_duration + margin
    print(f"\n[3/4] Gravando em RAM nos módulos ({total_wait}s)...")
    for sec in range(1, total_wait + 1):
        time.sleep(1)
        print(f"  Tempo decorrido: {sec}/{total_wait} s", end="\r", flush=True)
    print(f"\n  Gravação concluída. Buffers de RAM congelados para dump.")

    # 4. Descarregar dados dos módulos via '/api/modules/download'
    print("\n[4/4] Solicitando download binário dos módulos...")
    dl_resp = post_json("/api/modules/download", {
        "ports": connected_ports,
        "force_release": True,
        "timeout": 25.0
    })

    print(f"\nResultado do Download: {dl_resp.get('status')}")
    print(f"Mensagem: {dl_resp.get('message')}")
    
    downloaded = dl_resp.get("downloaded", [])
    errors = dl_resp.get("errors", [])

    print("\n" + "=" * 70)
    print("RELATÓRIO DO ENSAIO 't 10'")
    print("=" * 70)
    print(f"{'Porta':<8} | {'Nó ID':<8} | {'Papel':<8} | {'Registos':<10} | {'Duração':<10} | {'Ficheiro BIN':<25}")
    print("-" * 75)

    total_records = 0
    for item in downloaded:
        port = item.get("port", "-")
        node_id = item.get("node_id", "-")
        role = item.get("role", "-")
        recs = item.get("record_count", 0)
        dur = f"{item.get('duration_ms', 0)} ms"
        fn = item.get("bin_file", "-")
        total_records += recs
        print(f"{port:<8} | {node_id:<8} | {role:<8} | {recs:<10} | {dur:<10} | {fn:<25}")

    print("-" * 75)
    print(f"TOTAL DE REGISTOS GRAVADOS EM RAM NO ENXAME: {total_records}")

    if errors:
        print("\nAvisos / Erros:")
        for err in errors:
            print(f"  - {err}")

    trial_id = dl_resp.get("created_trial_id")
    if trial_id:
        print(f"\nSessão criada em: data/{trial_id}/")

    print("=" * 70)

if __name__ == "__main__":
    main()
