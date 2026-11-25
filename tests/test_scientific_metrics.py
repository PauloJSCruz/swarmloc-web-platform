# -*- coding: utf-8 -*-
"""
test_scientific_metrics.py - Testes de Unidade e Equivalência Científica
=======================================================================
Valida a precisão matemática do motor canónico de métricas científicas:
1. Estatística Descritiva Amostral (Bessel ddof=1, divisor N-1).
2. Metrologia de Distâncias (Média, Desvio-Padrão, Mediana, MAD, IQR, Bias, RMSE).
3. Teste de Fluxo Sintético a 250 Hz (Intervalos de 4 ms, Jitter zero).
4. Separação rigorosa entre Frequência Observada (UART/Streaming) e Frequência RF (seq).
5. Resiliência a amostras inválidas (None, NaN, Inf, strings).
"""

import math
import os
import sys
import unittest

# Assegurar que o diretório python está no path
PYTHON_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python"))
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

from scientific_metrics import (
    filter_valid_numbers,
    compute_descriptive_stats,
    compute_timing_and_rates
)


class TestScientificMetrics(unittest.TestCase):

    def test_filter_valid_numbers(self):
        raw = [1.2, None, "1.5", "invalid", float("nan"), float("inf"), 2.0, -999.0]
        filtered = filter_valid_numbers(raw, min_val=-10.0, max_val=100.0)
        self.assertEqual(filtered, [1.2, 1.5, 2.0])

    def test_descriptive_stats_known_dataset(self):
        # Amostra: [1.0, 2.0, 3.0, 4.0, 5.0]
        # n = 5
        # mean = 3.0
        # variance (amostral, n-1 = 4): (4 + 1 + 0 + 1 + 4) / 4 = 10 / 4 = 2.5
        # std = sqrt(2.5) ~ 1.58113883
        # median = 3.0
        # MAD: abs devs = [2, 1, 0, 1, 2] -> sorted: [0, 1, 1, 2, 2] -> median = 1.0
        # MAD_sigma = 1.4826
        # IQR: q1 = 2.0, q3 = 4.0 -> iqr = 2.0
        stats = compute_descriptive_stats([1.0, 2.0, 3.0, 4.0, 5.0], ref_val=3.0)
        self.assertIsNotNone(stats)
        self.assertEqual(stats["n"], 5)
        self.assertAlmostEqual(stats["mean"], 3.0, places=6)
        self.assertAlmostEqual(stats["variance"], 2.5, places=6)
        self.assertAlmostEqual(stats["std"], math.sqrt(2.5), places=6)
        self.assertAlmostEqual(stats["median"], 3.0, places=6)
        self.assertAlmostEqual(stats["mad"], 1.0, places=6)
        self.assertAlmostEqual(stats["mad_sigma"], 1.4826, places=4)
        self.assertAlmostEqual(stats["iqr"], 2.0, places=6)
        self.assertAlmostEqual(stats["min"], 1.0, places=6)
        self.assertAlmostEqual(stats["max"], 5.0, places=6)
        self.assertAlmostEqual(stats["span"], 4.0, places=6)
        self.assertAlmostEqual(stats["bias_mm"], 0.0, places=6)
        # RMSE: sqrt(sum(sq_err)/5) * 1000 = sqrt(10 / 5) * 1000 = sqrt(2) * 1000 ~ 1414.21356 mm
        self.assertAlmostEqual(stats["rmse_mm"], math.sqrt(2.0) * 1000.0, places=3)

    def test_single_sample_edge_case(self):
        stats = compute_descriptive_stats([42.0])
        self.assertIsNotNone(stats)
        self.assertEqual(stats["n"], 1)
        self.assertEqual(stats["mean"], 42.0)
        self.assertEqual(stats["variance"], 0.0)
        self.assertEqual(stats["std"], 0.0)
        self.assertEqual(stats["median"], 42.0)
        self.assertEqual(stats["span"], 0.0)

    def test_empty_or_all_invalid(self):
        stats = compute_descriptive_stats([None, "abc", float("nan")])
        self.assertIsNone(stats)

    def test_synthetic_250hz_stream(self):
        """
        Valida que um fluxo sintético de rádio emitido a 250 Hz (intervalos exatos de 4.0 ms)
        produz exatamente 250.0 Hz de frequência observada com dt_mean = 4.0 ms e jitter = 0.0 ms.
        """
        n_packets = 1001  # 1000 intervalos de 4 ms = 4.000 segundos
        timestamps = [i * 0.004 for i in range(n_packets)]
        seq_nums = list(range(n_packets))

        res = compute_timing_and_rates(timestamps, seq_nums)
        self.assertEqual(res["n"], 1001)
        self.assertAlmostEqual(res["span_s"], 4.0, places=4)
        self.assertAlmostEqual(res["dt_mean_ms"], 4.0, places=2)
        self.assertAlmostEqual(res["dt_median_ms"], 4.0, places=2)
        self.assertAlmostEqual(res["jitter_ms"], 0.0, places=2)
        self.assertAlmostEqual(res["freq_observed_hz"], 250.0, places=1)
        self.assertAlmostEqual(res["freq_radio_rf_hz"], 250.0, places=1)

    def test_decimated_stream_frequency_separation(self):
        """
        Valida a separação entre taxa observada de streaming (ex: UART decimada a 10 Hz)
        e taxa física de emissão RF no canal de rádio (250 Hz), deduzida através dos saltos de seq.
        Cenário: Pacotes transmitidos no ar a 250 Hz (passo seq=25 a cada 100 ms).
        """
        n_samples = 101  # 100 intervalos de 100 ms = 10.0 segundos
        timestamps = [i * 0.100 for i in range(n_samples)]
        # Salto de seq = 25 por cada amostra de 100ms (25 / 0.1s = 250 Hz RF)
        seq_nums = [i * 25 for i in range(n_samples)]

        res = compute_timing_and_rates(timestamps, seq_nums)
        self.assertEqual(res["n"], 101)
        self.assertAlmostEqual(res["span_s"], 10.0, places=3)
        self.assertAlmostEqual(res["dt_mean_ms"], 100.0, places=2)
        # Taxa observada no fluxo UART = 10.0 Hz
        self.assertAlmostEqual(res["freq_observed_hz"], 10.0, places=1)
        # Taxa de rádio RF física real recuperada = 250.0 Hz!
        self.assertAlmostEqual(res["freq_radio_rf_hz"], 250.0, places=1)


if __name__ == "__main__":
    unittest.main()

