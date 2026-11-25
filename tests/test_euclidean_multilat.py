"""
===============================================================================
SwarmLoc Unit Tests: Multilateração Euclidiana 3D e Acumulador de Módulos
===============================================================================
Valida:
1. Resolução analítica 3D (Cramer e esferas) com coordenadas conhecidas.
2. Comportamento rigoroso do Acumulador:
   - 4 medições do MESMO módulo NÃO ativam a multilateração (distinct_count == 1).
   - 4 medições de 4 MÓDULOS DIFERENTES ativam com sucesso a multilateração.
   - Caducidade temporal (freshness window).
   - Consumo de medições.
3. Correspondência exata entre a Caixa Negra em C (euclidean_multilat.c / meas_accumulator.c)
   e a Caixa Negra em Python (swarmloc_sci.multilat).
===============================================================================
"""

import unittest
import math
import ctypes
import os
import sys

# Ensure python/ is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "python")))

from multilat import (
    euclidean_multilat_solve_4pt as py_solve,
    MeasurementAccumulator as PyAccumulator,
    compute_trial_3d_positions
)

# Ctypes structures matching C definitions
class Point3D(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_float),
        ("y", ctypes.c_float),
        ("z", ctypes.c_float)
    ]

class Anchor(ctypes.Structure):
    _fields_ = [
        ("node_id", ctypes.c_uint16),
        ("pos", Point3D)
    ]

class Entry(ctypes.Structure):
    _fields_ = [
        ("node_id", ctypes.c_uint16),
        ("distance_m", ctypes.c_float),
        ("timestamp_ms", ctypes.c_uint32),
        ("valid", ctypes.c_bool),
        ("consumed", ctypes.c_bool),
    ]

class Accumulator(ctypes.Structure):
    _fields_ = [
        ("entries", Entry * 8),
        ("default_max_age_ms", ctypes.c_uint32),
    ]


class TestEuclideanMultilateration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Load compiled C DLL if present
        dll_path = os.path.join(os.path.dirname(__file__), "libmultilat_test.dll")
        cls.c_lib = None
        if os.path.exists(dll_path):
            try:
                cls.c_lib = ctypes.CDLL(dll_path)
                cls.c_lib.euclidean_multilat_solve_4pt.argtypes = [
                    ctypes.POINTER(Anchor * 4),
                    ctypes.POINTER(ctypes.c_float * 4),
                    ctypes.POINTER(Point3D),
                    ctypes.POINTER(ctypes.c_float)
                ]
                cls.c_lib.euclidean_multilat_solve_4pt.restype = ctypes.c_int

                cls.c_lib.meas_accumulator_push.argtypes = [
                    ctypes.c_void_p, ctypes.c_uint16, ctypes.c_float, ctypes.c_uint32
                ]
                cls.c_lib.meas_accumulator_push.restype = ctypes.c_bool

                cls.c_lib.meas_accumulator_get_distinct_count.argtypes = [
                    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32
                ]
                cls.c_lib.meas_accumulator_get_distinct_count.restype = ctypes.c_uint8

                cls.c_lib.meas_accumulator_has_4_distinct.argtypes = [
                    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_bool
                ]
                cls.c_lib.meas_accumulator_has_4_distinct.restype = ctypes.c_bool

                cls.c_lib.meas_accumulator_extract_4_distinct.argtypes = [
                    ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
                    ctypes.POINTER(ctypes.c_uint16 * 4),
                    ctypes.POINTER(ctypes.c_float * 4)
                ]
                cls.c_lib.meas_accumulator_extract_4_distinct.restype = ctypes.c_bool
            except Exception as e:
                cls.c_lib = None

    def test_multilat_analytical_solution_exact(self):
        """
        Valida a solução euclidiana contra um ponto tridimensional conhecido:
        Âncoras nos cantos de um prisma não coplanar:
        A1 = (0, 0, 1.0)
        A2 = (5.0, 0, 1.0)
        A3 = (0, 5.0, 1.0)
        A4 = (5.0, 5.0, 3.0)
        Alvo P = (2.1, 3.4, 1.8)
        """
        anchors_py = [
            (0.0, 0.0, 1.0),
            (5.0, 0.0, 1.0),
            (0.0, 5.0, 1.0),
            (5.0, 5.0, 3.0),
        ]
        target = (2.1, 3.4, 1.8)

        # Distâncias euclidianas ideais
        distances = [
            math.sqrt((target[0] - a[0])**2 + (target[1] - a[1])**2 + (target[2] - a[2])**2)
            for a in anchors_py
        ]

        # 1. Testar motor Python
        pos_py, residual_py, status_py = py_solve(anchors_py, distances)
        self.assertEqual(status_py, "OK")
        self.assertIsNotNone(pos_py)
        self.assertAlmostEqual(pos_py[0], target[0], places=3)
        self.assertAlmostEqual(pos_py[1], target[1], places=3)
        self.assertAlmostEqual(pos_py[2], target[2], places=3)
        self.assertAlmostEqual(residual_py, 0.0, places=4)

        # 2. Testar motor C (via ctypes DLL se disponível)
        if self.c_lib is not None:
            c_anchors = (Anchor * 4)(
                Anchor(0x0001, Point3D(*anchors_py[0])),
                Anchor(0x0002, Point3D(*anchors_py[1])),
                Anchor(0x0003, Point3D(*anchors_py[2])),
                Anchor(0x0004, Point3D(*anchors_py[3])),
            )
            c_dists = (ctypes.c_float * 4)(*distances)
            out_pos = Point3D()
            out_res = ctypes.c_float()

            status_c = self.c_lib.euclidean_multilat_solve_4pt(
                ctypes.byref(c_anchors),
                ctypes.byref(c_dists),
                ctypes.byref(out_pos),
                ctypes.byref(out_res)
            )
            self.assertEqual(status_c, 0, "C solver deve retornar EUCLIDEAN_MULTILAT_OK (0)")
            self.assertAlmostEqual(out_pos.x, target[0], places=3)
            self.assertAlmostEqual(out_pos.y, target[1], places=3)
            self.assertAlmostEqual(out_pos.z, target[2], places=3)
            self.assertAlmostEqual(out_res.value, 0.0, places=4)

    def test_multilat_singular_geometry_detection(self):
        """
        Valida que âncoras puramente coplanares (todos z=0) são detetadas como singularidade
        (det(A) ~ 0), rejeitando a resolução sem falhas de divisão por zero.
        """
        coplanar_anchors = [
            (0.0, 0.0, 0.0),
            (5.0, 0.0, 0.0),
            (0.0, 5.0, 0.0),
            (5.0, 5.0, 0.0),
        ]
        distances = [3.0, 3.0, 3.0, 3.0]

        pos_py, res_py, status_py = py_solve(coplanar_anchors, distances)
        self.assertEqual(status_py, "ERR_SINGULAR_GEOMETRY")
        self.assertIsNone(pos_py)

        if self.c_lib is not None:
            c_anchors = (Anchor * 4)(
                Anchor(0x0001, Point3D(*coplanar_anchors[0])),
                Anchor(0x0002, Point3D(*coplanar_anchors[1])),
                Anchor(0x0003, Point3D(*coplanar_anchors[2])),
                Anchor(0x0004, Point3D(*coplanar_anchors[3])),
            )
            c_dists = (ctypes.c_float * 4)(*distances)
            out_pos = Point3D()
            out_res = ctypes.c_float()

            status_c = self.c_lib.euclidean_multilat_solve_4pt(
                ctypes.byref(c_anchors),
                ctypes.byref(c_dists),
                ctypes.byref(out_pos),
                ctypes.byref(out_res)
            )
            # EUCLIDEAN_MULTILAT_ERR_SINGULAR_GEOMETRY == 3
            self.assertEqual(status_c, 3, "C solver deve retornar erro de singularidade geométrica (3)")

    def test_accumulator_rejects_single_module_repeats(self):
        """
        TESTE CRÍTICO (Requisito do Utilizador):
        "Não é medidas == 4, é medidas de 4 modulos diferentes"
        
        Envia 10 medições consecutivas do MESMO módulo 0x0001:
        - distinct_count deve permanecer rigorosamente 1.
        - has_4_distinct deve retornar FALSE!
        """
        acc = PyAccumulator(default_max_age_ms=2000)

        for seq in range(10):
            t_ms = 1000 + seq * 100
            acc.push(node_id=0x0001, distance_m=2.5 + seq * 0.01, timestamp_ms=t_ms)

        now = 2000
        self.assertEqual(acc.get_distinct_count(now), 1, "Mesmo com 10 medições do nó 0x0001, distinct_count deve ser 1!")
        self.assertFalse(acc.has_4_distinct(now), "NÃO pode disparar multilateração com 1 único nó repetido!")

        # Validação na biblioteca C
        if self.c_lib is not None:
            c_acc = Accumulator()
            self.c_lib.meas_accumulator_init(ctypes.byref(c_acc), 2000)
            for seq in range(10):
                t_ms = 1000 + seq * 100
                self.c_lib.meas_accumulator_push(
                    ctypes.byref(c_acc), 0x0001, ctypes.c_float(2.5 + seq * 0.01), t_ms
                )
            cnt_c = self.c_lib.meas_accumulator_get_distinct_count(ctypes.byref(c_acc), now, 2000)
            self.assertEqual(cnt_c, 1, "C accumulator distinct_count deve ser 1!")
            has_4_c = self.c_lib.meas_accumulator_has_4_distinct(ctypes.byref(c_acc), now, 2000, True)
            self.assertFalse(has_4_c, "C accumulator NÃO pode disparar com 1 único nó!")

    def test_accumulator_triggers_on_4_distinct_modules(self):
        """
        TESTE CRÍTICO:
        Quando 4 módulos DIFERENTES (0x0001, 0x0002, 0x0003, 0x0004) enviam medições:
        - distinct_count == 4.
        - has_4_distinct == True.
        - extract_4_distinct extrai com sucesso e marca como consumidos.
        """
        acc = PyAccumulator(default_max_age_ms=2000)

        now = 1500
        acc.push(node_id=0x0001, distance_m=1.2, timestamp_ms=1000)
        acc.push(node_id=0x0002, distance_m=2.3, timestamp_ms=1100)
        acc.push(node_id=0x0003, distance_m=3.4, timestamp_ms=1200)

        # Apenas 3 nós: ainda não pode disparar
        self.assertEqual(acc.get_distinct_count(now), 3)
        self.assertFalse(acc.has_4_distinct(now))

        # Chega o 4º nó distinto
        acc.push(node_id=0x0004, distance_m=4.5, timestamp_ms=1300)

        self.assertEqual(acc.get_distinct_count(now), 4)
        self.assertTrue(acc.has_4_distinct(now))

        # Extração
        extracted = acc.extract_4_distinct(now)
        self.assertIsNotNone(extracted)
        nids, dists = extracted
        self.assertEqual(set(nids), {0x0001, 0x0002, 0x0003, 0x0004})
        self.assertEqual(len(dists), 4)

        # Após extração, require_unconsumed=True deve ser False até chegar novo dado
        self.assertFalse(acc.has_4_distinct(now, require_unconsumed=True))

    def test_accumulator_expiration_window(self):
        """
        Valida que medições fora da janela de caducidade (max_age_ms = 2000)
        expiram e reduzem a contagem de nós distintos.
        """
        acc = PyAccumulator(default_max_age_ms=2000)

        # Nós 1, 2, 3 chegam em t=1000 ms
        acc.push(node_id=0x0001, distance_m=1.0, timestamp_ms=1000)
        acc.push(node_id=0x0002, distance_m=2.0, timestamp_ms=1000)
        acc.push(node_id=0x0003, distance_m=3.0, timestamp_ms=1000)

        # Nó 4 chega muito mais tarde, em t=3500 ms (2.5s depois)
        acc.push(node_id=0x0004, distance_m=4.0, timestamp_ms=3500)

        # Em t=3500 ms, os nós 1, 2, 3 têm idade de 2500 ms > 2000 ms, portanto caducaram
        self.assertEqual(acc.get_distinct_count(3500), 1, "Nós 1, 2, 3 devem ter caducado!")
        self.assertFalse(acc.has_4_distinct(3500))

    def test_trajectory_stream_processing(self):
        """
        Simula uma sequência temporal de pacotes recebidos de 4 emissores
        e valida a reconstrução contínua da trajetória 3D.
        """
        records = []
        anchors = {
            0x0001: (0.0, 0.0, 1.0),
            0x0002: (5.0, 0.0, 1.0),
            0x0003: (0.0, 5.0, 1.0),
            0x0004: (5.0, 5.0, 3.0),
        }
        true_pos = (1.5, 2.5, 1.4)

        # Gera 5 rondas de medição (4 nós em cada ronda)
        seq = 1
        for round_idx in range(5):
            t_base = round_idx * 1000
            for slot_idx, nid in enumerate([0x0001, 0x0002, 0x0003, 0x0004]):
                t_meas = t_base + slot_idx * 200
                ax, ay, az = anchors[nid]
                d = math.sqrt((true_pos[0] - ax)**2 + (true_pos[1] - ay)**2 + (true_pos[2] - az)**2)
                records.append({
                    "seq": seq,
                    "timestamp_ms": t_meas,
                    "src_addr": f"0x{nid:04X}",
                    "dst_addr": "0x0005",
                    "distance_m": d,
                    "round_duration_us": 1
                })
                seq += 1

        result = compute_trial_3d_positions(records, anchors_map=anchors, max_age_ms=2000)
        traj = result["trajectory"]
        stats = result["stats"]

        self.assertEqual(len(traj), 5, "Devem ser calculadas exatamente 5 posições 3D (1 por ronda)!")
        self.assertAlmostEqual(stats["mean_pos"][0], true_pos[0], places=2)
        self.assertAlmostEqual(stats["mean_pos"][1], true_pos[1], places=2)
        self.assertAlmostEqual(stats["mean_pos"][2], true_pos[2], places=2)
        self.assertAlmostEqual(stats["mean_residual_rms"], 0.0, places=3)


if __name__ == "__main__":
    unittest.main()

