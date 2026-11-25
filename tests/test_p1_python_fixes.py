# -*- coding: utf-8 -*-
import unittest
import struct
import os
import sys
from pathlib import Path

# Adicionar caminhos python
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT / "python"))

from data_analysis import RECORD_FORMAT, RECORD_SIZE
from raw_session_loader import parse_raw_session_dir, LOADER_VERSION


class TestP1PythonFixes(unittest.TestCase):
    def test_record_format_round_duration_unsigned_short(self):
        """
        Verifica que RECORD_FORMAT usa <H para round_duration_us, permitindo
        desempacotar tempos de ronda até 65535 µs sem corromper em números negativos.
        """
        # Formato esperado: <IIHHiHBBH5s5s5s5s5s5sh
        self.assertIn("HBBH", RECORD_FORMAT, "RECORD_FORMAT deve usar 'H' maiúsculo para uint16 round_duration_us")
        self.assertEqual(RECORD_SIZE, 54, "O tamanho do registo 54B deve ser preservado")

        # Simular registo binário com duração de 45000 µs (> 32767 µs)
        seq = 100
        timestamp_ms = 5000
        src = 0x0001
        dst = 0x0002
        dist_mm = 1250
        dur_us = 45000  # > 32767 µs
        role = 1
        status = 1
        err_code = 0
        t_dummy = b"\x00" * 5
        drift_x100 = 85

        packed = struct.pack(
            RECORD_FORMAT,
            seq, timestamp_ms, src, dst, dist_mm,
            dur_us, role, status, err_code,
            t_dummy, t_dummy, t_dummy, t_dummy, t_dummy, t_dummy, drift_x100
        )

        unpacked = struct.unpack_from(RECORD_FORMAT, packed, 0)
        unpacked_dur = unpacked[5]
        self.assertEqual(unpacked_dur, 45000, "A duração desempacotada deve ser estritamente positiva (45000 µs)")
        self.assertGreater(unpacked_dur, 0, "Não pode ocorrer wrap para valores negativos")

    def test_raw_session_loader_bench_ref1_duration(self):
        """
        Verifica que parse_raw_session_dir alinha correctamente os índices t_mono_ns
        e preserva a duração real de 600 segundos em vez de colapsar para 2.7 segundos.
        """
        session_path = _ROOT / "data" / "validation_sessions" / "20261119T1050Z_bench_ref1"
        if not session_path.is_dir():
            self.skipTest("Sessão bench_ref1 não disponível no ambiente")

        recs, meta = parse_raw_session_dir(str(session_path))
        self.assertGreater(len(recs), 10000, "Deve carregar a amostra decrescida com > 10000 registos")
        self.assertEqual(meta["loader_version"], LOADER_VERSION)

        dur_s = meta["duration_ms"] / 1000.0
        self.assertGreaterEqual(dur_s, 590.0, f"A duração deve ser ~600 s (obtido: {dur_s} s)")
        self.assertLessEqual(dur_s, 610.0, f"A duração não deve exceder 610 s (obtido: {dur_s} s)")
        self.assertGreaterEqual(meta["total_raw_frames"], 1000000, "Total de frames brutos deve ser > 1 milhão")


if __name__ == "__main__":
    unittest.main()