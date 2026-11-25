#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect_experimental_telemetry.py
Recolhe telemetria experimental em tempo real dos 4 módulos SwarmLoc
através da API local do data_analysis.py (porta 8080).
"""
import urllib.request
import urllib.parse
import json
import time
import re
import math
from collections import defaultdict

def run_collection(duration_sec=25.0):
    print(f"[*] A iniciar recolha experimental durante {duration_sec} segundos...")
    
    # 1. Enviar comando 'k' para atualizar status dos modelos
    try:
        req = urllib.request.Request(
            'http://127.0.0.1:8080/api/live/command',
            data=json.dumps({'command': 'k', 'target': 'all'}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        urllib.request.urlopen(req, timeout=3.0)
        time.sleep(0.5)
    except Exception as e:
        print(f"[!] Erro ao enviar comando 'k': {e}")

    # 2. Obter since_id inicial
    init_req = urllib.request.urlopen('http://127.0.0.1:8080/api/live/status?since_id=0')
    init_data = json.loads(init_req.read().decode('utf-8'))
    last_id = 0
    msgs = init_data.get('messages', [])
    if msgs:
        last_id = msgs[-1].get('id', 0)
    print(f"[*] ID inicial: {last_id}")

    collected_messages = []
    start_time = time.time()
    
    while (time.time() - start_time) < duration_sec:
        time.sleep(0.4)
        try:
            url = f"http://127.0.0.1:8080/api/live/status?since_id={last_id}"
            req = urllib.request.urlopen(url, timeout=3.0)
            data = json.loads(req.read().decode('utf-8'))
            new_msgs = data.get('messages', [])
            for m in new_msgs:
                collected_messages.append(m)
                if m.get('id', 0) > last_id:
                    last_id = m.get('id')
        except Exception as e:
            print(f"[!] Erro na recolha: {e}")

    print(f"[*] Recolha concluída: {len(collected_messages)} mensagens capturadas.")
    return collected_messages

def analyze_telemetry(messages):
    stats = {
        'total_msgs': len(messages),
        'by_node': defaultdict(lambda: {'twr_rounds': [], 'tdoa_beacons': [], 'sync_status': [], 'raw_lines': 0}),
        'master_beacons_tx': []
    }
    
    # Regexes
    re_twr_slave = re.compile(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]\s*\[SYNC:TWR\s*\]\s*#(\d+)\s+Sincronizacao com Master 0x([0-9A-Fa-f]+):\s+BEM-SUCEDIDA!\s*\|\s*Dist:\s*([\d\.]+)m\s*\|\s*Deriva:\s*([+-]?[\d\.]+)ppm")
    re_twr_master = re.compile(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]\s*\[SYNC:TWR\s*\]\s*#(\d+)\s*->\s*Slave 0x([0-9A-Fa-f]+):\s*Sincronizado OK\s*\|\s*Dist:\s*([\d\.]+)m")
    re_tdoa_rx = re.compile(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]\s*\[TDOA:RX\s*\]\s*Beacon #(\d+)\s+de Master 0x([0-9A-Fa-f]+)\s*\|\s*Dist:\s*([\d\.]+)m\s*\|\s*ToF:\s*([+-]?[\d\.]+)ns\s*\|\s*Deriva:\s*([+-]?[\d\.]+)ppm\s*\|\s*Sinc:\s*OK\s*\(ha\s*(\d+)\s*ms\)")
    re_tdoa_tx = re.compile(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]\s*\[TDOA:TX\s*\]\s*Beacon #(\d+)\s+emitido")
    re_sync_offset = re.compile(r"Offset \(Beta\):\s*([+-]?\d+)\s*ticks\s*\(([+-]?[\d\.]+) ms\)")
    re_sync_samples = re.compile(r"Estado do Relogio:.*?\((\d+)\s*pares de calibracao\)")
    re_model_alpha = re.compile(r"Modelo de Relogio:\s*Alpha=([\d\.]+)\s*\(([+-]?[\d\.]+) ppm\),\s*Beta=([+-]?[\d\.]+)\s*ticks")

    for m in messages:
        nid = m.get('node_id') or 'UNKNOWN'
        txt = m.get('text', '')
        stats['by_node'][nid]['raw_lines'] += 1

        # Mestre TWR TX
        m_twr_m = re_twr_master.search(txt)
        if m_twr_m:
            tl = float(m_twr_m.group(1))
            tg = float(m_twr_m.group(2))
            seq = int(m_twr_m.group(3))
            slv = m_twr_m.group(4)
            dist = float(m_twr_m.group(5))
            stats['by_node'][nid]['twr_rounds'].append({
                'tl': tl, 'tg': tg, 'seq': seq, 'slave': slv, 'dist_m': dist
            })
            continue

        # Mestre TDoA TX
        m_tx = re_tdoa_tx.search(txt)
        if m_tx:
            tl = float(m_tx.group(1))
            tg = float(m_tx.group(2))
            seq = int(m_tx.group(3))
            stats['master_beacons_tx'].append({'tl': tl, 'tg': tg, 'seq': seq})
            continue

        # Slave TWR RX
        m_twr_s = re_twr_slave.search(txt)
        if m_twr_s:
            tl = float(m_twr_s.group(1))
            tg = float(m_twr_s.group(2))
            seq = int(m_twr_s.group(3))
            m_id = m_twr_s.group(4)
            dist = float(m_twr_s.group(5))
            drift = float(m_twr_s.group(6))
            stats['by_node'][nid]['twr_rounds'].append({
                'tl': tl, 'tg': tg, 'seq': seq, 'master': m_id, 'dist_m': dist, 'drift_ppm': drift
            })
            continue

        # Slave TDoA RX
        m_rx = re_tdoa_rx.search(txt)
        if m_rx:
            tl = float(m_rx.group(1))
            tg = float(m_rx.group(2))
            seq = int(m_rx.group(3))
            m_id = m_rx.group(4)
            dist = float(m_rx.group(5))
            tof_ns = float(m_rx.group(6))
            drift = float(m_rx.group(7))
            age_ms = int(m_rx.group(8))
            stats['by_node'][nid]['tdoa_beacons'].append({
                'tl': tl, 'tg': tg, 'seq': seq, 'master': m_id, 'dist_m': dist,
                'tof_ns': tof_ns, 'drift_ppm': drift, 'age_ms': age_ms
            })
            continue

        # Clock Sync status
        m_off = re_sync_offset.search(txt)
        if m_off:
            beta_ticks = int(m_off.group(1))
            beta_ms = float(m_off.group(2))
            stats['by_node'][nid]['sync_status'].append({'beta_ticks': beta_ticks, 'beta_ms': beta_ms})

        m_alp = re_model_alpha.search(txt)
        if m_alp:
            alpha = float(m_alp.group(1))
            drift_ppm = float(m_alp.group(2))
            beta_t = float(m_alp.group(3))
            stats['by_node'][nid]['sync_status'].append({
                'alpha': alpha, 'drift_ppm': drift_ppm, 'beta_ticks': beta_t
            })

    return stats

def print_report(stats):
    print("\n" + "="*80)
    print("RELATÓRIO EXPERIMENTAL DE VALIDAÇÃO TEMPORAL SWARMLOC")
    print("="*80)
    print(f"Total de mensagens analisadas: {stats['total_msgs']}")
    print(f"Beacons TDoA emitidos pelo Mestre: {len(stats['master_beacons_tx'])}")
    if stats['master_beacons_tx']:
        tx_seqs = [b['seq'] for b in stats['master_beacons_tx']]
        print(f"  Seq Mestre: min={min(tx_seqs)}, max={max(tx_seqs)}, span={max(tx_seqs)-min(tx_seqs)}")

    for nid in sorted(stats['by_node'].keys()):
        node_data = stats['by_node'][nid]
        print("\n" + "-"*80)
        print(f"NÓ {nid}: (Linhas de texto: {node_data['raw_lines']})")
        
        # TWR Rondas
        twr = node_data['twr_rounds']
        print(f"  Rondas TWR: {len(twr)}")
        if twr:
            dists = [r['dist_m'] for r in twr]
            mean_d = sum(dists) / len(dists)
            std_d = math.sqrt(sum((x - mean_d)**2 for x in dists) / (len(dists) - 1)) if len(dists) > 1 else 0.0
            print(f"    Distância TWR: Média = {mean_d:.4f} m, Desvio Padrão = {std_d*1000:.2f} mm [Min: {min(dists):.4f} m, Max: {max(dists):.4f} m]")
            if 'drift_ppm' in twr[0]:
                drifts = [r['drift_ppm'] for r in twr if 'drift_ppm' in r]
                print(f"    Deriva (alpha - 1.0): {drifts[-1]:+.3f} ppm (amostras: {len(drifts)})")

        # TDoA Beacons
        tdoa = node_data['tdoa_beacons']
        print(f"  Beacons One-Way ToF Recebidos: {len(tdoa)}")
        if tdoa:
            dists = [b['dist_m'] for b in tdoa]
            tofs = [b['tof_ns'] for b in tdoa]
            ages = [b['age_ms'] for b in tdoa]
            drifts = [b['drift_ppm'] for b in tdoa]

            mean_d = sum(dists) / len(dists)
            std_d = math.sqrt(sum((x - mean_d)**2 for x in dists) / (len(dists) - 1)) if len(dists) > 1 else 0.0
            mean_tof = sum(tofs) / len(tofs)
            std_tof_ps = (math.sqrt(sum((x - mean_tof)**2 for x in tofs) / (len(tofs) - 1)) * 1000.0) if len(tofs) > 1 else 0.0

            print(f"    Distância One-Way: Média = {mean_d:.4f} m, Desvio Padrão = {std_d*1000:.2f} mm [Min: {min(dists):.4f} m, Max: {max(dists):.4f} m]")
            print(f"    ToF One-Way:       Média = {mean_tof:+.3f} ns, Jitter/Desvio = {std_tof_ps:.1f} ps [Min: {min(tofs):+.3f} ns, Max: {max(tofs):+.3f} ns]")
            print(f"    Deriva Relógio:    Média = {sum(drifts)/len(drifts):+.3f} ppm [Min: {min(drifts):+.3f}, Max: {max(drifts):+.3f}]")
            print(f"    Idade da Sinc:     Média = {sum(ages)/len(ages):.1f} ms [Min: {min(ages)} ms, Max: {max(ages)} ms]")

            # Análise de deriva temporal do ToF em função da idade da sincronização (Drift vs Age)
            age_buckets = defaultdict(list)
            for b in tdoa:
                # Agrupar por fatias de 100 ms
                bucket = (b['age_ms'] // 100) * 100
                age_buckets[bucket].append(b['tof_ns'])
            
            print("    Evolução do ToF vs Idade da Sincronização (Drift temporal não compensado):")
            for bucket in sorted(age_buckets.keys()):
                vals = age_buckets[bucket]
                avg_b_tof = sum(vals) / len(vals)
                std_b_ps = (math.sqrt(sum((x - avg_b_tof)**2 for x in vals) / (len(vals) - 1)) * 1000.0) if len(vals) > 1 else 0.0
                print(f"      [Age {bucket:3d}-{bucket+99:3d} ms] N={len(vals):3d} | ToF Médio: {avg_b_tof:+.4f} ns | Jitter: {std_b_ps:5.1f} ps | Dist: {avg_b_tof * 0.299702547:.4f} m")

        # Sync Status
        sync = node_data['sync_status']
        if sync:
            print(f"  Parâmetros do Modelo de Relógio:")
            for s in sync[-2:]:
                print(f"    {s}")

if __name__ == '__main__':
    msgs = run_collection(duration_sec=25.0)
    stats = analyze_telemetry(msgs)
    print_report(stats)
    
    # Gravar dados em JSON para documentação exata
    with open('docs/reports/experimental_telemetry_dump.json', 'w', encoding='utf-8') as f:
        json.dump({'messages_count': len(msgs), 'stats': stats}, f, indent=2)
    print("\n[*] Ficheiro 'docs/reports/experimental_telemetry_dump.json' gravado com sucesso!")
