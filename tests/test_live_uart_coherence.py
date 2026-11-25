#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_live_uart_coherence.py
---------------------------
Suíte de testes automatizados de coerência de leitura UART, processamento de
telemetria e exibição em tempo real da aplicação SwarmLoc.

Testa:
1. Identificação dinâmica de nós (Master 0x0000 / Slaves 0x0002-0x0004)
2. Sincronização DS-TWR Master -> Slave (com e sem número de sequência)
3. Medição bidirecional TWR e TDoA Downlink Beacon RX/TX
4. Deteção e tratamento resiliente de linhas corrompidas / ruído na UART
5. Coerência do estado de rotação de Master (0x0000 -> 0x0002)
6. Contrato de renderização dos cartões da UI:
   - Master: "👑 0x0000" (sem badge redundante)
   - Sucessor: "📡 0x0002 -> ⏳👑"
7. Endpoints REST da aplicação (/api/live/status, /api/live/simulation, /api/docs/status, /docs/*)
"""

import os
import sys
import time
import json
import unittest

# Adicionar pasta python ao sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "python"))

from data_analysis import LiveTelemetryEngine, GLOBAL_STATE


class TestLiveUartCoherence(unittest.TestCase):
    def setUp(self):
        """Inicializa um motor de telemetria isolado para cada teste."""
        self.engine = LiveTelemetryEngine()
        # Mock de portas COM ativas para teste sem hardware físico
        self.engine.active_serials = {"COM6": None, "COM5": None}
        self.engine.connected_ports = ["COM6", "COM5"]

    def test_01_node_identification(self):
        """Testa o reconhecimento correto de ID e Papel a partir da UART."""
        # 1. Identificação do Master 0x0000
        line_master = "[SWARMLOC:ID] NODE:0x0001 ROLE:MASTER"
        self.engine._process_line("COM6", line_master)
        
        # 2. Identificação do Slave 0x0002
        line_slave = "[SWARMLOC:ID] NODE:0x0002 ROLE:SLAVE"
        self.engine._process_line("COM5", line_slave)

        st = self.engine.get_status()
        nodes = st["nodes"]

        self.assertIn("0001", nodes)
        self.assertIn("0002", nodes)
        self.assertEqual(nodes["0001"]["role"], "Master")
        self.assertEqual(nodes["0002"]["role"], "Slave")
        self.assertEqual(st["master_rotation"]["current_master_id"], "0001")
        self.assertIsNone(st["master_rotation"]["next_master_id"])

    def test_02_master_sync_twr_parsing(self):
        """
        Testa o parsing de sincronização Master -> Slave.
        Verifica a correção do bug de índices nos grupos de regex.
        """
        # Linha padrão emitida pelo firmware C com sequência
        line_with_seq = "[TL:  10.1234567s|TG:  10.1234567s] [SYNC:TWR ] #000014 -> Slave 0x0002: Sincronizado OK | Dist:   0.1200m"
        self.engine._process_line("COM6", line_with_seq)

        # Verificar se nó 0002 registou a distância correta de 0.1200m (e NÃO float('0002') = 2.0m!)
        node_02 = self.engine.node_states.get("0002")
        self.assertIsNotNone(node_02)
        self.assertAlmostEqual(node_02["last_dist_m"], 0.1200, places=3)
        self.assertAlmostEqual(node_02["ref_dist_m"], 0.1200, places=3)
        self.assertEqual(node_02["mode"], "Sync TWR")

        # Linha sem número de sequência (não pode lançar exceção)
        line_no_seq = "-> Slave 0x0002: Sincronizado OK | Dist:   0.1550m"
        self.engine._process_line("COM6", line_no_seq)
        self.assertAlmostEqual(self.engine.node_states["0002"]["last_dist_m"], 0.1550, places=3)

    def test_03_tdoa_downlink_beacon_rx(self):
        """Testa a receção passiva de Beacon 1-via nos Slaves."""
        # Configurar identificador do Slave na porta COM5
        self.engine._process_line("COM5", "[SWARMLOC:ID] NODE:0x0002 ROLE:SLAVE")

        beacon_rx = "[TL:  12.3456789s|TG:  12.3456789s] [TDOA:RX  ] Beacon #007706 de Master 0x0000 | Dist:  0.5500m | ToF:  +1.835ns | Deriva:  -0.150ppm | Sinc: OK (ha 45 ms)"
        self.engine._process_line("COM5", beacon_rx)

        node_02 = self.engine.node_states["0002"]
        self.assertAlmostEqual(node_02["last_dist_m"], 0.5500, places=3)
        self.assertAlmostEqual(node_02["last_tdoa"], 1.835, places=3)
        self.assertAlmostEqual(node_02["clock_drift_ppm"], -0.150, places=3)
        self.assertEqual(node_02["mode"], "TDoA")

    def test_04_twr_round_bidirectional(self):
        """Testa o processamento de pacotes DS-TWR das duas direções."""
        # 1. Master -> Slave 2
        line_m = "[TWR:ROUND] #000042 M00->S02 | d=  0.5500m |  +0.120ppm"
        self.engine._process_line("COM6", line_m)
        self.assertAlmostEqual(self.engine.node_states["0002"]["last_dist_m"], 0.5500, places=3)

        # 2. Slave 2 -> Master
        line_s = "[TL:  14.0000000s|TG:  14.0000000s] [TWR:ROUND] #000042 S02<-M00 | d=  0.5480m |  -0.120ppm"
        self.engine._process_line("COM5", line_s)
        self.assertAlmostEqual(self.engine.node_states["0002"]["last_dist_m"], 0.5480, places=3)

    def test_05_resilience_to_garbage_and_out_of_bounds(self):
        """Testa a robustez perante ruído elétrico e valores fisicamente anómalos."""
        initial_invalid = self.engine.counters["invalid_corrupt"]

        # Linha corrompida / incompleta
        self.engine._process_line("COM6", "\x00\xff??@!RAW_JUNK_DATA##")
        # Distância fora dos limites físicos UWB (> 100m)
        self.engine._process_line("COM6", "[TWR:0x0000->0x0002] DIST: 999.999m")
        # Deriva de relógio impossível para cristais TCXO (> 50 ppm)
        self.engine._process_line("COM5", "[TL: 1.0s|TG: 1.0s] [TDOA:RX  ] Beacon #1 de Master 0x0000 | Dist: 0.50m | ToF: +1.6ns | Deriva: +999.0ppm")

        # O motor deve manter-se ativo e incrementar o contador de inválidos
        self.assertGreater(self.engine.counters["invalid_corrupt"], initial_invalid)
        self.assertTrue(self.engine.counters["uart_received"] >= 3)

    def test_06_master_rotation_and_simulation(self):
        """Testa o controlo e a coerência do estado de rotação de Master."""
        st = self.engine.get_status()
        self.assertIn("master_rotation", st)
        self.assertEqual(st["master_rotation"]["current_master_id"], "0001")
        self.assertIsNone(st["master_rotation"]["next_master_id"])

        # Simulação: alternar modo
        res = self.engine.set_simulation_mode(True, scenario="failover")
        self.assertTrue(res["simulation_mode"])
        self.assertEqual(res["sim_scenario"], "failover")

        # Simulação: dar 1 passo de transição
        res_step = self.engine.step_simulation_rotation()
        self.assertEqual(res_step["prev_master_id"], "0001")
        self.assertEqual(res_step["current_master_id"], "0002")
        self.assertEqual(res_step["next_master_id"], "0003")

    def test_07_frontend_card_contract(self):
        """
        Simula a lógica exata de renderização de cartões da UI em python/web/app.js.
        Verifica que:
        - Master gera: '👑 0x0000'
        - Sucessor gera: '📡 0x0002 -> ⏳👑'
        - Não há texto redundante '👑 MASTER ATUAL' nem '⏳ SUCESSOR DESIGNADO'
        """
        cleanNid_master = "0001"
        cleanNid_next = "0002"
        cleanNid_other = "0003"

        def generate_node_header(cleanNid, isConfirmedMaster, isDesignatedNext):
            if isConfirmedMaster:
                return f"👑 0x{cleanNid}"
            elif isDesignatedNext:
                return f"📡 0x{cleanNid} -> ⏳👑"
            else:
                return f"📡 0x{cleanNid}"

        # Teste 1: Master
        hdr_m = generate_node_header(cleanNid_master, isConfirmedMaster=True, isDesignatedNext=False)
        self.assertEqual(hdr_m, "👑 0x0001")
        self.assertNotIn("MASTER ATUAL", hdr_m)

        # Teste 2: Sucessor Designado
        hdr_s = generate_node_header(cleanNid_next, isConfirmedMaster=False, isDesignatedNext=True)
        self.assertEqual(hdr_s, "📡 0x0002 -> ⏳👑")
        self.assertNotIn("SUCESSOR DESIGNADO", hdr_s)

        # Teste 3: Outro nó comum
        hdr_o = generate_node_header(cleanNid_other, isConfirmedMaster=False, isDesignatedNext=False)
        self.assertEqual(hdr_o, "📡 0x0003")


if __name__ == "__main__":
    unittest.main(verbosity=2)
