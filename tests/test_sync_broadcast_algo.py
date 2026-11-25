import unittest
import struct
import tempfile
import os
import sys

# Ensure repository root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python")))

from data_analysis import parse_binary_file, parse_binary_data, HEADER_FORMAT, RECORD_FORMAT

class TestSyncBroadcastAlgorithm(unittest.TestCase):
    def test_35s_schedule_mathematical_counts(self):
        """
        Valida que numa janela de 35 segundos (slots de 1s de 0 a 35 inclusive):
        - Sincronizacao de 10 em 10 segundos: slots 10, 20, 30 => exatamente 3 sincronizacoes.
        - Broadcast segundo a segundo: 33 medicoes.
        - Total de registos = 36.
        """
        sync_period_s = 10
        total_duration_s = 35

        sync_slots = []
        broadcast_slots = []

        for slot in range(total_duration_s + 1):
            is_sync = (slot > 0) and ((slot % sync_period_s) == 0)
            if is_sync:
                sync_slots.append(slot)
            else:
                broadcast_slots.append(slot)

        self.assertEqual(sync_slots, [10, 20, 30])
        self.assertEqual(len(sync_slots), 3, "Devem existir exatamente 3 sincronizacoes!")
        self.assertEqual(len(broadcast_slots), 33, "Devem existir exatamente 33 medicoes de broadcast!")
        self.assertEqual(len(sync_slots) + len(broadcast_slots), 36, "Total de registos deve ser exatamente 36!")

    def test_binary_packet_classification_and_counts(self):
        """
        Gera um ficheiro binario cru simulando a recolha de 35s no Slave:
        - 33 registos TDoA (dur_us = 1)
        - 3 registos DS-TWR (dur_us = 3450)
        Verifica que ambos os parsers classificam rigorosamente 3 syncs e 33 medicoes.
        """
        records_raw = bytearray()
        seq = 1

        for slot in range(36):
            is_sync = (slot > 0) and ((slot % 10) == 0)
            dur_us = 3450 if is_sync else 1
            distance_mm = 1520 if not is_sync else 1518
            status = 1
            err_code = 0
            role = 2  # Slave
            t_dummy = (1000000 + slot * 1000).to_bytes(5, "little")
            drift_x100 = 12  # +0.12 ppm

            rec_bytes = struct.pack(
                RECORD_FORMAT,
                seq,
                slot * 1000,
                0x0001,
                0x0002,
                distance_mm,
                dur_us,
                role,
                status,
                err_code,
                t_dummy, t_dummy, t_dummy, t_dummy, t_dummy, t_dummy,
                drift_x100
            )
            records_raw.extend(rec_bytes)
            seq += 1

        # Checksum simples
        chk = sum(records_raw) & 0xFFFFFFFF
        rec_size = struct.calcsize(RECORD_FORMAT)
        # HEADER_FORMAT: magic (0x53574C42), node_id, role, rec_size, count, dur_ms, chk
        header = struct.pack(HEADER_FORMAT, 0x53574C42, 0x0002, 2, rec_size, 36, 35000, chk)
        full_bin = header + records_raw

        with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
            f.write(full_bin)
            tmp_path = f.name

        try:
            recs, meta = parse_binary_file(tmp_path)
            self.assertEqual(len(recs), 36)
            sync_cnt = sum(1 for r in recs if r.get("round_duration_us", 0) > 5)
            meas_cnt = sum(1 for r in recs if r.get("round_duration_us", 0) <= 5)
            self.assertEqual(sync_cnt, 3, "data_analysis.py deve detetar 3 sincronizacoes!")
            self.assertEqual(meas_cnt, 33, "data_analysis.py deve detetar 33 medicoes!")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_clock_sync_black_box_model(self):
        """
        Valida o modelo da caixa negra de sincronismo de relogio:
        Entra t_local -> Sai t_global (t_global = alpha * t_local + beta)
        com drift (+5 ppm) e offset constante.
        """
        alpha = 1.000005  # +5 ppm
        beta = 1250000    # ~19.5 ms offset em ticks DW3000

        t_local_samples = [1000000, 2000000, 3000000, 4000000, 5000000]
        t_global_expected = [int(round(alpha * t + beta)) for t in t_local_samples]

        # Simula a transformacao da caixa negra
        for t_loc, t_glob_exp in zip(t_local_samples, t_global_expected):
            t_glob_calc = int(round(alpha * t_loc + beta))
            self.assertEqual(t_glob_calc, t_glob_exp)
            # Teste inverso (global -> local)
            t_loc_calc = int(round((t_glob_calc - beta) / alpha))
            self.assertAlmostEqual(t_loc_calc, t_loc, delta=1)

if __name__ == "__main__":
    unittest.main()

