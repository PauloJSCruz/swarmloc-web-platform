#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
SwarmLoc UWB - Scientific Engineering Analysis & Metrology Platform
===============================================================================
Plataforma completa adaptada para funcionamento local e remoto via SSH/Web:
  - Catálogo experimental de ensaios com integridade e metadados metrológicos.
  - Análise aprofundada por ensaio (Resumo, Exploração Temporal, Estatística, Clock).
  - Tabela de dados crus com inspeção profunda bit-a-bit dos 54B e timestamps DW3000.
  - Área de Comparação Multi-Ensaio de primeira classe.
  - Anotações persistentes de laboratório e Ground-Truth nominal (trial_metadata.json).
  - Suporte total a Drag & Drop de ficheiros .bin e .csv no navegador.
  - Modo CLI (--cli) para relatórios rápidos e gráficos no terminal.

Compatível com Windows, Linux e macOS.
===============================================================================
"""

import sys
sys.dont_write_bytecode = True
import os

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT_DIR = os.path.dirname(_CURRENT_DIR)
for _p in (_CURRENT_DIR, _PARENT_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import time
import re
import csv
import json
import struct
import bisect
import argparse
import datetime
import math
import socket
import threading
import http.server
import urllib.parse
import subprocess
try:
    from raw_session_loader import parse_raw_session_dir
except ImportError:
    from python.raw_session_loader import parse_raw_session_dir

try:
    from scientific_metrics import (
        DWT_TIME_UNITS,
        SPEED_OF_LIGHT,
        CANONICAL_ALGO_VERSION,
        PROVENANCE_CATALOG,
        normalize_node_id,
        normalize_link_direction,
        ts_diff_40bit_signed,
        calculate_tof_from_timestamps,
        classify_physical_measurement_model,
        filter_records_by_entity,
        compute_descriptive_stats,
        unwrap_sequence_numbers,
        compute_timing_and_rates,
        compute_linear_drift_regression,
    )
except ImportError:
    from SwarmLoc.python.scientific_metrics import (
        DWT_TIME_UNITS,
        SPEED_OF_LIGHT,
        CANONICAL_ALGO_VERSION,
        PROVENANCE_CATALOG,
        normalize_node_id,
        normalize_link_direction,
        ts_diff_40bit_signed,
        calculate_tof_from_timestamps,
        classify_physical_measurement_model,
        filter_records_by_entity,
        compute_descriptive_stats,
        unwrap_sequence_numbers,
        compute_timing_and_rates,
        compute_linear_drift_regression,
    )
import numpy as np

# Módulo de Protocolo e Conversão Binária 7B Independente
try:
    from binary_protocol import (
        BinaryStreamParser,
        BinaryTdoaFrame,
        decode_binary_tdoa_frame,
        encode_binary_tdoa_frame,
        SequenceUnwrapper,
        PhysicalTimestampReconstructor,
        SwarmTimelineReconstructor,
    )
except ImportError:
    from python.binary_protocol import (
        BinaryStreamParser,
        BinaryTdoaFrame,
        decode_binary_tdoa_frame,
        encode_binary_tdoa_frame,
        SequenceUnwrapper,
        PhysicalTimestampReconstructor,
        SwarmTimelineReconstructor,
    )

# Módulo de Multilateração Euclidiana 3D e Acumulador Espacial
try:
    from multilat import (
        DEFAULT_ANCHORS,
        euclidean_multilat_solve_4pt,
        MeasurementAccumulator,
        compute_trial_3d_positions,
    )
except ImportError:
    from python.multilat import (
        DEFAULT_ANCHORS,
        euclidean_multilat_solve_4pt,
        MeasurementAccumulator,
        compute_trial_3d_positions,
    )

# Importar validador de integridade e checksum FNV-1a
try:
    from download_raw import compute_fnv1a, verify_binary_dump
except ImportError:
    try:
        from python.download_raw import compute_fnv1a, verify_binary_dump
    except ImportError:
        def compute_fnv1a(data: bytes, init_val: int = 0x55AA55AA) -> int:
            chk = init_val & 0xFFFFFFFF
            for b in data:
                chk = ((chk ^ b) * 16777619) & 0xFFFFFFFF
            return chk
        verify_binary_dump = None

# Garantir UTF-8 na consola do Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SWARMLOC_BIN_MAGIC = 0x53574C42  # 'SWLB'
SWARMLOC_BIN_END   = 0x454E4442  # 'ENDB'

HEADER_FORMAT = "<IHBBIII"  # 20 bytes
HEADER_SIZE   = struct.calcsize(HEADER_FORMAT)

RECORD_FORMAT = "<IIHHiHBBH5s5s5s5s5s5sh"  # uint16 round_duration_us
RECORD_SIZE   = struct.calcsize(RECORD_FORMAT)

# =============================================================================
# 1. IDENTIFICAÇÃO E PARSING DE DADOS BINÁRIOS (SWLB 54B) E TABULARES (CSV)
# =============================================================================

def extract_trial_info(filename: str) -> tuple:
    """Extrai o identificador único e o carimbo legível do ensaio a partir do nome do ficheiro."""
    m = re.search(r'(\d{8}_\d{6})', filename)
    if m:
        ts_str = m.group(1)
        try:
            dt = datetime.datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
            fmt = dt.strftime("%Y-%m-%d %H:%M:%S")
            return ts_str, fmt
        except Exception:
            return ts_str, ts_str
    # Fallback para ficheiros sem timestamp padrão
    base = os.path.splitext(os.path.basename(filename))[0]
    return base, base

def ts_bytes_to_uint64(raw_bytes: bytes) -> int:
    """Converte 5 bytes Little-Endian num inteiro sem sinal de 40 bits."""
    if len(raw_bytes) < 5:
        return 0
    return int.from_bytes(raw_bytes[:5], byteorder="little", signed=False)

def _ts_diff_40bit_signed(t_later: int, t_earlier: int) -> int:
    return ts_diff_40bit_signed(t_later, t_earlier)

def calculate_tof_meters(t1: int, t2: int, t3: int, t4: int, t5: int = 0, t6: int = 0) -> tuple:
    """Calcula a distância ToF direta a partir dos timestamps de 40 bits (DS-TWR e SS-TWR)
    usando a função canónica partilhada."""
    res = calculate_tof_from_timestamps(t1, t2, t3, t4, t5, t6)
    return res["raw_tof_ds_m"], res["raw_tof_ss_m"]


def normalize_sequence_records(records: list) -> list:
    """Normaliza a entidade da sequência para ser a mesma escala unificada de ciclos
    do algoritmo independentemente do protocolo (TWR vs TDoA), preservando seq_raw."""
    if not records:
        return records

    has_huge_jump = False
    seq_vals = [r.get("seq") for r in records if r.get("seq") is not None]
    if seq_vals and (max(seq_vals) - min(seq_vals) > 10000 or min(seq_vals) == 0):
        has_huge_jump = True

    if has_huge_jump:
        current_cycle = 1
        last_raw_by_proto = {}
        for idx, r in enumerate(records):
            if "seq_raw" not in r:
                r["seq_raw"] = r.get("seq")
            raw_s = r.get("seq_raw")
            proto = (r.get("packet_type") or r.get("protocol") or "TWR").upper()
            prev_raw = last_raw_by_proto.get(proto)

            if raw_s is not None and prev_raw is not None:
                delta = int(raw_s) - int(prev_raw)
                if 0 < delta < 10000:
                    current_cycle += delta
                elif delta != 0:
                    current_cycle += 1
            else:
                if idx > 0:
                    current_cycle += 1

            if raw_s is not None:
                last_raw_by_proto[proto] = int(raw_s)
            r["seq"] = current_cycle
            r["algo_cycle"] = current_cycle
    else:
        for r in records:
            if "seq_raw" not in r:
                r["seq_raw"] = r.get("seq")
            r["algo_cycle"] = r.get("seq")

    return records

def parse_binary_data(data: bytes, filename: str = "dados.bin") -> tuple:
    """Desempacota bytes binários no formato SWLB de 54B por registo."""
    if len(data) < HEADER_SIZE:
        return [], {}

    magic, node_id, role, rec_size, count, dur_ms, chk = struct.unpack_from(HEADER_FORMAT, data, 0)
    if magic != SWARMLOC_BIN_MAGIC or rec_size != RECORD_SIZE:
        return [], {}

    trial_key, trial_time_str = extract_trial_info(filename)
    role_str = "Master" if role == 1 else "Slave"
    records = []
    offset = HEADER_SIZE

    for _ in range(count):
        if offset + RECORD_SIZE > len(data):
            break

        unpacked = struct.unpack_from(RECORD_FORMAT, data, offset)
        offset += RECORD_SIZE

        (seq, timestamp_ms, src_addr, dst_addr, distance_mm,
         dur_us, r_role, status, err_code,
         t1_b, t2_b, t3_b, t4_b, t5_b, t6_b, drift_x100) = unpacked

        t1 = ts_bytes_to_uint64(t1_b)
        t2 = ts_bytes_to_uint64(t2_b)
        t3 = ts_bytes_to_uint64(t3_b)
        t4 = ts_bytes_to_uint64(t4_b)
        t5 = ts_bytes_to_uint64(t5_b)
        t6 = ts_bytes_to_uint64(t6_b)

        dist_m = round(distance_mm / 1000.0, 3) if distance_mm >= 0 else None
        drift_ppm = round(drift_x100 / 100.0, 2)
        raw_ds_m, raw_ss_m = calculate_tof_meters(t1, t2, t3, t4, t5, t6)

        # Classificação correta de protocolo:
        # Beacons TDoA/OWR são transmitidos para broadcast (0xFFFF) ou registados pelo recetor com dur_us entre 1 e 5 µs.
        # Rondas direcionadas a um escravo específico (dst_addr != 0xFFFF) são DS-TWR (mesmo quando falham com dur_us == 0).
        if dst_addr == 0xFFFF or (0 < dur_us <= 5):
            pkt_type = "TDOA"
        else:
            pkt_type = "TWR"
        ranging_method = "OWR_SYNC_TOF" if pkt_type == "TDOA" else ("SS_TWR_CFO" if r_role == 1 else "DS_TWR_FILTERED")
        rec_status = "OK" if status == 1 else "FAIL"
        inv_reason = None if status == 1 else f"firmware_status_{status}_err_{err_code}"
        if dist_m is not None and (dist_m < -20.0 or dist_m > 100.0):
            rec_status = "ERR_BOUNDS"
            inv_reason = "out_of_physical_bounds"
            dist_m = None
        if abs(drift_ppm) > 50.0:
            drift_ppm = None
            if inv_reason is None:
                inv_reason = "out_of_bounds_clock_drift"

        rec = {
            "seq": seq,
            "timestamp_ms": timestamp_ms,
            "src_addr": f"0x{src_addr:04X}",
            "dst_addr": f"0x{dst_addr:04X}",
            "role": "Master" if r_role == 1 else "Slave",
            "status": rec_status,
            "invalidation_reason": inv_reason,
            "error_code": err_code,
            "distance_m": dist_m,
            "distance_mm": distance_mm,
            "round_duration_us": dur_us,
            "packet_type": pkt_type,
            "ranging_method": ranging_method,
            "clock_drift_ppm": drift_ppm,
            "t1": f"0x{t1:010X}",
            "t2": f"0x{t2:010X}",
            "t3": f"0x{t3:010X}",
            "t4": f"0x{t4:010X}",
            "t5": f"0x{t5:010X}",
            "t6": f"0x{t6:010X}",
            "raw_tof_ds_m": raw_ds_m,
            "raw_tof_ss_m": raw_ss_m,
            "t_global_us": int(round(t2 * (1.0 / (499.2e6 * 128.0)) * 1e6)) if (pkt_type == "TDOA" and t2 > 0) else (int(round(t1 * (1.0 / (499.2e6 * 128.0)) * 1e6)) if t1 > 0 else None),
            "rssi_dbm": None,
            "fp_rssi_dbm": None,
            "provenance": "module_flash_54b",
            "clock_domain": "hardware_dw3000",
            "source_file": filename,
            "trial_id": trial_key,
            "trial_time": trial_time_str,
            "subslot": (src_addr & 0x07) if pkt_type == "TDOA" else 0,
            "slot_idx": (src_addr & 0x07) if pkt_type == "TDOA" else 0
        }
        records.append(rec)

    # Validação de integridade FNV-1a e marcador de rodapé ENDB
    expected_payload_bytes = count * rec_size
    expected_with_footer = HEADER_SIZE + expected_payload_bytes + 4
    chk_valid = None
    endb_valid = None
    computed_chk = None

    if len(data) >= HEADER_SIZE + expected_payload_bytes:
        payload = data[HEADER_SIZE : HEADER_SIZE + expected_payload_bytes]
        computed_chk = compute_fnv1a(payload)
        chk_valid = (computed_chk == chk)

        if len(data) >= expected_with_footer:
            end_marker, = struct.unpack_from('<I', data, HEADER_SIZE + expected_payload_bytes)
            endb_valid = (end_marker == SWARMLOC_BIN_END)
        else:
            endb_valid = False

    meta = {
        "filename": filename,
        "node_id": f"{node_id:04X}",
        "role": role_str,
        "record_count": len(records),
        "duration_ms": dur_ms,
        "checksum": f"0x{chk:08X}",
        "computed_checksum": f"0x{computed_chk:08X}" if computed_chk is not None else None,
        "checksum_valid": chk_valid,
        "end_marker_valid": endb_valid,
        "trial_id": trial_key,
        "trial_time": trial_time_str
    }
    records = normalize_sequence_records(records)
    meta['record_count'] = len(records)
    return records, meta

def parse_binary_file(filepath: str) -> tuple:
    """Lê um ficheiro .bin do disco e grava automaticamente a versão .csv equivalente."""
    if not os.path.exists(filepath):
        return [], {}
    with open(filepath, "rb") as f:
        data = f.read()

    fn = os.path.basename(filepath)
    records, meta = parse_binary_data(data, fn)
    meta["filepath"] = filepath

    base_no_ext, _ = os.path.splitext(filepath)
    csv_out = f"{base_no_ext}.csv"
    if not os.path.exists(csv_out) and records:
        save_records_to_csv(records, meta, csv_out)

    return records, meta

def parse_csv_file(filepath: str) -> tuple:
    """Lê um ficheiro CSV convertido e extrai os registos numéricos."""
    if not os.path.exists(filepath):
        return [], {}

    fn = os.path.basename(filepath)
    trial_key, trial_time_str = extract_trial_info(fn)

    metadata = {
        "filepath": filepath,
        "filename": fn,
        "node_id": "Desconhecido",
        "role": "Node",
        "duration_ms": 0,
        "trial_id": trial_key,
        "trial_time": trial_time_str
    }
    records = []

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        header = None
        for row in reader:
            if not row:
                continue
            if row[0].startswith("#"):
                comment = ",".join(row).lstrip("#").strip()
                if ":" in comment:
                    k, v = comment.split(":", 1)
                    metadata[k.strip().lower().replace(" ", "_")] = v.strip()
                continue

            if header is None:
                header = [col.strip() for col in row]
                continue

            row_dict = {}
            for i, val in enumerate(row):
                if i < len(header):
                    row_dict[header[i]] = val.strip()

            try:
                row_dict["seq"] = int(row_dict.get("seq", 0))
                row_dict["timestamp_ms"] = int(row_dict.get("timestamp_ms", 0))
                dist_str = row_dict.get("distance_m", "")
                row_dict["distance_m"] = float(dist_str) if dist_str and dist_str != "None" else None
                drift_str = row_dict.get("clock_drift_ppm", "0")
                row_dict["clock_drift_ppm"] = float(drift_str) if drift_str and drift_str != "None" else 0.0
                dur_str = row_dict.get("round_duration_us", "0")
                try:
                    row_dict["round_duration_us"] = int(dur_str)
                except ValueError:
                    row_dict["round_duration_us"] = 0
                row_dict["packet_type"] = "TDOA" if (row_dict["round_duration_us"] <= 5) else "TWR"
                row_dict["source_file"] = fn
                row_dict["trial_id"] = trial_key
                row_dict["trial_time"] = trial_time_str

                # Classificação explícita do método de medição física
                src_clean = str(row_dict.get("src_addr", "")).upper().replace("0X", "").zfill(4)
                if row_dict["packet_type"] == "TDOA":
                    row_dict["ranging_method"] = "OWR_SYNC_TOF"
                elif src_clean == "0001":
                    row_dict["ranging_method"] = "SS_TWR_CFO"
                else:
                    row_dict["ranging_method"] = "DS_TWR_FILTERED"

                # Validação de limites físicos plausíveis UWB [0.0, 100.0] m e deriva [-50.0, 50.0] ppm
                if row_dict["distance_m"] is not None and (row_dict["distance_m"] < 0.0 or row_dict["distance_m"] > 100.0):
                    row_dict["status"] = "ERR_BOUNDS"
                    row_dict["invalidation_reason"] = "out_of_physical_bounds"
                    row_dict["distance_m"] = None
                if row_dict.get("clock_drift_ppm") is not None and abs(row_dict["clock_drift_ppm"]) > 50.0:
                    row_dict["clock_drift_ppm"] = None
                    row_dict["invalidation_reason"] = row_dict.get("invalidation_reason") or "out_of_bounds_clock_drift"

                if "raw_tof_ds_m" in row_dict and row_dict["raw_tof_ds_m"]:
                    try:
                        row_dict["raw_tof_ds_m"] = float(row_dict["raw_tof_ds_m"])
                    except ValueError:
                        row_dict["raw_tof_ds_m"] = None
                else:
                    row_dict["raw_tof_ds_m"] = None

                if "raw_tof_ss_m" in row_dict and row_dict["raw_tof_ss_m"]:
                    try:
                        row_dict["raw_tof_ss_m"] = float(row_dict["raw_tof_ss_m"])
                    except ValueError:
                        row_dict["raw_tof_ss_m"] = None
                else:
                    row_dict["raw_tof_ss_m"] = None

                # Se t1..t6 estiverem presentes no CSV, reconstrói distância instantânea (não filtrada) DS-TWR e SS-TWR (40 bits)
                if row_dict["packet_type"] == "TWR" and row_dict["raw_tof_ds_m"] is None and "t1" in row_dict:
                    try:
                        t1 = int(str(row_dict.get("t1") or "0"), 0)
                        t2 = int(str(row_dict.get("t2") or "0"), 0)
                        t3 = int(str(row_dict.get("t3") or "0"), 0)
                        t4 = int(str(row_dict.get("t4") or "0"), 0)
                        t5 = int(str(row_dict.get("t5") or "0"), 0)
                        t6 = int(str(row_dict.get("t6") or "0"), 0)
                        tof_res = calculate_tof_from_timestamps(t1, t2, t3, t4, t5, t6)
                        if tof_res["raw_tof_ss_m"] is not None:
                            row_dict["raw_tof_ss_m"] = tof_res["raw_tof_ss_m"]
                        if tof_res["raw_tof_ds_m"] is not None:
                            row_dict["raw_tof_ds_m"] = tof_res["raw_tof_ds_m"]
                    except (ValueError, TypeError):
                        pass

                row_dict.setdefault("t_global_us", None)
                row_dict.setdefault("rssi_dbm", None)
                row_dict.setdefault("fp_rssi_dbm", None)
                row_dict.setdefault("provenance", "module_csv_converted")
                if "subslot" in row_dict and row_dict["subslot"] is not None and str(row_dict["subslot"]).strip() != "":
                    try:
                        row_dict["subslot"] = int(row_dict["subslot"])
                    except ValueError:
                        row_dict["subslot"] = 0
                else:
                    try:
                        s_addr = int(str(row_dict.get("src_addr", "0")), 16)
                        row_dict["subslot"] = (s_addr & 0x07) if row_dict.get("packet_type") == "TDOA" else 0
                    except Exception:
                        row_dict["subslot"] = 0
                row_dict["slot_idx"] = row_dict["subslot"]
                records.append(row_dict)
            except ValueError:
                continue

    metadata["record_count"] = len(records)
    if records and "src_addr" in records[0]:
        metadata["node_id"] = records[0]["src_addr"].replace("0x", "")
    if records and "role" in records[0]:
        metadata["role"] = records[0]["role"]

    records = normalize_sequence_records(records)
    metadata['record_count'] = len(records)
    return records, metadata

def save_records_to_csv(records: list, meta: dict, output_csv: str):
    """Guarda registos em ficheiro CSV padronizado."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(output_csv)), exist_ok=True)
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            f.write("# SWARMLOC UWB CONVERTED DATASET\n")
            f.write(f"# Node_ID: {meta.get('node_id', '0000')}\n")
            f.write(f"# Role: {meta.get('role', 'Node')}\n")
            f.write(f"# Records: {len(records)}\n")
            f.write(f"# Duration_ms: {meta.get('duration_ms', 0)}\n")
            f.write(f"# Checksum: {meta.get('checksum', '0x0')}\n")
            f.write(f"# Trial_ID: {meta.get('trial_id', '')}\n")
            if records:
                keys = [k for k in records[0].keys() if k not in ["source_file", "trial_id", "trial_time"]]
                writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(records)
    except Exception as e:
        print(f"[ERRO] Falha ao gravar CSV {output_csv}: {e}")

def parse_jsonl_file(filepath: str) -> tuple:
    """Carrega ficheiro de sessao de telemetria gravada em tempo real (.jsonl)."""
    records = []
    filename = os.path.basename(filepath)
    m = re.search(r'(\d{8}_\d{6})', filename)
    trial_id = f"stream_{m.group(1)}" if m else os.path.splitext(filename)[0]
    trial_time = trial_id
    if m:
        try:
            dt = datetime.datetime.strptime(m.group(1), "%Y%m%d_%H%M%S")
            trial_time = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass

    metadata = {
        "trial_id": trial_id,
        "trial_time": trial_time,
        "filename": filename,
        "filepath": filepath,
        "node_id": "0001",
        "role": "Live Stream",
        "format": "JSONL",
        "record_count": 0
    }

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    r["source_file"] = filename
                    r["trial_id"] = trial_id
                    r["trial_time"] = trial_time
                    if "round_duration_us" not in r:
                        r["round_duration_us"] = 1 if (r.get("protocol") or "").upper() == "TDOA" else 1000
                    
                    # Normalizar enderecos TDoA (corrigir caso historico onde src == dst)
                    if (r.get("protocol") or "").upper() == "TDOA":
                        parsed_dict = r.get("parsed") or {}
                        p_src = parsed_dict.get("src") or "0001"
                        p_dst = parsed_dict.get("dst") or r.get("node_id") or "0002"
                        if r.get("src_addr") == r.get("dst_addr") or (r.get("src_addr") != "0x0001" and "[TDOA:RX" in r.get("text", "")):
                            r["src_addr"] = f"0x{str(p_src).upper().zfill(4)}"
                            r["dst_addr"] = f"0x{str(p_dst).upper().zfill(4)}"
                            r["peer_id"] = str(p_src).upper().zfill(4)
                        else:
                            r["src_addr"] = str(r.get("src_addr") or "0x0001")
                            r["dst_addr"] = str(r.get("dst_addr") or "0x0002")
                    else:
                        r["src_addr"] = str(r.get("src_addr") or "0x0001")
                        r["dst_addr"] = str(r.get("dst_addr") or "0x0002")
                    if "subslot" not in r:
                        p_sub = (r.get("parsed") or {}).get("subslot")
                        if p_sub is not None:
                            r["subslot"] = p_sub
                        else:
                            try:
                                s_addr = int(str(r.get("src_addr", "0")), 16)
                                r["subslot"] = (s_addr & 0x07) if (r.get("protocol") or "").upper() == "TDOA" else 0
                            except Exception:
                                r["subslot"] = 0
                    r["slot_idx"] = r.get("slot_idx", r["subslot"])
                    records.append(r)
                except Exception:
                    continue
    except Exception as e:
        print(f"[ERRO] Falha ao ler {filepath}: {e}")

    metadata["record_count"] = len(records)
    records = normalize_sequence_records(records)
    return records, metadata

def load_file(path: str) -> tuple:
    """Deteta e carrega ficheiro .bin ou .csv."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".bin":
        return parse_binary_file(path)
    elif ext == ".csv":
        return parse_csv_file(path)
    elif ext == ".jsonl":
        return parse_jsonl_file(path)
    return [], {}

# =============================================================================
# 2. MOTOR DE ESTATÍSTICAS E ANÁLISE DE CORRELAÇÕES
# =============================================================================

def compute_group_metrics(records: list, ref_distances: dict = None, default_ref_m: float = None) -> list:
    """Calcula estatísticas avançadas agrupadas estritamente por link e protocolo (TWR vs TDoA).
    Utiliza o motor canónico de métricas científicas (scientific_metrics.py)."""
    ref_distances = ref_distances or {}
    groups = {}
    for r in records:
        proto = "TWR" if (r.get("packet_type") == "TWR" or float(r.get("round_duration_us", 0) or 0) > 5) else "TDoA"
        r["protocol"] = proto
        src = str(r.get("src_addr") or "Origem")
        dst = str(r.get("dst_addr") or "Destino")
        fn = str(r.get("source_file") or "")
        key = (src, dst, proto, fn)
        if key not in groups:
            groups[key] = []
        groups[key].append(r)

    results = []
    for (src, dst, proto, fn), recs in sorted(groups.items()):
        n_total = len(recs)
        valid_dists = [r["distance_m"] for r in recs if r.get("status") == "OK" and r["distance_m"] is not None]
        n_ok = len(valid_dists)
        n_invalid = max(0, n_total - n_ok)
        success_rate = (n_ok / n_total * 100.0) if n_total > 0 else 0.0

        base_label = f"{src} -> {dst}"
        link_label = f"{src} -> {dst} [{proto}]"
        ref_val = ref_distances.get(link_label) or ref_distances.get(base_label) or default_ref_m

        drifts = [r["clock_drift_ppm"] for r in recs if r.get("status") == "OK" and r.get("clock_drift_ppm") is not None and abs(r["clock_drift_ppm"]) <= 50.0]
        drift_stats = compute_descriptive_stats(drifts)
        mean_drift = round(drift_stats["mean"], 2) if drift_stats else 0.0

        dist_stats = compute_descriptive_stats(valid_dists, ref_val=ref_val, total_raw_count=n_total)
        if dist_stats:
            mean_d = round(dist_stats["mean"], 3)
            std_d = round(dist_stats["std"], 4)
            std_mm = round(dist_stats["std_mm"], 2)
            min_d = round(dist_stats["min"], 3)
            max_d = round(dist_stats["max"], 3)
            median_d = round(dist_stats["median"], 3)
            iqr_d = round(dist_stats["iqr"], 3)
            iqr_mm = round(dist_stats["iqr_mm"], 2)
            mad_mm = round(dist_stats["mad_mm"], 2)
            mad_sigma_mm = round(dist_stats["mad_sigma_mm"], 2)
            p5_d = round(dist_stats["p5"], 3)
            q1_d = round(dist_stats["q1"], 3)
            q3_d = round(dist_stats["q3"], 3)
            p95_d = round(dist_stats["p95"], 3)
            p99_d = round(dist_stats["p99"], 3)
            ci95_d = [round(dist_stats["ci95"][0], 4), round(dist_stats["ci95"][1], 4)]
            bias_mm = round(dist_stats["bias_mm"], 2) if dist_stats["bias_mm"] is not None else None
            rmse_mm = round(dist_stats["rmse_mm"], 2) if dist_stats["rmse_mm"] is not None else None
            has_gt = dist_stats["has_ground_truth"]
        else:
            mean_d = std_d = std_mm = min_d = max_d = median_d = iqr_d = iqr_mm = mad_mm = mad_sigma_mm = p5_d = q1_d = q3_d = p95_d = p99_d = 0.0
            ci95_d = [0.0, 0.0]
            bias_mm = None
            rmse_mm = None
            has_gt = False

        # Estatísticas separadas para distância instantânea não-filtrada (raw_tof_ds_m / raw_tof_ss_m)
        raw_ds_vals = [r["raw_tof_ds_m"] for r in recs if r.get("status") == "OK" and r.get("raw_tof_ds_m") is not None]
        raw_ss_vals = [r["raw_tof_ss_m"] for r in recs if r.get("status") == "OK" and r.get("raw_tof_ss_m") is not None]
        raw_ds_stats = compute_descriptive_stats(raw_ds_vals)
        raw_ss_stats = compute_descriptive_stats(raw_ss_vals)

        src_clean = str(src).upper().replace("0X", "").zfill(4)
        ranging_method = "OWR_SYNC_TOF" if proto == "TDoA" else ("SS_TWR_CFO" if src_clean == "0001" else "DS_TWR_FILTERED")
        phys_model = classify_physical_measurement_model(recs[0] if recs else {"src_addr": src, "protocol": proto})

        # Cálculo da Frequência Experimental e Intervalos dt via scientific_metrics
        ts_list = [r["timestamp_ms"] / 1000.0 for r in recs if r.get("timestamp_ms") is not None]
        seq_list = [r.get("seq") for r in recs if r.get("timestamp_ms") is not None]
        timing = compute_timing_and_rates(ts_list, seq_list)

        # Regressão linear de deriva para esta ligação
        t0_ms = min([r["timestamp_ms"] for r in recs if r.get("timestamp_ms") is not None], default=0)
        drift_t_s = [(r["timestamp_ms"] - t0_ms) / 1000.0 for r in recs if r.get("status") == "OK" and r.get("timestamp_ms") is not None and r.get("clock_drift_ppm") is not None]
        drift_v_ppm = [r["clock_drift_ppm"] for r in recs if r.get("status") == "OK" and r.get("timestamp_ms") is not None and r.get("clock_drift_ppm") is not None]
        drift_reg = compute_linear_drift_regression(drift_t_s, drift_v_ppm)

        results.append({
            "source_file": fn,
            "src": src,
            "dst": dst,
            "protocol": proto,
            "ranging_method": ranging_method,
            "physical_model": phys_model,
            "base_label": base_label,
            "link_label": link_label,
            "n_total": n_total,
            "n_ok": n_ok,
            "n_invalid": n_invalid,
            "success_rate": round(success_rate, 1),
            "mean_dist": mean_d,
            "std_mm": std_mm,
            "mad_mm": mad_mm,
            "mad_sigma_mm": mad_sigma_mm,
            "iqr_mm": iqr_mm,
            "min_dist": min_d,
            "max_dist": max_d,
            "median_dist": median_d,
            "iqr_dist": iqr_d,
            "p5_dist": p5_d,
            "q1_dist": q1_d,
            "q3_dist": q3_d,
            "p95_dist": p95_d,
            "p99_dist": p99_d,
            "ci95_dist": ci95_d,
            "ref_distance_m": ref_val,
            "has_ground_truth": has_gt,
            "bias_mm": bias_mm,
            "rmse_mm": rmse_mm,
            "raw_ds_mean_dist": round(raw_ds_stats["mean"], 3) if raw_ds_stats else None,
            "raw_ds_std_mm": round(raw_ds_stats["std_mm"], 2) if raw_ds_stats else None,
            "raw_ss_mean_dist": round(raw_ss_stats["mean"], 3) if raw_ss_stats else None,
            "raw_ss_std_mm": round(raw_ss_stats["std_mm"], 2) if raw_ss_stats else None,
            "mean_drift": mean_drift,
            "drift_regression": drift_reg,
            "freq_hz": timing["freq_observed_hz"],
            "freq_rf_hz": timing["freq_radio_rf_hz"],
            "mean_dt_ms": timing["dt_mean_ms"],
            "median_dt_ms": timing["dt_median_ms"],
            "jitter_ms": timing["jitter_ms"],
            "span_s": timing["span_s"],
            "dropped_packets_rf": timing["dropped_packets_rf"],
            "duplicate_packets": timing.get("duplicate_packets", 0),
            "out_of_order_packets": timing.get("out_of_order_packets", 0),
            "packet_loss_rate": timing["packet_loss_rate"],
            "algo_version": CANONICAL_ALGO_VERSION,
            "records": recs
        })
    return results

def compute_all_pairwise_symmetry(records: list) -> dict:
    """Calcula a análise completa de simetria, emparelhamento e concordância de Bland-Altman
    para pares de nós com comunicação bidirecional registrada (estritamente TWR bidirecional)."""
    from collections import defaultdict
    pair_recs = defaultdict(list)
    for r in records:
        is_twr = (r.get("packet_type") == "TWR" or float(r.get("round_duration_us", 0) or 0) > 5)
        if is_twr and r.get("status") == "OK" and r.get("distance_m") is not None:
            pair_recs[(r["src_addr"], r["dst_addr"])].append(r)

    pairs_result = {}
    seen_pairs = set()

    for (src, dst) in list(pair_recs.keys()):
        if (dst, src) in pair_recs and (dst, src) not in seen_pairs and (src, dst) not in seen_pairs:
            seen_pairs.add((src, dst))
            seen_pairs.add((dst, src))

            # Ordenar canonicamente: colocar o Master (0001) como A, se existir
            if "0001" in dst and "0001" not in src:
                nA, nB = dst, src
            else:
                nA, nB = src, dst

            pair_label = f"{nA} <-> {nB}"
            dir_a_to_b = f"{nA} -> {nB}"
            dir_b_to_a = f"{nB} -> {nA}"

            recs_a = pair_recs[(nA, nB)]
            recs_b = pair_recs[(nB, nA)]

            mapA = {r["seq"]: r["distance_m"] for r in recs_a}
            mapB = {r["seq"]: r["distance_m"] for r in recs_b}

            common_seqs = sorted(set(mapA.keys()) & set(mapB.keys()))
            n_paired = len(common_seqs)

            if n_paired < 2:
                continue

            dA = np.array([mapA[s] for s in common_seqs])
            dB = np.array([mapB[s] for s in common_seqs])
            diffs = dA - dB
            diffs_mm = diffs * 1000.0

            mean_diff = float(np.mean(diffs_mm))
            std_diff = float(np.std(diffs_mm, ddof=1)) if n_paired > 1 else 0.0
            se_diff = std_diff / np.sqrt(n_paired) if n_paired > 0 else 0.0
            t_val = 1.99 if n_paired > 30 else 2.05
            ci95 = [round(mean_diff - t_val * se_diff, 2), round(mean_diff + t_val * se_diff, 2)]
            
            med_diff = float(np.median(diffs_mm))
            mad_diff = float(np.median(np.abs(diffs_mm - med_diff)))
            loa_lower = round(mean_diff - 1.96 * std_diff, 2)
            loa_upper = round(mean_diff + 1.96 * std_diff, 2)

            means_m = ((dA + dB) / 2.0).round(4).tolist()
            corr = float(np.corrcoef(dA, dB)[0, 1]) if np.std(dA) > 0 and np.std(dB) > 0 else 0.0

            # ECDF dos resíduos da simetria
            sorted_diffs = np.sort(diffs_mm)
            ecdf_x = sorted_diffs.round(2).tolist()
            ecdf_y = [round((i + 1) / n_paired, 4) for i in range(n_paired)]

            pairs_result[pair_label] = {
                "pair_label": pair_label,
                "node_a": nA,
                "node_b": nB,
                "dir_a_to_b": dir_a_to_b,
                "dir_b_to_a": dir_b_to_a,
                "n_paired": n_paired,
                "n_unpaired_a": len(mapA) - n_paired,
                "n_unpaired_b": len(mapB) - n_paired,
                "total_a": len(mapA),
                "total_b": len(mapB),
                "pairing_rate_a_pct": round(n_paired / len(mapA) * 100.0, 1) if len(mapA) > 0 else 0.0,
                "pairing_rate_b_pct": round(n_paired / len(mapB) * 100.0, 1) if len(mapB) > 0 else 0.0,
                "seqs": common_seqs,
                "d_a": dA.round(4).tolist(),
                "d_b": dB.round(4).tolist(),
                "diffs_mm": diffs_mm.round(2).tolist(),
                "mean_diff_mm": round(mean_diff, 2),
                "std_diff_mm": round(std_diff, 2),
                "se_diff_mm": round(se_diff, 2),
                "ci95_diff_mm": ci95,
                "median_diff_mm": round(med_diff, 2),
                "mad_diff_mm": round(mad_diff, 2),
                "loa_lower_mm": loa_lower,
                "loa_upper_mm": loa_upper,
                "means_m": means_m,
                "correlation": round(corr, 3),
                "ecdf_x": ecdf_x,
                "ecdf_y": ecdf_y
            }

    return pairs_result

def compute_clock_drift_analysis(records: list) -> dict:
    """Analisa o desvio de frequência de relógio (CFO) medido por nó e por link,
    separando medições reais de modelos teóricos de erro."""
    from collections import defaultdict
    link_drifts = defaultdict(list)
    for r in records:
        if r.get("status") == "OK" and r.get("clock_drift_ppm") is not None:
            link = f"{r['src_addr']} -> {r['dst_addr']}"
            link_drifts[link].append((r["clock_drift_ppm"], r["src_addr"], r["dst_addr"]))

    measured_links = []
    for link, items in link_drifts.items():
        vals = np.array([x[0] for x in items])
        src = items[0][1]
        dst = items[0][2]
        n = len(vals)
        mean_v = float(np.mean(vals))
        std_v = float(np.std(vals, ddof=1)) if n > 1 else 0.0
        se = std_v / np.sqrt(n) if n > 0 else 0.0
        ci95 = [round(mean_v - 1.96 * se, 3), round(mean_v + 1.96 * se, 3)]
        
        measured_links.append({
            "link_label": link,
            "transmitter": src,
            "receiver": dst,
            "n_samples": n,
            "mean_ppm": round(mean_v, 3),
            "std_ppm": round(std_v, 3),
            "ci95_ppm": ci95,
            "min_ppm": round(float(np.min(vals)), 2),
            "max_ppm": round(float(np.max(vals)), 2),
            "instrument": "DW3000 Carrier Integrator (CFO)",
            "is_zero_instrumented": bool(np.all(vals == 0))
        })

    # Modelos Teóricos de Propagação de Erro TWR
    c_light = SPEED_OF_LIGHT # m/s (unificado com firmware include/uwb.h)
    t_reply_default_us = 500.0 # 500 us padrão de firmware DW3000
    
    theoretical = []
    for ml in measured_links:
        drift_val = ml["mean_ppm"]
        # SS-TWR erro: delta_d = c * (drift / 2) * T_reply
        err_ss_m = c_light * (drift_val * 1e-6 / 2.0) * (t_reply_default_us * 1e-6)
        # DS-TWR erro de segunda ordem com skew residual ~ 10 ppm
        err_ds_m = c_light * (drift_val * 1e-6) * (10e-6) * (t_reply_default_us * 1e-6)
        
        theoretical.append({
            "link_label": ml["link_label"],
            "drift_used_ppm": drift_val,
            "t_reply_us": t_reply_default_us,
            "ss_twr_error_mm": round(err_ss_m * 1000.0, 2),
            "ds_twr_error_mm": round(err_ds_m * 1000.0, 4),
            "ds_twr_suppression_factor": "Redução quadrática (~1000x menor)",
            "equation_ss": "ε_SS = c · (Δf / 2f) · T_reply",
            "equation_ds": "ε_DS ≈ c · (e_A · e_B) · T_reply / 4 (2.ª ordem)"
        })

    # 3. Análise Científica de Sincronização de Relógio Global por Nó
    nodes_sync_stats = {}
    time_series_by_node = {}

    recs_by_node = defaultdict(list)
    for r in records:
        if r.get("status") == "OK":
            node_key = r.get("src_addr")
            if node_key:
                recs_by_node[node_key].append(r)

    for node_addr, nrecs in recs_by_node.items():
        sorted_recs = sorted(nrecs, key=lambda x: x.get("timestamp_ms", 0))
        if not sorted_recs:
            continue

        t0_ms = sorted_recs[0].get("timestamp_ms", 0)
        t_end_ms = sorted_recs[-1].get("timestamp_ms", 0)
        dur_s = max(0.001, (t_end_ms - t0_ms) / 1000.0)

        # Drifts válidos
        drifts = [float(r["clock_drift_ppm"]) for r in sorted_recs if r.get("clock_drift_ppm") is not None and r["clock_drift_ppm"] != 0.0]
        mean_drift = float(np.mean(drifts)) if drifts else 0.0
        std_drift = float(np.std(drifts, ddof=1)) if len(drifts) > 1 else 0.0

        twr_recs = [r for r in sorted_recs if (r.get("packet_type") or "").upper() == "TWR" or (r.get("round_duration_us") or 0) > 100]
        tdoa_recs = [r for r in sorted_recs if (r.get("packet_type") or "").upper() == "TDOA" or (r.get("round_duration_us") or 0) <= 5]

        # Intervalo entre sincronizações (k)
        twr_ms_list = [r["timestamp_ms"] for r in twr_recs]
        diffs_s = [(twr_ms_list[i] - twr_ms_list[i-1]) / 1000.0 for i in range(1, len(twr_ms_list))]
        sync_k_s = float(np.mean(diffs_s)) if diffs_s else (0.5 if len(twr_recs) > 0 else 0.0)

        dists = [r["distance_m"] for r in sorted_recs if r.get("distance_m") is not None and r["distance_m"] > 0]
        mean_dist = float(np.mean(dists)) if dists else 0.0
        std_dist = float(np.std(dists, ddof=1)) if len(dists) > 1 else 0.0

        drift_rate_ns_s = mean_drift * 1000.0
        drift_rate_m_s = mean_drift * 1e-6 * c_light
        uncomp_tot_m = abs(drift_rate_m_s * dur_s)
        sawtooth_peak_ns = abs(drift_rate_ns_s * (sync_k_s if sync_k_s > 0 else 0.5))
        sawtooth_peak_mm = sawtooth_peak_ns * 1e-9 * c_light * 1000.0

        # Eficácia da supressão do desvio
        if uncomp_tot_m > 0:
            suppr_pct = round(max(0.0, min(100.0, 100.0 * (1.0 - (std_dist / uncomp_tot_m)))), 2)
        else:
            suppr_pct = 100.0

        role_str = sorted_recs[0].get("role", "Slave")

        nodes_sync_stats[node_addr] = {
            "node_addr": node_addr,
            "role": role_str,
            "total_records": len(sorted_recs),
            "twr_count": len(twr_recs),
            "tdoa_count": len(tdoa_recs),
            "duration_s": round(dur_s, 2),
            "mean_drift_ppm": round(mean_drift, 3),
            "std_drift_ppm": round(std_drift, 3),
            "alpha_estimated": round(1.0 + (mean_drift * 1e-6), 9),
            "drift_rate_ns_s": round(drift_rate_ns_s, 2),
            "drift_rate_m_s": round(drift_rate_m_s, 3),
            "sync_interval_k_s": round(sync_k_s, 3),
            "sawtooth_peak_ns": round(sawtooth_peak_ns, 2),
            "sawtooth_peak_mm": round(sawtooth_peak_mm, 1),
            "uncomp_error_total_m": round(uncomp_tot_m, 2),
            "residual_rms_ns": round((std_dist / c_light) * 1e9, 3),
            "residual_rms_mm": round(std_dist * 1000.0, 1),
            "error_suppression_pct": suppr_pct,
            "mean_distance_m": round(mean_dist, 3)
        }

        # Série Temporal Otimizada para Chart.js
        stride = max(1, len(sorted_recs) // 800)
        t_series = []
        last_twr_t_sec = 0.0

        for idx, r in enumerate(sorted_recs):
            is_twr = (r.get("packet_type") or "").upper() == "TWR" or (r.get("round_duration_us") or 0) > 100
            if not is_twr and (idx % stride != 0):
                continue

            t_sec = max(0.0, (r.get("timestamp_ms", 0) - t0_ms) / 1000.0)
            if is_twr:
                last_twr_t_sec = t_sec

            # Deriva bruta contínua (se não houvesse sincronismo afim)
            uncomp_ns = drift_rate_ns_s * t_sec
            uncomp_m = drift_rate_m_s * t_sec

            # Sawtooth (acumula desde a última calibração TWR e cai para 0 no burst)
            sawtooth_ns = 0.0 if is_twr else (drift_rate_ns_s * max(0.0, t_sec - last_twr_t_sec))
            sawtooth_m = sawtooth_ns * 1e-9 * c_light

            # Resíduo do relógio global compensado (centrado em 0 ns)
            dist = r.get("distance_m")
            res_ns = 0.0
            if dist is not None and mean_dist > 0:
                res_ns = ((dist - mean_dist) / c_light) * 1e9

            t_series.append({
                "t_sec": round(t_sec, 4),
                "seq": r.get("seq", idx),
                "is_twr": is_twr,
                "packet_type": "TWR" if is_twr else "TDOA",
                "uncomp_ns": round(uncomp_ns, 2),
                "uncomp_m": round(uncomp_m, 3),
                "sawtooth_ns": round(sawtooth_ns, 2),
                "sawtooth_m": round(sawtooth_m, 3),
                "residual_ns": round(res_ns, 2),
                "distance_m": round(dist, 3) if dist is not None else None,
                "uncomp_dist_m": round(mean_dist + uncomp_m, 3) if mean_dist > 0 else None,
                "drift_ppm": round(float(r.get("clock_drift_ppm") or mean_drift), 2)
            })

        time_series_by_node[node_addr] = t_series

    return {
        "measured_links": measured_links,
        "theoretical_models": theoretical,
        "nodes_sync_stats": nodes_sync_stats,
        "time_series_by_node": time_series_by_node,
        "c_light_mps": c_light,
        "t_reply_nominal_us": t_reply_default_us,
        "notes": [
            "O drift de relógio foi medido em hardware pelo registo dwt_readcarrierintegrator() do DW3000 durante a receção de pacotes.",
            "Valores medidos iguais a 0.00 ppm indicam que o firmware do transmissor/recetor correspondente não tinha a recolha de CFO ativa.",
            "As previsões de erro SS-TWR e DS-TWR são MODELOS TEÓRICOS DE PROPAGAÇÃO e não representam erros medidos experimentalmente."
        ]
    }

def compute_cross_link_correlation(link1_recs: list, link2_recs: list) -> dict:
    """Calcula a correlação cruzada e regressão linear entre dois links."""
    m1 = {r["seq"]: r["distance_m"] for r in link1_recs if r.get("status") == "OK" and r["distance_m"] is not None}
    m2 = {r["seq"]: r["distance_m"] for r in link2_recs if r.get("status") == "OK" and r["distance_m"] is not None}

    common_seqs = sorted(set(m1.keys()) & set(m2.keys()))
    if len(common_seqs) < 3:
        n = min(len(link1_recs), len(link2_recs))
        v1 = [r["distance_m"] for r in link1_recs[:n] if r.get("status") == "OK" and r["distance_m"] is not None]
        v2 = [r["distance_m"] for r in link2_recs[:n] if r.get("status") == "OK" and r["distance_m"] is not None]
        m = min(len(v1), len(v2))
        x = np.array(v1[:m])
        y = np.array(v2[:m])
    else:
        x = np.array([m1[s] for s in common_seqs])
        y = np.array([m2[s] for s in common_seqs])

    if len(x) < 3 or np.std(x) == 0 or np.std(y) == 0:
        return {}

    r = float(np.corrcoef(x, y)[0, 1])
    poly = np.polyfit(x, y, 1)
    slope = float(poly[0])
    intercept = float(poly[1])
    y_pred = slope * x + intercept
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    ss_res = np.sum((y - y_pred) ** 2)
    r_squared = float(1 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0

    return {
        "x": x.tolist(),
        "y": y.tolist(),
        "r": round(r, 3),
        "r_squared": round(r_squared, 3),
        "slope": round(slope, 3),
        "intercept": round(intercept, 3),
        "n_samples": len(x)
    }

def analyze_dataset_subset(
    records: list,
    trial_label: str = "Geral",
    ref_distances: dict = None,
    default_ref_m: float = None,
) -> dict:
    """Calcula estatísticas completas, KPIs e correlações para um subconjunto de registos."""
    groups = compute_group_metrics(records, ref_distances=ref_distances, default_ref_m=default_ref_m)
    n_total = len(records)
    valid_dists = [r["distance_m"] for r in records if r.get("status") == "OK" and r["distance_m"] is not None]
    n_ok = len(valid_dists)
    n_invalid = max(0, n_total - n_ok)
    success_rate = (n_ok / n_total * 100.0) if n_total > 0 else 0.0
    drifts = [r["clock_drift_ppm"] for r in records if r.get("status") == "OK" and r.get("clock_drift_ppm") is not None]
    mean_drift = float(np.mean(drifts)) if len(groups) == 1 and drifts else (groups[0]["mean_drift"] if len(groups) == 1 else 0.0)
    mean_jitter = float(np.mean([g["std_mm"] for g in groups])) if groups else 0.0
    unique_nodes = len(set([r["src_addr"] for r in records if r.get("src_addr")] + [r["dst_addr"] for r in records if r.get("dst_addr") and r.get("dst_addr") != "0xFFFF"]))
    dropped_total = sum(int(g.get("dropped_packets_rf", 0) or 0) for g in groups)
    dup_total = sum(int(g.get("duplicate_packets", 0) or 0) for g in groups)
    ooo_total = sum(int(g.get("out_of_order_packets", 0) or 0) for g in groups)

    # Análise de Frequências Segmentada por Protocolo (TDoA vs TWR) com Média Ponderada por Amostras
    tdoa_groups = [g for g in groups if g.get("protocol") == "TDoA"]
    twr_groups = [g for g in groups if g.get("protocol") == "TWR"]

    tdoa_valid = [g for g in tdoa_groups if (g.get("freq_hz") or 0.0) > 0]
    if tdoa_valid:
        tdoa_weights = [max(1, g.get("n_ok", 1)) for g in tdoa_valid]
        tdoa_freq_hz = round(float(np.average([g["freq_hz"] for g in tdoa_valid], weights=tdoa_weights)), 1)
        tdoa_mean_dt = round(float(np.average([(g.get("mean_dt_ms") or 0.0) for g in tdoa_valid], weights=tdoa_weights)), 2)
    else:
        tdoa_freq_hz = 0.0
        tdoa_mean_dt = 0.0

    twr_valid = [g for g in twr_groups if (g.get("freq_hz") or 0.0) > 0]
    if twr_valid:
        twr_weights = [max(1, g.get("n_ok", 1)) for g in twr_valid]
        twr_freq_hz = round(float(np.average([g["freq_hz"] for g in twr_valid], weights=twr_weights)), 1)
        twr_mean_dt = round(float(np.average([(g.get("mean_dt_ms") or 0.0) for g in twr_valid], weights=twr_weights)), 2)
    else:
        twr_freq_hz = 0.0
        twr_mean_dt = 0.0

    kpi = {
        "total_samples": n_total,
        "valid_samples": n_ok,
        "invalid_samples": n_invalid,
        "dropped_packets_rf": dropped_total,
        "duplicate_packets": dup_total,
        "out_of_order_packets": ooo_total,
        "success_rate": round(success_rate, 1),
        "unique_nodes": unique_nodes,
        "is_multi_link": len(groups) > 1,
        "mean_jitter_mm": round(mean_jitter, 1),
        "mean_drift_ppm": round(mean_drift, 2) if len(groups) == 1 else None,
        "tdoa_freq_hz": tdoa_freq_hz,
        "tdoa_mean_dt_ms": tdoa_mean_dt,
        "twr_freq_hz": twr_freq_hz,
        "twr_mean_dt_ms": twr_mean_dt,
        "algo_version": CANONICAL_ALGO_VERSION,
    }

    # Análise completa de simetria por pares independentes
    pairwise_sym = compute_all_pairwise_symmetry(records)
    default_sym = list(pairwise_sym.values())[0] if pairwise_sym else {}

    # Análise completa de clock drift medido vs teórico
    clock_drift_analysis = compute_clock_drift_analysis(records)

    # Correlação Cruzada entre Links
    cross = {}
    if len(groups) >= 2:
        cross = compute_cross_link_correlation(groups[0]["records"], groups[1]["records"])

    # Relatório de Texto
    rep = f"=== RELATÓRIO ESTATÍSTICO SWARMLOC - {trial_label.upper()} ===\n"
    rep += f"Data: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    rep += f"Total de Rondas: {n_total} | Taxa de Sucesso: {success_rate:.1f}% | Jitter Médio: {mean_jitter:.1f} mm\n"
    rep += "-" * 90 + "\n"
    for g in groups:
        rep += f"Link {g['link_label']} ({g['source_file']}):\n"
        rep += f"  Amostras: {g['n_total']} (OK: {g['n_ok']}, {g['success_rate']}%) | Dist Média: {g['mean_dist']:.3f} m (σ = {g['std_mm']} mm)\n"
        rep += f"  Intervalo: [{g['min_dist']:.3f} m .. {g['max_dist']:.3f} m] | Clock Drift Médio: {g['mean_drift']:+.2f} ppm\n"

    return {
        "kpi": kpi,
        "groups": groups,
        "symmetry": default_sym,
        "pairwise_symmetry": pairwise_sym,
        "clock_drift_analysis": clock_drift_analysis,
        "cross_correlation": cross,
        "report_text": rep,
        "records": records
    }

# =============================================================================
# 3. GESTÃO DE METADADOS EXPERIMENTAIS E BASE DE DADOS DE ENSAIOS
# =============================================================================

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
METADATA_FILE = os.path.join(PROJECT_ROOT, "trial_metadata.json")

def load_trial_metadata() -> dict:
    """Carrega metadados experimentais introduzidos pelo utilizador sem alterar os dados binários originais."""
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_trial_metadata(data: dict):
    """Guarda anotações, campanhas e distâncias nominais de referência em JSON persistente."""
    try:
        with open(METADATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[ERRO] Falha ao gravar metadados em {METADATA_FILE}: {e}")

GLOBAL_STATE = {
    "loaded_files": {},      # filename -> {"records": [...], "meta": {...}}
    "trials": {},            # trial_id -> trial_data_dict
    "catalog": [],           # list of trial summaries for the catalog UI
    "files_meta": {},        # filename -> meta
    "latest_trial_id": None,
    "anchors": dict(DEFAULT_ANCHORS)
}

def get_active_anchors_map() -> dict:
    """Retorna o dicionário de âncoras 3D atuais {int_node_id: (x, y, z)}."""
    anchors = GLOBAL_STATE.get("anchors")
    if not anchors:
        GLOBAL_STATE["anchors"] = dict(DEFAULT_ANCHORS)
        anchors = GLOBAL_STATE["anchors"]
    return dict(anchors)

def format_anchors_json(anchors_map: dict = None) -> dict:
    """Formata o mapa de âncoras com chaves hexadecimais '0x0001': [x, y, z]."""
    amap = anchors_map if anchors_map is not None else get_active_anchors_map()
    return {f"0x{int(nid):04X}": [round(float(pos[0]), 4), round(float(pos[1]), 4), round(float(pos[2]), 4)] for nid, pos in sorted(amap.items())}

def update_active_anchors(payload_anchors: dict, reset: bool = False) -> dict:
    """Atualiza as coordenadas 3D (X, Y, Z) das âncoras em GLOBAL_STATE."""
    if reset:
        GLOBAL_STATE["anchors"] = dict(DEFAULT_ANCHORS)
        return get_active_anchors_map()
    if not isinstance(payload_anchors, dict):
        raise ValueError("Formato de âncoras inválido (esperado objeto JSON)")
    current = dict(get_active_anchors_map())
    for k, coords in payload_anchors.items():
        k_str = str(k).strip()
        try:
            nid = int(k_str, 16) if (k_str.lower().startswith("0x") or any(c in k_str.lower() for c in "abcdef")) else int(k_str, 16 if len(k_str) == 4 else 10)
        except ValueError:
            continue
        if isinstance(coords, (list, tuple)) and len(coords) >= 3:
            x, y, z = float(coords[0]), float(coords[1]), float(coords[2])
        elif isinstance(coords, dict) and all(axis in coords for axis in ("x", "y", "z")):
            x, y, z = float(coords["x"]), float(coords["y"]), float(coords["z"])
        else:
            continue
        if any(math.isnan(v) or math.isinf(v) for v in (x, y, z)):
            continue
        current[nid] = (round(x, 4), round(y, 4), round(z, 4))
    GLOBAL_STATE["anchors"] = current
    return current

def prepare_records_for_multilat(records: list) -> list:
    """Prepara registos para o acumulador 3D garantindo identificação do nó âncora remoto
    mesmo quando o registo foi gravado pelo Master (src_addr=0x0001, dst_addr=0x0002..0x0006)."""
    if not records:
        return []
    normalized = []
    distinct_srcs = set()
    for r in records:
        rc = dict(r)
        if "distance_m" not in rc or rc["distance_m"] is None:
            if rc.get("dist_m") is not None:
                rc["distance_m"] = float(rc["dist_m"])
            elif rc.get("dist_cm") is not None:
                rc["distance_m"] = float(rc["dist_cm"]) / 100.0
        if "timestamp_ms" not in rc or rc["timestamp_ms"] is None:
            if rc.get("t_rel_s") is not None:
                rc["timestamp_ms"] = int(round(float(rc["t_rel_s"]) * 1000.0))
            else:
                rc["timestamp_ms"] = 0
        if "src_addr" not in rc and "src" in rc:
            rc["src_addr"] = f"0x{str(rc['src']).upper().replace('0X', '').zfill(4)}"
        if "dst_addr" not in rc and "dst" in rc:
            rc["dst_addr"] = f"0x{str(rc['dst']).upper().replace('0X', '').zfill(4)}"
        normalized.append(rc)
        dist = rc.get("distance_m")
        if dist is None or dist <= 0:
            continue
        s = str(rc.get("src_addr", "")).upper().replace("0X", "").zfill(4)
        if s and s != "0000" and s != "FFFF":
            distinct_srcs.add(s)
    if len(distinct_srcs) >= 4:
        return normalized
    prepared = []
    for rc in normalized:
        s = str(rc.get("src_addr", "")).upper().replace("0X", "").zfill(4)
        d = str(rc.get("dst_addr", "")).upper().replace("0X", "").zfill(4)
        if s == "0001" and d not in ("0000", "0001", "FFFF", ""):
            rc["src_addr"] = f"0x{d}"
            rc["dst_addr"] = "0x0001"
        prepared.append(rc)
    return prepared

DATA_DIR = os.path.join(PROJECT_ROOT, "data")

MODULE_IDENTITY_CACHE_FILE = os.path.join(DATA_DIR, ".modules_identity.json")
MODULE_IDENTITY_CACHE = {}

def load_module_identity_cache():
    global MODULE_IDENTITY_CACHE
    if os.path.exists(MODULE_IDENTITY_CACHE_FILE):
        try:
            with open(MODULE_IDENTITY_CACHE_FILE, "r", encoding="utf-8") as f:
                MODULE_IDENTITY_CACHE = json.load(f)
        except Exception as e:
            print(f"[AVISO] Falha ao ler cache de modulos: {e}")

def save_module_identity_cache():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(MODULE_IDENTITY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(MODULE_IDENTITY_CACHE, f, indent=2)
    except Exception as e:
        print(f"[AVISO] Falha ao guardar cache de modulos: {e}")

load_module_identity_cache()

def probe_module_identity(port: str, baud: int = 115200, timeout_sec: float = 0.25) -> dict:
    """
    Sonda a porta serie e deteta dinamicamente o node_id e o papel (Master / Slave)
    sem recurso a mapeamentos estaticos ou portas COM hardcoded.
    """
    global MODULE_IDENTITY_CACHE
    cached = MODULE_IDENTITY_CACHE.get(port)
    if cached and cached.get("node_id") and cached.get("role"):
        return cached

    ser = None
    try:
        import serial
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = baud
        ser.timeout = timeout_sec
        ser.dtr = False
        ser.rts = False
        ser.open()
        
        ser.reset_input_buffer()
        ser.write(b"\r\ni\r\nl\r\n")
        ser.flush()
        time.sleep(0.12)
        resp = ser.read(512).decode("utf-8", errors="replace")
        
        node_id = ""
        role = ""
        
        m = re.search(r"\[SWARMLOC:ID\]\s+NODE:0x([0-9A-Fa-f]+)\s+ROLE:([A-Za-z]+)", resp)
        if m:
            node_id = m.group(1).upper()
            role = m.group(2).capitalize()
        else:
            m_time = re.search(r"\[TL:([\d\.]+)s\|TG:([\d\.]+)s\]", resp)
            if m_time:
                tl = float(m_time.group(1))
                tg = float(m_time.group(2))
                if abs(tl - tg) < 0.00001:
                    role = "Master"
                else:
                    role = "Slave"
            
            if cached:
                node_id = cached.get("node_id", "")
                if not role:
                    role = cached.get("role", "")
        
        role_hint = ""
        if role and node_id:
            role_hint = f"{role} ({node_id})"
        elif role:
            role_hint = role
        elif node_id:
            role_hint = f"Node {node_id}"
            
        info = {
            "device": port,
            "node_id": node_id,
            "role": role,
            "role_hint": role_hint,
            "is_identified": bool(role or node_id)
        }
        
        if role or node_id:
            MODULE_IDENTITY_CACHE[port] = info
            save_module_identity_cache()
            
        return info
    except Exception as e:
        return cached or {"device": port, "node_id": "", "role": "", "role_hint": "", "is_identified": False}
    finally:
        if ser and ser.is_open:
            try:
                ser.close()
            except Exception:
                pass


def organize_existing_files_into_subdirs():
    """
    Organiza ficheiros de log (.bin e .csv) existentes em subdiretorias por secção de teste.
    Move ficheiros dispersos na raiz ou subpastas antigas para 'data/<trial_id>/'.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    ignored_dirs = {".git", "build", ".vscode", "components", "Documentation", "docs", "help", "src", "include", "data"}

    for root_dir, dirs, files in os.walk(PROJECT_ROOT):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]
        for f in files:
            if f.startswith("raw_") and f.lower().endswith((".bin", ".csv")):
                src_path = os.path.join(root_dir, f)
                norm_src = os.path.abspath(src_path)
                norm_data = os.path.abspath(DATA_DIR)
                if norm_src.startswith(norm_data):
                    continue

                trial_id, _ = extract_trial_info(f)
                target_sub = os.path.join(DATA_DIR, trial_id)
                os.makedirs(target_sub, exist_ok=True)
                dest_path = os.path.join(target_sub, f)

                try:
                    import shutil
                    if os.path.exists(dest_path):
                        if os.path.getsize(src_path) == os.path.getsize(dest_path):
                            os.remove(src_path)
                        else:
                            shutil.move(src_path, dest_path)
                    else:
                        shutil.move(src_path, dest_path)
                    print(f"[ORGANIZADOR] Ficheiro organizado em subdiretoria: {dest_path}")
                except Exception as e:
                    print(f"[AVISO] Falha ao organizar {src_path} -> {dest_path}: {e}")

def scan_server_directory_files() -> int:
    """Descobre e carrega automaticamente ficheiros de ensaios existentes na árvore de diretorias."""
    found = 0
    candidate_files = []
    ignored_dirs = {".git", "build", ".vscode", "components", "Documentation", "docs", "help", "src", "include"}
    for root_dir, dirs, files in os.walk(PROJECT_ROOT):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]
        for f in sorted(files):
            if f.startswith("raw_") and f.lower().endswith((".bin", ".csv")):
                p = os.path.join(root_dir, f)
                candidate_files.append((p, f))

    # Descobrir também todas as sessões de telemetria gravadas em tempo real (.jsonl)
    sessions_dir = os.path.join(DATA_DIR, "live_sessions")
    if os.path.isdir(sessions_dir):
        for f in sorted(os.listdir(sessions_dir)):
            if f.endswith(".jsonl"):
                p = os.path.join(sessions_dir, f)
                candidate_files.append((p, f))

    # Descobrir também todas as sessões de validação RAW com múltiplos canais (raw_COM*.bin)
    val_sessions_dir = os.path.join(DATA_DIR, "validation_sessions")
    if os.path.isdir(val_sessions_dir):
        for s_entry in sorted(os.listdir(val_sessions_dir)):
            s_path = os.path.join(val_sessions_dir, s_entry)
            if os.path.isdir(s_path) and not s_entry.startswith("."):
                has_raw = any(fn.startswith("raw_") and fn.endswith(".bin") for fn in os.listdir(s_path))
                if has_raw and s_entry not in GLOBAL_STATE["trials"]:
                    recs, meta = parse_raw_session_dir(s_path)
                    if recs:
                        GLOBAL_STATE["loaded_files"][s_entry] = {"meta": meta, "records": recs}
                        found += 1

    # Priorizar .bin sobre .csv para evitar duplicação do mesmo ensaio/nó
    by_base = {}
    for p, f in candidate_files:
        base, ext = os.path.splitext(f)
        ext = ext.lower()
        if base not in by_base:
            by_base[base] = (p, f, ext)
        else:
            if ext == ".bin" and by_base[base][2] == ".csv":
                by_base[base] = (p, f, ext)

    for p, f, ext in by_base.values():
        if f not in GLOBAL_STATE["loaded_files"]:
            recs, meta = load_file(p)
            if recs:
                GLOBAL_STATE["loaded_files"][f] = {"meta": meta, "records": recs}
                found += 1
    return found

def rebuild_trials_database():
    """Agrupa todos os registos por Ensaio (Trial) e calcula métricas completas para catálogo e análise."""
    trial_groups = {}
    files_meta = {}
    user_notes = load_trial_metadata()

    for fn, item in GLOBAL_STATE["loaded_files"].items():
        recs = item["records"]
        meta = item["meta"]
        files_meta[fn] = meta

        t_id = meta.get("trial_id", "Geral")
        if t_id not in trial_groups:
            trial_groups[t_id] = {
                "id": t_id,
                "label": meta.get("trial_time", t_id),
                "time": meta.get("trial_time", t_id),
                "files": [],
                "records": []
            }
        trial_groups[t_id]["files"].append(fn)
        trial_groups[t_id]["records"].extend(recs)

    trials = {}
    catalog = []
    sorted_trial_ids = sorted(trial_groups.keys(), reverse=True)

    for tid in sorted_trial_ids:
        t_info = trial_groups[tid]
        notes_item = dict(user_notes.get('global_defaults', {}))
        notes_item.update(user_notes.get(tid, {}))
        if 'ref_distances' not in user_notes.get(tid, {}) and 'ref_distances' in user_notes.get('global_defaults', {}):
            notes_item['ref_distances'] = user_notes['global_defaults']['ref_distances']
        raw_recs = sorted(t_info["records"], key=lambda r: (r.get("seq", 0), r.get("timestamp_ms", 0)))
        analysis = analyze_dataset_subset(
            raw_recs,
            trial_label=f"Ensaio {t_info['label']}",
            ref_distances=notes_item.get("ref_distances", {}),
            default_ref_m=notes_item.get("ref_distance_m", None),
        )

        # Identificar nós envolvidos
        nodes = sorted(list(set([r["src_addr"].replace("0x", "") for r in raw_recs if "src_addr" in r])))

        # Agrupar por fluxo de nó para cálculo temporal independente
        stream_groups = {}
        for r in raw_recs:
            src = r.get("src_addr", "Node")
            if src not in stream_groups:
                stream_groups[src] = []
            stream_groups[src].append(r)

        # Duração temporal e frequência de amostragem pelo fluxo principal
        duration_s = 0.0
        sample_rate_hz = 0.0
        if stream_groups:
            main_stream = max(stream_groups.values(), key=len)
            if len(main_stream) >= 2:
                t_first = main_stream[0].get("timestamp_ms", 0)
                t_last = main_stream[-1].get("timestamp_ms", 0)
                if t_last > t_first:
                    duration_s = round((t_last - t_first) / 1000.0, 2)
                    sample_rate_hz = round(len(main_stream) / duration_s, 1) if duration_s > 0 else 0.0

        # Deteção de lacunas temporais (gaps > 200 ms) dentro de cada fluxo
        gap_count = 0
        for src, stream_recs in stream_groups.items():
            sorted_stream = sorted(stream_recs, key=lambda r: r.get("seq", 0))
            for i in range(1, len(sorted_stream)):
                dt = sorted_stream[i].get("timestamp_ms", 0) - sorted_stream[i-1].get("timestamp_ms", 0)
                if dt > 200:
                    gap_count += 1

        kpi = analysis["kpi"]
        success_rate = kpi.get("success_rate", 0.0)

        # Avaliação de integridade
        if success_rate >= 95.0 and gap_count <= 2:
            integrity_status = "VALID"
            integrity_note = "Íntegro (100% Válido)"
        else:
            integrity_status = "WARNING"
            integrity_note = f"Gaps Detetados ({gap_count})" if gap_count > 2 else f"Perda de Pacotes ({100.0 - success_rate:.1f}%)"

        # Resumo metrológico rigoroso por Link individual (evita misturar nós/links distintos)
        link_summaries = []
        for g in analysis["groups"]:
            link_summaries.append({
                "link_label": g["link_label"],
                "protocol": g.get("protocol", "TWR"),
                "ranging_method": g.get("ranging_method", ""),
                "src": g["src"],
                "dst": g["dst"],
                "source_file": g.get("source_file", ""),
                "n_ok": g["n_ok"],
                "n_invalid": g.get("n_invalid", 0),
                "n_total": g["n_total"],
                "mean_dist": g["mean_dist"],
                "std_mm": g["std_mm"],
                "mad_mm": g.get("mad_mm", 0.0),
                "iqr_mm": g.get("iqr_mm", 0.0),
                "median_dist": g["median_dist"],
                "min_dist": g["min_dist"],
                "max_dist": g["max_dist"],
                "has_ground_truth": g.get("has_ground_truth", False),
                "bias_mm": g.get("bias_mm"),
                "rmse_mm": g.get("rmse_mm"),
                "dropped_packets_rf": g.get("dropped_packets_rf", 0)
            })

        valid_dists = [r["distance_m"] for r in raw_recs if r.get("status") == "OK" and r["distance_m"] is not None]
        sync_cnt = sum(1 for r in raw_recs if r.get("round_duration_us", 0) > 5)
        meas_cnt = sum(1 for r in raw_recs if r.get("round_duration_us", 0) <= 5)
        methods = []
        if sync_cnt > 0:
            methods.append("DS-TWR (Sync)")
        if meas_cnt > 0:
            methods.append("TDoA (Broadcast)")
        if not methods:
            methods = ["DS-TWR"]
        # Se existir apenas 1 link, apresentar a sua distância; se existirem múltiplos links, NUNCA calcular uma média global falsa
        mean_dist = link_summaries[0]["mean_dist"] if len(link_summaries) == 1 else None

        # Deteção do Período de Sincronismo (k) do ensaio gravado
        twr_recs = [r for r in raw_recs if r.get("round_duration_us", 0) > 5 or (r.get("packet_type") or "").upper() == "TWR"]
        sync_period_s = 0.0
        sync_period_ms = 0
        if len(twr_recs) >= 2:
            twr_by_node = {}
            for r in twr_recs:
                twr_by_node.setdefault(r.get("src_addr"), []).append(r)
            all_diffs_s = []
            for node_recs in twr_by_node.values():
                node_sorted = sorted(node_recs, key=lambda x: x.get("timestamp_ms", 0))
                for i in range(1, len(node_sorted)):
                    dt = (node_sorted[i].get("timestamp_ms", 0) - node_sorted[i-1].get("timestamp_ms", 0)) / 1000.0
                    if 0.05 <= dt <= 60.0:
                        all_diffs_s.append(dt)
            if all_diffs_s:
                sync_period_s = round(float(np.mean(all_diffs_s)), 3)
                sync_period_ms = int(round(sync_period_s * 1000))
        elif len(twr_recs) == 0:
            sync_period_s = 0.0
            sync_period_ms = 0

        trial_summary = {
            "id": tid,
            "time": t_info["time"],
            "files": t_info["files"],
            "nodes": nodes,
            "ranging_methods": methods,
            "sync_count": sync_cnt,
            "meas_count": meas_cnt,
            "sync_period_s": sync_period_s,
            "sync_period_ms": sync_period_ms,
            "tdoa_freq_hz": kpi.get("tdoa_freq_hz", 0.0),
            "tdoa_mean_dt_ms": kpi.get("tdoa_mean_dt_ms", 0.0),
            "twr_freq_hz": kpi.get("twr_freq_hz", 0.0),
            "twr_mean_dt_ms": kpi.get("twr_mean_dt_ms", 0.0),
            "total_records": len(raw_recs),
            "valid_records": len(valid_dists),
            "invalid_records": len(raw_recs) - len(valid_dists),
            "dropped_packets_rf": kpi.get("dropped_packets_rf", 0),
            "gap_count": gap_count,
            "success_rate": success_rate,
            "duration_s": duration_s,
            "sample_rate_hz": sample_rate_hz,
            "mean_distance_m": mean_dist,
            "links": link_summaries,
            "jitter_mm": kpi.get("mean_jitter_mm", 0.0),
            "mean_drift_ppm": kpi.get("mean_drift_ppm"),
            "integrity_status": integrity_status,
            "integrity_note": integrity_note,
            "user_title": notes_item.get("title", ""),
            "campaign": notes_item.get("campaign", ""),
            "ref_distance_m": notes_item.get("ref_distance_m", None),
            "ref_distances": notes_item.get("ref_distances", {})
        }
        catalog.append(trial_summary)

        trials[tid] = {
            "id": tid,
            "label": t_info["label"],
            "time": t_info["time"],
            "trial_info": trial_summary,
            "files": t_info["files"],
            "kpi": {**kpi, "mean_distance_m": mean_dist, "sync_period_s": sync_period_s, "sync_period_ms": sync_period_ms, "gap_count": gap_count},
            "groups": analysis["groups"],
            "symmetry": analysis["symmetry"],
            "pairwise_symmetry": analysis.get("pairwise_symmetry", {}),
            "clock_drift_analysis": analysis.get("clock_drift_analysis", {}),
            "cross_correlation": analysis["cross_correlation"],
            "report_text": analysis["report_text"],
            "records": raw_recs,
            "user_notes": notes_item,
            "provenance_catalog": PROVENANCE_CATALOG,
            "algo_version": CANONICAL_ALGO_VERSION
        }

    GLOBAL_STATE["trials"] = trials
    GLOBAL_STATE["catalog"] = catalog
    GLOBAL_STATE["files_meta"] = files_meta
    GLOBAL_STATE["latest_trial_id"] = sorted_trial_ids[0] if sorted_trial_ids else None

def preview_files_to_delete(scope: str = "all", trial_id: str = None) -> dict:
    """Retorna a lista de ficheiros .bin e .csv que serão eliminados fisicamente."""
    ignored_dirs = {".git", "build", ".vscode", "components", "Documentation", "docs", "help", "src", "include"}
    targets = set()

    if scope == "trial" and trial_id:
        trial_data = GLOBAL_STATE.get("trials", {}).get(trial_id)
        if trial_data:
            for fn in trial_data.get("files", []):
                meta = GLOBAL_STATE.get("files_meta", {}).get(fn, {})
                fp = meta.get("filepath")
                if fp and os.path.exists(fp):
                    targets.add(os.path.abspath(fp))
                base_no_ext, _ = os.path.splitext(fn)
                for ext in [".bin", ".csv"]:
                    sibling_name = f"{base_no_ext}{ext}"
                    for d in [os.path.dirname(fp) if fp else ".", ".", "python", "scripts"]:
                        sib_path = os.path.join(d, sibling_name)
                        if os.path.exists(sib_path):
                            targets.add(os.path.abspath(sib_path))

        for root_dir, dirs, files in os.walk(PROJECT_ROOT):
            dirs[:] = [d for d in dirs if d not in ignored_dirs]
            for f in files:
                if trial_id in f and f.lower().endswith((".bin", ".csv")):
                    targets.add(os.path.abspath(os.path.join(root_dir, f)))

    elif scope == "all":
        for fn, item in GLOBAL_STATE.get("loaded_files", {}).items():
            meta = item.get("meta", {})
            fp = meta.get("filepath")
            if fp and os.path.exists(fp):
                targets.add(os.path.abspath(fp))
            base_no_ext, _ = os.path.splitext(fn)
            for ext in [".bin", ".csv"]:
                for d in [os.path.dirname(fp) if fp else ".", ".", "python", "scripts"]:
                    sib_path = os.path.join(d, f"{base_no_ext}{ext}")
                    if os.path.exists(sib_path):
                        targets.add(os.path.abspath(sib_path))

        for root_dir, dirs, files in os.walk(PROJECT_ROOT):
            dirs[:] = [d for d in dirs if d not in ignored_dirs]
            for f in files:
                f_lower = f.lower()
                if f.startswith("raw_") and f_lower.endswith((".bin", ".csv")):
                    targets.add(os.path.abspath(os.path.join(root_dir, f)))
                elif (f_lower.startswith("upload") or f_lower.startswith("test_upload")) and f_lower.endswith((".bin", ".csv")):
                    targets.add(os.path.abspath(os.path.join(root_dir, f)))

    file_list = []
    total_bytes = 0
    for p in sorted(targets):
        if os.path.isfile(p):
            sz = os.path.getsize(p)
            total_bytes += sz
            file_list.append({
                "path": p,
                "filename": os.path.basename(p),
                "bytes": sz,
                "ext": os.path.splitext(p)[1].lower()
            })

    return {
        "files": file_list,
        "count": len(file_list),
        "total_bytes": total_bytes,
        "scope": scope,
        "trial_id": trial_id
    }

def delete_log_files(scope: str = "all", trial_id: str = None) -> dict:
    """
    Remove fisicamente do disco os ficheiros de log (.bin e .csv).
    Garante a eliminação rigorosa de ambos os formatos (binários brutos e convertidos CSV).
    Pode eliminar todos os logs ('all') ou apenas os associados a um ensaio ('trial').
    """
    preview = preview_files_to_delete(scope=scope, trial_id=trial_id)
    deleted_files = []
    freed_bytes = 0

    for item in preview["files"]:
        file_path = item["path"]
        try:
            if os.path.isfile(file_path):
                sz = item["bytes"]
                os.remove(file_path)
                deleted_files.append(item["filename"])
                freed_bytes += sz
                print(f"[REMOVER] Ficheiro eliminado fisicamente do disco: {file_path} ({sz} bytes)")
        except Exception as e:
            print(f"[ERRO] Falha ao eliminar {file_path}: {e}")

    # Limpar subdiretórios vazios em data/
    if os.path.exists(DATA_DIR):
        for sub in os.listdir(DATA_DIR):
            sub_path = os.path.join(DATA_DIR, sub)
            if os.path.isdir(sub_path):
                try:
                    if not os.listdir(sub_path):
                        os.rmdir(sub_path)
                except Exception:
                    pass

    # Atualizar estado interno em memória
    if scope == "all":
        GLOBAL_STATE["loaded_files"] = {}
        GLOBAL_STATE["trials"] = {}
        GLOBAL_STATE["catalog"] = []
        GLOBAL_STATE["files_meta"] = {}
        GLOBAL_STATE["latest_trial_id"] = None
        save_trial_metadata({})
    else:
        deleted_names = set(deleted_files)
        keys_to_remove = [k for k in list(GLOBAL_STATE["loaded_files"].keys()) if k in deleted_names or os.path.basename(k) in deleted_names]
        for k in keys_to_remove:
            del GLOBAL_STATE["loaded_files"][k]
        
        if trial_id:
            notes = load_trial_metadata()
            if trial_id in notes:
                del notes[trial_id]
                save_trial_metadata(notes)
        rebuild_trials_database()

    return {
        "status": "success",
        "deleted_files": deleted_files,
        "count": len(deleted_files),
        "freed_bytes": freed_bytes,
        "scope": scope,
        "trial_id": trial_id,
        "remaining_trials": len(GLOBAL_STATE.get("catalog", []))
    }

# =============================================================================
# 3.5. MOTOR DE TELEMETRIA EM TEMPO REAL E CONTROLO BIDIRECIONAL UART
# =============================================================================

class LiveTelemetryEngine:
    """Gere ligações série contínuas, streaming de telemetria e envio de comandos."""
    def __init__(self):
        self.lock = threading.RLock()
        self.active_serials = {}  # {port: serial.Serial}
        self.reader_threads = {}  # {port: Thread}
        self.running = False
        self.messages = []        # Ring buffer de mensagens
        self.max_messages = 20000
        self.seq_unwrap_state = {} # {port: full_seq_32bit}
        self.msg_counter = 0
        self.node_states = {}     # {node_id: {role, port, last_seen, last_dist_m, ...}}
        self.ref_distances = {}   # {node_id: ref_dist_m do ultimo TWR calibrado}
        self.last_twr_dist = {}   # {node_id: distancia medida por TWR de ground-truth}
        self.swarm_timeline = SwarmTimelineReconstructor() # Linha temporal unificada do enxame UWB
        self.t0_hardware_us = None  # Origem de tempo do hardware DW3000 do modulo
        self.last_known_tg_us = None
        self.base_tg_us = None
        self.base_tg_epoch = None
        self.connected_ports = []
        self.baudrate = 115200
        self.sync_period_s = 0.5
        self.sync_period_ms = 500
        self.twr_freq_hz = 2.0
        self.tdoa_target_freq_hz = 0.0  # 0.0 = Taxa máxima física (~550 Hz)
        self.t0_epoch = None
        self.session_recording = False
        self.session_file = None
        self.session_filepath = None
        self.session_start_epoch = 0.0
        self.session_record_count = 0
        self.last_seq_by_stream = {}
        self.algo_cycle_counter = 0
        self.stream_last_raw_seq = {}
        self.counters = {
            "uart_received": 0,
            "decoded_success": 0,
            "invalid_corrupt": 0,
            "dropped_packets_rf": 0,
            "duplicate_packets": 0,
            "out_of_order_packets": 0,
            "dropped_buffer_full": 0,
            "persisted_disk": 0
        }

        # Estado dinâmico de coordenação e rotação de Master (SwarmLoc E8.40)
        self.master_rotation = {
            "current_master_id": "0001",
            "prev_master_id": None,
            "next_master_id": None,
            "master_confirmed": True,
            "last_change_epoch": int(time.time() * 1000),
            "last_change_reason": "Inicialização do Protocolo Hardware",
            "active_master_source": "TELEMETRIA_UART"
        }

        # Pré-inicializar nós padrão do enxame SwarmLoc
        self._init_default_swarm_nodes()

    def _init_default_swarm_nodes(self):
        defaults = [
            ("0001", "Master"),
            ("0002", "Slave"),
            ("0003", "Slave"),
            ("0004", "Slave"),
            ("0005", "Slave"),
            ("0006", "Slave")
        ]
        for nid, role in defaults:
            self.node_states[nid] = {
                "node_id": nid,
                "role": role,
                "port": "",
                "last_seen": 0,
                "last_dist_m": None,
                "last_tdoa": None,
                "packet_count": 0,
                "is_online": False
            }

    def start_session_recording(self, session_name=None):
        with self.lock:
            if self.session_recording:
                return {"status": "already_recording", "filepath": self.session_filepath, "count": self.session_record_count}
            sessions_dir = os.path.join(DATA_DIR, "live_sessions")
            os.makedirs(sessions_dir, exist_ok=True)
            ts_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            prefix = f"{session_name}_" if session_name else ""
            self.session_filepath = os.path.join(sessions_dir, f"stream_{prefix}{ts_str}.jsonl")
            self.session_file = open(self.session_filepath, "a", encoding="utf-8")
            self.session_recording = True
            self.session_start_epoch = time.time()
            self.session_record_count = 0
            self.add_system_log(f"Gravação de sessão em tempo real iniciada: {os.path.basename(self.session_filepath)}", msg_type="system")
            return {
                "status": "recording_started",
                "filepath": self.session_filepath,
                "filename": os.path.basename(self.session_filepath),
                "start_time": datetime.datetime.now().isoformat()
            }

    def stop_session_recording(self):
        with self.lock:
            if not self.session_recording:
                return {"status": "not_recording"}
            if self.session_file:
                try:
                    self.session_file.flush()
                    self.session_file.close()
                except Exception:
                    pass
                self.session_file = None
            self.session_recording = False
            duration_s = round(time.time() - self.session_start_epoch, 2)
            filepath = self.session_filepath
            count = self.session_record_count
            self.add_system_log(f"Gravação de sessão concluída: {count} registos em {duration_s}s ({os.path.basename(filepath)})", msg_type="system")
            return {
                "status": "recording_stopped",
                "filepath": filepath,
                "filename": os.path.basename(filepath) if filepath else None,
                "count": count,
                "duration_s": duration_s
            }

    def get_session_recording_status(self):
        with self.lock:
            return {
                "is_recording": self.session_recording,
                "filepath": self.session_filepath,
                "filename": os.path.basename(self.session_filepath) if self.session_filepath else None,
                "count": self.session_record_count,
                "duration_s": round(time.time() - self.session_start_epoch, 1) if self.session_recording else 0.0
            }

    def get_available_ports(self):
        ports = []
        try:
            import serial.tools.list_ports
            for p in serial.tools.list_ports.comports():
                hwid = str(p.hwid or "")
                desc = str(p.description or "")
                mfg = str(p.manufacturer or "")
                is_jlink = ("1366" in hwid or "jlink" in desc.lower() or "segger" in mfg.lower())
                ident = MODULE_IDENTITY_CACHE.get(p.device, {})
                ports.append({
                    "port": p.device,
                    "description": desc,
                    "is_jlink": is_jlink,
                    "ident": ident
                })
        except Exception as e:
            print(f"[TELEMETRIA] Erro ao listar portas: {e}")
        return ports

    def connect(self, target_ports=None, baud=115200):
        import serial
        self.baudrate = baud
        avail = self.get_available_ports()
        avail_devs = [p["port"] for p in avail]
        jlink_devs = [p["port"] for p in avail if p["is_jlink"]]

        if not target_ports or target_ports == "all":
            selected = jlink_devs if jlink_devs else avail_devs
        elif isinstance(target_ports, str):
            if "," in target_ports:
                selected = [p.strip() for p in target_ports.split(",") if p.strip()]
            else:
                selected = [target_ports.strip()]
        else:
            selected = list(target_ports)

        success_ports = []
        with self.lock:
            self.running = True
            for port in selected:
                if port in self.active_serials and self.active_serials[port].is_open:
                    success_ports.append(port)
                    continue
                try:
                    ser = serial.Serial()
                    ser.port = port
                    ser.baudrate = baud
                    ser.timeout = 0.05
                    ser.dtr = False
                    ser.rts = False
                    ser.open()
                    self.active_serials[port] = ser
                    success_ports.append(port)

                    # Associar à porta o nó já cacheado
                    info = MODULE_IDENTITY_CACHE.get(port, {})
                    nid = info.get("node_id")
                    if nid:
                        role = info.get("role", "Master" if nid in ["0001", "1"] else "Slave")
                        self._update_node_state(nid, role=role, port=port)

                    # Enviar pedido de identificação imediato para confirmar nó
                    try:
                        ser.write(b"\r\ni\r\n")
                        ser.flush()
                    except Exception:
                        pass

                    t = threading.Thread(target=self._reader_worker, args=(port, ser), daemon=True)
                    self.reader_threads[port] = t
                    t.start()
                except Exception as e:
                    print(f"[TELEMETRIA] Erro ao abrir {port}: {e}")

            self.connected_ports = list(self.active_serials.keys())

        if success_ports:
            self.add_system_log(f"Ligação estabelecida a {len(success_ports)} porta(s): {', '.join(success_ports)} @ {baud} baud", msg_type="system")
        else:
            self.add_system_log(f"Falha ao conectar às portas solicitadas ({selected}). Verifique se as portas estão livres.", msg_type="err")

        return success_ports

    def disconnect(self, ports=None):
        with self.lock:
            if ports is None:
                to_close = list(self.active_serials.keys())
            elif isinstance(ports, str):
                if "," in ports:
                    to_close = [p.strip() for p in ports.split(",") if p.strip()]
                else:
                    to_close = [ports.strip()]
            else:
                to_close = list(ports)

            for p in to_close:
                ser = self.active_serials.pop(p, None)
                if ser:
                    try:
                        ser.close()
                    except Exception:
                        pass
                self.reader_threads.pop(p, None)

            self.connected_ports = list(self.active_serials.keys())
            if not self.active_serials:
                self.running = False

        if to_close:
            self.add_system_log(f"Desconectado de: {', '.join(to_close)}", msg_type="system")
        return True

    def set_simulation_mode(self, enabled=True, scenario="nominal"):
        with self.lock:
            self.master_rotation["simulation_mode"] = enabled
            self.master_rotation["sim_scenario"] = scenario
            return dict(self.master_rotation)

    def step_simulation_rotation(self):
        with self.lock:
            curr = self.master_rotation.get("current_master_id", "0001")
            prev = curr
            order = ["0001", "0002", "0003", "0004", "0005", "0006"]
            try:
                curr_idx = order.index(curr)
            except ValueError:
                curr_idx = 0
            new_curr = order[(curr_idx + 1) % len(order)]
            new_next = order[(curr_idx + 2) % len(order)]
            self.master_rotation["prev_master_id"] = prev
            self.master_rotation["current_master_id"] = new_curr
            self.master_rotation["next_master_id"] = new_next
            self.master_rotation["last_change_epoch"] = time.time()
            self.master_rotation["last_change_reason"] = "Passo de Simulação"
            return dict(self.master_rotation)

    def clear_data(self):
        with self.lock:
            self.messages = []
            self.msg_counter = 0
            self.t0_epoch = None
            self.t0_hardware_us = None
            self.base_tg_us = None
            self.base_tg_epoch = None
            if hasattr(self, "swarm_timeline") and self.swarm_timeline is not None:
                self.swarm_timeline.reset()
            if hasattr(self, "_tdoa_reconstructors"):
                self._tdoa_reconstructors.clear()
            if hasattr(self, "seq_unwrap_state"):
                self.seq_unwrap_state.clear()
            if hasattr(self, "last_twr_dist"):
                self.last_twr_dist.clear()
            if hasattr(self, "counters"):
                self.counters = {
                    "uart_received": 0,
                    "decoded_success": 0,
                    "invalid_corrupt": 0,
                    "dropped_packets_rf": 0,
                    "duplicate_packets": 0,
                    "out_of_order_packets": 0,
                    "dropped_buffer_full": 0,
                    "persisted_disk": 0
                }
            for nid, st in self.node_states.items():
                st["twr_ts"] = []
                st["tdoa_ts"] = []
                st["packet_count"] = 0
        self.add_system_log("Histórico de telemetria e linha temporal do enxame reiniciados.", msg_type="system")
        return True

    def send_command(self, cmd_text, target="all"):
        cmd_text = cmd_text.strip()
        if not cmd_text:
            return {"status": "error", "message": "Comando vazio"}

        raw_cmd = (cmd_text + "\r\n").encode("utf-8")
        ports_sent = []

        is_k_cmd = bool(re.match(r"^(?:k|sync)\b", cmd_text, re.I))
        is_f_cmd = bool(re.match(r"^(?:f|freq|rate)\b", cmd_text, re.I))

        with self.lock:
            ports_to_write = []
            if target == "all" or (is_k_cmd and target in ["all", "master"]):
                ports_to_write = list(self.active_serials.keys())
            elif target == "master" or (is_f_cmd and target in ["all", "master"]):
                for p in self.active_serials.keys():
                    info = MODULE_IDENTITY_CACHE.get(p, {})
                    if info.get("role", "").lower() == "master" or info.get("node_id") in ["1", "0001", "0x0001"]:
                        ports_to_write.append(p)
                        break
                if not ports_to_write and self.connected_ports:
                    ports_to_write = [self.connected_ports[0]]
            elif target in self.active_serials:
                ports_to_write = [target]
            else:
                try:
                    import serial
                    with serial.Serial(target, self.baudrate, timeout=0.3) as ser:
                        ser.write(raw_cmd)
                        ser.flush()
                        ports_sent.append(target)
                except Exception as e:
                    return {"status": "error", "message": f"Falha ao aceder a {target}: {e}"}

            for p in ports_to_write:
                ser = self.active_serials.get(p)
                if ser and ser.is_open:
                    try:
                        ser.write(raw_cmd)
                        ser.flush()
                        ports_sent.append(p)
                    except Exception as e:
                        print(f"[TELEMETRIA] Erro ao enviar comando para {p}: {e}")

        dest_name = "Todos os Módulos" if target == "all" else (f"Master ({', '.join(ports_sent)})" if target == "master" else target)
        self.add_system_log(f"> [CMD] '{cmd_text}' enviado para {dest_name}", msg_type="cmd")

        # Detetar se é comando k para atualizar a frequência/período de sincronismo no motor de telemetria
        m_k = re.match(r"^(?:k|sync)\s*=?\s*([\d\.]+)\s*(s|sec|ms|msec|hz)?$", cmd_text, re.I)
        if m_k:
            val = float(m_k.group(1))
            unit = (m_k.group(2) or "").lower()
            if "ms" in unit:
                ms = int(val)
                s = val / 1000.0
                f_hz = round(1000.0 / ms, 2) if ms > 0 else 0.0
            elif "hz" in unit:
                f_hz = val
                if val <= 0.0:
                    s = 0.0
                    ms = 0
                else:
                    ms = max(10, int(round(1000.0 / val)))
                    s = ms / 1000.0
            else:
                # Unidade padrão: segundos (s)
                s = val
                ms = int(round(val * 1000))
                f_hz = round(1.0 / s, 2) if s > 0 else 0.0
            self.sync_period_s = s
            self.sync_period_ms = ms
            self.twr_freq_hz = f_hz

        # Detetar se é comando f para atualizar a taxa de Beacons TDoA
        m_f = re.match(r"^(?:f|freq|rate)\s*=?\s*(max|auto|[\d\.]+)\s*(hz)?$", cmd_text, re.I)
        if m_f:
            val_str = m_f.group(1).lower()
            if val_str in ("max", "auto", "0"):
                self.tdoa_target_freq_hz = 0.0
            else:
                self.tdoa_target_freq_hz = float(val_str)

        return {
            "status": "success",
            "command": cmd_text,
            "ports": ports_sent,
            "target": target,
            "sync_period_s": self.sync_period_s,
            "sync_period_ms": self.sync_period_ms,
            "sync_freq_hz": getattr(self, "twr_freq_hz", 2.0),
            "tdoa_target_freq_hz": getattr(self, "tdoa_target_freq_hz", 0.0)
        }

    def add_system_log(self, text, msg_type="system"):
        with self.lock:
            self.msg_counter += 1
            now_epoch = time.time()
            if self.t0_epoch is None:
                self.t0_epoch = now_epoch
            elapsed_s = max(0.0, now_epoch - self.t0_epoch)
            now_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            msg = {
                "id": self.msg_counter,
                "time": now_str,
                "epoch": now_epoch,
                "elapsed_s": round(elapsed_s, 2),
                "port": "SYS",
                "node_id": None,
                "role": "System",
                "text": text,
                "type": msg_type,
                "parsed": {},
                "sync_period_s": self.sync_period_s,
                "sync_period_ms": self.sync_period_ms
            }
            self.messages.append(msg)
            if len(self.messages) > self.max_messages + 2000:
                del self.messages[:len(self.messages) - self.max_messages]



    def _reader_worker(self, port, ser):
        # Utiliza o parser de stream binário e desmultiplexador 100% independente (binary_protocol.py)
        parser = BinaryStreamParser()
        while self.running and port in self.active_serials and ser.is_open:
            try:
                chunk = ser.read(1024)
                if not chunk:
                    continue

                for kind, item in parser.feed(chunk):
                    if kind == 'binary':
                        try:
                            self._process_binary_tdoa_frame(port, item)
                        except Exception as be:
                            print(f"[TELEMETRIA] Erro ao processar frame binário na porta {port}: {be}")
                    elif kind == 'ascii':
                        try:
                            self._process_line(port, item)
                        except Exception as le:
                            print(f"[TELEMETRIA] Erro ao processar linha na porta {port}: {le}")

            except Exception as e:
                if not self.running or port not in self.active_serials:
                    print(f"[TELEMETRIA] Worker da porta {port} encerrado: {e}")
                    break
                time.sleep(0.5)
                try:
                    if not ser.is_open:
                        ser.open()
                except Exception:
                    time.sleep(0.5)

    def _is_master_port(self, port):
        curr_master = self.master_rotation.get("current_master_id", "0001")
        nid = MODULE_IDENTITY_CACHE.get(port, {}).get("node_id")
        if nid:
            return nid == curr_master
        role = MODULE_IDENTITY_CACHE.get(port, {}).get("role")
        if role:
            return role == "Master"
        return port == "COM6"

    def _process_binary_tdoa_frame(self, port, frame):
        # Registar que a porta possui fluxo binário 7B ativo (550 Hz)
        if not hasattr(self, "has_binary_stream"):
            self.has_binary_stream = {}
        self.has_binary_stream[port] = time.time()

        # Desempacotar frame usando o descodificador independente BinaryTdoaFrame
        if isinstance(frame, BinaryTdoaFrame):
            frame_obj = frame
        else:
            frame_obj = decode_binary_tdoa_frame(frame)
            if not frame_obj:
                return

        seq16 = frame_obj.seq16
        dist_m = frame_obj.dist_m
        is_valid_dist = frame_obj.is_valid_dist
        sync_ok = frame_obj.sync_ok

        # Gating estrito de sanidade fisica: no banco estatico, distancias fora de [0.05, 30.0] m
        # ou medicoes sem sincronismo convergido sao rejeitadas para evitar picos na transicao de lideranca
        if dist_m is not None and (dist_m < 0.05 or dist_m >= 30.0 or not sync_ok):
            is_valid_dist = False

        # Desenrolar sequência de 16 bits para 32 bits contínuos
        # Alinhar à base de 32 bits do Master (fonte única da verdade de sequência do enxame)
        m_master_seq = getattr(self, "swarm_master_seq32", None)
        if m_master_seq is not None:
            # Fórmula analítica sem ramificações: encontra o múltiplo de 64k exato mais próximo do Master
            diff = (seq16 - (m_master_seq & 0xFFFF) + 32768) % 65536 - 32768
            full_seq = max(0, m_master_seq + diff)
        else:
            last_seq = self.seq_unwrap_state.get(port, seq16)
            last_low = last_seq & 0xFFFF
            high = last_seq & ~0xFFFF
            if seq16 < last_low and (last_low - seq16) > 32768:
                high += 0x10000
            elif seq16 > last_low and (seq16 - last_low) > 32768:
                if high >= 0x10000:
                    high -= 0x10000
            full_seq = high | seq16

        self.seq_unwrap_state[port] = full_seq
        if self._is_master_port(port):
            self.swarm_master_seq32 = full_seq

        # Identificar o Slave recetor da porta COM
        curr_master = self.master_rotation.get("current_master_id", "0001")
        ident = MODULE_IDENTITY_CACHE.get(port, {})
        dst = ident.get("node_id")
        if not dst:
            for nid, st in self.node_states.items():
                if st.get("port") == port and nid != curr_master:
                    dst = nid
                    break
        if not dst:
            if port in ("COM6", "COM12"): dst = "0001"
            elif port == "COM5": dst = "0002"
            elif port in ("COM7", "COM11"): dst = "0003"
            elif port == "COM4": dst = "0004"
            elif port == "COM13": dst = "0005"
            elif port == "COM14": dst = "0006"
            else: dst = "0002"

        with self.lock:
            self.msg_counter += 1
            self.counters["uart_received"] = self.counters.get("uart_received", 0) + 1
            now_epoch = time.time()
            if self.t0_epoch is None:
                self.t0_epoch = now_epoch

            # Linha temporal unificada do Enxame UWB (Swarm Master Timeline):
            # Garante que todos os nós que recebem o mesmo Beacon #N do Master partilham
            # o mesmo t_global_us e elapsed_s absoluto, alinhando as curvas perfeitamente no gráfico.
            if not hasattr(self, "swarm_timeline") or self.swarm_timeline is None:
                self.swarm_timeline = SwarmTimelineReconstructor()

            base_tg = getattr(self, "base_tg_us", None) or getattr(self, "t0_hardware_us", None)
            cur_tg_us, elapsed_s = self.swarm_timeline.get_timestamp(full_seq, now_epoch, base_tg)

            # Imunidade física estrita: se cur_tg_us divergir > 2s do tempo de hardware ancorado do Master, fixa no tempo real
            if self.base_tg_us is not None and getattr(self, "base_tg_epoch", None) is not None:
                expected_tg = self.base_tg_us + int(round((now_epoch - self.base_tg_epoch) * 1e6))
                if abs(cur_tg_us - expected_tg) > 2_000_000:
                    cur_tg_us = expected_tg

            self.last_known_tg_us = cur_tg_us
            if not hasattr(self, "port_last_known_tg_us"):
                self.port_last_known_tg_us = {}
            self.port_last_known_tg_us[port] = cur_tg_us

            now_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

            if not hasattr(self, "last_twr_dist"):
                self.last_twr_dist = {}

            is_twr = getattr(frame_obj, "is_twr", False)
            if is_twr:
                if dist_m is not None and is_valid_dist and 0.05 <= dist_m <= 50.0:
                    self.last_twr_dist[dst] = dist_m
                ref_dist_m = self.last_twr_dist.get(dst, dist_m)
                dist_comp_m = dist_m
                parsed = {
                    "type": "twr",
                    "src": dst,
                    "dst": curr_master,
                    "measurer": dst,
                    "dist_m": dist_m,
                    "raw_dist_m": dist_m,
                    "dist_comp_m": dist_comp_m,
                    "ref_dist_m": ref_dist_m,
                    "seq": full_seq,
                    "is_valid_measurement": (dist_m is not None and is_valid_dist and sync_ok and 0.05 <= dist_m <= 30.0),
                    "mode": "Sync TWR",
                    "ranging_method": "DS_TWR_BINARY_7B",
                    "sync_state": "synchronized" if sync_ok else "awaiting_sync"
                }
                self._update_node_state(
                    dst,
                    role="Slave",
                    port=port,
                    last_dist_m=dist_m,
                    ref_dist_m=ref_dist_m,
                    status="OK" if is_valid_dist else "AWAITING_SYNC",
                    mode="Sync TWR",
                    seq=full_seq
                )
            else:
                ref_dist_m = self.last_twr_dist.get(dst)
                dist_comp_m = ref_dist_m if ref_dist_m is not None else dist_m
                subslot = (int(curr_master, 16) & 0x07) if curr_master else 0
                parsed = {
                    "type": "tdoa",
                    "src": curr_master,
                    "dst": dst,
                    "measurer": dst,
                    "beacon_src": curr_master,
                    "dist_m": dist_m,
                    "raw_dist_m": dist_m,
                    "dist_comp_m": dist_comp_m,
                    "ref_dist_m": ref_dist_m,
                    "seq": full_seq,
                    "subslot": subslot,
                    "slot_idx": subslot,
                    "is_valid_measurement": (dist_m is not None and is_valid_dist and sync_ok and 0.05 <= dist_m <= 30.0),
                    "mode": "TDoA",
                    "ranging_method": "OWR_SYNC_BINARY_7B",
                    "sync_state": "synchronized" if sync_ok else "awaiting_sync"
                }
                self._update_node_state(
                    dst,
                    role="Slave",
                    port=port,
                    last_dist_m=dist_m,
                    ref_dist_m=ref_dist_m,
                    status="OK" if is_valid_dist else "AWAITING_SYNC",
                    mode="TDoA",
                    seq=full_seq
                )

            msg = {
                "id": self.msg_counter,
                "trial_id": "live",
                "seq": full_seq,
                "seq_raw": seq16,
                "algo_cycle": full_seq,
                "seq_delta": 1,
                "seq_anomaly": None,
                "node_id": dst,
                "peer_id": curr_master,
                "src_addr": f"0x{dst}" if is_twr else f"0x{curr_master}",
                "dst_addr": f"0x{curr_master}" if is_twr else f"0x{dst}",
                "protocol": "Sync TWR" if is_twr else "TDoA",
                "ranging_method": "DS_TWR_BINARY_7B" if is_twr else "OWR_SYNC_BINARY_7B",
                "time": now_str,
                "epoch": now_epoch,
                "t_rx_host_epoch": now_epoch,
                "t_local_us": cur_tg_us,
                "t_global_us": cur_tg_us,
                "distance_m": dist_m,
                "dist_m": dist_m,
                "raw_dist_m": dist_m,
                "dist_comp_m": dist_comp_m,
                "ref_dist_m": ref_dist_m,
                "status": "OK" if (is_valid_dist and sync_ok) else "AWAITING_SYNC",
                "is_valid": bool(is_valid_dist and sync_ok),
                "provenance": "hardware_uart_binary_7b",
                "elapsed_s": round(elapsed_s, 4),
                "port": port,
                "role": "Slave",
                "text": f"[BIN:7B] Beacon #{full_seq:06d} de Master 0x{curr_master} | Dist: {dist_m:.4f}m" if dist_m is not None else f"[BIN:7B] Beacon #{full_seq:06d} de Master 0x{curr_master} | A aguardar sinc",
                "type": "twr" if is_twr else "tdoa",
                "parsed": parsed,
                "subslot": (int(curr_master, 16) & 0x07) if curr_master else 0,
                "slot_idx": (int(curr_master, 16) & 0x07) if curr_master else 0,
                "sync_period_s": self.sync_period_s,
                "sync_period_ms": self.sync_period_ms
            }

            self.messages.append(msg)
            if len(self.messages) > self.max_messages + 2000:
                dropped = len(self.messages) - self.max_messages
                self.counters["dropped_buffer_full"] = self.counters.get("dropped_buffer_full", 0) + dropped
                del self.messages[:dropped]

    def _process_line(self, port, line):
        with self.lock:
            self.msg_counter += 1
            self.counters["uart_received"] = self.counters.get("uart_received", 0) + 1
            now_epoch = time.time()
            if self.t0_epoch is None:
                self.t0_epoch = now_epoch
            elapsed_s = max(0.0, now_epoch - self.t0_epoch)
            now_str = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
            parsed = self._parse_telemetry_line(port, line, now_epoch)
            if not parsed:
                return None

            # Rastrear o Tempo Global do hardware do modulo
            m_hw_ts_hdr = re.search(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]", line)
            hw_tg_us = int(round(float(m_hw_ts_hdr.group(2)) * 1e6)) if m_hw_ts_hdr else None
            hw_tl_us = int(round(float(m_hw_ts_hdr.group(1)) * 1e6)) if m_hw_ts_hdr else None

            # Sincronismo da Linha Temporal Unificada do Enxame (Swarm Master Timeline):
            msg_seq = parsed.get("seq")
            is_master = (self._is_master_port(port) or parsed.get("src") == self.master_rotation.get("current_master_id", "0001") or parsed.get("role") == "Master")

            if hw_tg_us is not None:
                # O hardware DW3000 forneceu diretamente o TG verdadeiro
                # Imunidade a deriva de Slave não sincronizado: se Slave divergir > 5s do Master, fixa na base do Master
                if not is_master and self.base_tg_us is not None and getattr(self, "base_tg_epoch", None) is not None:
                    expected_tg = self.base_tg_us + int(round((now_epoch - self.base_tg_epoch) * 1e6))
                    if abs(hw_tg_us - expected_tg) > 5_000_000:
                        hw_tg_us = expected_tg

                t_glob_us = hw_tg_us
                self.last_known_tg_us = hw_tg_us
                self.last_known_tg_epoch = now_epoch

                if is_master:
                    self.base_tg_us = hw_tg_us
                    self.base_tg_epoch = now_epoch
                    if msg_seq is not None and msg_seq > 100:
                        self.swarm_master_seq32 = msg_seq
                        self.swarm_timeline.set_master_anchor(msg_seq, hw_tg_us)
                elif msg_seq is not None and msg_seq > 100:
                    if getattr(self.swarm_timeline, "t0_seq", None) is None:
                        self.swarm_timeline.set_master_anchor(msg_seq, hw_tg_us)

                if self.t0_hardware_us is None:
                    self.t0_hardware_us = hw_tg_us
                elapsed_s = max(0.0, (hw_tg_us - self.t0_hardware_us) / 1e6)
            elif msg_seq is not None and getattr(self.swarm_timeline, "t0_seq", None) is not None:
                cur_tg_us, swarm_elapsed = self.swarm_timeline.get_timestamp(msg_seq, now_epoch, self.base_tg_us)
                t_glob_us = cur_tg_us
                elapsed_s = swarm_elapsed
            elif hasattr(self, "swarm_timeline") and self.swarm_timeline.last_seq is not None:
                cur_tg_us, swarm_elapsed = self.swarm_timeline.get_current_timestamp(now_epoch)
                t_glob_us = cur_tg_us
                elapsed_s = swarm_elapsed
            elif self.last_known_tg_us is not None and getattr(self, "last_known_tg_epoch", None) is not None:
                dt = max(0.0, now_epoch - self.last_known_tg_epoch)
                t_glob_us = self.last_known_tg_us + int(round(dt * 1e6))
                elapsed_s = max(0.0, now_epoch - self.t0_epoch)
            else:
                t_glob_us = 0
                elapsed_s = max(0.0, now_epoch - self.t0_epoch)

            # Atualizar periodo de sincronismo dinamico se a mensagem contiver
            if parsed.get("sync_period_s") is not None:
                self.sync_period_s = parsed["sync_period_s"]
                self.sync_period_ms = parsed.get("sync_period_ms", int(round(self.sync_period_s * 1000)))

            msg_type = parsed.get("type", "raw")
            dist_val = parsed.get("distance_m") if parsed.get("distance_m") is not None else parsed.get("dist_m")
            raw_dist_val = parsed.get("raw_dist_m") if parsed.get("raw_dist_m") is not None else dist_val
            drift_val = parsed.get("raw_clock_drift_ppm") if parsed.get("raw_clock_drift_ppm") is not None else parsed.get("clock_drift_ppm")
            is_valid = (msg_type not in ["raw", "corrupt"])
            inv_reason = parsed.get("invalidation_reason") if parsed.get("invalidation_reason") else (None if is_valid else "Linha UART em texto livre nao estruturada")

            # Rejeitar medições com distância fora dos limites físicos UWB [0.0, 100.0] m ou deriva fora de [-50.0, 50.0] ppm
            if raw_dist_val is not None and (raw_dist_val < 0.0 or raw_dist_val > 100.0):
                is_valid = False
                inv_reason = f"out_of_physical_bounds ({raw_dist_val} m not in [0.0, 100.0] m)"
            elif drift_val is not None and (math.isnan(drift_val) or math.isinf(drift_val) or abs(drift_val) > 50.0):
                is_valid = False
                inv_reason = f"out_of_bounds_clock_drift ({drift_val} ppm not in [-50.0, 50.0] ppm)"
            elif parsed.get("is_valid_measurement") is False:
                is_valid = False
                if not inv_reason:
                    inv_reason = "incomplete_or_unsynchronized_measurement"

            # Se a porta já possui um fluxo binário 7B de alta frequência ativo (< 2.0s),
            # linhas ASCII de TDoA ([TDOA:RX] / [TDOA:TX]) são logs de diagnóstico da UART e não medições primárias.
            # Marcar is_valid_measurement=False evita duplicar ou contaminar os canais de alta frequência no gráfico.
            last_bin_t = getattr(self, "has_binary_stream", {}).get(port, 0)
            if (now_epoch - last_bin_t) < 2.0 and parsed.get("type") == "tdoa":
                parsed["is_valid_measurement"] = False

            if is_valid:
                self.counters["decoded_success"] = self.counters.get("decoded_success", 0) + 1
            else:
                self.counters["invalid_corrupt"] = self.counters.get("invalid_corrupt", 0) + 1

            # Determinar no e role da mensagem
            ident = MODULE_IDENTITY_CACHE.get(port, {})
            node_id = ident.get("node_id") or parsed.get("node_id")
            if not node_id:
                if parsed.get("type") == "tdoa" and "[TDOA:RX" in line:
                    node_id = parsed.get("dst")
                elif parsed.get("type") == "tdoa" and "[TDOA:TX" in line:
                    node_id = parsed.get("src")
                else:
                    node_id = parsed.get("src")
            if node_id:
                node_id = str(node_id).upper().zfill(4)

            role = ident.get("role") or parsed.get("role")
            if not role:
                if node_id in ["0001", "1"]:
                    role = "Master"
                elif node_id:
                    role = "Slave"
                else:
                    role = ""

            peer_id = parsed.get("dst") or parsed.get("peer")
            if peer_id:
                peer_id = str(peer_id).upper().zfill(4)

            m_hw_ts = re.search(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]", line)
            t_loc_us = int(round(float(m_hw_ts.group(1)) * 1e6)) if m_hw_ts else parsed.get("t_local_us")
            
            # Preservar o t_glob_us estritamente unificado na Swarm Master Timeline
            # (evita desfasamentos de 18000s causados pelo uptime interno de boot de cada escravo)
            if t_glob_us is None:
                if m_hw_ts and (self._is_master_port(port) or self.last_known_tg_us is None):
                    t_glob_us = int(round(float(m_hw_ts.group(2)) * 1e6))
                elif self.last_known_tg_us is not None:
                    t_glob_us = self.last_known_tg_us
                else:
                    t_glob_us = int(round(now_epoch * 1e6))

            if t_glob_us is not None:
                if not hasattr(self, "port_last_known_tg_us"):
                    self.port_last_known_tg_us = {}
                self.port_last_known_tg_us[port] = t_glob_us
            if t_loc_us is not None:
                parsed["t_local_us"] = t_loc_us
                parsed["clock_domain"] = "mcu_nrf52_systick"
            if t_glob_us is not None:
                parsed["t_global_us"] = t_glob_us

            # Rastreio de continuidade e normalização unificada da sequência como Ciclos do Algoritmo
            raw_seq = parsed.get("seq")
            norm_seq = None
            seq_delta = None
            seq_anomaly = None

            if msg_type in ("tdoa", "twr", "sync") and node_id:
                # Com a variável única partilhada no firmware, a sequência é contínua a nível do enxame/nó
                stream_key = node_id
                prev_raw = self.stream_last_raw_seq.get(stream_key)

                if raw_seq is not None:
                    try:
                        raw_int = int(raw_seq)
                        if raw_int == 0 and self.algo_cycle_counter > 10:
                            raw_int = self.algo_cycle_counter + 1
                    except (ValueError, TypeError):
                        raw_int = self.algo_cycle_counter + 1

                    if prev_raw is not None:
                        seq_delta = raw_int - int(prev_raw)
                        if seq_delta == 0:
                            seq_anomaly = "duplicate"
                            self.counters["duplicate_packets"] = self.counters.get("duplicate_packets", 0) + 1
                        elif seq_delta < 0:
                            seq_anomaly = "out_of_order"
                            self.counters["out_of_order_packets"] = self.counters.get("out_of_order_packets", 0) + 1
                        elif seq_delta > 1 and seq_delta < 10000:
                            seq_anomaly = "gap"
                            self.counters["dropped_packets_rf"] = self.counters.get("dropped_packets_rf", 0) + (seq_delta - 1)
                        else:
                            seq_anomaly = "OK"
                    else:
                        seq_anomaly = "OK"

                    self.stream_last_raw_seq[stream_key] = raw_int
                    norm_seq = raw_int
                    self.algo_cycle_counter = max(self.algo_cycle_counter, norm_seq)
                else:
                    self.algo_cycle_counter += 1
                    norm_seq = self.algo_cycle_counter
            elif raw_seq is not None:
                try:
                    norm_seq = int(raw_seq)
                    if norm_seq == 0 and self.algo_cycle_counter > 10:
                        norm_seq = self.algo_cycle_counter + 1
                except (ValueError, TypeError):
                    norm_seq = self.algo_cycle_counter + 1
            else:
                self.algo_cycle_counter = (self.algo_cycle_counter + 1) if self.algo_cycle_counter > 0 else self.msg_counter
                norm_seq = self.algo_cycle_counter

            parsed["seq"] = norm_seq
            parsed["seq_raw"] = raw_seq
            parsed["algo_cycle"] = norm_seq

            # Ajustar src_addr e dst_addr para manter consistência Direcional UWB:
            if msg_type == "tdoa" or parsed.get("type") == "tdoa":
                if "[TDOA:RX" in line:
                    src_s = parsed.get("src") or "0001"
                    dst_s = parsed.get("dst") or node_id or "0002"
                    src_addr = f"0x{str(src_s).upper().zfill(4)}"
                    dst_addr = f"0x{str(dst_s).upper().zfill(4)}"
                    peer_id = str(src_s).upper().zfill(4)
                elif "[TDOA:TX" in line:
                    src_addr = "0x0001"
                    dst_addr = "0x000*"
                    peer_id = "*"
                else:
                    src_addr = f"0x{node_id}" if node_id else "0x0001"
                    dst_addr = f"0x{peer_id}" if (peer_id and peer_id != "*") else peer_id
            else:
                src_addr = f"0x{node_id}" if node_id else None
                dst_addr = f"0x{peer_id}" if (peer_id and peer_id != "*") else peer_id

            msg = {
                "id": self.msg_counter,
                "trial_id": self.session_filepath or "live",
                "seq": norm_seq,
                "seq_raw": raw_seq,
                "algo_cycle": norm_seq,
                "seq_delta": seq_delta,
                "seq_anomaly": seq_anomaly,
                "node_id": node_id,
                "peer_id": peer_id,
                "src_addr": src_addr,
                "dst_addr": dst_addr,
                "protocol": parsed.get("mode") or ("TDoA" if msg_type == "tdoa" else ("Sync TWR" if msg_type == "twr" else "UART")),
                "ranging_method": parsed.get("ranging_method", "DS_TWR" if msg_type == "twr" else None),
                "time": now_str,
                "epoch": now_epoch,
                "t_rx_host_epoch": now_epoch,
                "t_local_us": t_loc_us,
                "t_global_us": t_glob_us,
                "t_local_ms": round(t_loc_us / 1000.0, 3) if t_loc_us is not None else None,
                "t_global_ms": round(t_glob_us / 1000.0, 3) if t_glob_us is not None else None,
                "timestamp_ms": round(t_loc_us / 1000.0, 3) if t_loc_us is not None else round(elapsed_s * 1000.0, 3),
                "clock_domain": "mcu_nrf52_systick" if (t_loc_us is not None) else "host_computer",
                "distance_m": dist_val,
                "dist_m": dist_val,
                "raw_dist_m": raw_dist_val,
                "dist_comp_m": dist_val,
                "tof_ns": parsed.get("tof_ns"),
                "clock_drift_ppm": parsed.get("clock_drift_ppm"),
                "ref_dist_m": parsed.get("ref_dist_m") or dist_val,
                "sync_elapsed_ms": parsed.get("sync_elapsed_ms"),
                "real_error_m": parsed.get("real_error_m"),
                "real_error_rate_mps": parsed.get("real_error_rate_mps"),
                "rssi_dbm": parsed.get("rssi_dbm") if parsed.get("rssi_dbm") is not None else parsed.get("prx_dbm"),
                "fp_rssi_dbm": parsed.get("fp_rssi_dbm") if parsed.get("fp_rssi_dbm") is not None else parsed.get("fp_dbm"),
                "status": "OK" if is_valid else "FAIL",
                "is_valid": is_valid,
                "invalidation_reason": inv_reason,
                "provenance": "hardware_uart",
                "elapsed_s": round(elapsed_s, 6),
                "port": port,
                "role": role,
                "text": line,
                "type": msg_type,
                "subslot": parsed.get("subslot"),
                "slot_idx": parsed.get("slot_idx", parsed.get("subslot")),
                "parsed": parsed,
                "sync_period_s": self.sync_period_s,
                "sync_period_ms": self.sync_period_ms
            }
            self.messages.append(msg)
            if len(self.messages) > self.max_messages + 2000:
                dropped = len(self.messages) - self.max_messages
                self.counters["dropped_buffer_full"] = self.counters.get("dropped_buffer_full", 0) + dropped
                del self.messages[:dropped]

            if self.session_recording and self.session_file:
                try:
                    self.session_file.write(json.dumps(msg, default=str) + "\n")
                    self.session_file.flush()
                    self.session_record_count += 1
                    self.counters["persisted_disk"] = self.counters.get("persisted_disk", 0) + 1
                except Exception:
                    pass

    def _parse_telemetry_line(self, port, line, now_epoch):
        parsed = {"type": "raw"}

        # Extração de timestamps de hardware DW3000 [TL: ...s | TG: ...s]
        m_hw_ts = re.search(r"\[TL:\s*([\d\.]+)s\|TG:\s*([\d\.]+)s\]", line)
        t_loc_us = int(round(float(m_hw_ts.group(1)) * 1e6)) if m_hw_ts else None
        t_glob_us = int(round(float(m_hw_ts.group(2)) * 1e6)) if m_hw_ts else None
        if m_hw_ts:
            parsed["t_local_us"] = t_loc_us
            parsed["t_global_us"] = t_glob_us
            parsed["clock_domain"] = "mcu_nrf52_systick"

        # 0. Deteção de Ronda de Sincronização Periódica Master
        # Ex: [SYNC:TWR ] Ronda de Sincronizacao #14 (Periodo: 10.000 s / 10000 ms | 3 Slaves)
        m_sync_hdr = re.search(r"Ronda de Sincronizacao\s+#?(\d+)\s*\(Periodo:\s*([\d\.]+)\s*s\s*/\s*(\d+)\s*ms", line, re.I)
        if m_sync_hdr:
            rnd_num = int(m_sync_hdr.group(1))
            k_s = float(m_sync_hdr.group(2))
            k_ms = int(m_sync_hdr.group(3))
            self.sync_period_s = k_s
            self.sync_period_ms = k_ms
            parsed = {
                "type": "sync",
                "seq": rnd_num,
                "sync_period_s": k_s,
                "sync_period_ms": k_ms,
                "mode": "Sync TWR"
            }
            ident = MODULE_IDENTITY_CACHE.get(port, {})
            src = ident.get("node_id", "0001").upper().zfill(4)
            self._update_node_state(src, role="Master", port=port, last_seen=now_epoch, sync_period_s=k_s, sync_period_ms=k_ms)
            return parsed

        # Detetar mensagens de configuração de sincronismo:
        # Ex: [SWARMLOC:SYNC] MODO 0 ATIVADO (k = 0 s)...
        # Ex: [SWARMLOC:SYNC] Sincronizacao DESATIVADA (k = 0 s)...
        # Ex: [SWARMLOC:SYNC] Periodo: 0.500 s (500 ms) ou [SWARMLOC:SYNC] Intervalo de sincronizacao atualizado para 0.500 s (500 ms).
        if "modo 0 ativado" in line.lower() or "sincronizacao desativada" in line.lower() or "sync: desativado" in line.lower() or "sync desativado" in line.lower() or "frequencia twr: 0 hz" in line.lower():
            self.sync_period_s = 0.0
            self.sync_period_ms = 0
            self.twr_freq_hz = 0.0
            parsed = {
                "type": "sync_config",
                "sync_period_s": 0.0,
                "sync_period_ms": 0,
                "twr_freq_hz": 0.0
            }
            return parsed

        m_sync_freq = re.search(r"\[SWARMLOC:SYNC\]\s+(?:Frequencia TWR(?:\s+configurada para)?\s*:?)\s*([\d\.]+)\s*Hz(?:\s*\(Periodo:\s*([\d\.]+)\s*s\s*/\s*(\d+)\s*ms\))?", line, re.I)
        if m_sync_freq:
            f_hz = float(m_sync_freq.group(1))
            k_s = float(m_sync_freq.group(2)) if m_sync_freq.group(2) else (1.0 / f_hz if f_hz > 0 else 0.0)
            k_ms = int(m_sync_freq.group(3)) if m_sync_freq.group(3) else int(round(k_s * 1000))
            self.twr_freq_hz = f_hz
            self.sync_period_s = k_s
            self.sync_period_ms = k_ms
            parsed = {
                "type": "sync_config",
                "twr_freq_hz": f_hz,
                "sync_period_s": k_s,
                "sync_period_ms": k_ms
            }
            return parsed

        m_sync_cfg = re.search(r"\[SWARMLOC:SYNC\]\s+(?:Periodo\s*:?|Intervalo de sincronizacao atualizado para\s*:?)\s*([\d\.]+)\s*s\s*(?:\((\d+)\s*ms\))?", line, re.I)
        if m_sync_cfg:
            k_s = float(m_sync_cfg.group(1))
            k_ms = int(m_sync_cfg.group(2)) if m_sync_cfg.group(2) else int(round(k_s * 1000))
            self.sync_period_s = k_s
            self.sync_period_ms = k_ms
            self.twr_freq_hz = round(1.0 / k_s, 2) if k_s > 0 else 0.0
            parsed = {
                "type": "sync_config",
                "twr_freq_hz": self.twr_freq_hz,
                "sync_period_s": k_s,
                "sync_period_ms": k_ms
            }
            return parsed

        # Detetar mensagens de configuração de taxa de Beacons TDoA:
        # Ex: [SWARMLOC:FREQ] Frequencia Beacons TDoA: MAXIMA DO HARDWARE (~550 Hz, Periodo: ~1.8 ms)
        # Ex: [SWARMLOC:FREQ] Frequencia Beacons TDoA configurada para 100 Hz (Periodo: 10.00 ms).
        m_tdoa_freq = re.search(r"\[SWARMLOC:FREQ\]\s+Frequencia Beacons TDoA(?:\s+configurada para)?\s*:?\s*(MAXIMA|[\d\.]+)\s*(?:Hz)?", line, re.I)
        if m_tdoa_freq:
            f_val = m_tdoa_freq.group(1).upper()
            if "MAX" in f_val:
                self.tdoa_target_freq_hz = 0.0
            else:
                self.tdoa_target_freq_hz = float(f_val)
            parsed = {
                "type": "tdoa_freq_config",
                "tdoa_target_freq_hz": self.tdoa_target_freq_hz
            }
            return parsed

        # 0. Transições Dinâmicas de Liderança do Enxame (Rotating Master)
        if "[SWARM:ROLE]" in line:
            m_lead = re.search(r"Node\s+0x([0-9A-Fa-f]+)\s+assumiu\s+LIDERANCA.*?Proximo:\s*0x([0-9A-Fa-f]+)", line, re.I)
            if m_lead:
                curr_id = m_lead.group(1).upper().zfill(4)
                next_id = m_lead.group(2).upper().zfill(4)
                prev_id = self.master_rotation.get("current_master_id")
                if prev_id != curr_id:
                    self.master_rotation["prev_master_id"] = prev_id
                self.master_rotation["current_master_id"] = curr_id
                self.master_rotation["next_master_id"] = next_id
                self.master_rotation["master_confirmed"] = True
                self.master_rotation["last_change_epoch"] = int(time.time() * 1000)
                self.master_rotation["last_change_reason"] = "Transição Dinâmica de Liderança (Hardware)"
                self.master_rotation["active_master_source"] = "TELEMETRIA_UART"
                for nid, ns in self.node_states.items():
                    if nid == curr_id:
                        ns["role"] = "Master"
                    else:
                        ns["role"] = "Slave"
                if port in MODULE_IDENTITY_CACHE:
                    MODULE_IDENTITY_CACHE[port]["role"] = "Master" if MODULE_IDENTITY_CACHE[port].get("node_id") == curr_id else "Slave"
                return {"type": "swarm_role", "current_master": curr_id, "next_master": next_id}

            m_cede = re.search(r"Node\s+0x([0-9A-Fa-f]+)\s+cedeu\s+lideranca\s+a\s+Node\s+0x([0-9A-Fa-f]+)", line, re.I)
            if m_cede:
                prev_id = m_cede.group(1).upper().zfill(4)
                curr_id = m_cede.group(2).upper().zfill(4)
                self.master_rotation["prev_master_id"] = prev_id
                self.master_rotation["current_master_id"] = curr_id
                self.master_rotation["next_master_id"] = None
                self.master_rotation["master_confirmed"] = True
                self.master_rotation["last_change_epoch"] = int(time.time() * 1000)
                self.master_rotation["last_change_reason"] = "Transição Dinâmica de Liderança (Hardware)"
                for nid, ns in self.node_states.items():
                    if nid == curr_id:
                        ns["role"] = "Master"
                    else:
                        ns["role"] = "Slave"
                for p, mod in MODULE_IDENTITY_CACHE.items():
                    if mod.get("node_id") == curr_id:
                        mod["role"] = "Master"
                    elif mod.get("node_id") == prev_id:
                        mod["role"] = "Slave"
                return {"type": "swarm_role", "current_master": curr_id, "prev_master": prev_id}

            m_watch = re.search(r"Watchdog timeout:\s*Node\s+0x([0-9A-Fa-f]+)\s+assumiu\s+LIDERANCA", line, re.I)
            if m_watch:
                curr_id = m_watch.group(1).upper().zfill(4)
                prev_id = self.master_rotation.get("current_master_id")
                if prev_id != curr_id:
                    self.master_rotation["prev_master_id"] = prev_id
                self.master_rotation["current_master_id"] = curr_id
                self.master_rotation["next_master_id"] = None
                self.master_rotation["master_confirmed"] = True
                self.master_rotation["last_change_epoch"] = int(time.time() * 1000)
                self.master_rotation["last_change_reason"] = "Transição Dinâmica de Liderança (Watchdog Eleição)"
                self.master_rotation["active_master_source"] = "TELEMETRIA_UART"
                for nid, ns in self.node_states.items():
                    if nid == curr_id:
                        ns["role"] = "Master"
                    else:
                        ns["role"] = "Slave"
                for p, mod in MODULE_IDENTITY_CACHE.items():
                    if mod.get("node_id") == curr_id:
                        mod["role"] = "Master"
                    else:
                        mod["role"] = "Slave"
                return {"type": "swarm_role", "current_master": curr_id, "next_master": self.master_rotation["next_master_id"]}

        # 1. Identificação de nó
        m_id = re.search(r"\[SWARMLOC:ID\]\s+NODE:0x([0-9A-Fa-f]+)\s+ROLE:([A-Za-z]+)", line)
        if not m_id:
            m_id = re.search(r"\[SWARMLOC:SLAVES\]\s+Este no e\s+(SLAVE|MASTER)\s+\(0x([0-9A-Fa-f]+)\)", line, re.I)
            if m_id:
                nid = m_id.group(2).upper().zfill(4)
                role = m_id.group(1).capitalize()
                m_id = True
        if m_id and not isinstance(m_id, bool):
            nid = m_id.group(1).upper().zfill(4)
            role = m_id.group(2).capitalize()
        if m_id:
            parsed = {"type": "id", "node_id": nid, "role": role}
            MODULE_IDENTITY_CACHE[port] = {
                "device": port,
                "node_id": nid,
                "role": role,
                "role_hint": f"{role} ({nid})",
                "is_identified": True
            }
            save_module_identity_cache()
            self._update_node_state(nid, role=role, port=port, last_seen=now_epoch)
            return parsed

        # 2. TDoA Beacon RX (Receção passiva de Beacon 1-via nos Slaves)
        # Ex: [TDOA:RX  ] Beacon #007706 de Master 0x0001 | Dist: 0.094m | ToF: +0.31ns | Deriva: -0.84ppm | Sinc: OK (ha 6 s)
        # Ou: [TDOA:RX  ] Beacon #007706 de Master 0x0001 | SINAL DETETADO | A aguardar calibracao TWR aos 10s...
        if "[TDOA:RX" in line:
            m_seq = re.search(r"Beacon\s+#?(\d+)", line, re.I)
            m_mstr = re.search(r"de\s+(?:Master|Node)\s+0x([0-9A-Fa-f]+)", line, re.I)
            m_slot = re.search(r"\((?:Sub)?slot:\s*(\d+)", line, re.I)
            m_d = re.search(r"Dist:\s*([\d\.\-]+)\s*m", line, re.I)
            m_tof = re.search(r"ToF:\s*([\+\-]?[\d\.]+)\s*ns", line, re.I)
            m_drift = re.search(r"Deriva:\s*([\+\-]?[\d\.]+)\s*ppm", line, re.I)
            m_freq = re.search(r"Freq\s*(?:RF)?:\s*([\d\.]+)\s*Hz", line, re.I)
            m_pdr = re.search(r"PDR:\s*([\d\.]+)\s*%", line, re.I)
            rf_freq_hw = float(m_freq.group(1)) if m_freq else None
            pdr_pct = float(m_pdr.group(1)) if m_pdr else None

            seq = int(m_seq.group(1)) if m_seq else None
            src = m_mstr.group(1).upper().zfill(4) if m_mstr else "0001"
            subslot = int(m_slot.group(1)) if m_slot else (int(src, 16) & 0x07 if src else 0)

            # Identificar o Slave recetor da porta COM
            ident = MODULE_IDENTITY_CACHE.get(port, {})
            dst = ident.get("node_id")
            if not dst or (dst == src and ident.get("role") != "Slave"):
                for nid, st in self.node_states.items():
                    if st.get("port") == port and nid != src:
                        dst = nid
                        break
            if not dst:
                if port == "COM5": dst = "0002"
                elif port in ("COM7", "COM11"): dst = "0003"
                elif port == "COM4": dst = "0004"
                elif port == "COM13": dst = "0005"
                elif port == "COM14": dst = "0006"
                else: dst = "0002" if src == "0001" else "0001"
            dst = dst.upper().zfill(4)

            dist = float(m_d.group(1)) if m_d else None
            tof = float(m_tof.group(1)) if m_tof else None
            drift = float(m_drift.group(1)) if m_drift else None

            awaiting_sync = ("aguardar calibracao" in line.lower() or "sinal detetado" in line.lower()) and (dist is None)
            out_of_bounds = (dist is not None) and (dist < -20.0 or dist > 100.0)
            drift_invalid = (drift is not None) and (abs(drift) > 50.0)
            valid_drift = drift if (drift is not None and not drift_invalid) else None

            m_elapsed = re.search(r"ha\s*(\d+)\s*ms", line, re.I)
            sync_elapsed_ms = int(m_elapsed.group(1)) if m_elapsed else None

            # Calculo de Erro Real Observado em relacao a referencia TWR calibrada
            ref_dist = self.ref_distances.get(dst)
            if ref_dist is None and dist is not None and not out_of_bounds and (sync_elapsed_ms is not None and sync_elapsed_ms <= 100):
                self.ref_distances[dst] = dist
                ref_dist = dist

            real_error_m = None
            real_error_rate_mps = None
            if dist is not None and not out_of_bounds and ref_dist is not None:
                real_error_m = round(dist - ref_dist, 4)
                if sync_elapsed_ms is not None and sync_elapsed_ms > 0:
                    real_error_rate_mps = round(real_error_m / (sync_elapsed_ms / 1000.0), 3)

            dist_comp = ref_dist if ref_dist is not None else (round(dist - real_error_m, 4) if (dist is not None and real_error_m is not None) else dist)

            parsed = {
                "type": "tdoa",
                "seq": seq,
                "subslot": subslot,
                "slot_idx": subslot,
                "src": src,
                "dst": dst,
                "measurer": dst,
                "beacon_src": src,
                "dist_m": dist if not out_of_bounds else None,
                "raw_dist_m": dist,
                "dist_comp_m": dist_comp if not out_of_bounds else None,
                "tof_ns": tof,
                "tdoa_diff": tof,
                "clock_drift_ppm": valid_drift,
                "raw_clock_drift_ppm": drift,
                "rf_freq_hw": rf_freq_hw,
                "pdr_pct": pdr_pct,
                "ref_dist_m": ref_dist,
                "sync_elapsed_ms": sync_elapsed_ms,
                "real_error_m": real_error_m,
                "real_error_rate_mps": real_error_rate_mps,
                "mode": "TDoA",
                "ranging_method": "OWR_SYNC_TOF",
                "sync_state": "awaiting_sync" if awaiting_sync else ("out_of_bounds" if (out_of_bounds or drift_invalid) else "synchronized"),
                "is_valid_measurement": (not awaiting_sync and not out_of_bounds and not drift_invalid and dist is not None),
                "invalidation_reason": "awaiting_clock_sync" if awaiting_sync else ("out_of_physical_bounds" if out_of_bounds else ("out_of_bounds_clock_drift" if drift_invalid else None))
            }

            valid_dist = dist if (dist is not None and 0.0 <= dist <= 100.0 and not drift_invalid) else None
            t_glob = t_glob_us
            t_loc = t_loc_us
            parsed["t_local_us"] = t_loc_us
            parsed["t_global_us"] = t_glob_us
            if valid_dist is not None:
                self._update_node_state(dst, role="Slave", port=port, last_seen=now_epoch,
                                       last_dist_m=valid_dist, last_tdoa=tof, clock_drift_ppm=valid_drift, mode="TDoA",
                                       t_global_us=t_glob, t_local_us=t_loc, ref_dist_m=ref_dist,
                                       sync_elapsed_ms=sync_elapsed_ms, real_error_m=real_error_m, real_error_rate_mps=real_error_rate_mps)
            else:
                self._update_node_state(dst, role="Slave", port=port, last_seen=now_epoch,
                                       last_tdoa=tof if (not out_of_bounds and not drift_invalid) else None,
                                       clock_drift_ppm=valid_drift if (not out_of_bounds and not awaiting_sync) else None, mode="TDoA",
                                       t_global_us=t_glob, t_local_us=t_loc)
            self._update_node_state(src, role="Master", last_seen=now_epoch, t_global_us=t_glob, t_local_us=t_loc)
            return parsed

        # 3. TDoA Beacon TX (Transmissão de Beacon de 1-via no Master)
        # Ex: [TDOA:TX  ] Beacon #007706 emitido (Broadcast 1-via) | Proximo Sync TWR em 4 s
        if "[TDOA:TX" in line:
            m_seq = re.search(r"Beacon\s+#?(\d+)", line, re.I)
            seq = int(m_seq.group(1)) if m_seq else None
            m_freq = re.search(r"Taxa\s*(?:RF)?:\s*([\d\.]+)\s*Hz", line, re.I)
            rf_freq_hw = float(m_freq.group(1)) if m_freq else None
            m_mstr = re.search(r"(?:Master|Node)\s+0x([0-9A-Fa-f]+)", line, re.I)
            if m_mstr:
                src = m_mstr.group(1).upper().zfill(4)
            else:
                ident = MODULE_IDENTITY_CACHE.get(port, {})
                src = ident.get("node_id", "0001").upper().zfill(4)
            m_slot = re.search(r"\((?:Sub)?slot:\s*(\d+)", line, re.I)
            subslot = int(m_slot.group(1)) if m_slot else (int(src, 16) & 0x07 if src else 0)
            parsed = {
                "type": "tdoa",
                "seq": seq,
                "subslot": subslot,
                "slot_idx": subslot,
                "src": src,
                "dst": "*",
                "mode": "TDoA",
                "rf_freq_hw": rf_freq_hw
            }
            parsed["t_local_us"] = t_loc_us
            parsed["t_global_us"] = t_glob_us
            self._update_node_state(src, role="Master", port=port, last_seen=now_epoch, mode="TDoA",
                                   t_global_us=t_glob_us, t_local_us=t_loc_us)
            return parsed

        # 4b. Sincronização DS-TWR reportada pelo Slave (quando k > 0)
        # Ex: [TL:19219.7538730s|TG:19252.2160630s] [SYNC:TWR ] #1656660 Sincronizacao com Master 0x0001: BEM-SUCEDIDA! | Dist:   0.6285m | Deriva: +1.233ppm
        m_slv_sync = re.search(r"\[SYNC:TWR\s*\]\s*#?(\d+)?\s*Sincronizacao com Master\s+0x([0-9A-Fa-f]+):?\s*BEM-SUCEDIDA!\s*\|\s*Dist:\s*([\d\.\-]+)\s*m(?:\s*\|\s*Deriva:\s*([\+\-]?[\d\.]+)\s*ppm)?", line, re.I)
        if m_slv_sync and not self._is_master_port(port):
            seq_val = int(m_slv_sync.group(1)) if m_slv_sync.group(1) else None
            mstr_id = m_slv_sync.group(2).upper().zfill(4)
            dist = float(m_slv_sync.group(3))
            drift = float(m_slv_sync.group(4)) if m_slv_sync.group(4) else None
            ident_tmp = MODULE_IDENTITY_CACHE.get(port, {})
            s_id = ident_tmp.get("node_id")
            if not s_id:
                for nid, st in self.node_states.items():
                    if st.get("port") == port and nid != mstr_id:
                        s_id = nid
                        break
            if not s_id:
                s_id = "0001" if port == "COM6" else ("0002" if port == "COM5" else ("0003" if port == "COM7" else "0004"))
            s_id = s_id.upper().zfill(4)
            if 0.0 <= dist <= 100.0:
                self.ref_distances[s_id] = dist
                if not hasattr(self, "last_twr_dist"):
                    self.last_twr_dist = {}
                self.last_twr_dist[s_id] = dist
            parsed = {
                "type": "twr",
                "seq": seq_val,
                "src": s_id,
                "dst": mstr_id,
                "measurer": s_id,
                "dist_m": dist,
                "raw_dist_m": dist,
                "dist_comp_m": dist,
                "ref_dist_m": dist,
                "clock_drift_ppm": drift,
                "raw_clock_drift_ppm": drift,
                "mode": "Sync TWR",
                "ranging_method": "DS_TWR",
                "is_valid_measurement": (0.0 <= dist <= 100.0),
                "t_local_us": t_loc_us,
                "t_global_us": t_glob_us
            }
            self._update_node_state(s_id, port=port, role="Slave", last_seen=now_epoch, last_dist_m=dist,
                                   ref_dist_m=dist, clock_drift_ppm=drift, real_error_m=0.0, real_error_rate_mps=0.0, sync_elapsed_ms=0,
                                   t_global_us=t_glob_us, t_local_us=t_loc_us, mode="Sync TWR")
            self._update_node_state(mstr_id, role="Master", last_seen=now_epoch)
            return parsed

        if "Distancia Medida:" in line and not self._is_master_port(port):
            # Ignorado para telemetria primária (já capturado na linha de cabeçalho [SYNC:TWR] com timestamp de hardware exato)
            return None

        if "Deriva (Alpha):" in line and not self._is_master_port(port):
            m_alpha = re.search(r"Deriva\s*\(Alpha\):\s*([\d\.]+)\s*\(\s*([\+\-]?[\d\.]+)\s*ppm\)", line)
            if m_alpha:
                drift = float(m_alpha.group(2))
                ident = MODULE_IDENTITY_CACHE.get(port, {})
                s_id = ident.get("node_id")
                if not s_id:
                    for nid, st in self.node_states.items():
                        if st.get("port") == port and nid != "0001":
                            s_id = nid
                            break
                if not s_id:
                    s_id = "0002" if port == "COM5" else ("0003" if port == "COM7" else ("0004" if port == "COM4" else "0002"))
                s_id = s_id.upper().zfill(4)
                parsed = {
                    "type": "sync",
                    "src": s_id,
                    "dst": "0001",
                    "clock_drift_ppm": drift,
                    "mode": "Sync TWR"
                }
                self._update_node_state(s_id, port=port, role="Slave", last_seen=now_epoch, clock_drift_ppm=drift)
                return parsed

        # 4. Sincronização Master -> Slave (DS-TWR)
        # Ex:   -> Slave 0x0002: Sincronizado OK | Dist:  0.120 m
        m_sync_slave = re.search(r"(?:#(\d+)\s*)?->\s*Slave\s+0x([0-9A-Fa-f]+):?\s*Sincronizado\s+OK\s*\|\s*Dist:\s*([\d\.\-]+)\s*m", line, re.I)
        if m_sync_slave:
            seq_val = int(m_sync_slave.group(1)) if m_sync_slave.group(1) else None
            dst = m_sync_slave.group(2).upper().zfill(4)
            dist = float(m_sync_slave.group(3))
            ident = MODULE_IDENTITY_CACHE.get(port, {})
            src = ident.get("node_id", "0001").upper().zfill(4)

            if 0.0 <= dist <= 100.0:
                self.ref_distances[dst] = dist
                if not hasattr(self, "last_twr_dist"):
                    self.last_twr_dist = {}
                self.last_twr_dist[dst] = dist
            parsed = {
                "type": "twr",
                "src": src,
                "dst": dst,
                "measurer": src,
                "dist_m": dist,
                "raw_dist_m": dist,
                "dist_comp_m": dist,
                "ref_dist_m": dist,
                "seq": seq_val,
                "real_error_m": 0.0,
                "real_error_rate_mps": 0.0,
                "sync_elapsed_ms": 0,
                "mode": "Sync TWR",
                "ranging_method": "DS_TWR",
                "is_valid_measurement": (0.0 <= dist <= 100.0)
            }
            self._update_node_state(dst, role="Slave", last_seen=now_epoch, last_dist_m=dist,
                                   ref_dist_m=dist, real_error_m=0.0, real_error_rate_mps=0.0, sync_elapsed_ms=0,
                                   t_global_us=parsed.get("t_global_us"), t_local_us=parsed.get("t_local_us"), mode="Sync TWR")
            self._update_node_state(src, role="Master", port=port, last_seen=now_epoch)
            return parsed

        # 5. Formato tabular padrão do logger SwarmLoc:
        # [TL: ...] [TWR:ROUND ] #000042 M01->S02 | ... | d= 1.234m | +1.23ppm
        # [TWR:ROUND] #000042 S02<-M01 | d= 1.234m | +1.23ppm
        if "[TWR:ROUND" in line:
            m_round = re.search(r"#(\d+)\s+([MS][0-9A-Fa-f]+)\s*(?:->|<-)\s*([MS][0-9A-Fa-f]+|\*|\?+)", line)
            m_d = re.search(r"d=\s*([\d\.\-]+)\s*m", line)
            m_drift = re.search(r"([\+\-]?[\d\.]+)\s*ppm", line)
            m_rf = re.search(r"Prx=([\-\d\.]+)\s+Fp=([\-\d\.]+)", line)

            seq = int(m_round.group(1)) if (m_round and m_round.group(1)) else None
            raw_s = m_round.group(2) if m_round else ""
            raw_d = m_round.group(3) if m_round else ""

            if len(raw_s) == 3:
                src = "00" + raw_s[1:].upper()
            else:
                src = raw_s[1:].upper().zfill(4) if len(raw_s) > 1 else "0001"

            if len(raw_d) == 3 and raw_d[0] in "MSms":
                dst = "00" + raw_d[1:].upper()
            elif len(raw_d) > 1 and raw_d[0] in "MSms":
                dst = raw_d[1:].upper().zfill(4)
            else:
                dst = "0002" if src == "0001" else "0001"

            # NOTA CRÍTICA: DS-TWR é 100% BIDIRECIONAL!
            # M01->S02: Master (0001) mediu distância até Slave 2 (0002) => link 0001->0002
            # S02<-M01: Slave 2 (0002) mediu distância até Master (0001) => link 0002->0001
            # NÃO inverter src e dst! Mantém a proveniência exata de quem calculou a distância.

            dist = float(m_d.group(1)) if m_d else None
            drift = float(m_drift.group(1)) if m_drift else None
            prx = float(m_rf.group(1)) if m_rf else None
            fp = float(m_rf.group(2)) if m_rf else None

            out_of_bounds = (dist is not None) and (dist < -20.0 or dist > 100.0)
            drift_invalid = (drift is not None) and (abs(drift) > 50.0)
            valid_dist = dist if (dist is not None and not out_of_bounds) else None
            valid_drift = drift if (drift is not None and not drift_invalid) else None

            parsed = {
                "type": "twr",
                "seq": seq,
                "src": src,
                "dst": dst,
                "dist_m": valid_dist,
                "raw_dist_m": dist,
                "clock_drift_ppm": valid_drift,
                "raw_clock_drift_ppm": drift,
                "prx_dbm": prx,
                "fp_dbm": fp,
                "t_local_us": t_loc_us,
                "t_global_us": t_glob_us,
                "mode": "TWR",
                "ranging_method": "SS_TWR_CFO" if (self._is_master_port(port) or src == self.master_rotation.get("current_master_id", "0001")) else "DS_TWR_FILTERED",
                "is_valid_measurement": (valid_dist is not None and not drift_invalid),
                "invalidation_reason": "out_of_physical_bounds" if out_of_bounds else ("out_of_bounds_clock_drift" if drift_invalid else None)
            }
            if valid_dist is not None and not drift_invalid:
                is_src_master = (raw_s.startswith("M") or src in ["0000", "0001"] or self.node_states.get(src, {}).get("role") == "Master")
                if is_src_master:
                    # [TWR:ROUND] no Master só é emitido em Modo 0 (k = 0, Puro TWR Contínuo)
                    self.sync_period_s = 0.0
                    self.sync_period_ms = 0
                    # Master é o Hub Coordenador de referência: não atribuir distância própria a si mesmo
                    self._update_node_state(src, port=port, role="Master", last_seen=now_epoch, dst=dst, mode="TWR")
                    self._update_node_state(dst, role="Slave", last_seen=now_epoch, last_dist_m=valid_dist, clock_drift_ppm=valid_drift, mode="TWR")
                else:
                    # Medição direta computada pelo Slave no canal bidirecional DS-TWR
                    self._update_node_state(src, port=port, role="Slave", last_seen=now_epoch, last_dist_m=valid_dist, clock_drift_ppm=valid_drift, mode="TWR")
                    self._update_node_state(dst, role="Master", last_seen=now_epoch)
            return parsed

        # 6. Ranging TWR: [TWR:0x0001->0x0002] DIST: 1.234m
        m_twr = re.search(r"(?:\[TWR:0x([0-9A-Fa-f]+)->0x([0-9A-Fa-f]+)\]|\[TWR\]).*?DIST:\s*([\d\.\-]+)\s*m", line)
        if m_twr:
            src = m_twr.group(1).upper().zfill(4) if m_twr.group(1) else "0001"
            dst = m_twr.group(2).upper().zfill(4) if m_twr.group(2) else ""
            dist = float(m_twr.group(3))
            m_seq = re.search(r"(?:SEQ|#):?\s*#?(\d+)", line, re.I)
            m_drift = re.search(r"(?:DRIFT|PPM):?\s*([\+\-]?[\d\.]+)\s*(?:ppm)?", line, re.I)
            seq = int(m_seq.group(1)) if m_seq else None
            drift = float(m_drift.group(1)) if m_drift else None

            parsed = {
                "type": "twr",
                "src": src,
                "dst": dst,
                "dist_m": dist,
                "seq": seq,
                "clock_drift_ppm": drift,
                "mode": "TWR"
            }
            if src == "0001":
                self._update_node_state(src, port=port, role="Master", last_seen=now_epoch, dst=dst, clock_drift_ppm=drift, mode="TWR")
                if dst:
                    self._update_node_state(dst, role="Slave", last_seen=now_epoch, last_dist_m=dist, clock_drift_ppm=drift, mode="TWR")
            else:
                self._update_node_state(src, port=port, role="Slave", last_seen=now_epoch, last_dist_m=dist, dst=dst, clock_drift_ppm=drift, mode="TWR")
                if dst:
                    self._update_node_state(dst, role="Master", last_seen=now_epoch)
            return parsed

        # 7. Fallback TWR: DIST: X.XXXm
        m_dist = re.search(r"DIST:\s*([\d\.\-]+)\s*m", line)
        if m_dist:
            dist = float(m_dist.group(1))
            ident = MODULE_IDENTITY_CACHE.get(port, {})
            nid = ident.get("node_id", port).upper().zfill(4) if len(ident.get("node_id", "")) <= 4 else ident.get("node_id", port)
            parsed = {"type": "twr", "node_id": nid, "dist_m": dist, "mode": "TWR"}
            if nid == "0001":
                self._update_node_state(nid, port=port, role="Master", last_seen=now_epoch, mode="TWR")
            else:
                self._update_node_state(nid, port=port, role="Slave", last_seen=now_epoch, last_dist_m=dist, mode="TWR")
            return parsed

        # 8. Sincronização / Relógio genérico
        if "[SWARMLOC:SYNC]" in line or "Alpha=" in line:
            m_ms = re.search(r"\((\d+)\s*ms\)", line)
            m_s = re.search(r"([\d\.]+)\s*s", line)
            parsed = {"type": "sync"}
            if m_ms:
                parsed["period_ms"] = int(m_ms.group(1))
            if m_s:
                parsed["period_s"] = float(m_s.group(1))
            return parsed

        # 9. Boot / Reset
        if "SWARMLOC" in line and any(w in line for w in ["BOOT", "START", "INIT", "RESET"]):
            parsed = {"type": "boot"}
            return parsed

        return parsed

    def _update_node_state(self, node_id, **kwargs):
        if not node_id:
            return
        node_id = str(node_id).upper().replace("0X", "").zfill(4) if len(str(node_id)) <= 4 else str(node_id)
        now = time.time()

        # Garantir unicidade: uma porta COM só pode estar associada a 1 único nó ativo
        port_kw = kwargs.get("port")
        if port_kw:
            for oid, ost in list(self.node_states.items()):
                if oid != node_id and ost.get("port") == port_kw:
                    if ost.get("packet_count", 0) <= 2 or oid in ["0000", "0"]:
                        del self.node_states[oid]
                    else:
                        ost["port"] = "" 
        if kwargs.get("last_dist_m") is not None and kwargs.get("last_tdoa") is None:
            try:
                kwargs["last_tdoa"] = round(float(kwargs["last_dist_m"]) / (SPEED_OF_LIGHT * 1e-9), 3)
            except Exception:
                pass
        if node_id not in self.node_states:
            role = kwargs.get("role") or ("Master" if node_id in ["0000", "0", "0001", "1"] else "Slave")
            self.node_states[node_id] = {
                "node_id": node_id,
                "role": role,
                "port": kwargs.get("port", ""),
                "last_seen": kwargs.get("last_seen", now),
                "last_dist_m": kwargs.get("last_dist_m"),
                "last_tdoa": kwargs.get("last_tdoa"),
                "clock_drift_ppm": kwargs.get("clock_drift_ppm"),
                "t_global_us": kwargs.get("t_global_us"),
                "t_local_us": kwargs.get("t_local_us"),
                "ref_dist_m": kwargs.get("ref_dist_m"),
                "sync_elapsed_ms": kwargs.get("sync_elapsed_ms"),
                "real_error_m": kwargs.get("real_error_m"),
                "real_error_rate_mps": kwargs.get("real_error_rate_mps"),
                "mode": kwargs.get("mode", "TDoA/TWR"),
                "packet_count": 1,
                "tdoa_ts": [],
                "twr_ts": [],
                "tdoa_freq_hz": 0.0,
                "twr_freq_hz": 0.0
            }
        else:
            st = self.node_states[node_id]
            st["last_seen"] = kwargs.get("last_seen", now)
            st["packet_count"] = st.get("packet_count", 0) + 1
            for k, v in kwargs.items():
                if v is not None:
                    st[k] = v
        st = self.node_states[node_id]
        # FIDELIDADE ESTRITA: O papel (role) e o Master so sao alterados quando
        # explicitamente reportados pelo hardware via mensagens UART dedicadas ([SWARM:ROLE] ou ID).
        # Nao deduzir rotacoes nem inventar transicoes de lideranca com base em respostas TWR/TDoA.
        if kwargs.get('role') == 'Master':
            st['role'] = 'Master'
            curr_m = self.master_rotation.get('current_master_id')
            if curr_m is None:
                self.master_rotation['current_master_id'] = node_id
        elif kwargs.get('role') == 'Slave':
            st['role'] = 'Slave'
        mode = kwargs.get("mode") or st.get("mode", "")
        if "tdoa_ts" not in st: st["tdoa_ts"] = []
        if "twr_ts" not in st: st["twr_ts"] = []

        if mode == "TDoA":
            ts_list = st["tdoa_ts"]
            ts_list.append(now)
            cutoff = now - 3.0
            if ts_list[0] < cutoff:
                cut = bisect.bisect_left(ts_list, cutoff)
                if cut > 0:
                    del ts_list[:cut]
            if len(ts_list) > 1:
                dt_span = ts_list[-1] - ts_list[0]
                if dt_span > 1e-4:
                    st["tdoa_freq_hz"] = round((len(ts_list) - 1) / dt_span, 1)
        elif mode in ["TWR", "Sync TWR"]:
            ts_list = st["twr_ts"]
            ts_list.append(now)
            cutoff = now - 10.0
            if ts_list[0] < cutoff:
                cut = bisect.bisect_left(ts_list, cutoff)
                if cut > 0:
                    del ts_list[:cut]
            if len(ts_list) > 1:
                dt_span = ts_list[-1] - ts_list[0]
                if dt_span > 1e-4:
                    st["twr_freq_hz"] = round((len(ts_list) - 1) / dt_span, 1)

    def get_live_3d_position(self, anchors_map: dict = None, max_age_ms: int = 5000) -> dict:
        """Calcula a posição 3D instantânea e trajetória recente a partir da telemetria live ativa."""
        with self.lock:
            amap = anchors_map if anchors_map is not None else get_active_anchors_map()
            now_epoch = time.time()
            now_ms = int(now_epoch * 1000)
            acc = MeasurementAccumulator(default_max_age_ms=max_age_ms)
            active_measurements = {}

            # 1. Alimentar a partir de mensagens recentes de telemetria
            recent_records = []
            for m in self.messages[-400:]:
                dist = m.get("distance_m")
                if dist is None:
                    dist = m.get("dist_m")
                if dist is None and m.get("dist_cm") is not None:
                    dist = float(m.get("dist_cm")) / 100.0
                if dist is None:
                    dist = (m.get("parsed") or {}).get("dist_m")
                if dist is None or float(dist) <= 0.0:
                    continue
                nid_str = str(m.get("node_id") or m.get("src_addr") or m.get("src") or "").upper().replace("0X", "").zfill(4)
                dst_str = str(m.get("dst_addr") or m.get("dst") or "").upper().replace("0X", "").zfill(4)
                if nid_str == "0001" and dst_str not in ("0000", "0001", "FFFF", ""):
                    peer_hex = f"0x{dst_str}"
                elif nid_str not in ("0000", "FFFF", ""):
                    peer_hex = f"0x{nid_str}"
                else:
                    continue
                t_ms = int(float(m.get("epoch", now_epoch)) * 1000)
                recent_records.append({
                    "seq": m.get("seq", m.get("id", 0)),
                    "timestamp_ms": t_ms,
                    "src_addr": peer_hex,
                    "dst_addr": "0x0001",
                    "distance_m": float(dist)
                })

            # 2. Alimentar o acumulador instantâneo com o estado atual dos nós ativos
            for nid_key, st in self.node_states.items():
                if nid_key in ("0000", "FFFF"):
                    continue
                dist = st.get("last_dist_m")
                last_seen = st.get("last_seen", 0)
                if dist is not None and float(dist) > 0.0 and last_seen > 0:
                    try:
                        nid_int = int(str(nid_key).replace("0x", "").replace("0X", ""), 16)
                    except ValueError:
                        continue
                    ts_ms = int(float(last_seen) * 1000)
                    acc.push(nid_int, float(dist), ts_ms)
                    age_ms = max(0, now_ms - ts_ms)
                    if age_ms <= max_age_ms:
                        active_measurements[f"0x{nid_int:04X}"] = {
                            "distance_m": round(float(dist), 4),
                            "timestamp_ms": ts_ms,
                            "age_ms": age_ms
                        }

            # Se também houver registos recentes nas mensagens, garantir que estão no acumulador
            for r in recent_records[-32:]:
                try:
                    nid_int = int(r["src_addr"], 16)
                    acc.push(nid_int, float(r["distance_m"]), int(r["timestamp_ms"]))
                    age_ms = max(0, now_ms - int(r["timestamp_ms"]))
                    if age_ms <= max_age_ms:
                        active_measurements[f"0x{nid_int:04X}"] = {
                            "distance_m": round(float(r["distance_m"]), 4),
                            "timestamp_ms": int(r["timestamp_ms"]),
                            "age_ms": age_ms
                        }
                except Exception:
                    pass

            distinct_count = acc.get_distinct_count(now_ms, max_age_ms=max_age_ms)
            current_pos = None
            solver_status = "WAITING_4_ANCHORS"

            if acc.has_4_distinct(now_ms, max_age_ms=max_age_ms, require_unconsumed=False, require_all_new=False):
                extracted = acc.extract_4_distinct(now_ms, max_age_ms=max_age_ms)
                if extracted:
                    node_ids, dists = extracted
                    if all(nid in amap for nid in node_ids):
                        anchors_pts = [amap[nid] for nid in node_ids]
                        pos, residual, st_str = euclidean_multilat_solve_4pt(anchors_pts, dists)
                        solver_status = st_str
                        if st_str == "OK" and pos is not None:
                            current_pos = {
                                "timestamp_ms": now_ms,
                                "time_s": round(now_ms / 1000.0, 3),
                                "x": round(pos[0], 4),
                                "y": round(pos[1], 4),
                                "z": round(pos[2], 4),
                                "residual_rms": round(residual, 4),
                                "node_ids": [f"0x{nid:04X}" for nid in node_ids],
                                "distances_m": [round(d, 3) for d in dists]
                            }

            # Calcular trajetória recente em modo sliding
            traj_res = compute_trial_3d_positions(recent_records, anchors_map=amap, max_age_ms=max_age_ms, mode="sliding")
            trajectory = traj_res["trajectory"]
            stats = traj_res["stats"]
            if current_pos and (not trajectory or (trajectory[-1]["x"], trajectory[-1]["y"], trajectory[-1]["z"]) != (current_pos["x"], current_pos["y"], current_pos["z"])):
                trajectory.append(current_pos)
                stats["count"] = len(trajectory)
                if len(trajectory) == 1:
                    stats["mean_pos"] = [current_pos["x"], current_pos["y"], current_pos["z"]]
                    stats["mean_residual_rms"] = current_pos["residual_rms"]

            return {
                "status": "success",
                "solver_status": solver_status,
                "distinct_anchors_count": distinct_count,
                "position": current_pos,
                "trajectory": trajectory[-200:],
                "anchors": format_anchors_json(amap),
                "active_measurements": active_measurements,
                "stats": stats
            }

    def get_status(self, since_id=0):
        with self.lock:
            # Purgar nó fantasma 0000 se o nó real 0001 estiver ativo
            if "0000" in self.node_states and ("0001" in self.node_states or len(self.node_states) > 6):
                del self.node_states["0000"]

            msgs_rev = []
            for m in reversed(self.messages):
                if m["id"] > since_id:
                    msgs_rev.append(m)
                else:
                    break
            msgs_rev.reverse()
            msgs = msgs_rev
            now = time.time()
            nodes_copy = {}

            # Cálculo de Frequência Real Observada no canal Série (varredura rápida pela cauda)
            cutoff_2s = now - 2.0
            cutoff_3s = now - 3.0
            recent_2s_rev = []
            recent_3s_rev = []
            for m in reversed(self.messages):
                ep = m.get("epoch", 0)
                if ep < cutoff_3s:
                    break
                recent_3s_rev.append(m)
                if ep >= cutoff_2s:
                    recent_2s_rev.append(m)
            recent_3s_rev.reverse()
            recent_2s_rev.reverse()
            recent_2s = recent_2s_rev
            recent_3s = recent_3s_rev
            tdoa_recent = [m for m in recent_2s if m.get("type") == "tdoa" or "[TDOA:RX" in m.get("text", "")]
            twr_recent = [m for m in recent_2s if m.get("type") == "twr" or "Sincronizado OK" in m.get("text", "") or "[TWR" in m.get("text", "")]

            # Medição dinâmica da Taxa Física Real de Rádio dos módulos sem limites artificiais
            radio_phy_freq_hz = None
            f_rf_by_node = {}
            f_rf_domain_by_node = {}

            active_proto_type = "twr" if self.sync_period_s == 0 else "tdoa"

            # Calcular taxa RF por nó via avanço de contadores de sequência over-the-air (d_seq / dt)
            # Prioriza o domínio temporal de hardware do MCU (t_local_us) sobre o tempo de chegada ao PC (epoch).
            for nid in sorted(set(["0001", "0002", "0003", "0004", "0005", "0006"]).union(k for k in self.node_states.keys() if k != "0000")):
                n_msgs = [
                    m for m in recent_3s
                    if m.get("node_id") == nid and m.get("seq") is not None and m.get("type") == active_proto_type
                ]
                if len(n_msgs) < 2:
                    n_msgs = [m for m in recent_3s if m.get("node_id") == nid and m.get("seq") is not None]

                # Isolar segmento monotónico mais recente caso tenha ocorrido reinício de contador seq
                if len(n_msgs) >= 2:
                    mono_start = 0
                    for k_idx in range(1, len(n_msgs)):
                        if n_msgs[k_idx]["seq"] < n_msgs[k_idx - 1]["seq"]:
                            mono_start = k_idx
                    n_msgs = n_msgs[mono_start:]

                if len(n_msgs) >= 2:
                    seq_span = n_msgs[-1]["seq"] - n_msgs[0]["seq"]
                    t0_hw = n_msgs[0].get("t_local_us")
                    t1_hw = n_msgs[-1].get("t_local_us")
                    if t0_hw is not None and t1_hw is not None and t1_hw > t0_hw:
                        t_span = (t1_hw - t0_hw) / 1e6
                        domain = "mcu_nrf52_systick"
                    else:
                        t_span = n_msgs[-1]["epoch"] - n_msgs[0]["epoch"]
                        domain = "host_computer"

                    hw_freq = n_msgs[-1].get("parsed", {}).get("rf_freq_hw") or n_msgs[-1].get("rf_freq_hw")
                    if hw_freq and 0 < hw_freq <= 2500.0:
                        calc_rate = round(hw_freq, 1)
                        f_rf_by_node[nid] = calc_rate
                        f_rf_domain_by_node[nid] = "mcu_rf_hardware_timer"
                        if radio_phy_freq_hz is None or calc_rate > radio_phy_freq_hz:
                            radio_phy_freq_hz = calc_rate
                    elif t_span >= 0.15 and len(n_msgs) >= 2:
                        if seq_span is not None and 0 < seq_span <= (t_span * 2500.0):
                            num_events = seq_span
                        else:
                            num_events = len(n_msgs) - 1
                        calc_rate = round(min(num_events / t_span, 2500.0), 1)
                        f_rf_by_node[nid] = calc_rate
                        f_rf_domain_by_node[nid] = domain
                        if radio_phy_freq_hz is None or calc_rate > radio_phy_freq_hz:
                            radio_phy_freq_hz = calc_rate

            f_phy_configured_hz = radio_phy_freq_hz if radio_phy_freq_hz is not None else 250.0
            f_host_rx_hz = round(len(recent_2s) / 2.0, 1) if recent_2s else 0.0
            f_protocol_sync_hz = (
                radio_phy_freq_hz if self.sync_period_s == 0
                else (round(1.0 / self.sync_period_s, 2) if (self.sync_period_s and self.sync_period_s > 0) else None)
            )

            if self.sync_period_s == 0:
                tdoa_obs_hz = 0.0
                twr_obs_hz = radio_phy_freq_hz or (round(len(twr_recent) / 2.0, 1) if twr_recent else (0.0 if bool(self.active_serials) else None))
            elif self.sync_period_s is not None and self.sync_period_s > 0:
                tdoa_obs_hz = radio_phy_freq_hz or (round(len(tdoa_recent) / 2.0, 1) if recent_2s else 0.0)
                twr_obs_hz = round(1.0 / self.sync_period_s, 2)
            else:
                tdoa_obs_hz = radio_phy_freq_hz or (round(len(tdoa_recent) / 2.0, 1) if recent_2s else 0.0)
                twr_obs_hz = radio_phy_freq_hz or (round(len(twr_recent) / 2.0, 1) if recent_2s else 0.0)

            for nid, st in self.node_states.items():
                item = dict(st)
                item.pop("tdoa_ts", None)
                item.pop("twr_ts", None)
                last_seen = item.get("last_seen", 0) or 0
                dt = now - last_seen
                is_conn = bool(self.active_serials)
                item["is_online"] = (dt < 4.5 and last_seen > 0 and is_conn)
                item["dt_sec"] = round(dt, 1) if last_seen > 0 else None

                # Estado observável de comunicação (nunca afirma estado energético do hardware sem telemetria)
                if last_seen <= 0:
                    comm_state_code = "NO_DATA_SESSION"
                    comm_state_label = "Sem dados na sessão"
                elif not is_conn:
                    comm_state_code = "PORT_DISCONNECTED"
                    comm_state_label = "Porta série desconectada"
                elif dt < 2.0:
                    comm_state_code = "ACTIVE_RX"
                    comm_state_label = "Receção ativa"
                elif dt < 6.0:
                    comm_state_code = "NO_RECENT_DATA"
                    comm_state_label = "Sem dados recentes"
                else:
                    comm_state_code = "COMM_INTERRUPTED"
                    comm_state_label = "Comunicação interrompida"

                item["comm_state_code"] = comm_state_code
                item["comm_state_label"] = comm_state_label
                item["sync_period_s"] = self.sync_period_s
                item["sync_period_ms"] = self.sync_period_ms
                node_rf_rate = f_rf_by_node.get(nid) or radio_phy_freq_hz
                node_rf_domain = f_rf_domain_by_node.get(nid) or ("mcu_nrf52_systick" if f_rf_domain_by_node else "host_computer")
                item["f_phy_configured_hz"] = node_rf_rate
                item["radio_phy_freq_hz"] = node_rf_rate
                item["rate_clock_domain"] = node_rf_domain

                # Taxas semânticas explícitas das 5 camadas da plataforma (sem limites artificiais)
                pkt_cnt = st.get("packet_count", 0)
                if not item["is_online"] or pkt_cnt < 2:
                    item["f_uart_observed_hz"] = None
                    item["f_tx_observed_hz"] = None
                    item["f_rf_event_hz"] = None
                    item["f_protocol_sync_hz"] = None
                    item["f_uart_tx_hz"] = None
                else:
                    uart_rate = st.get("twr_freq_hz" if self.sync_period_s == 0 else "tdoa_freq_hz")
                    item["f_uart_observed_hz"] = uart_rate
                    item["f_tx_observed_hz"] = node_rf_rate
                    item["f_rf_event_hz"] = node_rf_rate
                    item["f_protocol_sync_hz"] = f_protocol_sync_hz
                    item["f_uart_tx_hz"] = uart_rate

                # Frequencias e Modo especificos do no (Fidedignos com a Realidade Fisica)
                real_twr_rate = st.get("twr_freq_hz")
                if not real_twr_rate and self.sync_period_s and self.sync_period_s > 0:
                    # Limite fisico estrito de DS-TWR: cada ronda demora ~6.5 ms (~150 Hz maximo fisico possivel)
                    theo_rate = round(1.0 / self.sync_period_s, 2)
                    real_twr_rate = min(theo_rate, 150.0)

                if self.sync_period_s == 0:
                    item["mode"] = "TWR"
                    item["tdoa_freq_hz"] = 0.0
                    item["twr_freq_hz"] = (real_twr_rate or node_rf_rate or twr_obs_hz or 0.0) if item["is_online"] else 0.0
                else:
                    item["mode"] = "TDoA"
                    # Frequencia TDoA real: Taxa fisica de beacons transmitidos/recebidos por radio UWB (>1 kHz)
                    real_tdoa_rate = min(node_rf_rate or radio_phy_freq_hz or tdoa_obs_hz or 0.0, 2500.0)
                    item["tdoa_freq_hz"] = real_tdoa_rate if item["is_online"] else 0.0
                    item["twr_freq_hz"] = (real_twr_rate or 0.0) if item["is_online"] else 0.0

                nodes_copy[nid] = item

            return {
                "is_connected": bool(self.active_serials),
                "connected_ports": list(self.active_serials.keys()),
                "baudrate": self.baudrate,
                "nodes": nodes_copy,
                "messages": msgs,
                "last_id": self.msg_counter,
                "available_ports": self.get_available_ports(),
                "counters": dict(self.counters),
                "sync_period_s": self.sync_period_s,
                "sync_period_ms": self.sync_period_ms,
                "sync_freq_hz": getattr(self, "twr_freq_hz", 2.0),
                "tdoa_target_freq_hz": getattr(self, "tdoa_target_freq_hz", 0.0),
                "tdoa_freq_hz": min(radio_phy_freq_hz or tdoa_obs_hz or 0.0, 2500.0),
                "twr_freq_hz": (min(twr_obs_hz, 150.0) if twr_obs_hz else 0.0),
                "f_phy_configured_hz": f_phy_configured_hz,
                "radio_phy_freq_hz": radio_phy_freq_hz,
                "f_rf_event_hz": radio_phy_freq_hz,
                "f_protocol_sync_hz": f_protocol_sync_hz,
                "f_host_rx_hz": f_host_rx_hz,
                "f_ui_render_hz": 20.0,
                "t0_epoch": self.t0_epoch,
                "elapsed_s": round(now - self.t0_epoch, 2) if self.t0_epoch else 0.0,
                "swarm_master_seq32": getattr(self, "swarm_master_seq32", None),
                "swarm_timeline_t0_seq": getattr(self.swarm_timeline, "t0_seq", None) if hasattr(self, "swarm_timeline") else None,
                "swarm_timeline_t0_us": getattr(self.swarm_timeline, "t0_us", None) if hasattr(self, "swarm_timeline") else None,
                "provenance_catalog": PROVENANCE_CATALOG,
                "algo_version": CANONICAL_ALGO_VERSION,
                "master_rotation": dict(self.master_rotation),
                "current_master_id": self.master_rotation.get("current_master_id"),
                "next_master_id": self.master_rotation.get("next_master_id"),
                "master_confirmed": self.master_rotation.get("master_confirmed"),
                "recording": self.get_session_recording_status()
            }

GLOBAL_TELEMETRY_ENGINE = LiveTelemetryEngine()

# =============================================================================
# 4. SERVIDOR HTTP REST E SERVIÇO DE FICHEIROS ESTÁTICOS
# =============================================================================


def list_live_recordings():
    """Lista todos os ficheiros de sessao gravados na pasta data/live_sessions com metadados."""
    sessions_dir = os.path.join(DATA_DIR, "live_sessions")
    if not os.path.isdir(sessions_dir):
        return []
    items = []
    for fn in os.listdir(sessions_dir):
        if not fn.endswith(".jsonl"):
            continue
        fp = os.path.join(sessions_dir, fn)
        try:
            stat = os.stat(fp)
            size_bytes = stat.st_size
            if size_bytes < 1024:
                size_fmt = f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                size_fmt = f"{size_bytes / 1024:.1f} KB"
            else:
                size_fmt = f"{size_bytes / (1024 * 1024):.2f} MB"
            
            line_count = 0
            first_time = None
            last_time = None
            first_epoch = None
            last_epoch = None
            with open(fp, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    line_count += 1
                    if line_count == 1:
                        try:
                            d1 = json.loads(line)
                            first_time = d1.get("time")
                            first_epoch = d1.get("epoch")
                        except Exception:
                            pass
                    last_line = line
                if line_count > 0:
                    try:
                        d2 = json.loads(last_line)
                        last_time = d2.get("time")
                        last_epoch = d2.get("epoch")
                    except Exception:
                        pass

            duration_s = 0.0
            if first_epoch and last_epoch and last_epoch >= first_epoch:
                duration_s = round(last_epoch - first_epoch, 1)

            mtime = datetime.datetime.fromtimestamp(stat.st_mtime)
            items.append({
                "filename": fn,
                "filepath": fp,
                "size_bytes": size_bytes,
                "size_formatted": size_fmt,
                "records_count": line_count,
                "duration_s": duration_s,
                "first_time": first_time,
                "last_time": last_time,
                "created_at": mtime.strftime("%Y-%m-%d %H:%M:%S")
            })
        except Exception as e:
            print(f"[LIVE RECORDINGS] Erro ao ler {fn}: {e}")
    items.sort(key=lambda x: x["filename"], reverse=True)
    return items

def stream_session_to_csv_bytes(filepath):
    """Converte um ficheiro stream .jsonl em bytes CSV estruturados."""
    import io, csv
    output = io.StringIO()
    writer = csv.writer(output)
    headers = [
        "seq", "algo_cycle", "time", "epoch", "node_id", "src_addr", "dst_addr",
        "protocol", "ranging_method", "distance_m", "tof_ns", "clock_drift_ppm",
        "real_error_m", "sync_elapsed_ms", "t_local_ms", "t_global_ms",
        "status", "is_valid", "port", "role"
    ]
    writer.writerow(headers)
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                writer.writerow([
                    r.get("seq", ""),
                    r.get("algo_cycle", ""),
                    r.get("time", ""),
                    r.get("epoch", ""),
                    r.get("node_id", ""),
                    r.get("src_addr", ""),
                    r.get("dst_addr", ""),
                    r.get("protocol", ""),
                    r.get("ranging_method", ""),
                    r.get("distance_m", ""),
                    r.get("tof_ns", ""),
                    r.get("clock_drift_ppm", ""),
                    r.get("real_error_m", ""),
                    r.get("sync_elapsed_ms", ""),
                    r.get("t_local_ms", ""),
                    r.get("t_global_ms", ""),
                    r.get("status", ""),
                    r.get("is_valid", ""),
                    r.get("port", ""),
                    r.get("role", "")
                ])
            except Exception:
                continue
    return output.getvalue().encode("utf-8")

def load_live_recording(filename):
    """Carrega uma sessao live gravada (.jsonl) para o GLOBAL_STATE[trials] para analise cientifica completa."""
    sessions_dir = os.path.join(DATA_DIR, "live_sessions")
    fp = os.path.join(sessions_dir, os.path.basename(filename))
    if not os.path.isfile(fp):
        raise FileNotFoundError(f"Ficheiro de gravacao nao encontrado: {filename}")
    
    records = []
    with open(fp, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if "round_duration_us" not in r:
                    r["round_duration_us"] = 1 if (r.get("protocol") or "").upper() == "TDOA" else 1000
                r["src_addr"] = str(r.get("src_addr") or "Origem")
                r["dst_addr"] = str(r.get("dst_addr") or "Destino")
                r["source_file"] = os.path.basename(filename)
                records.append(r)
            except Exception:
                continue

    if not records:
        raise ValueError("O ficheiro de gravacao nao contem registos validos.")

    raw_recs = sorted(records, key=lambda r: (r.get("seq", 0), r.get("timestamp_ms", 0)))
    
    m = re.search(r'(\d{8}_\d{6})', filename)
    ts_str = m.group(1) if m else datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    tid = f"stream_{ts_str}"
    label = f"Stream Live ({ts_str})"
    time_fmt = ts_str
    try:
        dt = datetime.datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
        time_fmt = dt.strftime("%Y-%m-%d %H:%M:%S")
        label = f"Stream Live ({time_fmt})"
    except Exception:
        pass

    user_notes = load_trial_metadata()
    notes_item = dict(user_notes.get("global_defaults", {}))
    notes_item.update(user_notes.get(tid, {}))
    if "title" not in notes_item or not notes_item["title"]:
        notes_item["title"] = f"Gravacao Live Stream {time_fmt}"

    analysis = analyze_dataset_subset(
        raw_recs,
        trial_label=label,
        ref_distances=notes_item.get("ref_distances", {}),
        default_ref_m=notes_item.get("ref_distance_m", None),
    )

    nodes = sorted(list(set([r["src_addr"].replace("0x", "") for r in raw_recs if "src_addr" in r])))
    kpi = analysis["kpi"]
    link_summaries = []
    for g in analysis["groups"]:
        link_summaries.append({
            "label": g["link_label"],
            "protocol": g["protocol"],
            "src": g["src"],
            "dst": g["dst"],
            "source_file": g.get("source_file", ""),
            "n_ok": g["n_ok"],
            "n_invalid": g.get("n_invalid", 0),
            "n_total": g["n_total"],
            "mean_dist": g["mean_dist"],
            "std_mm": g["std_mm"],
            "mad_mm": g.get("mad_mm", 0.0),
            "iqr_mm": g.get("iqr_mm", 0.0),
            "median_dist": g["median_dist"],
            "min_dist": g["min_dist"],
            "max_dist": g["max_dist"],
            "has_ground_truth": g.get("has_ground_truth", False),
            "bias_mm": g.get("bias_mm"),
            "rmse_mm": g.get("rmse_mm"),
            "dropped_packets_rf": g.get("dropped_packets_rf", 0)
        })

    valid_dists = [r["distance_m"] for r in raw_recs if r.get("status") == "OK" and r["distance_m"] is not None]
    sync_cnt = sum(1 for r in raw_recs if r.get("round_duration_us", 0) > 5)
    meas_cnt = sum(1 for r in raw_recs if r.get("round_duration_us", 0) <= 5)
    methods = []
    if sync_cnt > 0:
        methods.append("DS-TWR (Sync)")
    if meas_cnt > 0:
        methods.append("TDoA (Broadcast)")
    if not methods:
        methods = ["TDoA"]

    mean_dist = link_summaries[0]["mean_dist"] if len(link_summaries) == 1 else None
    duration_s = round(float(raw_recs[-1].get("epoch", 0) - raw_recs[0].get("epoch", 0)), 2) if len(raw_recs) > 1 and raw_recs[-1].get("epoch") else 0.0
    sample_rate_hz = round(len(raw_recs) / duration_s, 1) if duration_s > 0 else 0.0
    success_rate = round(len(valid_dists) / len(raw_recs) * 100.0, 1) if raw_recs else 0.0

    trial_summary = {
        "id": tid,
        "time": time_fmt,
        "files": [filename],
        "nodes": nodes,
        "ranging_methods": methods,
        "sync_count": sync_cnt,
        "meas_count": meas_cnt,
        "sync_period_s": 0.0,
        "sync_period_ms": 0,
        "tdoa_freq_hz": kpi.get("tdoa_freq_hz", 0.0),
        "tdoa_mean_dt_ms": kpi.get("tdoa_mean_dt_ms", 0.0),
        "twr_freq_hz": kpi.get("twr_freq_hz", 0.0),
        "twr_mean_dt_ms": kpi.get("twr_mean_dt_ms", 0.0),
        "total_records": len(raw_recs),
        "valid_records": len(valid_dists),
        "invalid_records": len(raw_recs) - len(valid_dists),
        "dropped_packets_rf": kpi.get("dropped_packets_rf", 0),
        "gap_count": 0,
        "success_rate": success_rate,
        "duration_s": duration_s,
        "sample_rate_hz": sample_rate_hz,
        "mean_distance_m": mean_dist,
        "links": link_summaries,
        "jitter_mm": kpi.get("mean_jitter_mm", 0.0),
        "mean_drift_ppm": kpi.get("mean_drift_ppm"),
        "integrity_status": "VALID",
        "integrity_note": "Gravacao de Stream em Tempo Real",
        "user_title": notes_item.get("title", ""),
        "campaign": "Live Recording",
        "ref_distance_m": notes_item.get("ref_distance_m", None),
        "ref_distances": notes_item.get("ref_distances", {})
    }

    trial_full = {
        "id": tid,
        "label": label,
        "time": time_fmt,
        "trial_info": trial_summary,
        "files": [filename],
        "kpi": {**kpi, "mean_distance_m": mean_dist, "sync_period_s": 0.0, "sync_period_ms": 0, "gap_count": 0},
        "groups": analysis["groups"],
        "symmetry": analysis["symmetry"],
        "pairwise_symmetry": analysis.get("pairwise_symmetry", {}),
        "clock_drift_analysis": analysis.get("clock_drift_analysis", {}),
        "cross_correlation": analysis["cross_correlation"],
        "report_text": analysis["report_text"],
        "records": raw_recs,
        "user_notes": notes_item,
        "provenance_catalog": PROVENANCE_CATALOG,
        "algo_version": CANONICAL_ALGO_VERSION
    }

    GLOBAL_STATE["trials"][tid] = trial_full
    cat = [c for c in GLOBAL_STATE["catalog"] if c["id"] != tid]
    cat.insert(0, trial_summary)
    GLOBAL_STATE["catalog"] = cat
    GLOBAL_STATE["latest_trial_id"] = tid

    return {
        "status": "success",
        "trial_id": tid,
        "label": label,
        "records_count": len(raw_recs),
        "duration_s": duration_s
    }


class SwarmLocHttpHandler(http.server.BaseHTTPRequestHandler):
    """Handler HTTP para servir a aplicação Web científica e API REST enriquecida."""

    def log_message(self, format, *args):
        # Silenciar logs ruidosos para manter terminal legível
        pass

    def send_json_response(self, data, status_code=200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def serve_static_file(self, filepath: str, content_type: str):
        if not os.path.exists(filepath):
            self.send_error(404, "Ficheiro não encontrado")
            return
        with open(filepath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        # 1. Servir a página principal SPA
        if path in ["/", "/index.html"]:
            idx_path = os.path.join(WEB_DIR, "index.html")
            self.serve_static_file(idx_path, "text/html; charset=utf-8")
            return

        # 2. Servir ficheiros estáticos da pasta web/
        if path.startswith("/web/"):
            rel_path = path[len("/web/"):].lstrip("/\\")
            safe_path = os.path.join(WEB_DIR, rel_path)
            ext = os.path.splitext(rel_path)[1].lower()
            mime_types = {
                ".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".png": "image/png",
                ".svg": "image/svg+xml"
            }
            c_type = mime_types.get(ext, "application/octet-stream")
            self.serve_static_file(safe_path, c_type)
            return

        # 2.1 Servir documentação interactiva Doxygen e grafos AST da pasta docs/
        if path.startswith("/docs/"):
            rel_path = path[len("/docs/"):].lstrip("/\\")
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            docs_root = os.path.normpath(os.path.join(project_root, "docs"))
            safe_path = os.path.normpath(os.path.join(docs_root, rel_path))
            if not safe_path.startswith(docs_root):
                self.send_error(403, "Acesso Negado")
                return
            ext = os.path.splitext(rel_path)[1].lower()
            mime_types = {
                ".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".png": "image/png",
                ".svg": "image/svg+xml",
                ".dot": "text/plain; charset=utf-8",
                ".md": "text/plain; charset=utf-8"
            }
            c_type = mime_types.get(ext, "application/octet-stream")
            self.serve_static_file(safe_path, c_type)
            return

        if path == "/api/docs/status":
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            idx_file = os.path.join(project_root, "docs", "doxygen", "html", "index.html")
            exists = os.path.exists(idx_file)
            mtime_str = "Nunca gerada"
            if exists:
                mtime = os.path.getmtime(idx_file)
                mtime_str = datetime.datetime.fromtimestamp(mtime).strftime("%d/%m/%Y %H:%M:%S")
            self.send_json_response({
                "status": "ok",
                "exists": exists,
                "last_update": mtime_str
            })
            return

        # 3. API REST: Catálogo de Ensaios
        if path == "/api/catalog":
            new_found = scan_server_directory_files()
            if new_found > 0:
                rebuild_trials_database()
            self.send_json_response({
                "trials": GLOBAL_STATE["catalog"],
                "files_meta": GLOBAL_STATE["files_meta"],
                "notes": load_trial_metadata()
            })
            return

        # 3.5 API REST: Coordenadas 3D das Âncoras e Multilateração 3D
        if path == "/api/anchors":
            self.send_json_response({
                "status": "success",
                "anchors": format_anchors_json()
            })
            return

        if path == "/api/live/3d":
            query = urllib.parse.parse_qs(url.query)
            max_age_ms = int(query.get("max_age_ms", [5000])[0])
            res_3d = GLOBAL_TELEMETRY_ENGINE.get_live_3d_position(max_age_ms=max_age_ms)
            self.send_json_response(res_3d)
            return

        if path.startswith("/api/trial/") and path.endswith("/3d"):
            trial_id = urllib.parse.unquote(path[len("/api/trial/"):-len("/3d")]).strip("/")
            if trial_id in GLOBAL_STATE["trials"]:
                trial_data = GLOBAL_STATE["trials"][trial_id]
                query = urllib.parse.parse_qs(url.query)
                mode = query.get("mode", ["batch"])[0]
                max_age_ms = int(query.get("max_age_ms", [2000])[0])
                raw_recs = trial_data.get("records", [])
                prepared_recs = prepare_records_for_multilat(raw_recs)
                amap = get_active_anchors_map()
                res_3d = compute_trial_3d_positions(prepared_recs, anchors_map=amap, max_age_ms=max_age_ms, mode=mode)
                # Caso o modo batch estrito não encontre 4 nós novos na mesma janela mas sliding encontre, usar sliding como fallback automático
                if not res_3d["trajectory"] and mode == "batch":
                    res_3d = compute_trial_3d_positions(prepared_recs, anchors_map=amap, max_age_ms=max_age_ms, mode="sliding")
                self.send_json_response({
                    "status": "success",
                    "trial_id": trial_id,
                    "trajectory": res_3d["trajectory"],
                    "anchors": format_anchors_json(amap),
                    "stats": res_3d["stats"]
                })
            else:
                self.send_json_response({"status": "error", "error": "Ensaio não encontrado"}, status_code=404)
            return

        # 4. API REST: Detalhe do Ensaio (suporta filtragem por módulo, ligação, sentido, protocolo e intervalo temporal)
        if path.startswith("/api/trial/"):
            trial_id = urllib.parse.unquote(path[len("/api/trial/"):])
            if trial_id in GLOBAL_STATE["trials"]:
                trial_data = GLOBAL_STATE["trials"][trial_id]
                query = urllib.parse.parse_qs(url.query)
                f_mod = query.get("module_id", [None])[0]
                f_pair = query.get("link_pair", [None])[0]
                f_dir = query.get("direction", [None])[0]
                f_proto = query.get("protocol", [None])[0]
                f_tmin = float(query["t_min_s"][0]) if "t_min_s" in query and query["t_min_s"][0] != "" else None
                f_tmax = float(query["t_max_s"][0]) if "t_max_s" in query and query["t_max_s"][0] != "" else None
                if any([f_mod, f_pair, f_dir, f_proto, f_tmin is not None, f_tmax is not None]):
                    filtered_recs = filter_records_by_entity(
                        trial_data.get("records", []),
                        module_id=f_mod,
                        link_pair=f_pair,
                        direction=f_dir,
                        protocol=f_proto,
                        t_min_s=f_tmin,
                        t_max_s=f_tmax,
                    )
                    notes_item = trial_data.get("user_notes", {})
                    sub_analysis = analyze_dataset_subset(
                        filtered_recs,
                        trial_label=f"Ensaio {trial_id} (Filtrado)",
                        ref_distances=notes_item.get("ref_distances", {}),
                        default_ref_m=notes_item.get("ref_distance_m", None),
                    )
                    resp = dict(trial_data)
                    resp["groups"] = sub_analysis["groups"]
                    resp["kpi"] = {**sub_analysis["kpi"], "sync_period_s": trial_data["kpi"].get("sync_period_s"), "sync_period_ms": trial_data["kpi"].get("sync_period_ms")}
                    resp["symmetry"] = sub_analysis["symmetry"]
                    resp["pairwise_symmetry"] = sub_analysis["pairwise_symmetry"]
                    resp["clock_drift_analysis"] = sub_analysis["clock_drift_analysis"]
                    resp["records"] = filtered_recs
                    resp["active_filters"] = {
                        "module_id": f_mod,
                        "link_pair": f_pair,
                        "direction": f_dir,
                        "protocol": f_proto,
                        "t_min_s": f_tmin,
                        "t_max_s": f_tmax,
                    }
                    self.send_json_response(resp)
                else:
                    self.send_json_response(trial_data)
            else:
                self.send_json_response({"error": "Ensaio não encontrado"}, status_code=404)
            return

        # 5. API REST: Exportação de Dados em CSV (com suporte a filtros científicos)
        if path.startswith("/api/export/"):
            trial_id = urllib.parse.unquote(path[len("/api/export/"):])
            if trial_id in GLOBAL_STATE["trials"]:
                trial_data = GLOBAL_STATE["trials"][trial_id]
                records = trial_data.get("records", [])
                query = urllib.parse.parse_qs(url.query)
                f_mod = query.get("module_id", [None])[0]
                f_pair = query.get("link_pair", [None])[0]
                f_dir = query.get("direction", [None])[0]
                f_proto = query.get("protocol", [None])[0]
                f_tmin = float(query["t_min_s"][0]) if "t_min_s" in query and query["t_min_s"][0] != "" else None
                f_tmax = float(query["t_max_s"][0]) if "t_max_s" in query and query["t_max_s"][0] != "" else None
                if any([f_mod, f_pair, f_dir, f_proto, f_tmin is not None, f_tmax is not None]):
                    records = filter_records_by_entity(
                        records,
                        module_id=f_mod,
                        link_pair=f_pair,
                        direction=f_dir,
                        protocol=f_proto,
                        t_min_s=f_tmin,
                        t_max_s=f_tmax,
                    )
                meta = trial_data.get("trial_info", {})

                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="SwarmLoc_Trial_{trial_id}.csv"')
                self.end_headers()

                out_lines = [
                    f"# SWARMLOC UWB EXPERIMENTAL TRIAL DATASET\n",
                    f"# Trial_ID: {trial_id}\n",
                    f"# Date_Time: {meta.get('time', '')}\n",
                    f"# Title: {meta.get('user_title', '')}\n",
                    f"# Campaign: {meta.get('campaign', '')}\n",
                    f"# Sync_Period_s: {meta.get('sync_period_s', 0.5):.3f}\n",
                    f"# Sync_Period_ms: {meta.get('sync_period_ms', 500)}\n",
                    f"# Active_Filters: module={f_mod or 'all'} pair={f_pair or 'all'} dir={f_dir or 'all'} proto={f_proto or 'all'} t=[{f_tmin},{f_tmax}]\n",
                    f"# Total_Records: {len(records)}\n",
                    f"# Success_Rate: {meta.get('success_rate', 0)}%\n"
                ]
                if records:
                    keys = [k for k in records[0].keys() if k not in ["source_file", "trial_id", "trial_time"]]
                    out_lines.append(",".join(keys) + "\n")
                    for r in records:
                        row_vals = [str(r.get(k, "")) for k in keys]
                        out_lines.append(",".join(row_vals) + "\n")

                self.wfile.write("".join(out_lines).encode("utf-8"))
            else:
                self.send_error(404, "Ensaio não encontrado")
            return

        # 6. API REST: Listar Portas Série / Módulos UWB Conectados Dinamicamente
        if path == "/api/modules/ports":
            ports_info = []
            try:
                import serial.tools.list_ports
                for p in serial.tools.list_ports.comports():
                    hwid_str = str(p.hwid or "")
                    desc_str = str(p.description or "")
                    mfg_str = str(p.manufacturer or "")
                    is_jlink = ("1366" in hwid_str or 
                                "jlink" in desc_str.lower() or 
                                "segger" in mfg_str.lower())
                    
                    ident = probe_module_identity(p.device)

                    ports_info.append({
                        "device": p.device,
                        "description": desc_str,
                        "manufacturer": mfg_str,
                        "hwid": hwid_str,
                        "is_jlink": is_jlink,
                        "node_id": ident.get("node_id", ""),
                        "role": ident.get("role", ""),
                        "role_hint": ident.get("role_hint", "")
                    })
            except Exception as e:
                print(f"[ERRO] Falha ao detetar portas série: {e}")

            self.send_json_response({
                "status": "success",
                "ports": ports_info,
                "count": len(ports_info)
            })
            return

        # 6.5. API REST: Telemetria e Estado em Tempo Real
        if path == "/api/live/status":
            query = urllib.parse.parse_qs(url.query)
            since_id = 0
            try:
                since_id = int(query.get("since_id", [0])[0])
            except Exception:
                since_id = 0
            status_data = GLOBAL_TELEMETRY_ENGINE.get_status(since_id=since_id)
            self.send_json_response(status_data)
            return

        # 6.6. API REST: Lista de Gravacoes de Telemetria Stream
        if path == "/api/live/recordings":
            items = list_live_recordings()
            self.send_json_response({"status": "success", "recordings": items, "count": len(items)})
            return

        # 6.7. API REST: Download de Gravacao Stream (.jsonl ou .csv)
        if path == "/api/live/recordings/download":
            query = urllib.parse.parse_qs(url.query)
            fn = query.get("file", [None])[0]
            fmt = query.get("format", ["jsonl"])[0].lower()
            if not fn:
                self.send_error(400, "Parametro 'file' obrigatorio")
                return
            fn_safe = os.path.basename(fn)
            fp = os.path.join(DATA_DIR, "live_sessions", fn_safe)
            if not os.path.isfile(fp):
                self.send_error(404, "Ficheiro de gravacao nao encontrado")
                return
            
            if fmt == "csv":
                csv_bytes = stream_session_to_csv_bytes(fp)
                base_name = os.path.splitext(fn_safe)[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{base_name}.csv"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(csv_bytes)
                return
            else:
                with open(fp, "rb") as f:
                    file_bytes = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{fn_safe}"')
                self.send_header("Content-Length", str(len(file_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(file_bytes)
                return

        # 7. API REST: Pré-visualizar Remoção de Ficheiros (.bin e .csv)
        if path == "/api/logs/preview":
            query = urllib.parse.parse_qs(url.query)
            scope = query.get("scope", ["all"])[0]
            trial_id = query.get("trial_id", [None])[0]
            preview = preview_files_to_delete(scope=scope, trial_id=trial_id)
            self.send_json_response(preview)
            return

        self.send_error(404, "Recurso não encontrado")

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        path = url.path

        # 0.0 API REST: Atualizar Documentação Interativa Doxygen + Graphviz AST Flow
        if path == "/api/docs/update":
            try:
                project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                doxy_cmd = "doxygen"
                gen_script = os.path.join(project_root, "tools", "generate_algorithm_flowchart.py")

                # 1. Executar Doxygen
                doxy_res = subprocess.run(
                    [doxy_cmd, "Doxyfile"],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=True
                )

                # 2. Executar Extrator AST e gerador de grafos
                ast_res = subprocess.run(
                    [sys.executable, gen_script],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=True
                )

                now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                self.send_json_response({
                    "status": "ok",
                    "message": "Documentação e grafos AST atualizados com sucesso!",
                    "last_update": now_str
                })
            except Exception as e:
                self.send_json_response({
                    "status": "error",
                    "message": f"Erro ao atualizar documentacao: {str(e)}"
                }, code=500)
            return

        # 0.1 API REST: Conectar Telemetria em Tempo Real
        if path == "/api/live/connect":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = {}
            if body:
                try:
                    payload = json.loads(body.decode("utf-8"))
                except Exception:
                    pass
            ports = payload.get("ports")
            port = payload.get("port")
            baud = int(payload.get("baud", 115200))
            target = ports if ports else (port if port else "all")
            connected = GLOBAL_TELEMETRY_ENGINE.connect(target, baud=baud)
            self.send_json_response({
                "status": "success",
                "connected_ports": connected,
                "is_connected": bool(connected)
            })
            return

        # 0.2 API REST: Desconectar Telemetria
        if path == "/api/live/record/start":
            content_length = int(self.headers.get("Content-Length", 0))
            payload = {}
            if content_length > 0:
                try:
                    payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                except Exception:
                    pass
            sname = payload.get("name")
            res = GLOBAL_TELEMETRY_ENGINE.start_session_recording(sname)
            self.send_json_response(res)
            return

        if path == "/api/live/record/stop":
            res = GLOBAL_TELEMETRY_ENGINE.stop_session_recording()
            self.send_json_response(res)
            return

        if path == "/api/live/record/status":
            res = GLOBAL_TELEMETRY_ENGINE.get_session_recording_status()
            self.send_json_response(res)
            return

        # 0.21 API REST: Carregar Gravacao de Stream para SciMetrics
        if path == "/api/live/recordings/load":
            content_length = int(self.headers.get("Content-Length", 0))
            payload = {}
            if content_length > 0:
                try:
                    payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                except Exception:
                    pass
            filename = payload.get("filename")
            if not filename:
                self.send_json_response({"status": "error", "message": "Parametro 'filename' em falta"}, code=400)
                return
            try:
                res = load_live_recording(filename)
                self.send_json_response(res)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, code=500)
            return

        # 0.22 API REST: Eliminar Gravacao de Stream
        if path == "/api/live/recordings/delete":
            content_length = int(self.headers.get("Content-Length", 0))
            payload = {}
            if content_length > 0:
                try:
                    payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                except Exception:
                    pass
            filename = payload.get("filename")
            if not filename:
                self.send_json_response({"status": "error", "message": "Parametro 'filename' em falta"}, code=400)
                return
            try:
                fp = os.path.join(DATA_DIR, "live_sessions", os.path.basename(filename))
                if os.path.isfile(fp):
                    os.remove(fp)
                    self.send_json_response({"status": "success", "message": f"Ficheiro {filename} eliminado"})
                else:
                    self.send_json_response({"status": "error", "message": "Ficheiro nao encontrado"}, code=404)
            except Exception as e:
                self.send_json_response({"status": "error", "message": str(e)}, code=500)
            return

        if path == "/api/live/disconnect":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = {}
            if body:
                try:
                    payload = json.loads(body.decode("utf-8"))
                except Exception:
                    pass
            ports = payload.get("ports") or payload.get("port")
            GLOBAL_TELEMETRY_ENGINE.disconnect(ports)
            self.send_json_response({"status": "success", "is_connected": False})
            return

        if path == "/api/live/clear":
            GLOBAL_TELEMETRY_ENGINE.clear_data()
            self.send_json_response({"status": "success", "message": "Telemetria e linha temporal do enxame limpas com sucesso"})
            return

        # 0.25 API REST: Informação de Rotação do Master (Hardware 100% Real)
        if path == "/api/live/simulation":
            self.send_json_response({"status": "disabled", "message": "Simulação desativada - Apenas telemetria física real"})
            return

        # 0.3 API REST: Enviar Comando Série para Nós UWB
        if path == "/api/live/command":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = {}
            if body:
                try:
                    payload = json.loads(body.decode("utf-8"))
                except Exception:
                    pass
            cmd_text = payload.get("command", "")
            target = payload.get("target", "all")
            res = GLOBAL_TELEMETRY_ENGINE.send_command(cmd_text, target=target)
            self.send_json_response(res)
            return

        # 1. Descarregar Dados dos Módulos UWB Conectados via Serial
        if path == "/api/modules/download":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            payload = {}
            if body:
                try:
                    payload = json.loads(body.decode("utf-8"))
                except Exception:
                    payload = {}

            target_ports = payload.get("ports")
            target_port = payload.get("port", "all")
            baud = int(payload.get("baud", 115200))
            timeout_sec = float(payload.get("timeout", 20.0))
            force_release = bool(payload.get("force_release", False))

            try:
                import serial.tools.list_ports
                all_ports = [p.device for p in serial.tools.list_ports.comports()]
                jlink_ports = [p.device for p in serial.tools.list_ports.comports()
                               if "1366" in str(p.hwid) or "jlink" in str(p.description).lower() or "segger" in str(p.manufacturer).lower()]
            except Exception:
                all_ports = []
                jlink_ports = []

            # Suporte a seleção de múltiplos módulos/portas (lista de portas ou 'all')
            if target_ports and isinstance(target_ports, list):
                ports_to_poll = [p.strip() for p in target_ports if isinstance(p, str) and p.strip()]
            elif isinstance(target_port, list):
                ports_to_poll = [p.strip() for p in target_port if isinstance(p, str) and p.strip()]
            elif isinstance(target_port, str) and target_port != "all" and "," in target_port:
                ports_to_poll = [p.strip() for p in target_port.split(",") if p.strip()]
            elif target_port == "all":
                ports_to_poll = jlink_ports if jlink_ports else all_ports
            else:
                ports_to_poll = [target_port] if target_port else (jlink_ports if jlink_ports else all_ports)

            if not ports_to_poll:
                self.send_json_response({
                    "status": "error",
                    "message": "Nenhuma porta série ou módulo UWB detetado no servidor.",
                    "downloaded": []
                }, status_code=400)
                return

            # Pausar temporariamente o motor de telemetria para download exclusivo de binário
            was_live_running = GLOBAL_TELEMETRY_ENGINE.running
            saved_live_ports = list(GLOBAL_TELEMETRY_ENGINE.connected_ports)
            if was_live_running:
                GLOBAL_TELEMETRY_ENGINE.disconnect()
                time.sleep(0.2)

            # Importar funções auxiliares de download_raw
            try:
                from download_raw import download_binary_from_port, release_com_port, SerialPortBusyError
            except ImportError:
                python_dir = os.path.dirname(os.path.abspath(__file__))
                if python_dir not in sys.path:
                    sys.path.insert(0, python_dir)
                from download_raw import download_binary_from_port, release_com_port, SerialPortBusyError

            # Deteção prévia de portas ocupadas (se force_release não tiver sido ainda confirmado)
            if not force_release:
                busy_ports = []
                import serial
                for p in ports_to_poll:
                    try:
                        test_s = serial.Serial()
                        test_s.port = p
                        test_s.baudrate = baud
                        test_s.timeout = 0.1
                        test_s.open()
                        test_s.close()
                    except Exception as se:
                        err_str = str(se)
                        if "PermissionError" in err_str or "Acesso negado" in err_str or "Access is denied" in err_str or "could not open port" in err_str:
                            busy_ports.append(p)
                if busy_ports:
                    busy_names = ", ".join(busy_ports)
                    self.send_json_response({
                        "status": "port_busy",
                        "message": f"A porta {busy_names} está ocupada por outro processo ou ligação anterior.",
                        "busy_ports": busy_ports,
                        "busy_names": busy_names
                    }, status_code=200)
                    return
            else:
                # Se force_release == True, fechar/libertar as portas ocupadas
                for p in ports_to_poll:
                    try:
                        release_com_port(p)
                    except Exception as r_err:
                        print(f"[AVISO] Falha ao tentar libertar {p}: {r_err}")

            downloaded_items = []
            errors = []
            time_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            target_sub = os.path.join(DATA_DIR, time_str)
            os.makedirs(target_sub, exist_ok=True)

            for p in ports_to_poll:
                try:
                    raw_data, meta = download_binary_from_port(p, baud=baud, timeout_sec=timeout_sec)
                    if raw_data and meta:
                        node_id = meta.get("node_id", "0000")
                        role = meta.get("role", "Node")
                        fn_bin = f"raw_{node_id}_{role}_{time_str}.bin"
                        fn_csv = f"raw_{node_id}_{role}_{time_str}.csv"
                        save_bin_path = os.path.join(target_sub, fn_bin)
                        save_csv_path = os.path.join(target_sub, fn_csv)

                        with open(save_bin_path, "wb") as f_out:
                            f_out.write(raw_data)

                        MODULE_IDENTITY_CACHE[p] = {
                            "device": p,
                            "node_id": node_id,
                            "role": role,
                            "role_hint": f"{role} ({node_id})",
                            "is_identified": True
                        }
                        save_module_identity_cache()

                        recs, parsed_meta = parse_binary_data(raw_data, fn_bin)
                        if recs:
                            parsed_meta["filepath"] = save_bin_path
                            save_records_to_csv(recs, parsed_meta, save_csv_path)
                            GLOBAL_STATE["loaded_files"][fn_bin] = {"meta": parsed_meta, "records": recs}

                        downloaded_items.append({
                            "port": p,
                            "node_id": node_id,
                            "role": role,
                            "record_count": meta.get("record_count", len(recs)),
                            "duration_ms": meta.get("duration_ms", 0),
                            "bytes": len(raw_data),
                            "bin_file": fn_bin,
                            "csv_file": fn_csv
                        })
                    else:
                        errors.append(f"Porta {p}: Sem resposta de ensaio ou módulo sem dados.")
                except SerialPortBusyError as sp_err:
                    if not force_release:
                        self.send_json_response({
                            "status": "port_busy",
                            "message": f"A porta {p} está ocupada por outro processo ou ligação anterior.",
                            "busy_ports": [p],
                            "busy_names": p
                        }, status_code=200)
                        return
                    else:
                        errors.append(f"Porta {p}: Bloqueada por outro processo mesmo após libertação ({sp_err})")
                except Exception as ex:
                    errors.append(f"Porta {p}: Falha na comunicação ({ex})")

            rebuild_trials_database()

            if was_live_running and saved_live_ports:
                try:
                    GLOBAL_TELEMETRY_ENGINE.connect(saved_live_ports)
                except Exception as resume_err:
                    print(f"[TELEMETRIA] Erro ao retomar telemetria pós-download: {resume_err}")

            if downloaded_items:
                self.send_json_response({
                    "status": "success",
                    "message": f"Download concluído com sucesso ({len(downloaded_items)} módulo(s) descarregados).",
                    "downloaded": downloaded_items,
                    "errors": errors,
                    "created_trial_id": time_str,
                    "catalog": GLOBAL_STATE["catalog"]
                })
            else:
                self.send_json_response({
                    "status": "warning",
                    "message": "Nenhum módulo devolveu dados de ensaio.",
                    "downloaded": [],
                    "errors": errors
                }, status_code=200)
            return

        # 2. Carregamento de Novos Ficheiros via Upload
        if path == "/api/upload":
            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            if "multipart/form-data" in content_type:
                boundary = content_type.split("boundary=")[1].encode()
                parts = body.split(b"--" + boundary)
                uploaded_fns = []
                for part in parts:
                    if b"filename=" in part:
                        headers_part, file_data = part.split(b"\r\n\r\n", 1)
                        file_data = file_data.rstrip(b"\r\n")
                        h_str = headers_part.decode("utf-8", errors="replace")
                        fn = "upload.bin"
                        for line in h_str.split("\r\n"):
                            if "filename=" in line:
                                fn = line.split("filename=")[1].strip('"')

                        trial_id, _ = extract_trial_info(fn)
                        target_sub = os.path.join(DATA_DIR, trial_id)
                        os.makedirs(target_sub, exist_ok=True)
                        save_path = os.path.join(target_sub, fn)
                        with open(save_path, "wb") as f:
                            f.write(file_data)

                        if fn.lower().endswith(".bin"):
                            recs, meta = parse_binary_data(file_data, fn)
                            csv_fn = f"{os.path.splitext(fn)[0]}.csv"
                            csv_path = os.path.join(target_sub, csv_fn)
                            save_records_to_csv(recs, meta, csv_path)
                        else:
                            recs, meta = parse_csv_file(save_path)

                        if recs:
                            meta["filepath"] = save_path
                            GLOBAL_STATE["loaded_files"][fn] = {"meta": meta, "records": recs}
                            uploaded_fns.append(fn)

                rebuild_trials_database()
                self.send_json_response({
                    "status": "success",
                    "message": f"{len(uploaded_fns)} ficheiro(s) carregado(s) e indexado(s) com sucesso.",
                    "files": uploaded_fns,
                    "catalog": GLOBAL_STATE["catalog"]
                })
            else:
                self.send_error(400, "Content-Type Inválido")
            return

        # 2. Descoberta e Atualização de Ficheiros no Disco do Servidor
        if path == "/api/load_server_files":
            organize_existing_files_into_subdirs()
            found = scan_server_directory_files()
            rebuild_trials_database()
            self.send_json_response({
                "status": "success",
                "trials": GLOBAL_STATE["catalog"],
                "new_files_found": found
            })
            return

        # 2.9 API REST: Atualizar Coordenadas 3D das Âncoras
        if path == "/api/anchors":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
                reset_flag = bool(payload.get("reset", False))
                anchors_in = payload.get("anchors", payload) if not reset_flag else {}
                updated = update_active_anchors(anchors_in, reset=reset_flag)
                self.send_json_response({
                    "status": "success",
                    "anchors": format_anchors_json(updated)
                })
            except Exception as e:
                self.send_json_response({"status": "error", "error": str(e)}, status_code=400)
            return

        # 3. Guardar Notas e Ground-Truth do Ensaio
        if path == "/api/notes":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
                tid = payload.get("trial_id")
                if tid:
                    notes = load_trial_metadata()
                    notes[tid] = {
                        "title": payload.get("title", ""),
                        "campaign": payload.get("campaign", ""),
                        "ref_distance_m": payload.get("ref_distance_m", None),
                        "ref_distances": payload.get("ref_distances", {}),
                        "comments": payload.get("comments", "")
                    }
                    save_trial_metadata(notes)
                    rebuild_trials_database()
                    self.send_json_response({"status": "success"})
                    return
            except Exception as e:
                self.send_json_response({"error": str(e)}, status_code=400)
                return

        # 4. Comparação Multi-Ensaio
        if path == "/api/compare":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
                req_trial_ids = payload.get("trial_ids", [])
                compared_trials = []
                for tid in req_trial_ids:
                    if tid in GLOBAL_STATE["trials"]:
                        t_data = GLOBAL_STATE["trials"][tid]
                        compared_trials.append({
                            "id": t_data["id"],
                            "time": t_data["time"],
                            "user_title": t_data["trial_info"].get("user_title", ""),
                            "nodes": t_data["trial_info"].get("nodes", []),
                            "duration_s": t_data["trial_info"].get("duration_s", 0.0),
                            "links": t_data["trial_info"].get("links", []),
                            "kpi": t_data["kpi"],
                            "tdoa_freq_hz": t_data["trial_info"].get("tdoa_freq_hz", 0.0),
                            "twr_freq_hz": t_data["trial_info"].get("twr_freq_hz", 0.0),
                            "sync_period_s": t_data["trial_info"].get("sync_period_s", 0.0),
                            "sync_period_ms": t_data["trial_info"].get("sync_period_ms", 0),
                            "records": t_data["records"]
                        })
                self.send_json_response({
                    "status": "success",
                    "trials": compared_trials
                })
                return
            except Exception as e:
                self.send_json_response({"error": str(e)}, status_code=400)
                return

        # 5. Eliminar / Limpar Ficheiros de Log (.bin e .csv)
        if path in ["/api/logs/clear", "/api/trial/delete"]:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
                scope = payload.get("scope", "all" if path == "/api/logs/clear" else "trial")
                trial_id = payload.get("trial_id")
                res = delete_log_files(scope=scope, trial_id=trial_id)
                self.send_json_response(res)
                return
            except Exception as e:
                self.send_json_response({"error": str(e)}, status_code=500)
                return

        self.send_error(404, "Recurso não encontrado")

def start_web_server(port=8080, initial_files=None):
    """Inicia o servidor Web com suporte a catálogo e análise científica de ensaios para SSH."""
    organize_existing_files_into_subdirs()
    if initial_files:
        for f in initial_files:
            recs, meta = load_file(f)
            if recs:
                GLOBAL_STATE["loaded_files"][os.path.basename(f)] = {"meta": meta, "records": recs}
    else:
        scan_server_directory_files()
    rebuild_trials_database()

    host = "0.0.0.0"
    server = http.server.ThreadingHTTPServer((host, port), SwarmLocHttpHandler)

    ip = "localhost"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print("\n" + "=" * 80)
    print("  [SWARMLOC SCIENTIFIC UI] Servidor Web Cientifico Ativo!")
    print("=" * 80)
    print(f"  Aceda no seu navegador (browser do PC local) em:")
    print(f"    -> http://{ip}:{port}  (Rede local / Tailscale / IP Direto)")
    print(f"    -> http://localhost:{port}  (se usar tunel SSH: ssh -L {port}:localhost:{port} user@host)")
    print("")
    print(f"  Ensaios carregados no Catalogo: {len(GLOBAL_STATE['catalog'])}")
    for t in GLOBAL_STATE["catalog"]:
        print(f"    * Ensaio {t['id']} ({t['time']}): {t['total_records']} amostras | Nos: {t['nodes']}")
    print("=" * 80)
    print("  Prima Ctrl+C no terminal para parar o servidor.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SERVIDOR] Servidor Web SwarmLoc encerrado com sucesso.")
        try:
            GLOBAL_TELEMETRY_ENGINE.disconnect()
        except Exception:
            pass
        server.server_close()

# =============================================================================
# 5. EXECUÇÃO EM MODO TERMINAL (CLI)
# =============================================================================

def run_cli(files: list, ref_dist_m: float = None, output_png: str = "analysis_plot.png"):
    """Executa o processamento direto em linha de comandos (sem interface gráfica)."""
    all_records = []
    for f in files:
        recs, meta = load_file(f)
        if recs:
            print(f"[INFO] Carregados {len(recs)} registos de {f} (Nó: {meta.get('node_id', '?')}, Ensaio: {meta.get('trial_time', '?')})")
            all_records.extend(recs)

    if not all_records:
        print("[AVISO] Nenhum registo válido encontrado nos ficheiros fornecidos.")
        return

    groups = compute_group_metrics(all_records)
    print("\n" + "=" * 98)
    print("           RELATÓRIO CIENTÍFICO DE DESEMPENHO E ESTATÍSTICA SWARMLOC")
    print("=" * 98)
    print(f"{'Link / Destino':<16} | {'N':<6} | {'Sucesso':<9} | {'Dist Média':<12} | {'Jitter (std)':<12} | {'Drift Médio':<12}")
    print("-" * 98)

    for g in groups:
        print(f"{g['link_label']:<16} | {g['n_total']:<6} | {g['success_rate']:>7.1f} % | {g['mean_dist']:.3f} m     | {g['std_mm']:>+7.1f} mm   | {g['mean_drift']:>+7.2f} ppm")
    print("=" * 98 + "\n")

    if output_png:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 6))
            for g in groups:
                v = [r["distance_m"] for r in g["records"] if r.get("status") == "OK" and r["distance_m"] is not None]
                s = [r["seq"] for r in g["records"] if r.get("status") == "OK" and r["distance_m"] is not None]
                if v:
                    ax.plot(s, v, "o-", markersize=2.5, alpha=0.7, label=g["link_label"])
            if ref_dist_m is not None:
                ax.axhline(ref_dist_m, color="red", linestyle="--", label=f"Ref ({ref_dist_m} m)")
            ax.set_title("SwarmLoc UWB - Ranging e Dispersão de Enxame")
            ax.set_xlabel("N.º de Sequência")
            ax.set_ylabel("Distância (m)")
            ax.grid(True, linestyle=":", alpha=0.6)
            ax.legend()
            fig.tight_layout()
            fig.savefig(output_png, dpi=200)
            print(f"[GRÁFICO SUCESSO] Imagem gravada: {output_png}")
            plt.close()
        except Exception as e:
            print(f"[AVISO] Não foi possível gerar gráfico CLI: {e}")

# =============================================================================
# 6. ENTRY POINT
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="SwarmLoc - Conversor e Analisador de Enxames UWB")
    parser.add_argument("inputs", nargs="*", help="Ficheiros .bin ou .csv para analisar")
    parser.add_argument("-p", "--port", type=int, default=8080, help="Porta HTTP para o servidor Web GUI (padrão: 8080)")
    parser.add_argument("-o", "--output", default="analysis_plot.png", help="Caminho da imagem PNG de saída (CLI)")
    parser.add_argument("--ref", type=float, default=None, help="Distância real de referência em metros")
    parser.add_argument("--cli", action="store_true", help="Forçar execução em modo terminal sem abrir GUI nem Web")
    parser.add_argument("--web", action="store_true", help="Forçar abertura do servidor Web GUI")
    args = parser.parse_args()

    if args.cli:
        if not args.inputs:
            local_files = [f for f in os.listdir(".") if f.startswith("raw_") and f.endswith((".bin", ".csv"))]
            if local_files:
                args.inputs = local_files
            else:
                print("[ERRO] Modo CLI requer ficheiros como argumento ou existentes no diretório.")
                sys.exit(1)
        run_cli(args.inputs, args.ref, args.output)
    else:
        start_web_server(port=args.port, initial_files=args.inputs)

if __name__ == "__main__":
    main()
