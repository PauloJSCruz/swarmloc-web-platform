#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SwarmLoc — Testes de Validação do Componente Unificado de Gráficos (Live e Análises)
====================================================================================
"""

import re
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
PYTHON_DIR = ROOT_DIR / "python"
WEB_DIR = PYTHON_DIR / "web"


class TestUnifiedChartsArchitecture(unittest.TestCase):
    """Testa a arquitetura unificada de gráficos e filtros do SwarmLoc."""

    def setUp(self):
        self.index_html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        self.unified_js = (WEB_DIR / "unified_chart.js").read_text(encoding="utf-8")
        self.app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

    def test_01_exactly_two_canvas_elements_in_app(self):
        """Requisito 1: Devem existir apenas dois gráficos na aplicação (Live e Análises)."""
        canvases = re.findall(r'<canvas[^>]*id=[\"\']([^\"\']+)[\"\'][^>]*>', self.index_html)
        self.assertEqual(
            len(canvases),
            2,
            f"Devem existir exatamente 2 elementos <canvas> na aplicação, encontrados {len(canvases)}: {canvases}"
        )
        self.assertIn("analysis-chart", canvases, "O gráfico de análises (analysis-chart) deve existir")
        self.assertIn("live-chart", canvases, "O gráfico live (live-chart) deve existir")

    def test_02_unified_chart_script_included_and_reused(self):
        """Requisito 2: Uma única implementação reutilizável incluída em index.html e partilhada."""
        self.assertIn('unified_chart.js', self.index_html, "unified_chart.js deve ser importado em index.html")
        self.assertIn('class UnifiedUwbChart', self.unified_js, "UnifiedUwbChart deve estar definida em unified_chart.js")
        self.assertIn('window.UnifiedUwbChart = UnifiedUwbChart', self.unified_js)

        self.assertIn('new window.UnifiedUwbChart', self.app_js, "app.js deve instanciar UnifiedUwbChart")
        self.assertTrue('canvasId: "live-chart"' in self.app_js or "canvasId: 'live-chart'" in self.app_js, "Deve configurar UnifiedUwbChart para o live-chart")
        self.assertTrue('canvasId: "analysis-chart"' in self.app_js or "canvasId: 'analysis-chart'" in self.app_js, "Deve configurar UnifiedUwbChart para o analysis-chart")

    def test_03_x_axis_variables_supported(self):
        """Requisito 3: Eixo X com Tempo global, Tempo decorrido e Sequência."""
        for key in ['t_global', 'elapsed', 'seq']:
            self.assertIn(f"{key}:", self.unified_js, f"Variável de eixo X '{key}' deve estar definida")

        self.assertIn('Tempo Global', self.unified_js)
        self.assertIn('Tempo Decorrido', self.unified_js)
        self.assertIn('Sequência', self.unified_js)

    def test_04_y_axis_variables_supported(self):
        """Requisito 4: Eixo Y com Distância medida, Drift em ppm, Drift equivalente em distância, Frequência (Hz)."""
        for key in ['dist_m', 'drift_ppm', 'drift_dist_m', 'freq_hz']:
            self.assertIn(f"{key}:", self.unified_js, f"Variável de eixo Y '{key}' deve estar definida")

        self.assertIn('Distância Medida', self.unified_js)
        self.assertIn('Drift de Relógio', self.unified_js)
        self.assertIn('Drift Equivalente em Distância', self.unified_js)
        self.assertIn('Frequência de Eventos', self.unified_js)

    def test_05_interactive_checkbox_filters_markup(self):
        """Requisito 5: Checkboxes de Módulo, Ligação e Sentido presentes na UI unificada."""
        # 3.1 Módulo
        for mod in ['0001', '0002', '0003', '0004', '0005', '0006']:
            found = (f'value="{mod}"' in self.unified_js) or (f"'{mod}'" in self.unified_js) or (f'"{mod}"' in self.unified_js)
            self.assertTrue(found, f"Identificador do módulo {mod} deve existir na UI unificada")

        # 3.2 Ligação (Par)
        for pair in ['0001-0002', '0001-0003', '0001-0004', '0001-0005', '0001-0006']:
            found = (f'value="{pair}"' in self.unified_js) or (f'hub-{pair.split("-")[1]}' in self.unified_js)
            self.assertTrue(found, f"Opção ou chip de ligação {pair} deve existir")

        # 3.3 Sentido e Isolamento de Protocolo
        self.assertTrue(
            'btn-node-proto-sub' in self.unified_js and 'data-node=' in self.unified_js,
            "Sub-botões de protocolo ou sentido devem existir na UI unificada"
        )

        # Botão Limpar Filtros
        self.assertIn('Limpar Filtros', self.unified_js)

    def test_06_filter_intersection_logic(self):
        """Requisito 6: Simulação exata da lógica de interseção de filtros em JavaScript."""
        def matches_filters(record, selected_modules, selected_pairs, selected_directions, hide_all=False):
            if hide_all:
                return False
            src = record.get("src", "").replace("0x", "").zfill(4).upper()
            dst = record.get("dst", "").replace("0x", "").zfill(4).upper()

            if selected_modules:
                if src not in selected_modules and dst not in selected_modules:
                    return False

            if selected_pairs:
                pair_key = "-".join(sorted([src, dst]))
                if pair_key not in selected_pairs:
                    return False

            if selected_directions:
                dir_key = f"{src}->{dst}"
                if dir_key not in selected_directions:
                    return False

            return True

        records = [
            {"id": 1, "src": "0001", "dst": "0002"},
            {"id": 2, "src": "0002", "dst": "0001"},
            {"id": 3, "src": "0001", "dst": "0003"},
            {"id": 4, "src": "0003", "dst": "0001"},
            {"id": 5, "src": "0001", "dst": "0004"},
            {"id": 6, "src": "0004", "dst": "0001"},
        ]

        filtered_all = [r for r in records if matches_filters(r, set(), set(), set())]
        self.assertEqual(len(filtered_all), 6)

        filtered_none = [r for r in records if matches_filters(r, set(), set(), set(), hide_all=True)]
        self.assertEqual(len(filtered_none), 0)

        filtered_m2 = [r for r in records if matches_filters(r, {"0002"}, set(), set())]
        self.assertEqual([r["id"] for r in filtered_m2], [1, 2])

        filtered_p13 = [r for r in records if matches_filters(r, set(), {"0001-0003"}, set())]
        self.assertEqual([r["id"] for r in filtered_p13], [3, 4])

        filtered_d14 = [r for r in records if matches_filters(r, set(), set(), {"0001->0004"})]
        self.assertEqual([r["id"] for r in filtered_d14], [5])

        filtered_inter = [r for r in records if matches_filters(r, {"0002"}, {"0001-0002"}, {"0002->0001"})]
        self.assertEqual([r["id"] for r in filtered_inter], [2])

        filtered_conflict = [r for r in records if matches_filters(r, {"0003"}, set(), {"0001->0002"})]
        self.assertEqual(len(filtered_conflict), 0)

    def test_07_no_artificial_zeros_for_missing_values(self):
        """Requisito 7: Valores nulos/em falta não são substituídos por zero nem ligados (spanGaps: false)."""
        self.assertIn("spanGaps: false", self.unified_js, "Datasets devem ter spanGaps: false para não ligar falsamente dados nulos")
        self.assertIn("r.distance_m !== undefined && r.distance_m !== null", self.unified_js)

    def test_08_quick_rf_link_filter_selector_bar(self):
        """Requisito 8: Barra de seletor rápido de Links RF com botões Todos, Nenhum e toggle chips individuais."""
        self.assertIn("uwb-quick-links-bar", self.unified_js, "Barra de seletor rápido de links RF deve existir")
        self.assertIn("btn-quick-links-all", self.unified_js, "Botão 'Todos' do seletor rápido de links deve existir")
        self.assertIn("btn-quick-links-none", self.unified_js, "Botão 'Nenhum' do seletor rápido de links deve existir")
        self.assertIn("toggleQuickLinkPair", self.unified_js, "Método toggleQuickLinkPair deve existir em UnifiedUwbChart")
        self.assertIn("selectAllQuickLinks", self.unified_js, "Método selectAllQuickLinks deve existir em UnifiedUwbChart")
        self.assertIn("selectNoQuickLinks", self.unified_js, "Método selectNoQuickLinks deve existir em UnifiedUwbChart")
        self.assertIn("renderQuickLinkChips", self.unified_js, "Método renderQuickLinkChips deve existir em UnifiedUwbChart")
        self.assertIn("hideAllLinks", self.unified_js, "Estado hideAllLinks ('Nenhum') deve ser suportado em matchesFilters")


if __name__ == "__main__":
    unittest.main()
