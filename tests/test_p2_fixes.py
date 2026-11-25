#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/test_p2_fixes.py
Testes unitários para as correções P2 do sistema SwarmLoc:
1. Unificação da velocidade da luz no ar (c_ar = 299702547 m/s) entre firmware e Python.
2. Cálculo e validação do checksum polinomial FNV-1a (0x55AA55AA) e marcador ENDB (0x454E4442).
3. Verificação de rejeição de payloads binários corrompidos e truncados.
"""

import os
import sys
import struct
import pytest

# Assegurar importação a partir da raiz do repositório
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PYTHON_DIR = os.path.join(REPO_ROOT, "python")
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import scientific_metrics
import data_analysis
import download_raw


def test_speed_of_light_constants():
    """Valida que a constante canónica SPEED_OF_LIGHT é rigorosamente igual a c_ar = 299702547 m/s."""
    assert scientific_metrics.SPEED_OF_LIGHT == 299702547.0
    assert scientific_metrics.SPEED_OF_LIGHT_AIR == 299702547.0
    assert scientific_metrics.SPEED_OF_LIGHT_VACUUM == 299792458.0
    assert data_analysis.SPEED_OF_LIGHT == 299702547.0

    # Conversão de ToF: 1 ns deve corresponder a ~0.299702547 m (ar padrão)
    dist_1ns = 1e-9 * scientific_metrics.SPEED_OF_LIGHT
    assert pytest.approx(dist_1ns, rel=1e-8) == 0.299702547


def test_compute_fnv1a_c_equivalence():
    """Valida o cálculo do algoritmo FNV-1a conforme implementado em src/logger.c."""
    # Buffer vazio deve retornar a base 0x55AA55AA
    assert download_raw.compute_fnv1a(b"") == 0x55AA55AA

    # Teste de vetor passo a passo simulando exatamente o loop C:
    # checksum = ((checksum ^ b) * 16777619U) & 0xFFFFFFFF
    test_data = bytes([0x01, 0x02, 0x03, 0xAA, 0x55, 0xFF, 0x00, 0x42])
    expected = 0x55AA55AA
    for b in test_data:
        expected = ((expected ^ b) * 16777619) & 0xFFFFFFFF

    computed = download_raw.compute_fnv1a(test_data)
    assert computed == expected

    # Validação da função auxiliar em data_analysis
    assert data_analysis.compute_fnv1a(test_data) == expected


def _generate_synthetic_swlb_dump(num_records: int = 2, corrupt_payload: bool = False, corrupt_endb: bool = False):
    """Gera um dump binário SWLB sintético de 54B por registo com cabeçalho de 20B e rodapé ENDB de 4B."""
    magic = download_raw.SWARMLOC_BIN_MAGIC
    node_id = 0x0002
    role = 0  # Slave
    rec_size = data_analysis.RECORD_SIZE  # 54
    count = num_records
    dur_ms = 1000

    # Gerar registos falsos de 54 bytes cada
    record_bytes = bytearray()
    for seq in range(1, count + 1):
        # RECORD_FORMAT = "<IIHHiHBBH5s5s5s5s5s5sh"
        rec = struct.pack(
            data_analysis.RECORD_FORMAT,
            seq,                 # seq (uint32)
            seq * 100,           # timestamp_ms (uint32)
            0x0001,              # src_addr (uint16)
            0x0002,              # dst_addr (uint16)
            1500,                # distance_mm (int32)
            500,                 # dur_us (uint16)
            0,                   # r_role (uint8)
            1,                   # status (uint8)
            0,                   # err_code (uint16)
            b"\x00" * 5,         # t1 (5s)
            b"\x00" * 5,         # t2 (5s)
            b"\x00" * 5,         # t3 (5s)
            b"\x00" * 5,         # t4 (5s)
            b"\x00" * 5,         # t5 (5s)
            b"\x00" * 5,         # t6 (5s)
            85                   # drift_x100 (+0.85 ppm) (int16)
        )
        record_bytes.extend(rec)

    checksum = download_raw.compute_fnv1a(bytes(record_bytes))

    header = struct.pack(
        download_raw.HEADER_FORMAT,
        magic, node_id, role, rec_size, count, dur_ms, checksum
    )

    endb = download_raw.SWARMLOC_BIN_END
    if corrupt_endb:
        endb = 0xDEADBEEF

    payload_to_send = bytearray(record_bytes)
    if corrupt_payload:
        payload_to_send[0] ^= 0xFF

    dump = header + payload_to_send + struct.pack("<I", endb)
    return dump, checksum


def test_verify_binary_dump_valid():
    """Valida que um dump íntegro é aprovado com checksum_valid=True e end_marker_valid=True."""
    dump, chk = _generate_synthetic_swlb_dump(num_records=3)
    is_valid, details = download_raw.verify_binary_dump(dump)
    assert is_valid is True
    assert details["checksum_valid"] is True
    assert details["end_marker_valid"] is True
    assert details["record_count"] == 3
    assert details["computed_checksum"] == f"0x{chk:08X}"

    # Validação cruzada via parse_binary_data
    records, meta = data_analysis.parse_binary_data(dump, "valid_test.bin")
    assert len(records) == 3
    assert meta["checksum_valid"] is True
    assert meta["end_marker_valid"] is True


def test_verify_binary_dump_corrupt_payload():
    """Valida que a corrupção de 1 byte no payload é detetada pelo checksum FNV-1a."""
    dump, chk = _generate_synthetic_swlb_dump(num_records=2, corrupt_payload=True)
    is_valid, details = download_raw.verify_binary_dump(dump)
    assert is_valid is False
    assert details["checksum_valid"] is False
    assert details["end_marker_valid"] is True

    # parse_binary_data deve assinalar checksum inválido
    records, meta = data_analysis.parse_binary_data(dump, "corrupt_test.bin")
    assert meta["checksum_valid"] is False


def test_verify_binary_dump_corrupt_endb():
    """Valida que um marcador ENDB incorreto é rejeitado."""
    dump, chk = _generate_synthetic_swlb_dump(num_records=2, corrupt_endb=True)
    is_valid, details = download_raw.verify_binary_dump(dump)
    assert is_valid is False
    assert details["checksum_valid"] is True
    assert details["end_marker_valid"] is False

    records, meta = data_analysis.parse_binary_data(dump, "corrupt_endb.bin")
    assert meta["end_marker_valid"] is False


def test_verify_binary_dump_truncated():
    """Valida que um ficheiro truncado (incompleto) é rejeitado."""
    dump, _ = _generate_synthetic_swlb_dump(num_records=4)
    truncated = dump[:-10]
    is_valid, details = download_raw.verify_binary_dump(truncated)
    assert is_valid is False
    assert "truncado" in details.get("error", "").lower()
