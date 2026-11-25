"""
raw_session_loader.py - Módulo de Carregamento de Sessões RAW de Bancada (SwarmLoc).
Integra sessões capturadas (raw_COM*.bin + raw_COM*.idx.jsonl) no formato de registos
do SwarmLoc para análise científica imediata na aplicação original.
Alinhamento temporal estrito através de offsets indexados e t_mono_ns do host.
"""
import os
import json
import re
from pathlib import Path
from typing import Tuple, List, Dict, Any

from binary_protocol import BinaryStreamParser, BinaryTdoaFrame

LOADER_VERSION = 2  # Versão de alinhamento temporal contínuo e indexação exacta


def detect_node_role_from_ascii(port_name: str, ascii_sample: List[str]) -> Tuple[str, str]:
    """
    Identifica de forma heurística ou determinística o ID do nó e o seu papel
    a partir de linhas ASCII gravadas no stream da porta.
    """
    for line in ascii_sample:
        if "[TDOA:TX" in line or "emitido (Taxa RF" in line:
            return "0x0001", "Master"
        if "Slave 0x0002" in line and "[SYNC:TWR" in line and "->" in line:
            return "0x0001", "Master"
        m_slv = re.search(r"Sincronizacao com Master (0x[0-9A-Fa-f]{4})", line)
        if m_slv:
            # É um slave; tentar determinar o ID a partir do mapeamento padrão
            pass

    # Mapeamento canónico da bancada física de validação SwarmLoc
    canonical_map = {
        "COM6": ("0x0001", "Master"),   # Master A (legacy)
        "COM12": ("0x0001", "Master"),  # Master A
        "COM5": ("0x0002", "Slave"),    # Slave B
        "COM7": ("0x0003", "Slave"),    # Slave C (legacy)
        "COM11": ("0x0003", "Slave"),   # Slave C
        "COM4": ("0x0004", "Slave"),    # Slave D
        "COM13": ("0x0005", "Slave"),   # Slave E
        "COM14": ("0x0006", "Slave"),   # Slave F
    }
    return canonical_map.get(port_name, (f"0x000{abs(hash(port_name)) % 8 + 1:04X}", "Slave"))


def parse_raw_session_dir(
    session_dir_path: str, max_samples_per_port: int = 10000
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    s_path = Path(session_dir_path)
    if not s_path.is_dir():
        return [], {}

    session_id = s_path.name
    meta_path = s_path / "meta.json"
    session_meta: Dict[str, Any] = {}
    if meta_path.is_file():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                session_meta = json.load(f)
        except Exception:
            pass

    raw_bins = sorted(list(s_path.glob("raw_*.bin")))
    if not raw_bins:
        return [], {}

    cache_file = s_path / "records_sampled.json"
    meta_cache_file = s_path / "meta_sampled.json"

    # Verificar se cache é válido (mais recente que todos os raw_bins E com versão LOADER_VERSION)
    if cache_file.is_file() and meta_cache_file.is_file():
        try:
            cache_mtime = cache_file.stat().st_mtime
            if all(cache_mtime >= rb.stat().st_mtime for rb in raw_bins):
                with open(meta_cache_file, "r", encoding="utf-8") as fmc:
                    meta = json.load(fmc)
                # Invalidar caches antigos com versão anterior ou duração distorcida (< 10s em ficheiros grandes)
                if (
                    meta.get("loader_version") == LOADER_VERSION
                    and meta.get("duration_ms", 0) > 10000
                ):
                    with open(cache_file, "r", encoding="utf-8") as fc:
                        records = json.load(fc)
                    return records, meta
        except Exception:
            pass

    # 1. Carregar índices e determinar t0_global_ns comum a todas as portas
    port_indices: Dict[str, List[Dict[str, Any]]] = {}
    t0_global_ns = None

    for rb in raw_bins:
        idx_file = s_path / f"{rb.stem}.idx.jsonl"
        entries = []
        if idx_file.is_file():
            try:
                with open(idx_file, "r", encoding="utf-8") as fi:
                    for line in fi:
                        line = line.strip()
                        if line:
                            entries.append(json.loads(line))
            except Exception:
                pass
        port_indices[rb.stem] = entries

        if entries:
            t_first = entries[0].get("t_mono_ns", 0)
            if t_first > 0:
                if t0_global_ns is None or t_first < t0_global_ns:
                    t0_global_ns = t_first

    records = []
    ports = []
    total_raw_frames_detected = 0

    # 2. Processar cada porta com alinhamento temporal contínuo
    for rb in raw_bins:
        port = rb.stem.replace("raw_", "")
        ports.append(port)
        entries = port_indices.get(rb.stem, [])

        # Amostra de texto ASCII para autodetecção de nó/papel
        ascii_sample = []
        file_size = rb.stat().st_size
        est_frames = max(1, file_size // 7)
        stride = max(1, est_frames // max_samples_per_port)

        parser = BinaryStreamParser()
        port_frames = 0
        local_node_id = None
        local_role = None

        with open(rb, "rb") as fb:
            if entries:
                # Leitura indexada bloco a bloco com timestamp monotónico exacto
                for entry in entries:
                    fb.seek(entry["off"])
                    chunk = fb.read(entry["len"])
                    if not chunk:
                        continue
                    cur_t_ns = entry.get("t_mono_ns", 0)
                    t_elapsed_ms = (
                        int(round((cur_t_ns - t0_global_ns) / 1e6))
                        if (t0_global_ns and cur_t_ns > 0)
                        else 0
                    )

                    for kind, item in parser.feed(chunk):
                        if kind == "ascii" and len(ascii_sample) < 20:
                            ascii_sample.append(str(item))
                        elif kind == "binary" and isinstance(item, BinaryTdoaFrame):
                            port_frames += 1
                            total_raw_frames_detected += 1
                            if port_frames % stride != 0:
                                continue

                            is_twr = getattr(item, "is_twr", False)
                            dist_m = item.dist_m
                            is_valid = item.is_valid_dist

                            rec_status = "OK" if is_valid else "FAIL"
                            inv_reason = None
                            if not is_valid:
                                inv_reason = "sentinel_or_flag_invalid"
                            elif dist_m is not None and (dist_m < -20.0 or dist_m > 100.0):
                                rec_status = "ERR_BOUNDS"
                                inv_reason = "out_of_physical_bounds"
                                dist_m = None

                            if local_node_id is None:
                                local_node_id, local_role = detect_node_role_from_ascii(port, ascii_sample)

                            src_node = "0x0001" if not is_twr else local_node_id
                            dst_node = local_node_id if not is_twr else "0x0001"

                            rec = {
                                "seq": item.seq16,
                                "timestamp_ms": t_elapsed_ms,
                                "src_addr": src_node,
                                "dst_addr": dst_node,
                                "role": local_role,
                                "status": rec_status,
                                "invalidation_reason": inv_reason,
                                "error_code": 0,
                                "distance_m": dist_m,
                                "distance_mm": item.dist_mm,
                                "round_duration_us": 10 if is_twr else 2,
                                "packet_type": "TWR" if is_twr else "TDOA",
                                "ranging_method": "DS_TWR_RAW_7B" if is_twr else "OWR_SYNC_RAW_7B",
                                "clock_drift_ppm": 0.0,
                                "port": port,
                                "source_file": rb.name,
                                "t_global_us": int(round(cur_t_ns / 1000.0)) if cur_t_ns > 0 else None,
                                "raw_dist_m": dist_m,
                                "dist_comp_m": dist_m,
                            }
                            records.append(rec)
            else:
                # Fallback sem índice: leitura contínua de 64 KiB
                cur_t_ms = 0
                while True:
                    chunk = fb.read(65536)
                    if not chunk:
                        break
                    for kind, item in parser.feed(chunk):
                        if kind == "binary" and isinstance(item, BinaryTdoaFrame):
                            port_frames += 1
                            total_raw_frames_detected += 1
                            if port_frames % stride != 0:
                                continue

                            is_twr = getattr(item, "is_twr", False)
                            dist_m = item.dist_m
                            is_valid = item.is_valid_dist

                            rec_status = "OK" if is_valid else "FAIL"
                            inv_reason = None
                            if not is_valid:
                                inv_reason = "sentinel_or_flag_invalid"
                            elif dist_m is not None and (dist_m < -20.0 or dist_m > 100.0):
                                rec_status = "ERR_BOUNDS"
                                inv_reason = "out_of_physical_bounds"
                                dist_m = None

                            if local_node_id is None:
                                local_node_id, local_role = detect_node_role_from_ascii(port, ascii_sample)

                            src_node = "0x0001" if not is_twr else local_node_id
                            dst_node = local_node_id if not is_twr else "0x0001"

                            rec = {
                                "seq": item.seq16,
                                "timestamp_ms": cur_t_ms,
                                "src_addr": src_node,
                                "dst_addr": dst_node,
                                "role": local_role,
                                "status": rec_status,
                                "invalidation_reason": inv_reason,
                                "error_code": 0,
                                "distance_m": dist_m,
                                "distance_mm": item.dist_mm,
                                "round_duration_us": 10 if is_twr else 2,
                                "packet_type": "TWR" if is_twr else "TDOA",
                                "ranging_method": "DS_TWR_RAW_7B" if is_twr else "OWR_SYNC_RAW_7B",
                                "clock_drift_ppm": 0.0,
                                "port": port,
                                "source_file": rb.name,
                                "t_global_us": cur_t_ms * 1000,
                                "raw_dist_m": dist_m,
                                "dist_comp_m": dist_m,
                            }
                            records.append(rec)
                            cur_t_ms += int(round(stride * 1.825))

    # Ordenação estrita de todos os registos por timestamp monotónico unificado
    records.sort(key=lambda r: r.get("timestamp_ms", 0))

    session_duration_ms = records[-1]["timestamp_ms"] if records else 0

    meta = {
        "filename": session_id,
        "filepath": str(s_path),
        "node_id": "SwarmCluster",
        "role": "Cluster",
        "duration_ms": session_duration_ms,
        "trial_id": session_id,
        "trial_time": session_meta.get("start_utc", session_id),
        "total_records": len(records),
        "total_raw_frames": total_raw_frames_detected,
        "ports": ports,
        "loader_version": LOADER_VERSION,
        "operator_note": session_meta.get("note", {}).get("value")
        if isinstance(session_meta.get("note"), dict)
        else session_meta.get("operator_note"),
    }

    # Gravar cache serializado em disco para arranques subsequentes imediatos
    try:
        with open(cache_file, "w", encoding="utf-8") as fc:
            json.dump(records, fc)
        with open(meta_cache_file, "w", encoding="utf-8") as fmc:
            json.dump(meta, fmc, indent=2)
    except Exception:
        pass

    return records, meta