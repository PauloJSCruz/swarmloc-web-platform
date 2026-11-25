#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
SwarmLoc - Download de Dados Crus (Pure Binary Downloader)
===============================================================================
Apenas faz o download dos dados crus enviados pelos módulos e guarda num ficheiro
binário (.bin) tal como estão na memória do módulo.

Não faz conversão, não altera bytes, não calcula distâncias.
Posteriormente, os dados podem ser visualizados ou exportados através da Web UI
ou convertidos diretamente.
===============================================================================
"""

import sys
sys.dont_write_bytecode = True
import os
import time
import struct
import argparse
import subprocess
from datetime import datetime

# Constantes do protocolo de dump binário SwarmLoc
SWARMLOC_BIN_MAGIC = 0x53574C42  # 'SWLB'
SWARMLOC_BIN_END   = 0x454E4442  # 'ENDB'
HEADER_FORMAT      = "<IHBBIII"  # 20 bytes (magic, node_id, role, record_size, count, dur_ms, checksum)
HEADER_SIZE        = struct.calcsize(HEADER_FORMAT)
DEFAULT_BAUD       = 115200


def compute_fnv1a(data: bytes, init_val: int = 0x55AA55AA) -> int:
    """
    Calcula o checksum polinomial FNV-1a de 32 bits conforme implementado no firmware SwarmLoc (src/logger.c).
    Fórmula: checksum = ((checksum ^ b) * 16777619) & 0xFFFFFFFF
    Parâmetros:
        data: buffer de bytes a processar.
        init_val: valor inicial de semente (padrão SwarmLoc: 0x55AA55AA).
    Retorna:
        uint32 com o checksum FNV-1a calculado.
    """
    chk = init_val & 0xFFFFFFFF
    for b in data:
        chk = ((chk ^ b) * 16777619) & 0xFFFFFFFF
    return chk


def verify_binary_dump(raw_bytes: bytes) -> tuple:
    """
    Valida a integridade completa de um dump binário SwarmLoc (SWLB):
    1. Verifica tamanho mínimo e número mágico no cabeçalho (SWLB, 20 bytes).
    2. Valida o tamanho total: HEADER_SIZE (20) + count * rec_size (54) + ENDB (4).
    3. Verifica o marcador de terminação 0x454E4442 ('ENDB').
    4. Calcula e compara o checksum FNV-1a sobre o buffer de registos.

    Retorna:
        (is_valid: bool, details: dict)
    """
    if len(raw_bytes) < HEADER_SIZE:
        return False, {"error": "Buffer menor que o cabeçalho mínimo (20 bytes)", "is_valid": False}

    magic, node_id, role, rec_size, count, dur_ms, chk = struct.unpack_from(HEADER_FORMAT, raw_bytes, 0)
    if magic != SWARMLOC_BIN_MAGIC:
        return False, {"error": f"Magic inválido: 0x{magic:08X} != 0x{SWARMLOC_BIN_MAGIC:08X}", "is_valid": False}

    expected_payload_bytes = count * rec_size
    expected_total_bytes = HEADER_SIZE + expected_payload_bytes + 4

    if len(raw_bytes) < expected_total_bytes:
        return False, {
            "error": f"Tamanho truncado: recebidos {len(raw_bytes)} bytes, esperados {expected_total_bytes}",
            "is_valid": False,
            "expected_bytes": expected_total_bytes,
            "received_bytes": len(raw_bytes),
            "record_count": count
        }

    payload = raw_bytes[HEADER_SIZE : HEADER_SIZE + expected_payload_bytes]
    computed_chk = compute_fnv1a(payload)
    chk_valid = (computed_chk == chk)

    end_marker, = struct.unpack_from("<I", raw_bytes, HEADER_SIZE + expected_payload_bytes)
    end_valid = (end_marker == SWARMLOC_BIN_END)

    is_valid = chk_valid and end_valid
    details = {
        "is_valid": is_valid,
        "node_id": f"{node_id:04X}",
        "role": "Master" if role == 1 else "Slave",
        "record_count": count,
        "record_size": rec_size,
        "duration_ms": dur_ms,
        "header_checksum": f"0x{chk:08X}",
        "computed_checksum": f"0x{computed_chk:08X}",
        "checksum_valid": chk_valid,
        "end_marker": f"0x{end_marker:08X}",
        "end_marker_valid": end_valid,
        "payload_bytes": expected_payload_bytes,
        "total_bytes": expected_total_bytes
    }
    return is_valid, details


class SerialPortBusyError(Exception):
    """Exceção levantada quando a porta COM se encontra ocupada ou bloqueada por outro processo."""
    def __init__(self, port, original_error=None):
        self.port = port
        self.original_error = original_error
        super().__init__(f"A porta {port} encontra-se ocupada ou bloqueada por outro programa ({original_error})")


def release_com_port(port: str) -> bool:
    """
    Tenta libertar uma porta COM ocupada no Windows:
    1. Termina processos terminais conhecidos (putty, teraterm, etc.), NUNCA matando servidores python.
    2. Aguarda que o Windows liberte o identificador de hardware.
    """
    print(f"[SERIAL] A tentar libertar a porta {port}...")
    my_pid = os.getpid()

    try:
        cmd = "tasklist /fo csv /nh"
        out = subprocess.check_output(cmd, shell=True).decode("utf-8", errors="replace")
        for line in out.strip().splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2:
                pname = parts[0].lower()
                pid = parts[1]
                try:
                    pid_int = int(pid)
                except ValueError:
                    continue

                if pid_int == my_pid:
                    continue

                if pname in ["putty.exe", "ttermpro.exe", "realterm.exe", "arduino.exe"]:
                    print(f"[SERIAL] A terminar processo bloqueador {pname} (PID {pid_int})...")
                    subprocess.run(f"taskkill /F /PID {pid_int}", shell=True, capture_output=True)
    except Exception as e:
        print(f"[AVISO] Erro ao enumerar processos bloqueadores: {e}")

    time.sleep(0.5)

    try:
        import serial
        test_s = serial.Serial()
        test_s.port = port
        test_s.baudrate = DEFAULT_BAUD
        test_s.timeout = 0.2
        test_s.open()
        test_s.close()
        print(f"[SERIAL] Porta {port} libertada com sucesso!")
        return True
    except Exception as e:
        print(f"[AVISO] Porta {port} continua inacessível: {e}")
        return False


def list_serial_ports():
    """Deteta portas série associadas a módulos UWB / J-Link."""
    try:
        import serial.tools.list_ports
        ports = serial.tools.list_ports.comports()
        jlink = [p.device for p in ports if "1366" in str(p.hwid) or "JLink" in str(p.description) or "SEGGER" in str(p.manufacturer)]
        return sorted(jlink) if jlink else sorted([p.device for p in ports])
    except Exception:
        return []


def download_binary_from_port(port: str, baud: int = DEFAULT_BAUD, timeout_sec: float = 20.0) -> tuple:
    """
    Liga à porta série do nó UWB, envia o comando 'd' para extração do dump binário puro (SWLB),
    e aguarda a receção completa dos bytes até atingir o marcador final ENDB, validando o checksum FNV-1a.
    """
    try:
        import serial
    except ImportError:
        print("[ERRO] Biblioteca 'pyserial' em falta. Instale com: pip install pyserial")
        return b"", {}

    print(f"[SERIAL] A ligar a {port} @ {baud} baud para download...")
    try:
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = baud
        ser.timeout = 0.5
        ser.dtr = False
        ser.rts = False
        ser.open()
    except Exception as e:
        err_str = str(e)
        if "PermissionError" in err_str or "Acesso negado" in err_str or "Access is denied" in err_str or "could not open port" in err_str:
            print(f"[ERRO] Acesso negado a {port}! A porta está em uso por outro programa.")
            raise SerialPortBusyError(port, e)
        else:
            print(f"[ERRO] Falha ao abrir {port}: {e}")
        return b"", {}

    time.sleep(0.2)
    ser.reset_input_buffer()

    print(f"[SERIAL] A solicitar despejo binário ('d') em {port}...")
    ser.write(b"\r\n\x03\r\nd\r\n")
    ser.flush()

    raw_bytes = bytearray()
    header_found = False
    expected_total_bytes = 0
    meta = {}
    t_start = time.time()
    retry_sent = False

    while (time.time() - t_start < timeout_sec):
        if not header_found and not retry_sent and (time.time() - t_start > 1.5):
            ser.write(b"\r\nd\r\n")
            ser.flush()
            retry_sent = True

        chunk = ser.read(1024)
        if not chunk:
            if header_found and expected_total_bytes > 0 and len(raw_bytes) >= expected_total_bytes:
                break
            continue

        raw_bytes.extend(chunk)

        if not header_found:
            magic_idx = raw_bytes.find(struct.pack("<I", SWARMLOC_BIN_MAGIC))
            if magic_idx != -1:
                raw_bytes = raw_bytes[magic_idx:]
                if len(raw_bytes) >= HEADER_SIZE:
                    header_found = True
                    unpacked = struct.unpack_from(HEADER_FORMAT, raw_bytes, 0)
                    magic, node_id, role, rec_size, count, dur_ms, chk = unpacked

                    role_str = "Master" if role == 1 else "Slave"
                    meta = {
                        "node_id": f"{node_id:04X}",
                        "role": role_str,
                        "record_size": rec_size,
                        "record_count": count,
                        "duration_ms": dur_ms,
                        "checksum": chk
                    }
                    expected_total_bytes = HEADER_SIZE + (count * rec_size) + 4
                    print(f"[SERIAL] Cabeçalho SWLB detetado em {port}: Nó {node_id:04X} ({role_str}), {count} registos ({expected_total_bytes} bytes esperados)...")

        if header_found and expected_total_bytes > 0:
            if len(raw_bytes) >= expected_total_bytes:
                raw_bytes = raw_bytes[:expected_total_bytes]
                is_valid, details = verify_binary_dump(raw_bytes)
                meta.update(details)
                if is_valid:
                    print(f"[SERIAL] Transferência binária concluída com sucesso ({len(raw_bytes)} bytes recebidos de {port}). Checksum FNV-1a (0x{chk:08X}) e marcador ENDB validados!")
                else:
                    print(f"[AVISO] Transferência concluída em {port}, mas falhou a validação de integridade: checksum={details.get('checksum_valid')}, end_marker={details.get('end_marker_valid')}")
                break

    try:
        ser.close()
    except Exception:
        pass

    if not header_found:
        print(f"[AVISO] Nenhum ensaio binário detetado na porta {port}.")
        return b"", {}

    if expected_total_bytes > 0 and len(raw_bytes) < expected_total_bytes:
        print(f"[AVISO] Transferência incompleta em {port}: {len(raw_bytes)}/{expected_total_bytes} bytes recebidos.")
        is_valid, details = verify_binary_dump(raw_bytes)
        meta.update(details)

    return bytes(raw_bytes), meta


def main():
    parser = argparse.ArgumentParser(
        description="SwarmLoc - Download de Dados Crus em Binário Puro (Agnóstico de SO)"
    )
    parser.add_argument("-p", "--port", default="all", help="Porta série ('COM4', '/dev/ttyACM0' ou 'all' para todas)")
    parser.add_argument("-b", "--baud", type=int, default=115200, help="Velocidade em baud (padrão: 115200)")
    parser.add_argument("-o", "--output", default="", help="Ficheiro binário de saída personalizado (.bin)")
    parser.add_argument("-d", "--dir", default="", help="Diretório onde guardar os ficheiros .bin (padrão: scripts/ ou ./)")
    parser.add_argument("-l", "--list", action="store_true", help="Listar portas série disponíveis")
    args = parser.parse_args()

    ports = list_serial_ports()

    if args.list:
        print("Portas série disponíveis:", ports if ports else "Nenhuma")
        return

    target_dir = args.dir if args.dir else "."
    os.makedirs(target_dir, exist_ok=True)

    time_str = datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.port.lower() == "all":
        if not ports:
            print("[AVISO] Nenhuma porta série encontrada. Ligue os módulos por USB.")
            return

        print(f"[INFO] Portas detetadas para download: {ports}")
        sucessos = 0
        for p in ports:
            data, meta = download_binary_from_port(p, args.baud)
            if data:
                fn = f"raw_{meta.get('node_id', '0000')}_{meta.get('role', 'Node')}_{time_str}.bin"
                out_path = os.path.join(target_dir, fn)
                with open(out_path, "wb") as f:
                    f.write(data)
                chk_status = "OK" if meta.get("checksum_valid") else "FALHA"
                print(f"[SUCESSO] Ficheiro binário cru guardado: {out_path} ({len(data)} bytes, {meta.get('record_count', 0)} registos, Checksum: {chk_status})\n")
                sucessos += 1

        if sucessos == 0:
            print("[AVISO] Nenhum ensaio foi descarregado.")
    else:
        data, meta = download_binary_from_port(args.port, args.baud)
        if data:
            out_path = args.output
            if not out_path:
                fn = f"raw_{meta.get('node_id', '0000')}_{meta.get('role', 'Node')}_{time_str}.bin"
                out_path = os.path.join(target_dir, fn)
            with open(out_path, "wb") as f:
                f.write(data)
            chk_status = "OK" if meta.get("checksum_valid") else "FALHA"
            print(f"[SUCESSO] Ficheiro binário cru guardado: {out_path} ({len(data)} bytes, {meta.get('record_count', 0)} registos, Checksum: {chk_status})\n")


if __name__ == "__main__":
    main()
