import unittest
import os
import sys

# Ensure python folder is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python")))

from data_analysis import LiveTelemetryEngine, parse_csv_file, parse_jsonl_file, parse_binary_file

class TestTDMASubslotParsing(unittest.TestCase):
    def setUp(self):
        self.engine = LiveTelemetryEngine()

    def test_parse_tdoa_rx_with_explicit_slot(self):
        line = "[TL:12.3456789s|TG:12.3456789s] [TDOA:RX  ] Beacon #001234 de Node 0x0003 (Slot: 3) | Dist:   1.2345m | Freq RF:  550.0 Hz (PDR: 100.0%) | ToF:  +4.118ns | Deriva: -0.120ppm | Sinc: OK (ha 12 ms)"
        parsed = self.engine._parse_telemetry_line("COM5", line, 1000.0)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("type"), "tdoa")
        self.assertEqual(parsed.get("src"), "0003")
        self.assertEqual(parsed.get("subslot"), 3)
        self.assertEqual(parsed.get("slot_idx"), 3)

    def test_parse_tdoa_rx_legacy_fallback_to_emitter_subslot(self):
        line = "[TL:12.3456789s|TG:12.3456789s] [TDOA:RX  ] Beacon #001234 de Master 0x0002 | Dist:   0.8500m | Freq RF:  550.0 Hz (PDR: 100.0%) | ToF:  +2.836ns | Deriva: +0.050ppm | Sinc: OK (ha 5 ms)"
        parsed = self.engine._parse_telemetry_line("COM4", line, 1000.0)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("src"), "0002")
        self.assertEqual(parsed.get("subslot"), 2)
        self.assertEqual(parsed.get("slot_idx"), 2)

    def test_parse_tdoa_tx_with_slot(self):
        line = "[TL:12.3456789s|TG:12.3456789s] [TDOA:TX  ] Beacon #001235 emitido por Master 0x0001 (Slot: 1, Taxa RF: 550.0 Hz) | Proximo Sync em 450 ms"
        parsed = self.engine._parse_telemetry_line("COM6", line, 1000.0)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("src"), "0001")
        self.assertEqual(parsed.get("subslot"), 1)
        self.assertEqual(parsed.get("slot_idx"), 1)

    def test_parse_tdoa_tx_slave_subslot(self):
        line = "[TL:12.3456789s|TG:12.3456789s] [TDOA:TX  ] Beacon #001236 emitido por Node 0x0004 (Slot: 4)"
        parsed = self.engine._parse_telemetry_line("COM4", line, 1000.0)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("src"), "0004")
        self.assertEqual(parsed.get("subslot"), 4)
        self.assertEqual(parsed.get("slot_idx"), 4)

    def test_process_line_exposes_subslot_in_msg(self):
        line = "[TL:12.3456789s|TG:12.3456789s] [TDOA:RX  ] Beacon #001234 de Node 0x0002 (Slot: 2) | Dist:   1.5000m | Freq RF: 500.0 Hz (PDR: 100.0%) | ToF: +5.000ns | Deriva: +0.000ppm | Sinc: OK (ha 1 ms)"
        self.engine._process_line("COM6", line)
        self.assertTrue(len(self.engine.messages) > 0)
        msg = self.engine.messages[-1]
        self.assertEqual(msg.get("subslot"), 2)
        self.assertEqual(msg.get("slot_idx"), 2)

if __name__ == "__main__":
    unittest.main()
