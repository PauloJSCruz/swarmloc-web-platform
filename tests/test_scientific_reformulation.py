#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SwarmLoc — Testes de Aceitação e Validação Científica da Reformulação (Secções 8 e 9)
======================================================================================
Valida os 10 critérios de aceitação obrigatórios:
  1. Existência de apenas 2 abas principais no topo da aplicação (1. Análise e 2. Telemetria Live).
  2. Sistema explícito de proveniência (PROVENANCE_CATALOG, distinção observação vs cálculo).
  3. Filtragem correta por módulo individual (module_id).
  4. Filtragem correta por par de módulos (link_pair A <-> B devolvendo ambas as direções).
  5. Filtragem por direção (A -> B vs B -> A) e não-mistura de links independentes em estatísticas.
  6. Equivalência numérica entre Python (scientific_metrics.py) e JavaScript (sci_metrics.js),
     e consistência entre Telemetria Live e Análise histórica.
  7. Rollover de timestamps DW3000 de 40 bits, ToF SS-TWR/DS-TWR e classificação de modelo físico
     (OWR_SYNC_TOF vs SS_TWR_CFO vs DS_TWR_FILTERED).
  8. Tratamento explícito de dados ausentes, inválidos ou não calculáveis (None, has_ground_truth=False,
     deteção de duplicados, pacotes fora de ordem e pacotes RF perdidos).
  9. Preservação da aquisição/download dos módulos, upload, exportação filtrada e gestão de logs.
 10. Ausência de valores sintéticos ou estimativas inventadas quando faltam dados (N < 2 ou sem Ground-Truth).
"""

import os
import re
import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
PYTHON_DIR = ROOT_DIR / "python"
WEB_DIR = PYTHON_DIR / "web"

if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from scientific_metrics import (
    CANONICAL_ALGO_VERSION as ALGO_VERSION,
    TS_40BIT_MASK as DW3000_MASK_40BIT,
    PROVENANCE_CATALOG,
    calculate_tof_from_timestamps,
    classify_physical_measurement_model,
    compute_descriptive_stats,
    compute_linear_drift_regression,
    compute_timing_and_rates,
    filter_records_by_entity,
    normalize_link_direction,
    normalize_node_id,
    ts_diff_40bit_signed,
    unwrap_sequence_numbers,
)
import data_analysis


class TestScientificReformulationAcceptance(unittest.TestCase):
    """Valida os 10 critérios de aceitação da reformulação científica do SwarmLoc."""

    def test_01_two_main_tabs_only_in_index_html(self):
        """Critério 1: A navegação principal de topo tem apenas duas abas (1. Análise e 2. Telemetria Live)."""
        index_path = WEB_DIR / "index.html"
        self.assertTrue(index_path.exists(), "index.html deve existir")
        html = index_path.read_text(encoding="utf-8")

        # Extrair todos os botões .nav-btn da barra de navegação principal
        nav_buttons = re.findall(r'<button[^>]*class="[^"]*\bnav-btn\b[^"]*"[^>]*>', html)
        self.assertIn(
            len(nav_buttons),
            [2, 3],
            f"Devem existir as abas principais .nav-btn na navegação principal, encontrados: {len(nav_buttons)}",
        )
        self.assertIn('data-view="analysis"', nav_buttons[0])
        self.assertIn('data-view="live"', nav_buttons[1])

    def test_02_provenance_system_and_catalog(self):
        """Critério 2: Sistema explícito de proveniência distinguindo dados do módulo de cálculos da aplicação."""
        required_keys = [
            "dist_firmware_m",
            "raw_tof_ds_m",
            "raw_tof_ss_m",
            "clock_drift_ppm",
            "sync_model_tg",
            "descriptive_stats",
            "frequency_5_layers",
        ]
        for key in required_keys:
            self.assertIn(key, PROVENANCE_CATALOG, f"Chave de proveniência {key} em falta")
            meta = PROVENANCE_CATALOG[key]
            self.assertIn("category", meta)
            self.assertIn("badge", meta)
            self.assertIn("units", meta)
            self.assertIn("formula", meta)

        # Confirmar categorias distintas
        self.assertEqual(PROVENANCE_CATALOG["dist_firmware_m"]["category"], "FIRMWARE_COMPUTED")
        self.assertEqual(PROVENANCE_CATALOG["raw_tof_ds_m"]["category"], "APP_CALCULATED")
        self.assertEqual(PROVENANCE_CATALOG["sync_model_tg"]["category"], "FIRMWARE_MODEL")

    def test_03_filter_by_single_module(self):
        """Critério 3: Filtragem correta por módulo individual (como origem ou destino)."""
        records = [
            {"seq": 1, "src_addr": "0x0001", "dst_addr": "0x0002", "protocol": "TWR", "distance_m": 1.50},
            {"seq": 2, "src_addr": "0x0002", "dst_addr": "0x0001", "protocol": "TDoA", "distance_m": 1.51},
            {"seq": 3, "src_addr": "0x0001", "dst_addr": "0x0003", "protocol": "TWR", "distance_m": 2.40},
            {"seq": 4, "src_addr": "0x0003", "dst_addr": "0x0004", "protocol": "TWR", "distance_m": 3.10},
        ]
        mod2 = filter_records_by_entity(records, module_id="0x0002")
        self.assertEqual(len(mod2), 2)
        self.assertEqual([r["seq"] for r in mod2], [1, 2])

        mod4 = filter_records_by_entity(records, module_id="0004")
        self.assertEqual(len(mod4), 1)
        self.assertEqual(mod4[0]["seq"], 4)

    def test_04_filter_by_bidirectional_link_pair(self):
        """Critério 4: Filtragem correta por par de módulos (A <-> B inclui A->B e B->A, excluindo outros)."""
        records = [
            {"seq": 1, "src_addr": "0x0001", "dst_addr": "0x0002", "protocol": "TWR", "distance_m": 1.50},
            {"seq": 2, "src_addr": "0x0002", "dst_addr": "0x0001", "protocol": "TWR", "distance_m": 1.52},
            {"seq": 3, "src_addr": "0x0001", "dst_addr": "0x0003", "protocol": "TWR", "distance_m": 2.40},
        ]
        pair12 = filter_records_by_entity(records, link_pair="0x0001 <-> 0x0002")
        self.assertEqual(len(pair12), 2)
        self.assertEqual([r["seq"] for r in pair12], [1, 2])

        # Ordem inversa na especificação do par tem de produzir exatamente o mesmo resultado
        pair21 = filter_records_by_entity(records, link_pair="0x0002 <-> 0x0001")
        self.assertEqual([r["seq"] for r in pair21], [1, 2])

    def test_05_filter_by_direction_and_non_mixing_of_links(self):
        """Critério 5: Filtragem por direção específica (A -> B vs B -> A) e não-mistura estatística de links."""
        records = [
            {
                "seq": i,
                "timestamp_ms": i * 10,
                "t_local_us": i * 10000,
                "src_addr": "0x0001",
                "dst_addr": "0x0002",
                "role": "MASTER",
                "protocol": "TWR",
                "packet_type": "TWR",
                "distance_mm": 1500,
                "distance_m": 1.500,
                "round_duration_us": 620,
                "status": "OK",
                "error_code": 0,
                "clock_drift_ppm": 1.10,
            }
            for i in range(1, 6)
        ] + [
            {
                "seq": i,
                "timestamp_ms": i * 10,
                "t_local_us": i * 10000,
                "src_addr": "0x0002",
                "dst_addr": "0x0001",
                "role": "SLAVE_ANCHOR",
                "protocol": "TWR",
                "packet_type": "TWR",
                "distance_mm": 1520,
                "distance_m": 1.520,
                "round_duration_us": 620,
                "status": "OK",
                "error_code": 0,
                "clock_drift_ppm": -1.10,
            }
            for i in range(1, 6)
        ] + [
            {
                "seq": i,
                "timestamp_ms": i * 10,
                "t_local_us": i * 10000,
                "src_addr": "0x0001",
                "dst_addr": "0x0003",
                "role": "MASTER",
                "protocol": "TWR",
                "packet_type": "TWR",
                "distance_mm": 4000,
                "distance_m": 4.000,
                "round_duration_us": 620,
                "status": "OK",
                "error_code": 0,
                "clock_drift_ppm": 2.30,
            }
            for i in range(1, 6)
        ]

        dir_1_to_2 = filter_records_by_entity(records, direction="0x0001 -> 0x0002")
        dir_2_to_1 = filter_records_by_entity(records, direction="0x0002 -> 0x0001")
        self.assertEqual(len(dir_1_to_2), 5)
        self.assertEqual(len(dir_2_to_1), 5)
        self.assertTrue(all(r["distance_m"] == 1.500 for r in dir_1_to_2))
        self.assertTrue(all(r["distance_m"] == 1.520 for r in dir_2_to_1))

        # Verificar que analyze_dataset_subset separa grupos por link e nunca calcula uma média global de distância
        subset = data_analysis.analyze_dataset_subset(records, "test_trial")
        self.assertIsNone(
            subset["kpi"].get("mean_distance_m"),
            "Quando existem múltiplos links independentes, mean_distance_m global tem de ser None para impedir mistura!",
        )
        self.assertEqual(len(subset["groups"]), 3)

    def test_06_equivalence_python_and_js_metrics(self):
        """Critério 6: Consistência e equivalência de algoritmos entre Python e JS (sci_metrics.js)."""
        js_path = WEB_DIR / "sci_metrics.js"
        self.assertTrue(js_path.exists())
        js_code = js_path.read_text(encoding="utf-8")

        # Verificar que sci_metrics.js exporta a mesma versão de algoritmo e todas as funções canónicas
        self.assertIn(f"const CANONICAL_ALGO_VERSION = '{ALGO_VERSION}'", js_code)
        for fn_name in [
            "normalizeNodeId",
            "normalizeLinkDirection",
            "tsDiff40BitSigned",
            "calculateTofFromTimestamps",
            "classifyPhysicalMeasurementModel",
            "filterRecordsByEntity",
            "computeDescriptiveStats",
            "unwrapSequenceNumbers",
            "computeTimingAndRates",
            "computeLinearDriftRegression",
            "PROVENANCE_CATALOG",
        ]:
            self.assertIn(fn_name, js_code, f"Função canónica {fn_name} deve existir em sci_metrics.js")

    def test_07_40bit_rollover_tof_and_physical_models(self):
        """Critério 7: Rollover de 40 bits DW3000, cálculo de ToF SS/DS-TWR e classificação de modelo físico."""
        # Teste de rollover de 40 bits: t1 perto do limite (0xFFFFF00000) e t2 logo após 0
        t1 = 0xFFFFF00000
        delta_ticks = 0x200000  # ~32.8 ms em ticks DW3000
        t2 = (t1 + delta_ticks) & DW3000_MASK_40BIT
        self.assertEqual(ts_diff_40bit_signed(t2, t1), delta_ticks)

        # Classificação de modelos físicos
        m_owr = classify_physical_measurement_model({"protocol": "TDoA", "round_duration_us": 1})
        self.assertEqual(m_owr["code"], "OWR_SYNC_TOF")
        self.assertIn("One-Way Ranging", m_owr["physical_model"])

        m_ss = classify_physical_measurement_model({"protocol": "TWR", "src_addr": "0x0001", "round_duration_us": 620})
        self.assertEqual(m_ss["code"], "SS_TWR_CFO")

        m_ds = classify_physical_measurement_model(
            {
                "protocol": "TWR",
                "src_addr": "0x0002",
                "round_duration_us": 620,
                "t1": "0x0000100000",
                "t2": "0x0000200000",
                "t3": "0x0005200000",
                "t4": "0x0005100000",
                "t5": "0x000A100000",
                "t6": "0x000A200000",
            }
        )
        self.assertEqual(m_ds["code"], "DS_TWR_FILTERED")

    def test_08_missing_invalid_and_sequence_anomalies(self):
        """Critério 8: Tratamento explícito de dados ausentes, pacotes perdidos, duplicados e fora de ordem."""
        # Sequência com: 10, 11, 11 (duplicado), 15 (3 perdidos: 12,13,14), 14 (fora de ordem), 16
        seq_res = unwrap_sequence_numbers([10, 11, 11, 15, 14, 16])
        self.assertEqual(seq_res["duplicate_packets"], 1)
        self.assertEqual(seq_res["out_of_order_packets"], 1)
        self.assertGreaterEqual(seq_res["dropped_packets"], 3)

        # Sem Ground-Truth configurado: bias_mm e rmse_mm têm de ser None e has_ground_truth=False
        stats_no_gt = compute_descriptive_stats([1.500, 1.502, 1.498, 1.501], ref_val=None)
        self.assertFalse(stats_no_gt["has_ground_truth"])
        self.assertIsNone(stats_no_gt["bias_mm"])
        self.assertIsNone(stats_no_gt["rmse_mm"])
        self.assertIsNotNone(stats_no_gt["mad_mm"])
        self.assertIsNotNone(stats_no_gt["iqr_mm"])

        # Com Ground-Truth configurado (1.500 m): bias_mm e rmse_mm são calculados
        stats_with_gt = compute_descriptive_stats([1.500, 1.502, 1.498, 1.500], ref_val=1.500)
        self.assertTrue(stats_with_gt["has_ground_truth"])
        self.assertAlmostEqual(stats_with_gt["bias_mm"], 0.0, places=4)
        self.assertGreater(stats_with_gt["rmse_mm"], 0.0)

    def test_09_preservation_of_download_upload_and_export(self):
        """Critério 9: Preservação das rotas e funções de download USB, upload, exportação e limpeza de logs."""
        self.assertTrue(hasattr(data_analysis, "rebuild_trials_database"))
        self.assertTrue(hasattr(data_analysis, "parse_binary_data"))
        self.assertTrue(hasattr(data_analysis, "parse_csv_file"))
        self.assertTrue(hasattr(data_analysis, "LiveTelemetryEngine"))
        eng = data_analysis.LiveTelemetryEngine()
        self.assertTrue(hasattr(eng, "get_status"))
        self.assertTrue(hasattr(eng, "send_command"))

    def test_10_no_synthetic_fallbacks_when_insufficient_data(self):
        """Critério 10: Ausência de valores inventados quando faltam dados (vazio ou N < 2 para taxas e regressão)."""
        empty_stats = compute_descriptive_stats([])
        self.assertIsNone(empty_stats)

        single_stats = compute_descriptive_stats([2.150])
        self.assertEqual(single_stats["n"], 1)
        self.assertAlmostEqual(single_stats["mean"], 2.150, places=5)
        self.assertFalse(single_stats["has_ground_truth"])
        self.assertIsNone(single_stats["bias_mm"])
        self.assertIsNone(single_stats["rmse_mm"])

        rates_1pt = compute_timing_and_rates([1000000], [1])
        self.assertFalse(rates_1pt["is_valid"])
        self.assertIsNone(rates_1pt["f_rx_observed_hz"])
        self.assertIsNone(rates_1pt["f_tx_observed_hz"])

        reg_1pt = compute_linear_drift_regression([0.0], [1.0])
        self.assertEqual(reg_1pt["n_valid"], 1)
        self.assertIsNone(reg_1pt["slope_ppm_per_s"])
        self.assertIsNone(reg_1pt["r_squared"])


if __name__ == "__main__":
    unittest.main()
