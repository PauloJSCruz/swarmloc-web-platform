# -*- coding: utf-8 -*-
"""
test_frequency_investigation.py - Testes Automatizados para a Fase II
====================================================================
Validação rigorosa dos 10 cenários de frequência, integridade de pacotes,
decimação UART, rollovers de sequência e eliminação de fallbacks nominais.
"""

import os
import sys
import unittest

PYTHON_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python"))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

from scientific_metrics import (
    compute_timing_and_rates,
    unwrap_sequence_numbers,
    filter_valid_numbers
)
from data_analysis import LiveTelemetryEngine


class TestFrequencyInvestigation(unittest.TestCase):

    def test_scenario_1_continuous_stream_250hz(self):
        """1. Fluxo contínuo a 250 Hz (intervalos ~4 ms)."""
        dt = 0.004  # 4 ms -> 250 Hz
        timestamps = [i * dt for i in range(251)]  # 0.0 a 1.0s (251 amostras)
        seqs = list(range(1000, 1251))

        res = compute_timing_and_rates(timestamps, seqs, f_phy_configured_hz=250.0)
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["status"], "ok")
        self.assertAlmostEqual(res["f_uart_observed_hz"], 250.0, places=1)
        self.assertAlmostEqual(res["f_tx_observed_hz"], 250.0, places=1)
        self.assertAlmostEqual(res["dt_mean_ms"], 4.0, places=1)
        self.assertAlmostEqual(res["jitter_ms"], 0.0, places=1)
        self.assertEqual(res["dropped_packets_rf"], 0)

    def test_scenario_2_telemetry_10hz_recovering_250hz_rf(self):
        """2. Telemetria dizimada a 10 Hz com saltos de seq de 25 (recuperando 250 Hz de rádio)."""
        dt_uart = 0.100  # 100 ms -> 10 Hz de UART
        timestamps = [i * dt_uart for i in range(11)]  # 1.0 s span
        # Em 100 ms a 250 Hz são emitidos 25 pacotes RF por intervalo
        seqs = [i * 25 for i in range(11)]

        res = compute_timing_and_rates(timestamps, seqs, f_phy_configured_hz=250.0)
        self.assertTrue(res["is_valid"])
        self.assertAlmostEqual(res["f_uart_observed_hz"], 10.0, places=1)
        self.assertAlmostEqual(res["f_tx_observed_hz"], 250.0, places=1)
        self.assertEqual(res["f_phy_configured_hz"], 250.0)
        self.assertEqual(res["dropped_packets_rf"], 240)  # 240 pacotes não transmitidos por UART

    def test_scenario_3_telemetry_packet_drops(self):
        """3. Queda de pacotes na telemetria (perdas detetadas por gaps em seq)."""
        # Sequência normal 1 a 10, com perdas nos pacotes 4, 5 e 8
        seqs = [1, 2, 3, 6, 7, 9, 10]
        timestamps = [0.0, 0.1, 0.2, 0.5, 0.6, 0.8, 0.9]

        res = compute_timing_and_rates(timestamps, seqs)
        self.assertTrue(res["is_valid"])
        # Gap de 3 para 6 = 2 perdidos; gap de 7 para 9 = 1 perdido -> total 3
        self.assertEqual(res["dropped_packets_rf"], 3)
        self.assertGreater(res["packet_loss_rate"], 0.0)

    def test_scenario_4_anomalous_sequence_jumps(self):
        """4. Saltos de sequência anómalos (salto gigante ou decrescente sem rollover)."""
        # Salto anómalo decrescente: 50 -> 20 sem rollover
        seqs = [48, 49, 50, 20, 21, 22]
        timestamps = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]

        res = compute_timing_and_rates(timestamps, seqs)
        self.assertTrue(res["is_valid"])
        self.assertGreater(len(res["anomalies"]), 0)
        self.assertTrue(any("decrescente" in a.lower() for a in res["anomalies"]))

    def test_scenario_5_counter_rollover(self):
        """5. Rollover de contadores de sequência (16-bit e 32-bit)."""
        # 16-bit rollover: 65530 -> 65535 -> 4 -> 14 (span = 0.080 s)
        seqs_16 = [65530, 65535, 4, 14]
        ts_16 = [0.000, 0.020, 0.040, 0.080]
        res_16 = compute_timing_and_rates(ts_16, seqs_16)
        # Total emitido: (65535 - 65530) + (4 + 65536 - 65535) + (14 - 4) = 5 + 5 + 10 = 20
        # Taxa RF: 20 / 0.080 = 250.0 Hz
        self.assertAlmostEqual(res_16["f_tx_observed_hz"], 250.0, places=1)

        # 32-bit rollover
        seqs_32 = [4294967290, 4294967295, 5]
        unwrap_32 = unwrap_sequence_numbers(seqs_32)
        # (4294967295 - 4294967290) + (5 + 4294967296 - 4294967295) = 5 + 6 = 11
        self.assertEqual(unwrap_32["total_emitted"], 11)

    def test_scenario_6_duplicate_missing_unordered_timestamps(self):
        """6. Timestamps duplicados, nulos ou fora de ordem."""
        # Timestamps fora de ordem e com nulos e duplicados
        raw_ts = [0.5, None, 0.1, 0.3, 0.3, 0.7]
        raw_seq = [5, None, 1, 3, 3, 7]

        res = compute_timing_and_rates(raw_ts, raw_seq)
        self.assertTrue(res["is_valid"])
        self.assertEqual(res["n"], 5)
        # O ordenamento cronológico garante que span é 0.7 - 0.1 = 0.6
        self.assertAlmostEqual(res["span_s"], 0.6, places=2)
        # Deteta a duplicata no seq
        self.assertTrue(any("duplicado" in a.lower() for a in res["anomalies"]))

    def test_scenario_7_connected_module_without_transmission(self):
        """7. Módulo conectado mas sem transmissão de dados."""
        engine = LiveTelemetryEngine()
        engine.active_serials["COM5"] = True  # Simula porta aberta conectada
        engine.node_states["0002"]["port"] = "COM5"
        # Nó existe no registry mas não recebeu pacotes (packet_count == 0)
        status = engine.get_status()
        self.assertTrue(status["is_connected"])
        node = status["nodes"]["0002"]
        self.assertIsNotNone(node)
        self.assertEqual(node["packet_count"], 0)
        # Não pode inventar 250.0 Hz quando não há pacotes!
        self.assertIsNone(node["f_uart_observed_hz"])
        self.assertIsNone(node["f_tx_observed_hz"])

    def test_scenario_8_offline_module(self):
        """8. Módulo desconectado (offline)."""
        engine = LiveTelemetryEngine()
        # Sem portas ativas / ativas desconectadas
        status = engine.get_status()
        self.assertFalse(status["is_connected"])
        # Todos os nós em nodes devem reportar offline e taxas nulas
        for nid, node in status["nodes"].items():
            self.assertFalse(node["is_online"])
            self.assertIsNone(node["f_uart_observed_hz"])
            self.assertIsNone(node["f_tx_observed_hz"])

    def test_scenario_9_configured_250hz_with_lower_actual_rate(self):
        """9. Módulo com taxa nominal de 250 Hz configurada mas taxa real de rádio inferior (150 Hz)."""
        # 150 Hz -> intervalo 1 / 150 = ~0.006667s
        dt = 1.0 / 150.0
        timestamps = [i * dt for i in range(151)]  # 1.0 s span
        seqs = list(range(100, 251))  # 150 incrementos

        res = compute_timing_and_rates(timestamps, seqs, f_phy_configured_hz=250.0)
        self.assertTrue(res["is_valid"])
        # A taxa nominal continua 250.0
        self.assertEqual(res["f_phy_configured_hz"], 250.0)
        # A taxa observada DEVE ser 150.0, SEM fallback ou forçamento para 250.0
        self.assertAlmostEqual(res["f_tx_observed_hz"], 150.0, places=1)
        self.assertAlmostEqual(res["f_uart_observed_hz"], 150.0, places=1)

    def test_scenario_10_insufficient_data(self):
        """10. Dados insuficientes (< 2 amostras), retornando None/insufficient_data sem divisão por zero."""
        # 0 amostras
        res_0 = compute_timing_and_rates([])
        self.assertFalse(res_0["is_valid"])
        self.assertEqual(res_0["status"], "insufficient_data")
        self.assertIsNone(res_0["f_uart_observed_hz"])
        self.assertIsNone(res_0["f_tx_observed_hz"])
        self.assertIsNone(res_0["dt_mean_ms"])

        # 1 amostra
        res_1 = compute_timing_and_rates([12.34], [101])
        self.assertFalse(res_1["is_valid"])
        self.assertEqual(res_1["status"], "insufficient_data")
        self.assertIsNone(res_1["f_uart_observed_hz"])
        self.assertIsNone(res_1["f_tx_observed_hz"])
        self.assertIsNone(res_1["jitter_ms"])


if __name__ == "__main__":
    unittest.main()
