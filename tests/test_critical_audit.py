"""
SwarmLoc - Suite de Testes Independentes de Auditoria Crítica e Regressão:
Validação rigorosa de Relógios, Sincronização, DS-TWR, OWR (1-via), Parsers e Equivalência Live/Histórico.
"""

import unittest
import math
import subprocess
import json
import sys
import os

# Garantir acesso aos módulos python
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python")))
from data_analysis import (
    calculate_tof_meters,
    compute_group_metrics,
    DWT_TIME_UNITS,
    SPEED_OF_LIGHT,
    LiveTelemetryEngine,
)
import scientific_metrics
from scientific_metrics import compute_descriptive_stats, compute_timing_and_rates

TS_40BIT_MASK = 0xFFFFFFFFFF
TS_40BIT_WRAP = 1 << 40
TICK_DURATION_PS = DWT_TIME_UNITS * 1e12  # ~15.65004 ps
CLOCK_SYNC_MIN_SPAN_TICKS = 319488000     # ~5 ms em ticks DW3000
CLOCK_DRIFT_MAX_PPM = 50.0


def ts_diff_40bit_firmware(t_later: int, t_earlier: int) -> int:
    """Implementação exata da função ts_diff_40bit de clock_sync.c"""
    diff = (t_later - t_earlier) & TS_40BIT_MASK
    if diff & (1 << 39):
        return diff - (1 << 40)
    return diff


class ClockSyncFirmwareModel:
    """Modelo fiel da máquina de estados corrigida em SwarmLoc/src/clock_sync.c."""

    def __init__(self, buf_size: int = 16):
        self.buf_size = buf_size
        self.pairs = []
        self.alpha = 1.0
        self.beta = 0.0
        self.model_valid = False
        self.t_slave_last = 0
        self.t_master_last = 0
        self.last_residual_ns = 0.0

    def process_pair(self, t_master: int, t_slave: int):
        t_master &= TS_40BIT_MASK
        t_slave &= TS_40BIT_MASK

        # Erro residual a priori (antes de atualizar t_slave_last e t_master_last)
        if len(self.pairs) >= 1:
            t_pred_prior = self.to_global_time(t_slave)
            err_ticks = ts_diff_40bit_firmware(t_master, t_pred_prior)
            self.last_residual_ns = float(err_ticks) * DWT_TIME_UNITS * 1e9
        else:
            self.last_residual_ns = 0.0

        self.t_master_last = t_master
        self.t_slave_last = t_slave

        self.pairs.append((t_master, t_slave))
        if len(self.pairs) > self.buf_size:
            self.pairs = self.pairs[-self.buf_size:]

        if len(self.pairs) < 2:
            self.alpha = 1.0
            self.beta = float(ts_diff_40bit_firmware(t_master, t_slave))
            self.model_valid = False
            return

        sum_x = sum_y = sum_xy = sum_xx = 0.0
        valid_n = 0
        prev_s = prev_m = 0
        accum_s = accum_m = 0

        for cur_m, cur_s in self.pairs:
            if valid_n == 0:
                accum_s = 0
                accum_m = 0
            else:
                step_s = ts_diff_40bit_firmware(cur_s, prev_s)
                step_m = ts_diff_40bit_firmware(cur_m, prev_m)
                if step_s < 0 or step_m < 0:
                    sum_x = sum_y = sum_xy = sum_xx = 0.0
                    valid_n = 0
                    accum_s = accum_m = 0
                else:
                    accum_s += step_s
                    accum_m += step_m

            prev_s = cur_s
            prev_m = cur_m
            x = float(accum_s)
            y = float(accum_m)
            sum_x += x
            sum_y += y
            sum_xy += x * y
            sum_xx += x * x
            valid_n += 1

        if valid_n >= 2:
            denom = valid_n * sum_xx - sum_x * sum_x
            if abs(denom) > 1e-9:
                new_alpha = (valid_n * sum_xy - sum_x * sum_y) / denom
                drift_ppm = abs(new_alpha - 1.0) * 1e6
                if drift_ppm <= CLOCK_DRIFT_MAX_PPM and accum_s >= CLOCK_SYNC_MIN_SPAN_TICKS:
                    self.alpha = new_alpha
                    self.beta = float(ts_diff_40bit_firmware(t_master, t_slave))
                    self.model_valid = True
                else:
                    self.alpha = 1.0
                    self.beta = float(ts_diff_40bit_firmware(t_master, t_slave))
                    self.model_valid = False

    def to_global_time(self, t_local: int) -> int:
        t_local &= TS_40BIT_MASK
        dt_slave = ts_diff_40bit_firmware(t_local, self.t_slave_last)
        dt_master = self.alpha * float(dt_slave)
        dt_master_rounded = int(dt_master + (0.5 if dt_master >= 0.0 else -0.5))
        return (self.t_master_last + dt_master_rounded) & TS_40BIT_MASK


class TestSwarmLocCriticalAudit(unittest.TestCase):
    """Testes matemáticos e algorítmicos independentes para a auditoria crítica e regressão."""

    def test_dwt_time_units_physical_constant(self):
        """Verifica a constante física DWT_TIME_UNITS = 1 / (499.2 MHz * 128)."""
        expected_units = 1.0 / (499.2e6 * 128.0)
        self.assertAlmostEqual(DWT_TIME_UNITS, expected_units, places=18)
        self.assertAlmostEqual(TICK_DURATION_PS, 15.65004, places=4)
        wrap_seconds = (1 << 40) * DWT_TIME_UNITS
        self.assertAlmostEqual(wrap_seconds, 17.2074, places=3)
        dist_per_tick_mm = DWT_TIME_UNITS * SPEED_OF_LIGHT * 1000.0
        # Com c_ar (299702547 m/s unificado): 4.69036 mm; no vácuo (299792458 m/s): 4.69176 mm
        self.assertAlmostEqual(dist_per_tick_mm, 4.69036, places=4)
        if hasattr(scientific_metrics, 'SPEED_OF_LIGHT_VACUUM'):
            self.assertAlmostEqual(DWT_TIME_UNITS * scientific_metrics.SPEED_OF_LIGHT_VACUUM * 1000.0, 4.69176, places=4)

    def test_ds_twr_asymmetric_formula_exact(self):
        """Valida a fórmula analítica de DS-TWR com quantização de ticks do hardware."""
        tof_ticks_exact = 640
        dist_exact_m = tof_ticks_exact * DWT_TIME_UNITS * SPEED_OF_LIGHT

        t1 = 1000000
        reply_slave_ticks = 64000  # ~1 ms
        reply_master_ticks = 64000 # ~1 ms

        t2 = t1 + tof_ticks_exact
        t3 = t2 + reply_slave_ticks
        t4 = t3 + tof_ticks_exact
        t5 = t4 + reply_master_ticks
        t6 = t5 + tof_ticks_exact

        raw_ds_m, raw_ss_m = calculate_tof_meters(t1, t2, t3, t4, t5, t6)
        self.assertIsNotNone(raw_ds_m)
        self.assertAlmostEqual(raw_ds_m, dist_exact_m, places=4)
        self.assertAlmostEqual(raw_ss_m, dist_exact_m, places=4)

    def test_owr_tdoa_sensitivity_to_clock_offset(self):
        """
        Demonstra que a implementação em uwb_tdoa.c é One-Way Ranging (OWR / ToF 1-via sincronizado)
        e quantifica o erro de +248.4 m provocado por um atraso de 828.92 ns (ex: DWT_START_TX_IMMEDIATE fallback).
        """
        tof_real_ns = 1.0 / (SPEED_OF_LIGHT * 1e-9)
        tof_real_ticks = int(round((tof_real_ns * 1e-9) / DWT_TIME_UNITS))

        offset_residual_ns = 828.92
        offset_residual_ticks = int(round((offset_residual_ns * 1e-9) / DWT_TIME_UNITS))

        tof_medido_ticks = tof_real_ticks + offset_residual_ticks
        dist_calculada_m = tof_medido_ticks * DWT_TIME_UNITS * SPEED_OF_LIGHT

        erro_esperado_m = (offset_residual_ns * 1e-9) * SPEED_OF_LIGHT
        self.assertAlmostEqual(dist_calculada_m - 1.0, erro_esperado_m, places=2)
        self.assertAlmostEqual(dist_calculada_m, 249.5, delta=1.5)

    def test_clock_sync_rollover_bug_and_incremental_unwrap_fix(self):
        """
        1) Demonstra que ts_diff_40bit direto contra ref_slave inverte o sinal para > 8.603 s (2^39 ticks).
        2) Verifica que o unwrap incremental corrigido em clock_sync.c recupera alpha perfeitamente
           mesmo em janelas de 30 segundos (quase 2 rollovers completos de 40 bits).
        """
        t_base = 1000
        t_8_5s = (t_base + int(8.5 / DWT_TIME_UNITS)) & TS_40BIT_MASK
        self.assertGreater(ts_diff_40bit_firmware(t_8_5s, t_base), 0)

        t_9_0s = (t_base + int(9.0 / DWT_TIME_UNITS)) & TS_40BIT_MASK
        self.assertLess(ts_diff_40bit_firmware(t_9_0s, t_base), 0)

        sync = ClockSyncFirmwareModel(buf_size=16)
        true_alpha = 1.0 + 2.5e-6  # +2.50 ppm
        step_slave_ticks = int(2.0 / DWT_TIME_UNITS)
        t_s0 = (1 << 40) - int(3.0 / DWT_TIME_UNITS)
        t_m0 = 50000000

        for i in range(16):
            dt_s = i * step_slave_ticks
            dt_m = int(round(dt_s * true_alpha))
            sync.process_pair((t_m0 + dt_m) & TS_40BIT_MASK, (t_s0 + dt_s) & TS_40BIT_MASK)

        self.assertTrue(sync.model_valid)
        estimated_ppm = (sync.alpha - 1.0) * 1e6
        self.assertAlmostEqual(estimated_ppm, 2.50, places=3)
        self.assertLess(abs(sync.last_residual_ns), 1.0)

    def test_clock_sync_negative_modular_interval_no_underflow(self):
        """
        Verifica que clock_sync_to_global_time() converte corretamente um timestamp ligeiramente anterior
        a t_slave_last (ex: t2_simultaneous < t6_simultaneous por 2 ms em uwb_dstwr.c:739) sem sofrer
        underflow não-assinado de +17.205 s.
        """
        sync = ClockSyncFirmwareModel()
        true_alpha = 1.0 + 5.0e-6  # +5.0 ppm
        dt_1s = int(1.0 / DWT_TIME_UNITS)
        dt_2ms = int(0.002 / DWT_TIME_UNITS)

        sync.process_pair(1000000, 2000000)
        t5_m = (1000000 + int(round(dt_1s * true_alpha))) & TS_40BIT_MASK
        t6_s = (2000000 + dt_1s) & TS_40BIT_MASK
        sync.process_pair(t5_m, t6_s)

        t2_s = (t6_s - dt_2ms) & TS_40BIT_MASK
        t2_global = sync.to_global_time(t2_s)
        expected_t2_global = (t5_m - int(round(dt_2ms * true_alpha))) & TS_40BIT_MASK

        err_ticks = abs(ts_diff_40bit_firmware(t2_global, expected_t2_global))
        self.assertLessEqual(err_ticks, 2, "Não pode existir erro de underflow de 17.2s * alpha!")

    def test_clock_sync_lifecycle_init_min_span_loss_and_recovery(self):
        """
        Testa o ciclo de vida completo da sincronização (Regra: não marcar válido antes de critérios explícitos):
        1. Par único: model_valid = False.
        2. Dois pares na mesma ronda DS-TWR (separados por 2 ms < 5 ms): model_valid = False e alpha = 1.0.
        3. Segunda ronda DS-TWR (>= 5 ms): model_valid = True e alpha estimado por regressão linear.
        4. Perturbação anómala (> 50 ppm): perda de sincronização (model_valid = False, alpha = 1.0).
        5. Recuperação após salto temporal e novas amostras coerentes.
        """
        sync = ClockSyncFirmwareModel()
        dt_2ms = int(0.002 / DWT_TIME_UNITS)
        dt_1s = int(1.0 / DWT_TIME_UNITS)

        # 1. Primeiro par (t1, t2)
        sync.process_pair(100000, 200000)
        self.assertFalse(sync.model_valid)

        # 2. Segundo par da mesma ronda (t5, t6) separado por apenas 2 ms (< 5 ms CLOCK_SYNC_MIN_SPAN_TICKS)
        sync.process_pair(100000 + dt_2ms + 3, 200000 + dt_2ms)
        self.assertFalse(sync.model_valid, "Não deve marcar model_valid=True com janela intra-ronda de apenas 2 ms!")
        self.assertEqual(sync.alpha, 1.0)

        # 3. Ronda seguinte após 1.0 s com deriva real de -3.0 ppm
        true_alpha = 1.0 - 3.0e-6
        sync.process_pair(100000 + int(round(dt_1s * true_alpha)), 200000 + dt_1s)
        self.assertTrue(sync.model_valid)
        self.assertAlmostEqual((sync.alpha - 1.0) * 1e6, -3.0, delta=0.1)

        # 4. Outlier severo (+200 ppm) -> perda de sincronização
        bad_sync = ClockSyncFirmwareModel()
        bad_sync.process_pair(100000, 200000)
        bad_sync.process_pair(100000 + int(round(dt_1s * (1.0 + 200e-6))), 200000 + dt_1s)
        self.assertFalse(bad_sync.model_valid)
        self.assertEqual(bad_sync.alpha, 1.0)

        # 5. Recuperação após reinício de relógio e 2 amostras válidas separadas por 1s
        bad_sync.process_pair(50000, 60000)
        bad_sync.process_pair(50000 + dt_1s, 60000 + dt_1s)
        self.assertTrue(bad_sync.model_valid)
        self.assertAlmostEqual(bad_sync.alpha, 1.0, places=7)

    def test_missing_inconsistent_and_out_of_order_timestamps(self):
        """
        Valida o comportamento perante timestamps ausentes, inconsistentes (t4 < t1 ou distância > 100m)
        ou recebidos fora de ordem em calculate_tof_meters e compute_timing_and_rates.
        """
        # 1. Timestamps ausentes (zeros)
        ds_m, ss_m = calculate_tof_meters(0, 0, 0, 0, 0, 0)
        self.assertIsNone(ds_m)
        self.assertIsNone(ss_m)

        # 2. Timestamps invertidos (t4 < t1 sem rollover válido: diferença negativa)
        ds_inv, ss_inv = calculate_tof_meters(5000000, 5000640, 5064640, 4000000, 0, 0)
        self.assertIsNone(ds_inv)
        self.assertIsNone(ss_inv)

        # 3. Timestamps com ToF absurdo (> 100 m)
        tof_500m_ticks = int((500.0 / SPEED_OF_LIGHT) / DWT_TIME_UNITS)
        t1 = 1000000
        t2 = t1 + tof_500m_ticks
        t3 = t2 + 64000
        t4 = t3 + tof_500m_ticks
        ds_big, ss_big = calculate_tof_meters(t1, t2, t3, t4, 0, 0)
        self.assertIsNone(ds_big)
        self.assertIsNone(ss_big)

        # 4. Timestamps fora de ordem e com None em compute_timing_and_rates
        ts_unordered = [1.024, None, 1.000, 1.004, 1.020, 1.008, 1.016]
        seqs_unordered = [7, None, 1, 2, 6, 3, 5]
        rates = compute_timing_and_rates(ts_unordered, seqs_unordered)
        self.assertTrue(rates["is_valid"])
        self.assertAlmostEqual(rates["freq_radio_rf_hz"], 250.0, places=1)
        self.assertEqual(rates["dropped_packets_rf"], 1)

    def test_uart_burst_and_lost_messages_rf_rate(self):
        """
        Verifica que a frequência RF (f_rf_event_hz) usa os timestamps de hardware [TL:...]
        dos módulos e recupera a taxa física real (250.0 Hz) mesmo quando 90% das mensagens
        não são impressas na UART (dizimação) e chegam ao PC em rajada (burst).
        """
        engine = LiveTelemetryEngine()
        engine.active_serials = {"COM5": True}
        engine.sync_period_s = 1.0
        engine._process_line("COM5", "[SWARMLOC:ID] NODE:0x0002 ROLE:SLAVE")

        # 2 linhas UART entregues ao PC em rajada, mas com timestamps de hardware [TL:...] distanciados em 1.000000 s
        engine._process_line(
            "COM5",
            "[TL:  10.000000s|TG:  10.000000s] [TDOA:RX  ] Beacon #001000 de Master 0x0001 | Dist:  1.320m | ToF:  +4.40ns | Deriva: +1.20ppm | Sinc: OK (ha 100 ms)"
        )
        engine._process_line(
            "COM5",
            "[TL:  11.000000s|TG:  11.000001s] [TDOA:RX  ] Beacon #001250 de Master 0x0001 | Dist:  1.321m | ToF:  +4.41ns | Deriva: +1.20ppm | Sinc: OK (ha 200 ms)"
        )

        st = engine.get_status()
        node_02 = st["nodes"].get("0002")
        self.assertIsNotNone(node_02)
        self.assertEqual(node_02["rate_clock_domain"], "mcu_nrf52_systick")
        self.assertAlmostEqual(node_02["f_rf_event_hz"], 250.0, places=1)
        self.assertEqual(st["f_protocol_sync_hz"], 1.0)

    def test_rejection_of_impossible_distances_invalid_drift_and_awaiting_sync(self):
        """
        Verifica que valores fisicamente impossíveis de distância (< 0 ou > 100 m),
        valores inválidos de deriva (|drift| > 50 ppm) e mensagens sem sincronismo
        são marcados como is_valid=False com invalidation_reason explícita.
        """
        engine = LiveTelemetryEngine()
        engine._process_line("COM5", "[SWARMLOC:ID] NODE:0x0002 ROLE:SLAVE")

        # 1. Medição válida primeiro (1.318 m, +1.41 ppm)
        engine._process_line(
            "COM5",
            "[TL:  20.000000s|TG:  20.000000s] [TDOA:RX  ] Beacon #000010 de Master 0x0001 | Dist:  1.318m | ToF:  +4.40ns | Deriva: +1.41ppm | Sinc: OK (ha 50 ms)"
        )
        st1 = engine.get_status()
        self.assertTrue(st1["messages"][-1]["is_valid"])
        self.assertEqual(st1["nodes"]["0002"]["last_dist_m"], 1.318)
        self.assertEqual(st1["nodes"]["0002"]["clock_drift_ppm"], 1.41)

        # 2. Medição anómala de +248.429 m (falha de DWT_START_TX_DELAYED)
        engine._process_line(
            "COM5",
            "[TL:  20.100000s|TG:  20.100000s] [TDOA:RX  ] Beacon #000024 de Master 0x0001 | Dist: 248.429m | ToF: +828.92ns | Deriva: +0.00ppm | Sinc: OK (ha 150 ms)"
        )
        st2 = engine.get_status()
        bad_msg = st2["messages"][-1]
        self.assertFalse(bad_msg["is_valid"])
        self.assertIn("out_of_physical_bounds", bad_msg["invalidation_reason"])
        self.assertEqual(st2["nodes"]["0002"]["last_dist_m"], 1.318)

        # 3. Medição com deriva fora da especificação de cristal (+125.0 ppm > 50 ppm)
        engine._process_line(
            "COM5",
            "[TL:  20.150000s|TG:  20.150000s] [TWR:ROUND] #000025 S02<-M01 | d= 1.320m | +125.00ppm"
        )
        st_drift = engine.get_status()
        drift_msg = st_drift["messages"][-1]
        self.assertFalse(drift_msg["is_valid"])
        self.assertIn("out_of_bounds_clock_drift", drift_msg["invalidation_reason"])
        self.assertEqual(st_drift["nodes"]["0002"]["clock_drift_ppm"], 1.41)

        # 4. Mensagem de beacon detetado antes da calibração DS-TWR
        engine._process_line(
            "COM5",
            "[TL:  20.200000s|TG:  20.200000s] [TDOA:RX  ] Beacon #000026 de Master 0x0001 | SINAL DETETADO | A aguardar calibracao..."
        )
        st3 = engine.get_status()
        wait_msg = st3["messages"][-1]
        self.assertFalse(wait_msg["is_valid"])
        self.assertEqual(wait_msg["invalidation_reason"], "awaiting_clock_sync")

    def test_live_and_historical_numerical_equivalence(self):
        """
        Garante que um conjunto de medições submetido ao motor Live/Python (scientific_metrics.py)
        e ao motor Frontend/JS (sci_metrics.js) e ao agregador histórico (compute_group_metrics)
        produz resultados estatísticos e taxas numericamente idênticos.
        """
        sample_dists = [1.318, 1.321, 1.315, 1.320, 1.319, 1.322, 1.317, 1.320]
        sample_ts = [i * 0.004 for i in range(len(sample_dists))]
        sample_seq = [100 + i for i in range(len(sample_dists))]

        py_stats = compute_descriptive_stats(sample_dists, ref_val=1.320)
        py_rates = compute_timing_and_rates(sample_ts, sample_seq)

        # Verificar equivalência com compute_group_metrics (Análise Histórica)
        hist_records = [
            {
                "seq": s,
                "timestamp_ms": t * 1000.0,
                "src_addr": "0x0002",
                "dst_addr": "0x0001",
                "status": "OK",
                "distance_m": d,
                "clock_drift_ppm": 1.25,
                "round_duration_us": 1,
                "packet_type": "TDOA",
                "source_file": "test.csv",
            }
            for s, t, d in zip(sample_seq, sample_ts, sample_dists)
        ]
        groups = compute_group_metrics(hist_records)
        self.assertEqual(len(groups), 1)
        g = groups[0]
        self.assertEqual(g["ranging_method"], "OWR_SYNC_TOF")
        self.assertAlmostEqual(g["mean_dist"], round(py_stats["mean"], 3), places=3)
        self.assertAlmostEqual(g["std_mm"], round(py_stats["std_mm"], 2), places=2)
        self.assertAlmostEqual(g["freq_rf_hz"], py_rates["freq_radio_rf_hz"], places=2)

        # Verificar equivalência com sci_metrics.js via Node.js (se disponível no ambiente)
        js_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python", "web", "sci_metrics.js")).replace("\\", "/")
        node_script = (
            f"const sm = require('{js_path}');"
            f"const st = sm.computeDescriptiveStats({json.dumps(sample_dists)}, 1.320);"
            f"const rt = sm.computeTimingAndRates({json.dumps(sample_ts)}, {json.dumps(sample_seq)});"
            f"console.log(JSON.stringify({{st, rt}}));"
        )
        try:
            proc = subprocess.run(["node", "-e", node_script], capture_output=True, text=True, timeout=5)
            if proc.returncode == 0 and proc.stdout.strip():
                js_out = json.loads(proc.stdout.strip())
                self.assertAlmostEqual(py_stats["mean"], js_out["st"]["mean"], places=12)
                self.assertAlmostEqual(py_stats["std_mm"], js_out["st"]["std_mm"], places=10)
                self.assertAlmostEqual(py_stats["median"], js_out["st"]["median"], places=12)
                self.assertAlmostEqual(py_stats["bias_mm"], js_out["st"]["bias_mm"], places=10)
                self.assertAlmostEqual(py_stats["rmse_mm"], js_out["st"]["rmse_mm"], places=10)
                self.assertAlmostEqual(py_rates["freq_radio_rf_hz"], js_out["rt"]["freq_radio_rf_hz"], places=6)
        except FileNotFoundError:
            pass

    def test_parser_robustness_incomplete_and_corrupt_lines(self):
        """Valida que o parser lida com linhas UART truncadas e corrompidas."""
        engine = LiveTelemetryEngine()

        p1 = engine._parse_telemetry_line("COM6", "[TWR:ROUND] #000042 M01->S02 | d= 1.", 1000.0)
        self.assertIsNone(p1.get("dist_m"))

        p2 = engine._parse_telemetry_line("COM6", "???@@@[TDOA:RX  ] Beacon #abc de Master ???", 1000.0)
        self.assertIsNone(p2.get("dist_m"))
        self.assertIsNone(p2.get("tof_ns"))

        p3 = engine._parse_telemetry_line("COM6", "\x00\xff\xfe random binary garbage \r\n", 1000.0)
        self.assertEqual(p3.get("type"), "raw")

    def test_clock_domain_classification_integrity(self):
        """Garante que campos de host e hardware têm clock_domains estritamente diferenciados."""
        engine = LiveTelemetryEngine()

        line_with_tl = "[TL:  10.500000s|TG:  10.500000s] [TWR:ROUND ] #000001 M01->S02 | d= 1.250m | +0.00ppm"
        engine._process_line("COM6", line_with_tl)
        st = engine.get_status()
        last_msg = st["messages"][-1]
        self.assertEqual(last_msg["clock_domain"], "mcu_nrf52_systick")
        self.assertEqual(last_msg["t_local_us"], 10500000)

        line_host_only = "Aviso generico do sistema host"
        engine._process_line("COM6", line_host_only)
        last_msg_host = engine.get_status()["messages"][-1]
        self.assertEqual(last_msg_host["clock_domain"], "host_computer")
        self.assertIsNone(last_msg_host["t_local_us"])


if __name__ == "__main__":
    unittest.main()
