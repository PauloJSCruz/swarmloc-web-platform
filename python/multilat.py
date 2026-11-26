"""
===============================================================================
SwarmLoc UWB - Caixa Negra de Multilateração Euclidiana 3D e Acumulador Espacial
===============================================================================
Módulo matemático puro correspondente às caixas negras em C:
- euclidean_multilat.h / euclidean_multilat.c
- meas_accumulator.h / meas_accumulator.c

Funcionalidades:
- Resolução analítica fechada de sistemas 3x3 por Regra de Cramer.
- Acumulador de medições por Node_ID com validação de 4 módulos distintos.
- Motor de computação de trajetórias 3D e métricas espaciais (RMS, CEP50, GDOP).
===============================================================================
"""

import math
from typing import Dict, List, Optional, Tuple, Any

# Sem coordenadas predefinidas arbitrárias: o firmware transmite apenas distâncias 1D escalares
# entre nós da rede. Qualquer cálculo 3D requer coordenadas explicitamente fornecidas pelo utilizador.
DEFAULT_ANCHORS: Dict[int, Tuple[float, float, float]] = {}


def euclidean_multilat_solve_4pt(
    anchors: List[Tuple[float, float, float]],
    distances_m: List[float]
) -> Tuple[Optional[Tuple[float, float, float]], float, str]:
    """
    Resolve o sistema de multilateração 3D para 4 âncoras e 4 distâncias.
    
    Subtrai a equação da primeira âncora para linearizar as equações das esferas:
    2*(x_i - x_0)*x + 2*(y_i - y_0)*y + 2*(z_i - z_0)*z = (d_0^2 - d_i^2) + (r_i^2 - r_0^2)
    
    Retorna: ((x, y, z), residual_rms, status_str)
    """
    if len(anchors) != 4 or len(distances_m) != 4:
        return None, 0.0, "ERR_INVALID_COUNT"

    for d in distances_m:
        if d < 0 or math.isnan(d) or math.isinf(d):
            return None, 0.0, "ERR_INVALID_DIST"

    x0, y0, z0 = anchors[0]
    d0 = distances_m[0]
    r0_sq = x0 * x0 + y0 * y0 + z0 * z0
    d0_sq = d0 * d0

    A = []
    B = []

    for k in range(1, 4):
        xi, yi, zi = anchors[k]
        di = distances_m[k]
        ri_sq = xi * xi + yi * yi + zi * zi
        di_sq = di * di

        A.append([
            2.0 * (xi - x0),
            2.0 * (yi - y0),
            2.0 * (zi - z0)
        ])
        B.append((d0_sq - di_sq) + (ri_sq - r0_sq))

    # Determinante principal det(A)
    det_A = (
        A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
        - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
        + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    )

    if abs(det_A) < 1e-6:
        return None, 0.0, "ERR_SINGULAR_GEOMETRY"

    # det(A_x) com B na coluna 0
    det_Ax = (
        B[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
        - A[0][1] * (B[1] * A[2][2] - A[1][2] * B[2])
        + A[0][2] * (B[1] * A[2][1] - A[1][1] * B[2])
    )

    # det(A_y) com B na coluna 1
    det_Ay = (
        A[0][0] * (B[1] * A[2][2] - A[1][2] * B[2])
        - B[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
        + A[0][2] * (A[1][0] * B[2] - B[1] * A[2][0])
    )

    # det(A_z) com B na coluna 2
    det_Az = (
        A[0][0] * (A[1][1] * B[2] - B[1] * A[2][1])
        - A[0][1] * (A[1][0] * B[2] - B[1] * A[2][0])
        + B[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    )

    px = det_Ax / det_A
    py = det_Ay / det_A
    pz = det_Az / det_A

    # Cálculo do resíduo quadrático médio (RMS)
    sum_sq_err = 0.0
    for i in range(4):
        dx = px - anchors[i][0]
        dy = py - anchors[i][1]
        dz = pz - anchors[i][2]
        d_calc = math.sqrt(dx * dx + dy * dy + dz * dz)
        diff = d_calc - distances_m[i]
        sum_sq_err += diff * diff

    residual_rms = math.sqrt(sum_sq_err / 4.0)
    return (px, py, pz), residual_rms, "OK"


class MeasurementAccumulator:
    """
    Acumulador puro de medições indexado por Node_ID.
    Garante o cumprimento da regra:
    "Medições válidas de 4 módulos DIFERENTES".
    """
    def __init__(self, default_max_age_ms: int = 2000):
        self.default_max_age_ms = default_max_age_ms
        self.entries: Dict[int, Dict[str, Any]] = {}

    def push(self, node_id: int, distance_m: float, timestamp_ms: int) -> bool:
        if node_id <= 0 or node_id == 0xFFFF or distance_m < 0:
            return False

        self.entries[node_id] = {
            "node_id": node_id,
            "distance_m": float(distance_m),
            "timestamp_ms": int(timestamp_ms),
            "valid": True,
            "consumed": False
        }
        return True

    def get_distinct_count(self, current_time_ms: int, max_age_ms: Optional[int] = None) -> int:
        eff_max_age = max_age_ms if max_age_ms is not None else self.default_max_age_ms
        count = 0
        for entry in self.entries.values():
            if not entry.get("valid", False):
                continue
            age = max(0, current_time_ms - entry["timestamp_ms"])
            if age <= eff_max_age:
                count += 1
        return count

    def has_4_distinct(
        self,
        current_time_ms: int,
        max_age_ms: Optional[int] = None,
        require_unconsumed: bool = True,
        require_all_new: bool = False
    ) -> bool:
        eff_max_age = max_age_ms if max_age_ms is not None else self.default_max_age_ms
        fresh_entries = []
        unconsumed_count = 0

        for entry in self.entries.values():
            if not entry.get("valid", False):
                continue
            age = max(0, current_time_ms - entry["timestamp_ms"])
            if age <= eff_max_age:
                fresh_entries.append(entry)
                if not entry.get("consumed", False):
                    unconsumed_count += 1

        if len(fresh_entries) < 4:
            return False

        if require_all_new and unconsumed_count < 4:
            return False

        if require_unconsumed and unconsumed_count == 0:
            return False

        return True

    def extract_4_distinct(
        self,
        current_time_ms: int,
        max_age_ms: Optional[int] = None
    ) -> Optional[Tuple[List[int], List[float]]]:
        eff_max_age = max_age_ms if max_age_ms is not None else self.default_max_age_ms
        fresh_entries = []

        for entry in self.entries.values():
            if not entry.get("valid", False):
                continue
            age = max(0, current_time_ms - entry["timestamp_ms"])
            if age <= eff_max_age:
                fresh_entries.append(entry)

        if len(fresh_entries) < 4:
            return None

        # Ordenar por timestamp descendente para utilizar as 4 medições mais frescas
        fresh_entries.sort(key=lambda e: e["timestamp_ms"], reverse=True)
        selected = fresh_entries[:4]

        node_ids = []
        distances = []
        for e in selected:
            e["consumed"] = True
            node_ids.append(e["node_id"])
            distances.append(e["distance_m"])

        return node_ids, distances

    def clear(self):
        self.entries.clear()


def compute_trial_3d_positions(
    records: List[Dict[str, Any]],
    anchors_map: Optional[Dict[int, Tuple[float, float, float]]] = None,
    max_age_ms: int = 2000,
    mode: str = "batch"
) -> Dict[str, Any]:
    """
    Processa uma sequência de registos de ensaio através do acumulador espacial,
    calculando as posições 3D quando existirem medições de 4 módulos distintos.
    
    mode: 'batch' (aguarda que os 4 nós transmitam novo dado) ou 'sliding' (recalcula a cada nova medição válida).
    """
    if anchors_map is None:
        anchors_map = DEFAULT_ANCHORS

    acc = MeasurementAccumulator(default_max_age_ms=max_age_ms)
    trajectory: List[Dict[str, Any]] = []
    require_all_new = (mode == "batch")

    # Ordenar registos temporalmente
    sorted_recs = sorted(records, key=lambda r: (r.get("timestamp_ms", 0), r.get("seq", 0)))

    for r in sorted_recs:
        src = r.get("src_addr", 0)
        dist = r.get("distance_m", None)
        t_ms = r.get("timestamp_ms", 0)

        # Converter string hex "0x0001" para inteiro caso necessário
        if isinstance(src, str):
            try:
                src = int(src, 16)
            except ValueError:
                continue

        if dist is None or dist <= 0.0:
            continue

        acc.push(src, dist, t_ms)

        if acc.has_4_distinct(t_ms, max_age_ms=max_age_ms, require_unconsumed=True, require_all_new=require_all_new):
            extracted = acc.extract_4_distinct(t_ms, max_age_ms=max_age_ms)
            if not extracted:
                continue

            node_ids, dists = extracted
            # Verificar se todos os 4 nós têm coordenadas conhecidas no mapa de âncoras
            if all(nid in anchors_map for nid in node_ids):
                anchors_pts = [anchors_map[nid] for nid in node_ids]
                pos, residual, status = euclidean_multilat_solve_4pt(anchors_pts, dists)

                if status == "OK" and pos is not None:
                    trajectory.append({
                        "timestamp_ms": t_ms,
                        "time_s": round(t_ms / 1000.0, 3),
                        "x": round(pos[0], 4),
                        "y": round(pos[1], 4),
                        "z": round(pos[2], 4),
                        "residual_rms": round(residual, 4),
                        "node_ids": [f"0x{nid:04X}" for nid in node_ids],
                        "distances_m": [round(d, 3) for d in dists]
                    })

    # Estatísticas espaciais da trajetória
    stats = {}
    if trajectory:
        xs = [p["x"] for p in trajectory]
        ys = [p["y"] for p in trajectory]
        zs = [p["z"] for p in trajectory]
        res = [p["residual_rms"] for p in trajectory]

        mean_x = sum(xs) / len(xs)
        mean_y = sum(ys) / len(ys)
        mean_z = sum(zs) / len(zs)
        mean_res = sum(res) / len(res)

        std_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs) / len(xs)) if len(xs) > 1 else 0.0
        std_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys) / len(ys)) if len(ys) > 1 else 0.0
        std_z = math.sqrt(sum((z - mean_z) ** 2 for z in zs) / len(zs)) if len(zs) > 1 else 0.0

        # CEP 50% e CEP 95% horizontais
        r_errors = sorted([math.sqrt((p["x"] - mean_x) ** 2 + (p["y"] - mean_y) ** 2) for p in trajectory])
        idx_50 = int(len(r_errors) * 0.50)
        idx_95 = min(len(r_errors) - 1, int(len(r_errors) * 0.95))
        cep50 = r_errors[idx_50] if r_errors else 0.0
        cep95 = r_errors[idx_95] if r_errors else 0.0

        stats = {
            "count": len(trajectory),
            "mean_pos": [round(mean_x, 4), round(mean_y, 4), round(mean_z, 4)],
            "std_pos": [round(std_x, 4), round(std_y, 4), round(std_z, 4)],
            "mean_residual_rms": round(mean_res, 4),
            "cep50_m": round(cep50, 4),
            "cep95_m": round(cep95, 4),
            "anchors_used": {f"0x{nid:04X}": list(pos) for nid, pos in anchors_map.items()}
        }
    else:
        stats = {
            "count": 0,
            "mean_pos": [0.0, 0.0, 0.0],
            "std_pos": [0.0, 0.0, 0.0],
            "mean_residual_rms": 0.0,
            "cep50_m": 0.0,
            "cep95_m": 0.0,
            "anchors_used": {f"0x{nid:04X}": list(pos) for nid, pos in anchors_map.items()}
        }

    return {
        "trajectory": trajectory,
        "stats": stats
    }
