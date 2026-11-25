#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
SwarmLoc - Módulo Independente de Protocolo e Conversão Binária (7B)
===============================================================================

Este módulo é 100% autónomo e desacoplado do servidor web e de outras ferramentas.
Implementa a especificação física de telemetria binária compacta de alta velocidade
do firmware SwarmLoc (DW3000 / nRF52840):

Estrutura do Frame Binário Compacto (7 bytes):
-------------------------------------------------------------------------------
Byte 0:  0xA5           (Prefixo identificador fixo de sincronismo)
Byte 1:  seq_lo         (Seq de hardware - Byte Menos Significativo, uint16)
Byte 2:  seq_hi         (Seq de hardware - Byte Mais Significativo, uint16)
Byte 3:  dist_lo        (Distância em mm - LSB, int16 little-endian com sinal)
Byte 4:  dist_hi        (Distância em mm - MSB, int16 little-endian com sinal)
Byte 5:  flags          (Flags de estado: Bit 0 = valid_dist, Bit 1 = sync_ok)
Byte 6:  chk            (Checksum XOR: 0xA5 ^ B1 ^ B2 ^ B3 ^ B4 ^ B5)
-------------------------------------------------------------------------------

Funcionalidades:
- Descodificação e validação de integridade por Checksum XOR.
- Desempacotamento de campos (distância em metros, flags de sincronismo e validade).
- Desenrolamento contínuo de sequência (16-bit para 32-bit / 64-bit).
- Reconstrução física de timestamps monotónicos a cadência nominal (~548 Hz / 1825 µs).
- Parser de stream contínuo (separa frames binários de texto ASCII com auto-ressincronização).
- Codificador independente para testes e simulação.
- CLI autónomo para teste unitário, benchmark e leitura direta de portas série.
"""

import sys
import struct
import time
import math
import argparse
from typing import Optional, List, Tuple, Dict, Any, Generator
from dataclasses import dataclass, asdict


# Constantes do Protocolo
SYNC_BYTE = 0xA5
FRAME_SIZE = 7
NOMINAL_CADENCE_US = 1825     # ~547.95 Hz (cadência nominal física Master DW3000)
INVALID_DIST_SENTINEL = -32768 # Valor sentinel para medição inválida (0x8000)
MIN_PHYSICAL_DIST_M = -20.0    # Limite físico inferior aceitável (m)
MAX_PHYSICAL_DIST_M = 100.0    # Limite físico superior aceitável (m)


@dataclass
class BinaryTdoaFrame:
    """Representação estruturada de um frame binário TDoA descodificado."""
    seq16: int
    full_seq: int
    dist_mm: int
    dist_m: Optional[float]
    flags: int
    is_valid_dist: bool
    sync_ok: bool
    checksum: int
    raw_bytes: bytes
    is_twr: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Converte o frame para dicionário simples."""
        d = asdict(self)
        d['raw_hex'] = self.raw_bytes.hex().upper()
        return d


def compute_checksum(data: bytes) -> int:
    """Calcula o checksum XOR dos primeiros 6 bytes do frame (Byte 0 a Byte 5)."""
    if len(data) < 6:
        raise ValueError(f"Dados insuficientes para cálculo de checksum ({len(data)} < 6)")
    chk = 0
    for b in data[:6]:
        chk ^= b
    return chk


def verify_checksum(frame: bytes) -> bool:
    """Valida se o frame possui 7 bytes, inicia em 0xA5 e o checksum XOR confere."""
    if len(frame) != FRAME_SIZE:
        return False
    if frame[0] != SYNC_BYTE:
        return False
    expected_chk = compute_checksum(frame[:6])
    return frame[6] == expected_chk


def encode_binary_tdoa_frame(
    seq: int,
    dist_m: Optional[float] = None,
    is_valid_dist: bool = True,
    sync_ok: bool = True,
    is_twr: bool = False
) -> bytes:
    """
    Codifica medição TDoA ou TWR num frame binário estrito de 7 bytes conforme o firmware.
    
    :param seq: Número de sequência (0 a 65535, truncado a uint16)
    :param dist_m: Distância em metros (convertida internamente para mm, int16)
    :param is_valid_dist: Flag de distância válida (Bit 0)
    :param sync_ok: Flag de relógio sincronizado (Bit 1)
    :param is_twr: Flag de medição TWR de Sincronismo (Bit 2: 1=TWR, 0=TDoA)
    :return: bytes com exatamente 7 bytes
    """
    seq16 = int(seq) & 0xFFFF

    flags = 0
    if sync_ok:
        flags |= 0x02
    if is_twr:
        flags |= 0x04

    if (dist_m is not None and 
        is_valid_dist and 
        MIN_PHYSICAL_DIST_M <= dist_m <= MAX_PHYSICAL_DIST_M and
        not math.isnan(dist_m) and 
        not math.isinf(dist_m)):
        dist_mm = int(round(dist_m * 1000.0))
        # Clamp a int16 com proteção do sentinel -32768
        dist_mm = max(-32767, min(32767, dist_mm))
        flags |= 0x01
    else:
        dist_mm = INVALID_DIST_SENTINEL

    dist_bytes = struct.pack("<h", dist_mm)

    buf = bytearray(7)
    buf[0] = SYNC_BYTE
    buf[1] = seq16 & 0xFF
    buf[2] = (seq16 >> 8) & 0xFF
    buf[3] = dist_bytes[0]
    buf[4] = dist_bytes[1]
    buf[5] = flags
    buf[6] = compute_checksum(buf[:6])

    return bytes(buf)


def decode_binary_tdoa_frame(frame: bytes, full_seq_override: Optional[int] = None) -> Optional[BinaryTdoaFrame]:
    """
    Descodifica um frame binário de 7 bytes sem dependências externas.
    
    :param frame: Buffer de 7 bytes com prefixo 0xA5 e checksum válido
    :param full_seq_override: Sequência desenrolada opcional de 32/64 bits
    :return: BinaryTdoaFrame descodificado ou None se checksum for inválido
    """
    if len(frame) != FRAME_SIZE or frame[0] != SYNC_BYTE:
        return None

    # Validação rigorosa de Checksum XOR
    expected_chk = 0xA5 ^ frame[1] ^ frame[2] ^ frame[3] ^ frame[4] ^ frame[5]
    if frame[6] != expected_chk:
        return None

    seq16 = frame[1] | (frame[2] << 8)
    dist_mm = struct.unpack("<h", frame[3:5])[0]
    flags = frame[5]

    is_valid_dist = bool(flags & 0x01)
    sync_ok = bool(flags & 0x02)
    is_twr = bool(flags & 0x04)

    dist_m: Optional[float] = None
    if is_valid_dist and dist_mm != INVALID_DIST_SENTINEL:
        dist_m = round(dist_mm / 1000.0, 4)

    return BinaryTdoaFrame(
        seq16=seq16,
        full_seq=full_seq_override if full_seq_override is not None else seq16,
        dist_mm=dist_mm,
        dist_m=dist_m,
        flags=flags,
        is_valid_dist=is_valid_dist,
        sync_ok=sync_ok,
        is_twr=is_twr,
        checksum=frame[6],
        raw_bytes=bytes(frame)
    )


class SequenceUnwrapper:
    """
    Desenrola contadores de sequência de 16 bits para inteiros contínuos (32/64 bits),
    lidando com rollovers naturais (0xFFFF -> 0x0000) e out-of-order tolerável.
    """
    def __init__(self, initial_seq: Optional[int] = None):
        self._last_full_seq: Optional[int] = initial_seq

    def unwrap(self, seq16: int) -> int:
        seq16 &= 0xFFFF
        if self._last_full_seq is None:
            self._last_full_seq = seq16
            return seq16

        last_low = self._last_full_seq & 0xFFFF
        high = self._last_full_seq & ~0xFFFF

        # Detetar transição direta de rollover (avanço > 32768 para trás)
        if seq16 < last_low and (last_low - seq16) > 32768:
            high += 0x10000
        # Tolerância a pacotes fora de ordem na viragem
        elif seq16 > last_low and (seq16 - last_low) > 32768:
            if high >= 0x10000:
                high -= 0x10000

        full_seq = high | seq16
        self._last_full_seq = full_seq
        return full_seq

    def reset(self, seq: Optional[int] = None) -> None:
        self._last_full_seq = seq


class SwarmTimelineReconstructor:
    """
    Linha temporal unificada do Enxame UWB (Swarm Master Timeline).
    Garante que todas as portas e nós (S02, S03, S04) que recebem o mesmo Beacon #N
    do Master partilhem exatamente o mesmo instante temporal global t_global_us e
    o mesmo tempo decorrido elapsed_s, eliminando desfasamentos espúrios de threads.
    """
    def __init__(self, dt_nominal_us: float = NOMINAL_CADENCE_US):
        self.dt_nominal_us = dt_nominal_us
        self.t0_seq: Optional[int] = None
        self.t0_epoch: Optional[float] = None
        self.t0_us: Optional[int] = None
        self.last_seq: Optional[int] = None
        self.last_epoch: Optional[float] = None

    def get_timestamp(
        self, full_seq: int, host_now_epoch: float, base_tg_us: Optional[int] = None
    ) -> Tuple[int, float]:
        """
        Retorna (t_global_us, elapsed_s) perfeitamente coerentes e unificados entre todos os nós.
        """
        if (self.t0_seq is None or
            (self.last_seq is not None and full_seq < (self.last_seq - 50000))):
            self.t0_seq = full_seq
            self.t0_epoch = host_now_epoch
            self.t0_us = base_tg_us if base_tg_us is not None else 0
            self.last_seq = full_seq
            self.last_epoch = host_now_epoch
            return self.t0_us, 0.0

        self.last_epoch = host_now_epoch
        if self.last_seq is None or full_seq > self.last_seq:
            self.last_seq = full_seq

        d_seq = full_seq - self.t0_seq
        tg_us = self.t0_us + int(round(d_seq * self.dt_nominal_us))
        elapsed_s = max(0.0, d_seq * (self.dt_nominal_us / 1e6))
        return tg_us, round(elapsed_s, 6)

    def get_current_timestamp(self, host_now_epoch: float) -> Tuple[int, float]:
        """
        Retorna a estimativa temporal global mais recente da timeline do enxame.
        """
        if self.t0_seq is None or self.last_seq is None or self.t0_us is None:
            now_us = int(round(host_now_epoch * 1e6))
            return now_us, 0.0
        d_seq = self.last_seq - self.t0_seq
        tg_us = self.t0_us + int(round(d_seq * self.dt_nominal_us))
        elapsed_s = max(0.0, d_seq * (self.dt_nominal_us / 1e6))
        return tg_us, round(elapsed_s, 6)

    def set_master_anchor(self, master_seq: int, master_tg_us: int) -> None:
        """
        Ancora a timeline do enxame aos valores físicos reais emitidos pelo Master (0x0001).
        Garante sincronismo absoluto e elimina desfasamentos de boot entre nós.
        """
        self.t0_seq = master_seq
        self.t0_us = master_tg_us
        self.last_seq = master_seq

    def reset(self) -> None:
        self.t0_seq = None
        self.t0_epoch = None
        self.t0_us = None
        self.last_seq = None
        self.last_epoch = None


class PhysicalTimestampReconstructor:
    """
    Reconstrói timestamps físicos monotónicos por canal/porta a partir dos deltas
    de sequência emitidos pelo Master DW3000 (~548 Hz nominal, ~1825 µs).
    
    Elimina os pilares verticais (barcode artifacts) causados pelo buffer USB do Windows,
    garantindo que cada frame receba um instante temporal físico e estritamente crescente.
    """
    def __init__(self, dt_nominal_us: int = NOMINAL_CADENCE_US, max_anchor_gap_s: float = 0.040):
        self.dt_nominal_us = dt_nominal_us
        self.max_anchor_gap_s = max_anchor_gap_s
        self.anchor_seq: Optional[int] = None
        self.anchor_tg_us: Optional[int] = None
        self.last_epoch: Optional[float] = None
        self.last_tg_us: int = 0

    def get_timestamp(self, full_seq: int, host_tg_us: int, now_epoch: Optional[float] = None) -> int:
        """
        Retorna o timestamp interpolado fisicamente em microssegundos (tg_us).
        Garante monotonicidade estrita (nunca recua no tempo).
        """
        if now_epoch is None:
            now_epoch = time.time()

        if (self.anchor_seq is None or
            (now_epoch - (self.last_epoch or 0)) > self.max_anchor_gap_s or
            full_seq < self.anchor_seq or
            (full_seq - self.anchor_seq) > 250):
            # Re-ancoragem ao tempo de referência do host, preservando monotonicidade
            cur_tg_us = max(host_tg_us, self.last_tg_us + self.dt_nominal_us)
            self.anchor_seq = full_seq
            self.anchor_tg_us = cur_tg_us
            self.last_epoch = now_epoch
            self.last_tg_us = cur_tg_us
            return cur_tg_us

        d_seq = full_seq - self.anchor_seq
        cur_tg_us = max(self.anchor_tg_us + int(d_seq * self.dt_nominal_us), self.last_tg_us + 1)
        self.last_epoch = now_epoch
        self.anchor_seq = full_seq
        self.anchor_tg_us = cur_tg_us
        self.last_tg_us = cur_tg_us
        return cur_tg_us

    def reset(self) -> None:
        self.anchor_seq = None
        self.anchor_tg_us = None
        self.last_epoch = None
        self.last_tg_us = 0


class BinaryStreamParser:
    """
    Desmultiplexador de stream contínuo de alta velocidade.
    
    Capacidades:
    - Processa fluxos de bytes que misturam pacotes binários compactos (7B) e texto ASCII.
    - Sincroniza e recupera automaticamente de ruído ou perda de bytes.
    - Extrai frames binários com validação imediata de checksum.
    - Extrai linhas ASCII delimitadas por newline (\\n) ou prefixo 0xA5.
    """
    def __init__(self):
        self.buffer = bytearray()
        self.unwrapper = SequenceUnwrapper()
        self.ts_reconstructor = PhysicalTimestampReconstructor()

    def feed(self, chunk: bytes) -> Generator[Tuple[str, Any], None, None]:
        """
        Alimenta o parser com um novo bloco de bytes da porta série ou socket.
        Produz tuplos ('binary', BinaryTdoaFrame) ou ('ascii', str).
        """
        self.buffer.extend(chunk)

        while len(self.buffer) > 0:
            if self.buffer[0] == SYNC_BYTE:
                if len(self.buffer) < FRAME_SIZE:
                    break  # Aguarda bytes adicionais para completar o frame

                # Verificar Checksum XOR do frame binário
                expected_chk = (SYNC_BYTE ^ 
                                self.buffer[1] ^ 
                                self.buffer[2] ^ 
                                self.buffer[3] ^ 
                                self.buffer[4] ^ 
                                self.buffer[5])

                if self.buffer[6] == expected_chk:
                    frame_raw = bytes(self.buffer[:FRAME_SIZE])
                    del self.buffer[:FRAME_SIZE]

                    seq16 = frame_raw[1] | (frame_raw[2] << 8)
                    full_seq = self.unwrapper.unwrap(seq16)
                    frame_obj = decode_binary_tdoa_frame(frame_raw, full_seq_override=full_seq)
                    if frame_obj:
                        yield ('binary', frame_obj)
                    continue
                else:
                    # Checksum inválido: avança 1 byte para ressincronizar
                    del self.buffer[:1]
                    continue

            # Processamento de texto ASCII: procurar delimitador de fim de linha ou próximo prefixo 0xA5
            next_a5 = self.buffer.find(b"\xA5")
            next_nl = self.buffer.find(b"\n")

            if next_nl != -1 and (next_a5 == -1 or next_nl < next_a5):
                line_bytes = bytes(self.buffer[:next_nl])
                del self.buffer[:next_nl + 1]
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
                if line:
                    yield ('ascii', line)
            elif next_a5 != -1:
                line_bytes = bytes(self.buffer[:next_a5])
                del self.buffer[:next_a5]
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
                if line:
                    yield ('ascii', line)
            else:
                break


# =============================================================================
# SUÍTE DE TESTES E CLI AUTÓNOMO
# =============================================================================

def run_self_tests() -> bool:
    """Executa testes unitários estritos da especificação binária."""
    print("=" * 70)
    print("Iniciando testes unitários do protocolo binário 7B SwarmLoc...")
    print("=" * 70)

    # 1. Teste de codificação e descodificação de distância válida
    seq_in = 12345
    dist_in = 1.8543
    raw = encode_binary_tdoa_frame(seq_in, dist_in, is_valid_dist=True, sync_ok=True)
    assert len(raw) == 7, f"Tamanho incorreto: {len(raw)}"
    assert raw[0] == 0xA5, f"Sync incorreto: {raw[0]:#x}"

    decoded = decode_binary_tdoa_frame(raw)
    assert decoded is not None, "Falha na descodificação"
    assert decoded.seq16 == seq_in, f"Seq divergente: {decoded.seq16} != {seq_in}"
    assert abs(decoded.dist_m - 1.854) < 0.002, f"Distância divergente: {decoded.dist_m}"
    assert decoded.is_valid_dist is True, "valid_dist deve ser True"
    assert decoded.sync_ok is True, "sync_ok deve ser True"
    print("✔ Teste 1: Codificação e descodificação de medição válida (1.854m) concluído com sucesso.")

    # 2. Teste de distância negativa válida (ex: -0.05m em calibração zero)
    raw_neg = encode_binary_tdoa_frame(500, -0.050, is_valid_dist=True, sync_ok=True)
    dec_neg = decode_binary_tdoa_frame(raw_neg)
    assert dec_neg is not None
    assert dec_neg.dist_mm == -50
    assert abs(dec_neg.dist_m - (-0.050)) < 0.001
    print("✔ Teste 2: Distâncias negativas legítimas (calibração zero) preservadas com fidelidade.")

    # 3. Teste de medição inválida (sentinel -32768)
    raw_inv = encode_binary_tdoa_frame(999, None, is_valid_dist=False, sync_ok=False)
    dec_inv = decode_binary_tdoa_frame(raw_inv)
    assert dec_inv is not None
    assert dec_inv.dist_m is None
    assert dec_inv.dist_mm == INVALID_DIST_SENTINEL
    assert dec_inv.is_valid_dist is False
    assert dec_inv.sync_ok is False
    print("✔ Teste 3: Sentinel de medição inválida / sem sincronismo validado.")

    # 4. Teste de corrupção e rejeição de Checksum
    corrupted = bytearray(raw)
    corrupted[3] ^= 0xFF
    assert decode_binary_tdoa_frame(bytes(corrupted)) is None
    print("✔ Teste 4: Rejeição instantânea de corrupção por Checksum XOR comprovada.")

    # 5. Teste de desenrolamento de sequência (rollover 16-bit -> 32-bit)
    unwrapper = SequenceUnwrapper()
    assert unwrapper.unwrap(65534) == 65534
    assert unwrapper.unwrap(65535) == 65535
    assert unwrapper.unwrap(0) == 65536
    assert unwrapper.unwrap(1) == 65537
    print("✔ Teste 5: Desenrolamento de sequência com rollover de 16 para 32 bits validado.")

    # 6. Teste de fluxo misto (Binário + ASCII) com BinaryStreamParser
    parser = BinaryStreamParser()
    test_stream = (
        b"[TL:100.0s|TG:100.0s] Boot Slave 0x0002\r\n" +
        raw +
        b"[STATUS] Sincronismo OK\n" +
        raw_neg +
        b"\xA5\x01\x02" # Frame incompleto que deve aguardar no buffer
    )
    results = list(parser.feed(test_stream))
    assert len(results) == 4, f"Esperados 4 eventos, obtidos {len(results)}"
    assert results[0][0] == 'ascii'
    assert "Boot Slave" in results[0][1]
    assert results[1][0] == 'binary'
    assert results[1][1].seq16 == seq_in
    assert results[2][0] == 'ascii'
    assert "STATUS" in results[2][1]
    assert results[3][0] == 'binary'
    assert results[3][1].dist_mm == -50
    print("✔ Teste 6: Stream misto (Binário 7B intercalado com ASCII UART) descodificado sem falhas.")

    # 7. Benchmark de performance
    start_t = time.perf_counter()
    n_packets = 200000
    p = BinaryStreamParser()
    # Chunk com 10 frames binários
    block = raw * 10
    total_decoded = 0
    for _ in range(n_packets // 10):
        for kind, item in p.feed(block):
            if kind == 'binary':
                total_decoded += 1
    elapsed = time.perf_counter() - start_t
    rate = total_decoded / elapsed
    print(f"✔ Benchmark: {total_decoded} frames descodificados em {elapsed:.3f}s ({rate:,.0f} frames/segundo)")

    print("=" * 70)
    print("TODOS OS TESTES UNITÁRIOS DO PROTOCOLO BINÁRIO FORAM APROVADOS!")
    print("=" * 70)
    return True


def main():
    parser = argparse.ArgumentParser(description="SwarmLoc - Protocolo e Descodificador Binário 7B Independente")
    parser.add_argument("--test", action="store_true", help="Executa suíte de testes unitários e benchmark")
    parser.add_argument("--decode-hex", type=str, help="Descodifica uma sequência hexadecimal (ex: A539303E070386)")
    parser.add_argument("--encode", action="store_true", help="Codifica um frame de exemplo")
    parser.add_argument("--seq", type=int, default=1000, help="Sequência para codificação")
    parser.add_argument("--dist", type=float, default=1.5, help="Distância em metros para codificação")
    parser.add_argument("--port", type=str, help="Lê diretamente de uma porta série (ex: COM5)")
    parser.add_argument("--baud", type=int, default=115200, help="Baudrate para porta série (default: 115200)")

    args = parser.parse_args()

    if args.test or len(sys.argv) == 1:
        run_self_tests()
        return

    if args.encode:
        frame_bytes = encode_binary_tdoa_frame(args.seq, args.dist, is_valid_dist=True, sync_ok=True)
        print(f"Frame codificado (7B): {frame_bytes.hex().upper()}")
        print(f"Bytes: {[f'0x{b:02X}' for b in frame_bytes]}")
        return

    if args.decode_hex:
        raw = bytes.fromhex(args.decode_hex.replace(" ", "").replace("0x", ""))
        frame = decode_binary_tdoa_frame(raw)
        if frame:
            print("Frame descodificado com sucesso:")
            for k, v in frame.to_dict().items():
                print(f"  {k:15s}: {v}")
        else:
            print("Erro: frame inválido (tamanho != 7, prefixo != 0xA5 ou falha de checksum).")
        return

    if args.port:
        try:
            import serial
        except ImportError:
            print("Erro: pyserial não está instalado. Execute: pip install pyserial")
            return

        print(f"A abrir {args.port} a {args.baud} baud...")
        ser = serial.Serial(args.port, args.baud, timeout=0.1)
        stream_parser = BinaryStreamParser()
        count = 0
        t0 = time.time()

        try:
            while True:
                chunk = ser.read(1024)
                if not chunk:
                    continue
                for kind, item in stream_parser.feed(chunk):
                    if kind == 'binary':
                        count += 1
                        if count % 250 == 0:
                            fps = count / (time.time() - t0)
                            print(f"[BIN] Seq: #{item.full_seq:06d} | Dist: {item.dist_m:6.4f}m | Rate: {fps:5.1f} Hz")
                    elif kind == 'ascii':
                        print(f"[TXT] {item}")
        except KeyboardInterrupt:
            print(f"\nTerminado pelo utilizador. Total de frames binários: {count}")
        finally:
            ser.close()


if __name__ == "__main__":
    main()
