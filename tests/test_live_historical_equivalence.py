# -*- coding: utf-8 -*-
"""
test_live_historical_equivalence.py - Teste de Equivalência Científica Live vs Histórico
=======================================================================================
Garante que o processamento em lote da Análise Histórica e o processamento incremental
da Telemetria Live produzem exatamente os mesmos resultados metrológicos quando submetidos
ao mesmo conjunto de dados do ensaio SwarmLoc.
"""

import os
import sys
import struct
import tempfile
import unittest

SWARMLOC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PYTHON_DIR = os.path.join(SWARMLOC_DIR, "python")
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

from data_analysis import (
    parse_binary_file,
    compute_group_metrics,
    HEADER_FORMAT,
    RECORD_FORMAT,
    SWARMLOC_BIN_MAGIC
)
from scientific_metrics import compute_descriptive_stats, compute_timing_and_rates


class TestLiveHistoricalEquivalence(unittest.TestCase):

    def setUp(self):
        # Localizar ficheiro real gravado de ensaio ou gerar ficheiro temporário padronizado
        self.tmp_created = False
        import glob
        candidate_bins = [
            b for b in glob.glob(os.path.join(SWARMLOC_DIR, "**", "raw_*.bin"), recursive=True) +
                       glob.glob(os.path.join(SWARMLOC_DIR, "..", "data", "**", "raw_*.bin"), recursive=True)
            if "CMakeFiles" not in b
        ]
        
        valid_swlb = []
        for b in candidate_bins:
            try:
                with open(b, "rb") as f:
                    if f.read(4) == b"SWLB":
                        valid_swlb.append(b)
            except Exception:
                pass
        self.sample_bin = valid_swlb[0] if valid_swlb else None

        if not self.sample_bin or not os.path.exists(self.sample_bin):
            # Gerar ficheiro binário sintético de 50 amostras válido (SWLB 54B)
            records_raw = bytearray()
            rec_size = struct.calcsize(RECORD_FORMAT)
            n_samples = 50
            t_dummy = (1000000).to_bytes(5, "little")

            for i in range(n_samples):
                seq = 100 + i
                ts_ms = 10000 + i * 100  # 100 ms interval (10 Hz)
                dist_mm = 1350 + (i % 7) * 5  # Variação determinística: 1350 a 1380 mm
                dur_us = 2750  # TWR
                role = 2       # Slave
                status = 1     # OK
                err_code = 0
                drift_x100 = 85  # +0.85 ppm

                rec_b = struct.pack(
                    RECORD_FORMAT,
                    seq, ts_ms, 0x0001, 0x0002, dist_mm, dur_us,
                    role, status, err_code,
                    t_dummy, t_dummy, t_dummy, t_dummy, t_dummy, t_dummy,
                    drift_x100
                )
                records_raw.extend(rec_b)

            chk = sum(records_raw) & 0xFFFFFFFF
            header = struct.pack(
                HEADER_FORMAT,
                SWARMLOC_BIN_MAGIC, 0x0002, 2, rec_size, n_samples, 5000, chk
            )
            full_bin = header + records_raw

            fd, self.sample_bin = tempfile.mkstemp(prefix="raw_0002_Slave_20261026_140358_", suffix=".bin")
            with os.fdopen(fd, "wb") as f:
                f.write(full_bin)
            self.tmp_created = True

    def tearDown(self):
        if self.tmp_created and self.sample_bin and os.path.exists(self.sample_bin):
            try:
                os.remove(self.sample_bin)
            except Exception:
                pass

    def test_equivalence_real_trial_data(self):
        records, meta = parse_binary_file(self.sample_bin)
        self.assertGreater(len(records), 0, "O ficheiro binário não contém registos.")

        # 1. Processamento em Lote Histórico
        hist_groups = compute_group_metrics(records)
        self.assertGreater(len(hist_groups), 0)

        # Selecionar o primeiro grupo com registos válidos
        target_group = next((g for g in hist_groups if g["n_ok"] > 0), None)
        self.assertIsNotNone(target_group, "Nenhum grupo com medições válidas no ensaio.")

        # 2. Processamento Incremental (Simulação da Telemetria Live)
        # No Live, à medida que cada pacote chega, ele é adicionado ao buffer analítico
        live_stream_values = []
        live_stream_ts = []
        live_stream_seq = []

        for r in records:
            proto = "TWR" if (r.get("packet_type") == "TWR" or float(r.get("round_duration_us", 0) or 0) > 5) else "TDoA"
            if r.get("src_addr") == target_group["src"] and r.get("dst_addr") == target_group["dst"] and proto == target_group["protocol"]:
                if r.get("status") == "OK" and r.get("distance_m") is not None:
                    live_stream_values.append(r["distance_m"])
                    if r.get("timestamp_ms") is not None:
                        live_stream_ts.append(r["timestamp_ms"] / 1000.0)
                        live_stream_seq.append(r.get("seq"))

        # Executar o motor canónico SciMetrics no buffer incremental
        live_stats = compute_descriptive_stats(live_stream_values)
        live_timing = compute_timing_and_rates(live_stream_ts, live_stream_seq)

        # 3. Verificação de Equivalência Rigorosa
        self.assertEqual(target_group["n_ok"], live_stats["n"])
        self.assertAlmostEqual(target_group["mean_dist"], round(live_stats["mean"], 3), places=3)
        self.assertAlmostEqual(target_group["std_mm"], round(live_stats["std_mm"], 2), places=2)
        self.assertAlmostEqual(target_group["median_dist"], round(live_stats["median"], 3), places=3)
        self.assertAlmostEqual(target_group["min_dist"], round(live_stats["min"], 3), places=3)
        self.assertAlmostEqual(target_group["max_dist"], round(live_stats["max"], 3), places=3)
        self.assertAlmostEqual(target_group["freq_hz"], live_timing["freq_observed_hz"], places=1)


if __name__ == "__main__":
    unittest.main()
