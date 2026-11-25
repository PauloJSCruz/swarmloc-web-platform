import json
#!/usr/bin/env python3
"""
test_commands.py - Testes unitários para todos os comandos UART do SwarmLoc
Valida a formatação, encaminhamento para portas série (Master/Slaves/All),
e o processamento de respostas de telemetria para todos os comandos:
  - 't <sec>' : Ensaio temporizado (ex: t 5, t 35)
  - 'p'       : Pausa / silenciamento do stream de medições
  - 'l'       : Retoma do modo Live (streaming contínuo)
  - 'i'       : Identificação do nó ([SWARMLOC:ID])
  - 'd'       : Despejo de memória binária (dump)
  - 's'       : Consulta e configuração de nós escravos ativos
  - 'k'       : Intervalo e modelo de sincronização de relógio
  - 'r'       : Reinício por software (NVIC System Reset)
"""

import sys
import os
import unittest
from unittest.mock import MagicMock

# Garantir que o módulo python está no path
SWARMLOC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PYTHON_DIR = os.path.join(SWARMLOC_DIR, "python")
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)

from data_analysis import LiveTelemetryEngine, MODULE_IDENTITY_CACHE


class MockSerialPort:
    """Simulador de porta série para testes de envio e receção de comandos."""
    def __init__(self, port_name):
        self.port = port_name
        self.is_open = True
        self.written_bytes = bytearray()

    def write(self, data):
        self.written_bytes.extend(data)
        return len(data)

    def flush(self):
        pass

    def close(self):
        self.is_open = False


class TestSwarmLocCommands(unittest.TestCase):
    def setUp(self):
        self.engine = LiveTelemetryEngine()
        # Configurar portas mock
        self.ser_master = MockSerialPort("COM4")
        self.ser_slave2 = MockSerialPort("COM6")
        self.ser_slave3 = MockSerialPort("COM5")
        self.ser_slave4 = MockSerialPort("COM7")

        self.engine.active_serials = {
            "COM4": self.ser_master,
            "COM6": self.ser_slave2,
            "COM5": self.ser_slave3,
            "COM7": self.ser_slave4
        }
        self.engine.connected_ports = list(self.engine.active_serials.keys())

        # Configurar identidades no cache
        MODULE_IDENTITY_CACHE["COM4"] = {"device": "COM4", "node_id": "0001", "role": "Master", "is_identified": True}
        MODULE_IDENTITY_CACHE["COM6"] = {"device": "COM6", "node_id": "0002", "role": "Slave", "is_identified": True}
        MODULE_IDENTITY_CACHE["COM5"] = {"device": "COM5", "node_id": "0003", "role": "Slave", "is_identified": True}
        MODULE_IDENTITY_CACHE["COM7"] = {"device": "COM7", "node_id": "0004", "role": "Slave", "is_identified": True}

        # Inicializar estados de nós no engine
        self.engine._update_node_state("0001", role="Master", port="COM4")
        self.engine._update_node_state("0002", role="Slave", port="COM6")
        self.engine._update_node_state("0003", role="Slave", port="COM5")
        self.engine._update_node_state("0004", role="Slave", port="COM7")

    def test_command_pause_p(self):
        """Testa o envio do comando 'p' para todos os módulos (para silenciamento imediato)."""
        res = self.engine.send_command("p", target="all")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "p")
        self.assertEqual(len(res["ports"]), 4)

        for ser in [self.ser_master, self.ser_slave2, self.ser_slave3, self.ser_slave4]:
            self.assertEqual(ser.written_bytes, b"p\r\n")

    def test_command_live_l(self):
        """Testa o comando 'l' (live) para retomar o streaming de medições."""
        res = self.engine.send_command("l", target="all")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "l")
        for ser in [self.ser_master, self.ser_slave2, self.ser_slave3, self.ser_slave4]:
            self.assertEqual(ser.written_bytes, b"l\r\n")

    def test_command_timed_test_t5(self):
        """Testa o comando 't 5' direcionado ao Master."""
        res = self.engine.send_command("t 5", target="master")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "t 5")
        self.assertIn("COM4", res["ports"])
        self.assertEqual(len(res["ports"]), 1)
        self.assertEqual(self.ser_master.written_bytes, b"t 5\r\n")
        # Slaves não devem receber o comando t diretamente, pois o Master sinaliza-os por rádio
        self.assertEqual(len(self.ser_slave2.written_bytes), 0)

    def test_command_timed_test_t35(self):
        """Testa o comando 't 35' (sincronização de 10 em 10 segundos + TDoA nos intervalos)."""
        res = self.engine.send_command("t 35", target="master")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "t 35")
        self.assertIn("COM4", res["ports"])
        self.assertEqual(self.ser_master.written_bytes, b"t 35\r\n")

    def test_command_identity_i(self):
        """Testa o envio do comando 'i' e o parsing da resposta [SWARMLOC:ID]."""
        res = self.engine.send_command("i", target="all")
        self.assertEqual(res["status"], "success")

        # Simular resposta do Master
        self.engine._process_line("COM4", "[SWARMLOC:ID] NODE:0x0001 ROLE:MASTER ADDR:1")
        # Simular resposta de um Slave
        self.engine._process_line("COM6", "[SWARMLOC:ID] NODE:0x0002 ROLE:SLAVE ADDR:2")

        status = self.engine.get_status()
        self.assertEqual(status["nodes"]["0001"]["role"], "Master")
        self.assertEqual(status["nodes"]["0002"]["role"], "Slave")

    def test_command_dump_d(self):
        """Testa o comando de despejo binário de memória 'd'."""
        res = self.engine.send_command("d", target="all")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "d")
        for ser in [self.ser_master, self.ser_slave2, self.ser_slave3, self.ser_slave4]:
            self.assertEqual(ser.written_bytes, b"d\r\n")

    def test_command_slaves_s(self):
        """Testa o comando 's' para consultar e configurar escravos ativos no Master."""
        res = self.engine.send_command("s", target="master")
        self.assertEqual(res["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"s\r\n")

        # Simular resposta do Master com 3 escravos
        self.engine._process_line("COM4", "[SWARMLOC:SLAVES] Total: 3 escravo(s) ativo(s): 0x0002, 0x0003, 0x0004")
        msgs = self.engine.get_status()["messages"]
        self.assertTrue(any("3 escravo(s) ativo(s)" in m["text"] for m in msgs))

    def test_command_sync_period_k(self):
        """Testa o comando 'k' para configurar o intervalo de sincronização no Master (incluindo milissegundos e decimais)."""
        # 1. Teste k 10 (segundos inteiros)
        res = self.engine.send_command("k 10", target="master")
        self.assertEqual(res["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"k 10\r\n")

        # 2. Teste k 0.5 (número decimal de segundos)
        self.ser_master.written_bytes.clear()
        res_dec = self.engine.send_command("k 0.5", target="master")
        self.assertEqual(res_dec["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"k 0.5\r\n")
        self.assertEqual(res_dec["sync_period_s"], 0.5)
        self.assertEqual(res_dec["sync_period_ms"], 500)
        self.assertEqual(self.engine.sync_period_s, 0.5)
        self.assertEqual(self.engine.sync_period_ms, 500)

        # 3. Teste k = 0.5 s (com sintaxe com igual e unidade)
        self.ser_master.written_bytes.clear()
        res_eq = self.engine.send_command("k = 0.5 s", target="master")
        self.assertEqual(res_eq["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"k = 0.5 s\r\n")
        self.assertEqual(res_eq["sync_period_s"], 0.5)

        # 4. Teste k 500ms (unidade em milissegundos)
        self.ser_master.written_bytes.clear()
        res_ms = self.engine.send_command("k 500ms", target="master")
        self.assertEqual(res_ms["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"k 500ms\r\n")
        self.assertEqual(res_ms["sync_period_s"], 0.5)
        self.assertEqual(res_ms["sync_period_ms"], 500)

        # 5. Teste k 0 (modo contínuo puro)
        self.ser_master.written_bytes.clear()
        res_zero = self.engine.send_command("k 0", target="master")
        self.assertEqual(res_zero["status"], "success")
        self.assertEqual(self.ser_master.written_bytes, b"k 0\r\n")
        self.assertEqual(res_zero["sync_period_s"], 0.0)
        self.assertEqual(res_zero["sync_period_ms"], 0)

        # 6. Simular resposta com período em segundos e milissegundos e taxa máxima
        self.engine._process_line("COM4", "[SWARMLOC:SYNC] Intervalo de sincronizacao atualizado para 0.500 s (500 ms).")
        self.engine._process_line("COM4", "[SWARMLOC:SYNC] TDoA sera transmitido na TAXA MAXIMA (~250 Hz) nos intervalos!")
        st = self.engine.get_status()
        self.assertEqual(st["sync_period_s"], 0.5)
        self.assertEqual(st["sync_period_ms"], 500)
        self.assertIsNotNone(st["t0_epoch"])
        msgs = st["messages"]
        self.assertTrue(any("atualizado para 0.500 s (500 ms)" in m["text"] for m in msgs))
        self.assertTrue(any("TAXA MAXIMA" in m["text"] for m in msgs))
        last_m = msgs[-1]
        self.assertIn("elapsed_s", last_m)
        self.assertIn("sync_period_s", last_m)
        self.assertEqual(last_m["sync_period_s"], 0.5)

        # 7. Simular resposta com Modo 0 ativado (k = 0 s: Puro DS-TWR)
        self.engine._process_line("COM4", "[SWARMLOC:SYNC] MODO 0 ATIVADO (k = 0 s): Ranging Continuo PURO DS-TWR (~250 Hz) com todos os Slaves ativos!")
        st_zero = self.engine.get_status()
        self.assertEqual(st_zero["sync_period_s"], 0.0)
        self.assertEqual(st_zero["sync_period_ms"], 0)
        self.assertEqual(st_zero["f_phy_configured_hz"], 250.0)
        self.assertEqual(st_zero["tdoa_freq_hz"], 0.0)

    def test_command_reset_r(self):
        """Testa o comando de reinício 'r' enviado a todos os microcontroladores."""
        res = self.engine.send_command("r", target="all")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["command"], "r")
        for ser in [self.ser_master, self.ser_slave2, self.ser_slave3, self.ser_slave4]:
            self.assertEqual(ser.written_bytes, b"r\r\n")

    def test_tdoa_beacon_distance_parsing(self):
        """
        Testa o parsing de beacons TDoA recebidos nos escravos e a extração
        correta de distância, ToF e clock drift para apresentação nos cartões e gráficos.
        """
        raw_log = "[TDOA:RX  ] Beacon #007706 de Master 0x0001 | Dist:  0.094m | ToF:  +0.31ns | Deriva:  -0.84ppm | Sinc: OK (ha 6 s)"
        self.engine._process_line("COM7", raw_log)

        status = self.engine.get_status()
        node4 = status["nodes"]["0004"]
        self.assertEqual(node4["last_dist_m"], 0.094)
        self.assertEqual(node4["last_tdoa"], 0.31)
        self.assertEqual(node4["clock_drift_ppm"], -0.84)
        self.assertEqual(node4["mode"], "TDoA")

        last_msg = status["messages"][-1]
        self.assertEqual(last_msg["parsed"]["type"], "tdoa")
        self.assertEqual(last_msg["parsed"]["seq"], 7706)
        self.assertEqual(last_msg["parsed"]["src"], "0001")
        self.assertEqual(last_msg["parsed"]["dst"], "0004")
        self.assertEqual(last_msg["parsed"]["dist_m"], 0.094)
        self.assertEqual(last_msg["parsed"]["tof_ns"], 0.31)



    def test_live_session_recording_and_integrity(self):
        """
        Valida que a gravação contínua em tempo real captura todos os eventos com timestamps
        e pode ser lida para auditoria e replay sem depender da taxa visual dos gráficos.
        """
        res_start = self.engine.start_session_recording("test_session")
        self.assertEqual(res_start["status"], "recording_started")
        self.assertTrue(self.engine.session_recording)
        filepath = res_start["filepath"]
        self.assertTrue(os.path.exists(filepath))

        # Simular chegada de 5 mensagens
        for i in range(5):
            self.engine._process_line("COM6", f"[TWR:ROUND] #{i:06d} M01->S02 | d= 1.{i:03d}m | +1.23ppm")

        status = self.engine.get_session_recording_status()
        self.assertTrue(status["is_recording"])
        self.assertEqual(status["count"], 5)

        res_stop = self.engine.stop_session_recording()
        self.assertEqual(res_stop["status"], "recording_stopped")
        self.assertFalse(self.engine.session_recording)
        self.assertEqual(res_stop["count"], 5)

        # Verificar integridade do ficheiro JSONL gravado
        with open(filepath, "r", encoding="utf-8") as f:
            lines = [json.loads(line) for line in f if line.strip()]
        self.assertEqual(len(lines), 5)
        self.assertEqual(lines[0]["parsed"]["seq"], 0)
        self.assertEqual(lines[4]["parsed"]["seq"], 4)
        self.assertIn("epoch", lines[0])

        # Limpeza
        try:
            os.remove(filepath)
        except Exception:
            pass

    def test_six_node_swarm_support(self):
        """
        Valida que o enxame suporta nativamente 6 módulos (0x0001 a 0x0006),
        incluindo estados iniciais, rotação de liderança e telemetria TWR/TDoA para 0005 e 0006.
        """
        status0 = self.engine.get_status()
        for nid in ["0001", "0002", "0003", "0004", "0005", "0006"]:
            self.assertIn(nid, status0["nodes"])

        self.engine._process_line("COM15", "[SWARMLOC:ID] NODE:0x0005 ROLE:SLAVE ADDR:5")
        self.engine._process_line("COM16", "[SWARMLOC:ID] NODE:0x0006 ROLE:SLAVE ADDR:6")
        self.engine._process_line("COM15", "[TDOA:RX  ] Beacon #000100 de Master 0x0001 | Dist:  1.2500m | ToF:  +4.17ns | Deriva:  +0.35ppm | Sinc: OK (ha 1 s)")
        self.engine._process_line("COM16", "[TWR:ROUND] #000101 S06<-M01 | d= 1.7500m | -0.210ppm")
        MODULE_IDENTITY_CACHE.pop("COM15", None)
        MODULE_IDENTITY_CACHE.pop("COM16", None)

        status = self.engine.get_status()
        self.assertAlmostEqual(status["nodes"]["0005"]["last_dist_m"], 1.2500, places=3)
        self.assertAlmostEqual(status["nodes"]["0006"]["last_dist_m"], 1.7500, places=3)

        # Rotação em simulação deve percorrer 0001 -> ... -> 0005 -> 0006 -> 0001
        visited = []
        for _ in range(6):
            rot = self.engine.step_simulation_rotation()
            visited.append(rot["current_master_id"])
        self.assertEqual(visited, ["0002", "0003", "0004", "0005", "0006", "0001"])


if __name__ == "__main__":
    unittest.main()
