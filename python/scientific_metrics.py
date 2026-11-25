# -*- coding: utf-8 -*-
"""
scientific_metrics.py - Motor Canónico de Métricas Científicas da Plataforma SwarmLoc
===================================================================================
Fonte única de verdade matemática para estatística descritiva, metrologia de distância,
intervalos temporais, frequências (observada vs RF), jitter, deriva de relógio (drift),
classificação física UWB (OWR, SS-TWR, DS-TWR, TDoA), filtragem de entidades/ligações
e sistema explícito de proveniência científica.

Garante equivalência numérica rigorosa entre backend Python e frontend JavaScript:
- Desvio-padrão amostral com correção de Bessel (ddof=1, divisor N-1).
- Definição explícita de populações válidas e regras de dados em falta.
- Separação entre taxa observada de pacotes e taxa física de rádio (via seq).
- Distinção rigorosa entre dados publicados pelos módulos e cálculos da aplicação.
"""

import math
from typing import List, Dict, Any, Optional, Tuple

DWT_TIME_UNITS = 1.0 / (499.2e6 * 128.0)  # ~15.650040064102564 ps por tick
# Velocidade da luz no ar padrao (n = 1.0003, c_ar = 299792458 / 1.0003 = 299702547 m/s)
# Coerencia com include/uwb.h: SPEED_OF_LIGHT = 299702547
SPEED_OF_LIGHT_VACUUM = 299792458.0        # m/s (no vacuo)
SPEED_OF_LIGHT_AIR = 299702547.0           # m/s (no ar padrao, firmware SwarmLoc)
SPEED_OF_LIGHT = SPEED_OF_LIGHT_AIR        # Unificado com firmware DW3000
TS_40BIT_MASK = 0xFFFFFFFFFF
CANONICAL_ALGO_VERSION = "SciMetrics-v2.1"


def normalize_node_id(node_id: Any) -> str:
    """Normaliza um identificador de módulo UWB para o formato hexadecimal '0xXXXX'."""
    if node_id is None:
        return ""
    s = str(node_id).strip().upper()
    if not s or s in ("*", "FFFF", "0XFFFF", "DESCONHECIDO", "NONE"):
        return s
    clean = s.replace("0X", "")
    try:
        val = int(clean, 16)
        return f"0x{val:04X}"
    except ValueError:
        return s


def normalize_link_direction(src: Any, dst: Any) -> str:
    """Normaliza uma ligação direcional ordenada '0xAAAA → 0xBBBB'."""
    ns = normalize_node_id(src)
    nd = normalize_node_id(dst)
    if not ns or not nd:
        return ""
    return f"{ns} -> {nd}"


def ts_diff_40bit_signed(t_later: int, t_earlier: int) -> int:
    """Diferença modular assinada para contadores de 40 bits do DW3000."""
    diff = (int(t_later) - int(t_earlier)) & TS_40BIT_MASK
    if diff & (1 << 39):
        return diff - (1 << 40)
    return diff


def calculate_tof_from_timestamps(
    t1: int, t2: int, t3: int, t4: int, t5: int = 0, t6: int = 0
) -> Dict[str, Any]:
    """
    Calcula o tempo de voo (ToF) e a distância diretamente a partir dos timestamps de 40 bits
    do transrecetor DW3000 (SS-TWR de 2 mensagens e DS-TWR assimétrico de 3 mensagens).
    Não substitui valores ausentes por zero; retorna None quando os timestamps são insuficientes
    ou fisicamente inconsistentes.
    """
    raw_tof_ds_m = None
    raw_tof_ss_m = None
    tof_ds_ns = None
    tof_ss_ns = None
    rtt1_ticks = None
    reply1_ticks = None
    rtt2_ticks = None
    reply2_ticks = None

    if t1 and t2 and t3 and t4 and t1 > 0 and t2 > 0 and t3 > 0 and t4 > 0:
        rtt1 = ts_diff_40bit_signed(t4, t1)
        reply1 = ts_diff_40bit_signed(t3, t2)
        rtt1_ticks = rtt1
        reply1_ticks = reply1
        if rtt1 > 0 and reply1 > 0 and rtt1 >= reply1:
            tof_ticks_ss = (rtt1 - reply1) / 2.0
            cand_ss_s = tof_ticks_ss * DWT_TIME_UNITS
            cand_ss_m = round(cand_ss_s * SPEED_OF_LIGHT, 4)
            if 0.0 <= cand_ss_m <= 100.0:
                raw_tof_ss_m = cand_ss_m
                tof_ss_ns = round(cand_ss_s * 1e9, 4)

            if t5 and t6 and t5 > 0 and t6 > 0:
                rtt2 = ts_diff_40bit_signed(t6, t3)
                reply2 = ts_diff_40bit_signed(t5, t4)
                rtt2_ticks = rtt2
                reply2_ticks = reply2
                denom = rtt1 + rtt2 + reply1 + reply2
                if rtt2 > 0 and reply2 > 0 and denom > 0:
                    tof_ticks_ds = (rtt1 * rtt2 - reply1 * reply2) / float(denom)
                    cand_ds_s = tof_ticks_ds * DWT_TIME_UNITS
                    cand_ds_m = round(cand_ds_s * SPEED_OF_LIGHT, 4)
                    if 0.0 <= cand_ds_m <= 100.0:
                        raw_tof_ds_m = cand_ds_m
                        tof_ds_ns = round(cand_ds_s * 1e9, 4)

    return {
        "raw_tof_ds_m": raw_tof_ds_m,
        "raw_tof_ss_m": raw_tof_ss_m,
        "tof_ds_ns": tof_ds_ns,
        "tof_ss_ns": tof_ss_ns,
        "rtt1_ticks": rtt1_ticks,
        "reply1_ticks": reply1_ticks,
        "rtt2_ticks": rtt2_ticks,
        "reply2_ticks": reply2_ticks,
    }


def classify_physical_measurement_model(rec: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classifica com rigor físico o método de medição UWB de um registo:
    - OWR_SYNC_TOF: Tempo de voo unidirecional (1-via) entre emissor e um único recetor com relógio sincronizado.
                    Nota científica: a diferença temporal numa única ligação é OWR sincronizado;
                    TDoA clássico hiperbólico exige a diferença entre tempos de chegada a >=2 recetores sincronizados.
    - SS_TWR_CFO: Single-Sided Two-Way Ranging (t1..t4) compensado por Carrier Integrator (CFO).
    - DS_TWR_3MSG: Double-Sided Two-Way Ranging assimétrico de 3 mensagens (t1..t6).
    """
    dur_us = float(rec.get("round_duration_us", 0) or 0)
    pkt = str(rec.get("packet_type") or rec.get("protocol") or rec.get("type") or "").upper()
    src = normalize_node_id(rec.get("src_addr") or rec.get("src") or rec.get("node_id"))

    is_owr = (pkt in ("TDOA", "OWR") or (0 < dur_us <= 5))
    if is_owr:
        return {
            "code": "OWR_SYNC_TOF",
            "short_label": "OWR Sync (Beacon 1-via)",
            "protocol_family": "TDoA",
            "physical_model": "One-Way Ranging (ToF Unidirecional com Relógio Global Sincronizado)",
            "formula": "ToF = t_RX,global - t_TX,beacon = (α · t_RX,local + β) - t_TX,beacon ; d = c · ToF",
            "scientific_note": (
                "Observação unidirecional num único recetor sincronizado (OWR). "
                "Para TDoA hiperbólico clássico são necessárias observações simultâneas do mesmo beacon em múltiplos recetores."
            ),
        }
    elif src == "0x0001":
        return {
            "code": "SS_TWR_CFO",
            "short_label": "SS-TWR + CFO (Master)",
            "protocol_family": "TWR",
            "physical_model": "Single-Sided Two-Way Ranging com Compensação CFO (Carrier Integrator)",
            "formula": "ToF = ((t4 - t1) - (1 - cfo) · (t3 - t2)) / 2 ; d = c · ToF",
            "scientific_note": "Calculado no iniciador da ronda usando t1..t4 e o desvio de frequência portadora lido no registo DW3000.",
        }
    else:
        return {
            "code": "DS_TWR_FILTERED",
            "short_label": "DS-TWR 3-Msg (Slave)",
            "protocol_family": "TWR",
            "physical_model": "Asymmetric Double-Sided Two-Way Ranging (3 Mensagens: Poll, Resp, Final)",
            "formula": "ToF = (R_a · R_b - D_a · D_b) / (R_a + R_b + D_a + D_b) ; d = c · ToF",
            "scientific_note": "Imunidade de 2.ª ordem à deriva de relógio entre módulos independentes; utilizado também para atualizar o modelo afim TG = α·TL + β.",
        }


def filter_records_by_entity(
    records: List[Dict[str, Any]],
    module_id: Optional[str] = None,
    link_pair: Optional[str] = None,
    direction: Optional[str] = None,
    protocol: Optional[str] = None,
    t_min_s: Optional[float] = None,
    t_max_s: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Filtra de forma canónica uma lista de registos (Live ou Histórico) por:
    - module_id: mostra apenas registos onde o módulo participa (como origem ou destino).
    - link_pair: mostra apenas registos entre dois módulos específicos (ambos os sentidos A->B e B->A).
    - direction: mostra apenas um sentido ordenado estrito '0xAAAA -> 0xBBBB'.
    - protocol: 'TWR' ou 'TDoA' / 'OWR'.
    - t_min_s, t_max_s: intervalo temporal em segundos decorridos.
    Nunca mistura nem altera os registos originais.
    """
    if not records:
        return []

    target_mod = normalize_node_id(module_id) if (module_id and str(module_id).lower() != "all") else None

    pair_nodes = None
    if link_pair and str(link_pair).lower() != "all":
        parts = [normalize_node_id(p) for p in str(link_pair).replace("<->", "->").replace("↔", "->").replace("→", "->").split("->") if p.strip()]
        if len(parts) == 2 and parts[0] and parts[1]:
            pair_nodes = (parts[0], parts[1])

    dir_nodes = None
    if direction and str(direction).lower() != "all":
        parts = [normalize_node_id(p) for p in str(direction).replace("→", "->").split("->") if p.strip()]
        if len(parts) == 2 and parts[0] and parts[1]:
            dir_nodes = (parts[0], parts[1])

    proto_clean = str(protocol).strip().upper() if (protocol and str(protocol).lower() != "all") else None

    # Determinar t0 para filtro temporal quando elapsed_s não está pré-calculado
    ts_vals = [float(r.get("timestamp_ms")) / 1000.0 for r in records if r.get("timestamp_ms") is not None and float(r.get("timestamp_ms") or 0) > 0]
    t0_s = min(ts_vals) if ts_vals else 0.0

    filtered = []
    for r in records:
        parsed = r.get("parsed") if isinstance(r.get("parsed"), dict) else {}
        raw_src = r.get("src_addr") or parsed.get("src") or r.get("node_id")
        raw_dst = r.get("dst_addr") or parsed.get("dst") or r.get("peer_id")

        # Para TDoA RX na telemetria live, o medidor/recetor é o Slave (node_id/dst) e o emissor é o Master (0x0001)
        r_type = str(r.get("packet_type") or r.get("protocol") or parsed.get("mode") or r.get("type") or "").upper()
        if "TDOA" in r_type and parsed.get("measurer"):
            src = normalize_node_id(parsed.get("measurer"))
            dst = normalize_node_id(parsed.get("beacon_src") or "0x0001")
        else:
            src = normalize_node_id(raw_src)
            dst = normalize_node_id(raw_dst)

        if target_mod:
            if src != target_mod and dst != target_mod:
                continue

        if pair_nodes:
            na, nb = pair_nodes
            if not ((src == na and dst == nb) or (src == nb and dst == na)):
                continue

        if dir_nodes:
            da, db = dir_nodes
            if not (src == da and dst == db):
                continue

        if proto_clean:
            dur_us = float(r.get("round_duration_us", 0) or 0)
            rec_proto = "TDOA" if ("TDOA" in r_type or "OWR" in r_type or (0 < dur_us <= 5)) else "TWR"
            if proto_clean in ("TDOA", "OWR") and rec_proto != "TDOA":
                continue
            if proto_clean == "TWR" and rec_proto != "TWR":
                continue

        if t_min_s is not None or t_max_s is not None:
            el_s = r.get("elapsed_s")
            if el_s is None and r.get("timestamp_ms") is not None:
                el_s = max(0.0, (float(r["timestamp_ms"]) / 1000.0) - t0_s)
            if el_s is not None:
                if t_min_s is not None and float(el_s) < float(t_min_s):
                    continue
                if t_max_s is not None and float(el_s) > float(t_max_s):
                    continue

        filtered.append(r)

    return filtered


def filter_valid_numbers(values: List[Any], min_val: Optional[float] = None, max_val: Optional[float] = None) -> List[float]:
    """Filtra valores numéricos finitos, excluindo None, NaN, inf e limites fora de gama."""
    valids = []
    for v in values:
        if v is None:
            continue
        try:
            fv = float(v)
            if math.isnan(fv) or math.isinf(fv):
                continue
            if min_val is not None and fv < min_val:
                continue
            if max_val is not None and fv > max_val:
                continue
            valids.append(fv)
        except (ValueError, TypeError):
            continue
    return valids


def compute_descriptive_stats(
    values: List[Any],
    ref_val: Optional[float] = None,
    total_raw_count: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    Calcula o conjunto canónico de estatísticas descritivas e metrológicas.
    Retorna None se não houver amostras válidas.
    Distingue explicitamente registos válidos de inválidos e só calcula desvios face a
    referência (bias_mm, rmse_mm) quando ref_val (Ground-Truth) é fornecido.
    """
    valids = filter_valid_numbers(values)
    n = len(valids)
    if n == 0:
        return None

    n_total = total_raw_count if (total_raw_count is not None and total_raw_count >= n) else len(values)
    n_invalid = max(0, n_total - n)

    valids.sort()
    sum_val = sum(valids)
    mean_val = sum_val / n

    # Variância e Desvio-Padrão amostral (Bessel: n - 1)
    if n > 1:
        sq_diffs = [(v - mean_val) ** 2 for v in valids]
        variance = sum(sq_diffs) / (n - 1)
        std_val = math.sqrt(variance)
    else:
        variance = 0.0
        std_val = 0.0

    # Erro padrão da média e Intervalo de Confiança a 95%
    se = (std_val / math.sqrt(n)) if n > 0 else 0.0
    t_crit = 1.96 if n > 30 else (2.05 if n > 10 else (2.20 if n > 2 else 12.71))
    ci95 = [mean_val - t_crit * se, mean_val + t_crit * se]

    # Mediana empírica
    if n % 2 == 0:
        median_val = (valids[n // 2 - 1] + valids[n // 2]) / 2.0
    else:
        median_val = valids[n // 2]

    # MAD (Median Absolute Deviation) e estimador consistente de sigma
    abs_devs = sorted([abs(v - median_val) for v in valids])
    if n % 2 == 0:
        mad_val = (abs_devs[n // 2 - 1] + abs_devs[n // 2]) / 2.0
    else:
        mad_val = abs_devs[n // 2]
    mad_sigma = 1.4826 * mad_val

    # Percentis empíricos
    def get_percentile(pct: float) -> float:
        idx = int(round(pct * (n - 1)))
        idx = max(0, min(n - 1, idx))
        return valids[idx]

    p5 = get_percentile(0.05)
    q1 = get_percentile(0.25)
    q3 = get_percentile(0.75)
    p95 = get_percentile(0.95)
    p99 = get_percentile(0.99)
    iqr = q3 - q1

    min_val = valids[0]
    max_val = valids[-1]
    span_val = max_val - min_val

    # Outliers Tukey (1.5 * IQR) e 3-sigma
    fence_low = q1 - 1.5 * iqr
    fence_high = q3 + 1.5 * iqr
    outliers_iqr = [v for v in valids if v < fence_low or v > fence_high]
    outliers_3s = [v for v in valids if abs(v - mean_val) > 3.0 * std_val] if std_val > 1e-12 else []

    # Assimetria (Skewness g1) e Curtose em Excesso (Excess Kurtosis g2)
    skewness = 0.0
    kurtosis = 0.0
    if n > 2 and std_val > 1e-12:
        m3 = sum(((v - mean_val) / std_val) ** 3 for v in valids)
        skewness = (n / ((n - 1) * (n - 2))) * m3
    if n > 3 and std_val > 1e-12:
        m4 = sum(((v - mean_val) / std_val) ** 4 for v in valids)
        t1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * m4
        t2 = (3.0 * ((n - 1) ** 2)) / ((n - 2) * (n - 3))
        kurtosis = t1 - t2

    # Metrologia referenciada (Bias e RMSE) - apenas quando há Ground-Truth explícito
    bias_mm = None
    rmse_mm = None
    if ref_val is not None:
        try:
            rf = float(ref_val)
            if not (math.isnan(rf) or math.isinf(rf)):
                bias_mm = (mean_val - rf) * 1000.0
                sq_errs = [(v - rf) ** 2 for v in valids]
                rmse_mm = math.sqrt(sum(sq_errs) / n) * 1000.0
        except (ValueError, TypeError):
            pass

    return {
        "n": n,
        "n_valid": n,
        "n_invalid": n_invalid,
        "n_total": n_total,
        "mean": mean_val,
        "variance": variance,
        "std": std_val,
        "std_mm": std_val * 1000.0,
        "se": se,
        "ci95": ci95,
        "median": median_val,
        "mad": mad_val,
        "mad_mm": mad_val * 1000.0,
        "mad_sigma": mad_sigma,
        "mad_sigma_mm": mad_sigma * 1000.0,
        "p5": p5,
        "q1": q1,
        "q3": q3,
        "p95": p95,
        "p99": p99,
        "iqr": iqr,
        "iqr_mm": iqr * 1000.0,
        "min": min_val,
        "max": max_val,
        "span": span_val,
        "skewness": skewness,
        "kurtosis": kurtosis,
        "outliers_iqr_count": len(outliers_iqr),
        "outliers_3s_count": len(outliers_3s),
        "bias_mm": bias_mm,
        "rmse_mm": rmse_mm,
        "has_ground_truth": bias_mm is not None,
        "algo_version": CANONICAL_ALGO_VERSION,
    }


def unwrap_sequence_numbers(seq_list: List[int], wrap_limit: Optional[int] = None) -> Dict[str, Any]:
    """
    Desdobra contadores de sequência identificando deltas incrementais,
    rollovers (16-bit ou 32-bit), perdas de pacotes, duplicados e pacotes fora de ordem.
    """
    if not seq_list or len(seq_list) < 2:
        return {
            "total_emitted": 0,
            "dropped_packets": 0,
            "duplicate_packets": 0,
            "out_of_order_packets": 0,
            "loss_rate": 0.0,
            "anomalies": []
        }

    total_emitted = 0
    dropped = 0
    duplicates = 0
    out_of_order = 0
    anomalies = []

    for i in range(1, len(seq_list)):
        s_prev = seq_list[i - 1]
        s_curr = seq_list[i]
        if s_prev is None or s_curr is None:
            continue

        if s_curr >= s_prev:
            d = s_curr - s_prev
            if d > 10000 and wrap_limit is None:
                anomalies.append(f"Salto de sequencia anomalo em i={i}: {s_prev} -> {s_curr} (delta={d})")
        else:
            # Rollover ou salto decrescente
            if wrap_limit:
                d = (s_curr - s_prev) % wrap_limit
            elif s_prev > 4000000000 and s_curr < 100000000:
                # 32-bit rollover padrão (4294967296)
                d = (s_curr + 4294967296) - s_prev
            elif 50000 < s_prev <= 65536 and s_curr < 15000:
                # 16-bit rollover padrão (65536)
                d = (s_curr + 65536) - s_prev
            else:
                out_of_order += 1
                anomalies.append(f"Salto de sequencia decrescente nao esperado em i={i}: {s_prev} -> {s_curr}")
                d = 0

        if d > 0:
            total_emitted += d
            if d > 1:
                dropped += (d - 1)
        elif d == 0 and s_curr == s_prev:
            duplicates += 1
            anomalies.append(f"Numero de sequencia duplicado em i={i}: {s_curr}")

    total_expected = total_emitted + 1 if total_emitted > 0 else len(seq_list)
    loss_rate = (dropped / total_expected) if total_expected > 0 else 0.0

    return {
        "total_emitted": total_emitted,
        "dropped_packets": dropped,
        "duplicate_packets": duplicates,
        "out_of_order_packets": out_of_order,
        "loss_rate": round(loss_rate, 4),
        "anomalies": anomalies
    }


def compute_timing_and_rates(
    timestamps_s: List[float],
    seq_numbers: Optional[List[int]] = None,
    f_phy_configured_hz: Optional[float] = None,
    rx_timestamps_s: Optional[List[float]] = None,
    wrap_limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Calcula intervalos temporais (dt), taxa de pacotes observada, jitter,
    e distingue semanticamente as 5 grandezas de frequência da plataforma:
    - f_tx_observed_hz / freq_radio_rf_hz: taxa RF over-the-air calculada via seq e relógio do módulo
    - f_rx_observed_hz: taxa observada nos timestamps de receção locais do módulo
    - f_uart_observed_hz / freq_observed_hz: taxa de mensagens publicadas/recebidas
    - f_trial_observed_hz: taxa efetiva do ensaio
    - f_visual_update_hz: taxa de atualização gráfica
    Retorna None nas métricas de taxa quando n < 2 (dados insuficientes),
    eliminando rigorosamente fallbacks nominais.
    """
    ts = filter_valid_numbers(timestamps_s)
    n = len(ts)
    if n < 2:
        return {
            "n": n,
            "is_valid": False,
            "status": "insufficient_data",
            "span_s": 0.0,
            "dt_mean_ms": None,
            "dt_median_ms": None,
            "dt_min_ms": None,
            "dt_max_ms": None,
            "jitter_ms": None,
            "f_phy_configured_hz": f_phy_configured_hz,
            "f_tx_observed_hz": None,
            "f_rx_observed_hz": None,
            "f_uart_observed_hz": None,
            "f_trial_observed_hz": None,
            "f_visual_update_hz": None,
            "freq_observed_hz": None,
            "freq_radio_rf_hz": None,
            "dropped_packets_rf": 0,
            "duplicate_packets": 0,
            "out_of_order_packets": 0,
            "packet_loss_rate": 0.0,
            "anomalies": [],
            "dt_list_ms": []
        }

    # Ordenar pares se seq estiver presente
    if seq_numbers and len(seq_numbers) == len(timestamps_s):
        pairs = sorted([(t, s) for t, s in zip(timestamps_s, seq_numbers) if t is not None and s is not None], key=lambda x: x[0])
        sorted_ts = [p[0] for p in pairs]
        sorted_seq = [p[1] for p in pairs]
    else:
        sorted_ts = sorted(ts)
        sorted_seq = None

    span_s = sorted_ts[-1] - sorted_ts[0]
    dt_list_ms = []
    for i in range(1, len(sorted_ts)):
        dt_ms = round((sorted_ts[i] - sorted_ts[i - 1]) * 1000.0, 4)
        if dt_ms > 0:
            dt_list_ms.append(dt_ms)

    if dt_list_ms:
        dt_mean = sum(dt_list_ms) / len(dt_list_ms)
        sorted_dt = sorted(dt_list_ms)
        m_idx = len(sorted_dt) // 2
        dt_median = (sorted_dt[m_idx - 1] + sorted_dt[m_idx]) / 2.0 if len(sorted_dt) % 2 == 0 else sorted_dt[m_idx]
        dt_min = sorted_dt[0]
        dt_max = sorted_dt[-1]
        # Jitter: desvio padrão amostral dos intervalos dt
        if len(dt_list_ms) > 1:
            var_dt = sum((d - dt_mean) ** 2 for d in dt_list_ms) / (len(dt_list_ms) - 1)
            jitter_ms = math.sqrt(var_dt)
        else:
            jitter_ms = 0.0
    else:
        dt_mean = dt_median = dt_min = dt_max = jitter_ms = 0.0

    # Frequência observada de receção/publicação de pacotes
    f_uart_obs = round(((len(sorted_ts) - 1) / span_s), 2) if span_s > 1e-6 else 0.0

    # Frequência física de rádio RF over-the-air (baseada nos saltos de sequência)
    f_tx_obs = f_uart_obs
    dropped_rf = 0
    dup_cnt = 0
    ooo_cnt = 0
    loss_rate = 0.0
    seq_anomalies = []

    if sorted_seq and len(sorted_seq) >= 2 and span_s > 1e-6:
        unwrap_res = unwrap_sequence_numbers(sorted_seq, wrap_limit=wrap_limit)
        total_emitted = unwrap_res["total_emitted"]
        dropped_rf = unwrap_res["dropped_packets"]
        dup_cnt = unwrap_res.get("duplicate_packets", 0)
        ooo_cnt = unwrap_res.get("out_of_order_packets", 0)
        loss_rate = unwrap_res["loss_rate"]
        seq_anomalies = unwrap_res["anomalies"]
        if total_emitted > 0:
            f_tx_obs = round(total_emitted / span_s, 2)

    # Frequência calculada a partir de RX hardware timestamps, se fornecidos
    f_rx_obs = None
    if rx_timestamps_s:
        valid_rx = filter_valid_numbers(rx_timestamps_s)
        if len(valid_rx) >= 2:
            s_rx = sorted(valid_rx)
            rx_span = s_rx[-1] - s_rx[0]
            if rx_span > 1e-6:
                f_rx_obs = round((len(s_rx) - 1) / rx_span, 2)

    return {
        "n": len(sorted_ts),
        "is_valid": True,
        "status": "ok",
        "span_s": round(span_s, 4),
        "dt_mean_ms": round(dt_mean, 2),
        "dt_median_ms": round(dt_median, 2),
        "dt_min_ms": round(dt_min, 2),
        "dt_max_ms": round(dt_max, 2),
        "jitter_ms": round(jitter_ms, 2),
        "f_phy_configured_hz": f_phy_configured_hz,
        "f_tx_observed_hz": f_tx_obs,
        "f_rx_observed_hz": f_rx_obs,
        "f_uart_observed_hz": f_uart_obs,
        "f_trial_observed_hz": f_uart_obs,
        "f_visual_update_hz": None,
        # Compatibilidade com chaves anteriores
        "freq_observed_hz": f_uart_obs,
        "freq_radio_rf_hz": f_tx_obs,
        "dropped_packets_rf": dropped_rf,
        "duplicate_packets": dup_cnt,
        "out_of_order_packets": ooo_cnt,
        "packet_loss_rate": loss_rate,
        "anomalies": seq_anomalies,
        "dt_list_ms": dt_list_ms
    }


def compute_linear_drift_regression(
    elapsed_s: List[float],
    drift_ppm_series: List[float],
) -> Dict[str, Any]:
    """
    Calcula estatísticas descritivas e regressão linear simples (OLS) da deriva de relógio
    para um único módulo ou ligação específica.
    Nunca agrega módulos distintos; retorna 'insufficient_data' quando N < 2.
    """
    pairs = []
    for t, d in zip(elapsed_s or [], drift_ppm_series or []):
        if t is None or d is None:
            continue
        try:
            ft = float(t)
            fd = float(d)
            if not (math.isnan(ft) or math.isinf(ft) or math.isnan(fd) or math.isinf(fd)):
                pairs.append((ft, fd))
        except (ValueError, TypeError):
            continue

    n = len(pairs)
    if n == 0:
        return {
            "n_valid": 0,
            "status": "insufficient_data",
            "status_label": "Não calculável com os dados disponíveis",
            "mean_ppm": None,
            "std_ppm": None,
            "median_ppm": None,
            "min_ppm": None,
            "max_ppm": None,
            "alpha_ratio": None,
            "slope_ppm_per_s": None,
            "intercept_ppm": None,
            "r_squared": None,
            "residual_rms_ppm": None,
            "t_span_s": 0.0,
            "algo_version": CANONICAL_ALGO_VERSION,
        }

    drifts = [p[1] for p in pairs]
    stats = compute_descriptive_stats(drifts)
    mean_ppm = round(stats["mean"], 4) if stats else None
    std_ppm = round(stats["std"], 4) if stats else None
    alpha_ratio = round(1.0 + (mean_ppm * 1e-6), 9) if mean_ppm is not None else None

    if n < 2:
        return {
            "n_valid": n,
            "status": "single_sample",
            "status_label": "Amostra única (regressão linear requer N >= 2)",
            "mean_ppm": mean_ppm,
            "std_ppm": 0.0,
            "median_ppm": mean_ppm,
            "min_ppm": mean_ppm,
            "max_ppm": mean_ppm,
            "alpha_ratio": alpha_ratio,
            "slope_ppm_per_s": None,
            "intercept_ppm": None,
            "r_squared": None,
            "residual_rms_ppm": None,
            "t_span_s": 0.0,
            "algo_version": CANONICAL_ALGO_VERSION,
        }

    ts = [p[0] for p in pairs]
    t_mean = sum(ts) / n
    d_mean = sum(drifts) / n
    s_tt = sum((t - t_mean) ** 2 for t in ts)
    s_td = sum((t - t_mean) * (d - d_mean) for t, d in pairs)
    s_dd = sum((d - d_mean) ** 2 for d in drifts)

    slope = None
    intercept = None
    r_sq = None
    res_rms = None
    if s_tt > 1e-12:
        slope = s_td / s_tt
        intercept = d_mean - slope * t_mean
        if s_dd > 1e-12:
            r_sq = max(0.0, min(1.0, (s_td ** 2) / (s_tt * s_dd)))
        else:
            r_sq = 1.0
        residuals = [d - (slope * t + intercept) for t, d in pairs]
        res_rms = math.sqrt(sum(r ** 2 for r in residuals) / n)

    return {
        "n_valid": n,
        "status": "ok",
        "status_label": "Calculado pela aplicação (OLS + Bessel)",
        "mean_ppm": mean_ppm,
        "std_ppm": std_ppm,
        "median_ppm": round(stats["median"], 4) if stats else None,
        "min_ppm": round(stats["min"], 4) if stats else None,
        "max_ppm": round(stats["max"], 4) if stats else None,
        "alpha_ratio": alpha_ratio,
        "slope_ppm_per_s": round(slope, 6) if slope is not None else None,
        "intercept_ppm": round(intercept, 4) if intercept is not None else None,
        "r_squared": round(r_sq, 4) if r_sq is not None else None,
        "residual_rms_ppm": round(res_rms, 4) if res_rms is not None else None,
        "t_span_s": round(max(ts) - min(ts), 4),
        "algo_version": CANONICAL_ALGO_VERSION,
    }


PROVENANCE_CATALOG: Dict[str, Dict[str, Any]] = {
    "dist_firmware_m": {
        "category": "FIRMWARE_COMPUTED",
        "badge": "Calculado no firmware",
        "label": "Distância publicada pelo módulo (dist_m / dist_mm)",
        "inputs": "Timestamps DW3000 de 40 bits (t1..t4 em SS-TWR+CFO ou t1..t6 em DS-TWR; t_RX,G - t_TX em OWR)",
        "formula": "d_fw = c · ToF_fw (convertido de mm inteiros para m: dist_mm / 1000.0)",
        "units": "m (metros, resolução 1 mm)",
        "validity_criteria": "0 < d_fw <= 100 m e status == 0 (OK)",
        "limitations": "Inclui atraso de antena configurado no firmware e eventual filtro EMA no nó.",
    },
    "raw_tof_ds_m": {
        "category": "APP_CALCULATED",
        "badge": "Calculado pela aplicação",
        "label": "Distância DS-TWR recalculada na aplicação a partir de t1..t6",
        "inputs": "Timestamps brutos DW3000 t1, t2, t3, t4, t5, t6 (ticks de 15.65 ps, 40 bits)",
        "formula": "ToF = (R_a·R_b - D_a·D_b) / (R_a + R_b + D_a + D_b) · DWT_TIME_UNITS ; d = c · ToF",
        "units": "m (metros)",
        "validity_criteria": "t1..t6 > 0, R_a >= D_a > 0, R_b > 0, D_b > 0, 0 <= d <= 100 m",
        "limitations": "Disponível apenas nos registos binários de 54B onde t1..t6 são gravados; na UART texto t1..t6 não são transmitidos.",
    },
    "raw_tof_ss_m": {
        "category": "APP_CALCULATED",
        "badge": "Calculado pela aplicação",
        "label": "Distância SS-TWR bruta recalculada na aplicação a partir de t1..t4",
        "inputs": "Timestamps brutos DW3000 t1, t2, t3, t4 (ticks de 15.65 ps, 40 bits)",
        "formula": "ToF = ((t4 - t1) - (t3 - t2)) / 2 · DWT_TIME_UNITS ; d = c · ToF",
        "units": "m (metros)",
        "validity_criteria": "t1..t4 > 0, R_a >= D_a > 0, 0 <= d <= 100 m",
        "limitations": "Sem compensação CFO na fórmula bruta simples; sensível ao desvio de relógio durante D_a.",
    },
    "clock_drift_ppm": {
        "category": "FIRMWARE_MODEL",
        "badge": "Estimativa de modelo (Firmware)",
        "label": "Deriva relativa do oscilador (Clock Drift / CFO)",
        "inputs": "Registo Carrier Integrator do DW3000 ou razão de intervalos Δt_remoto / Δt_local",
        "formula": "drift_ppm = (α - 1) · 10^6 ppm (convenção: >0 indica relógio remoto mais rápido)",
        "units": "ppm (partes por milhão, 1 ppm = 1 µs/s)",
        "validity_criteria": "|drift_ppm| <= 100 ppm (especificação cristal UWB IEEE 802.15.4z)",
        "limitations": "Na estrutura binária de 54B é quantizado em centésimos de ppm (int16); em TDoA UART representa a inclinação α do modelo afim.",
    },
    "sync_model_tg": {
        "category": "FIRMWARE_MODEL",
        "badge": "Estimativa de modelo",
        "label": "Tempo Global Sincronizado (TG = α · TL + β)",
        "inputs": "Tempo local do módulo (TL em µs) e parâmetros α (escala) e β (offset) ancorados na última ronda TWR",
        "formula": "TG(TL) = T_master_ref + α · (TL - T_local_ref)",
        "units": "µs (microssegundos)",
        "validity_criteria": "sync_valid == 1 e idade da âncora < SYNC_STALE_US",
        "limitations": "Enviado explicitamente na telemetria UART TDoA; não armazenado no registo binário de 54B (que guarda apenas timestamp_ms local).",
    },
    "descriptive_stats": {
        "category": "APP_CALCULATED",
        "badge": "Calculado pela aplicação",
        "label": "Estatísticas Descritivas e Dispersão (Média, Mediana, s, MAD, IQR, Percentis)",
        "inputs": "Amostras válidas de distância ou tempo filtradas por módulo/ligação/intervalo",
        "formula": "s = sqrt(Σ(x_i - x̄)^2 / (N - 1)) [Bessel ddof=1]; MAD = median(|x_i - median(X)|); σ_MAD = 1.4826 · MAD",
        "units": "m (média, mediana, min, max) e mm (s, MAD, IQR, Bias, RMSE)",
        "validity_criteria": "Amostras finitas com status == 0; Bias e RMSE exigem Ground-Truth explícito.",
        "limitations": "Sem distância de referência (Ground-Truth) configurada pelo utilizador, avalia apenas precisão/estabilidade (dispersão), nunca exatidão absoluta.",
    },
    "frequency_5_layers": {
        "category": "APP_CALCULATED",
        "badge": "Calculado pela aplicação",
        "label": "Decomposição Canónica das 5 Frequências do Sistema",
        "inputs": "Contadores de sequência (seq), timestamps do módulo (t_local_us / timestamp_ms) e timestamps de receção no PC (t_rx_host)",
        "formula": "f_RF = Δseq_unwrapped / Δt_módulo ; f_UART = (N - 1) / Δt_módulo ; f_Host = (N - 1) / Δt_host_pc",
        "units": "Hz (1/s)",
        "validity_criteria": "N >= 2 amostras válidas com Δt > 1 µs (sem fallbacks nominais)",
        "limitations": "Em ensaios binários históricos (flash RAM), f_Host e f_UI não se aplicam porque os dados foram gravados localmente no módulo.",
    },
}

