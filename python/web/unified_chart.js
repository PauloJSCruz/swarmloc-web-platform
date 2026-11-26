/**
 * SwarmLoc — Componente Unificado de Gráficos UWB (Live & Análises)
 * ==============================================================================
 * Implementação única reutilizável partilhada entre o Gráfico Live e o
 * Gráfico de Análises. Garante consistência visual, integridade de dados e
 * rigor científico em toda a aplicação.
 *
 * Eixos Suportados:
 *   Eixo X (Temporal / Sequencial):
 *     - 't_global': Tempo global sincronizado de hardware (s com resolução µs)
 *     - 'elapsed': Tempo decorrido desde o início da sessão/ensaio (s com µs)
 *     - 'seq': Sequência normalizada dos Ciclos do Algoritmo SwarmLoc (unificada entre TWR e TDoA)
 *     - 'seq_rf': Contador de sequência bruto do pacote / beacon DW3000 de hardware
 *
 *   Eixo Y (Medido / Calculado):
 *     - 'dist_m': Distância medida diretamente (m)
 *     - 'drift_ppm': Desvio de frequência de relógio do rádio DW3000 (ppm)
 *     - 'drift_dist_m': Drift equivalente em distância: c * drift_ppm * 1e-6 * dt_sync (m)
 *     - 'freq_hz': Frequência real de eventos do canal baseada em hardware (Hz)
 *
 * Filtros Combináveis (Interseção Rigorosa das Condições Ativas):
 *   - 3.1. Módulo: 0x0001 (Master), 0x0002 (S2), 0x0003 (S3), 0x0004 (S4)
 *   - 3.2. Ligação: 0x0001 ↔ 0x0002, 0x0001 ↔ 0x0003, 0x0001 ↔ 0x0004
 *   - 3.3. Sentido: M01 → S02, S02 → M01, M01 → S03, S03 → M01, M01 → S04, S04 → M01
 * ==============================================================================
 */

(function (window) {
    'use strict';

    // Constante física da velocidade da luz no ar / vácuo (m/s)
    const SPEED_OF_LIGHT_MPS = 299702547.0; // c_ar unificado com firmware

    // Definições Semânticas dos Eixos
    const AXIS_DEFS = {
        x: {
            t_global: {
                id: 't_global',
                label: 'Tempo Global TG',
                unit: 's',
                provenance: 'FIRMWARE_HARDWARE',
                description: 'Tempo global absoluto sincronizado entre nós UWB (base DW3000/MCU)',
                formatTick: (v) => {
                    const num = Number(v);
                    if (num > 100000000) {
                        const d = new Date(num * 1000);
                        const timeStr = d.toLocaleTimeString('pt-PT', { hour12: false });
                        const ms = Math.floor((num % 1) * 1000);
                        return ms > 0 ? `${timeStr}.${String(ms).padStart(3, '0')}` : timeStr;
                    }
                    if (num % 1 === 0) return `${num}s`;
                    const s = num.toFixed(3);
                    return `${parseFloat(s)}s`;
                },
                formatTooltip: (v, raw) => {
                    const num = Number(v);
                    if (num > 100000000) {
                        const d = new Date(num * 1000);
                        const timeStr = d.toLocaleTimeString('pt-PT', { hour12: false });
                        const ms = String(Math.floor((num % 1) * 1000)).padStart(3, '0');
                        const elStr = (raw && raw.elapsed_s != null) ? ` (Δt: +${Number(raw.elapsed_s).toFixed(3)}s)` : '';
                        return `${timeStr}.${ms}${elStr} (TG Hardware)`;
                    }
                    return `${num.toFixed(6)} s (TG Hardware)`;
                }
            },
            elapsed: {
                id: 'elapsed',
                label: 'Tempo Decorrido Δt',
                unit: 's',
                provenance: 'FIRMWARE_HARDWARE',
                description: 'Tempo decorrido a partir do primeiro pacote recebido (com resolução µs)',
                formatTick: (v) => {
                    const num = Number(v);
                    if (num % 1 === 0) return `+${num}s`;
                    const s = num.toFixed(3);
                    return `+${parseFloat(s)}s`;
                },
                formatTooltip: (v) => `+${Number(v).toFixed(6)} s (Δt)`
            },
            seq: {
                id: 'seq',
                label: 'Sequência (Ciclos do Algoritmo)',
                unit: 'ciclo',
                provenance: 'FIRMWARE_HARDWARE',
                description: 'Ciclos discretos de execução do algoritmo SwarmLoc normalizados entre protocolos (TWR e TDoA)',
                formatTick: (v) => `#${Math.round(v)}`,
                formatTooltip: (v, raw) => {
                    const hwStr = (raw && raw.seq_raw !== undefined && raw.seq_raw !== null && raw.seq_raw !== v)
                        ? ` [HW #${raw.seq_raw}]`
                        : '';
                    return `Ciclo #${Math.round(v)}${hwStr}`;
                }
            },
            seq_rf: {
                id: 'seq_rf',
                label: 'Sequência RF (Contador DW3000)',
                unit: 'nº',
                provenance: 'FIRMWARE_HARDWARE',
                description: 'Contador de sequência bruto do pacote ou beacon de rádio emitido pelo hardware',
                formatTick: (v) => `#${Math.round(v)}`,
                formatTooltip: (v) => `Pacote RF #${Math.round(v)}`
            }
        },
        y: {
            dist_m: {
                id: 'dist_m',
                label: 'Distância Medida Bruta (Física Real / Deriva)',
                unit: 'm',
                provenance: 'FIRMWARE_COMPUTED',
                description: 'Distância física direta do rádio (inclui a deriva natural do oscilador de quartzo)',
                decimals: 4,
                isValid: (v) => v !== null && v !== undefined && !isNaN(v) && v >= -2.0 && v <= 16.0,
                extract: (r) => {
                    if (r.src === '0001' && (r.dst === '*' || r.dst === '000*' || r.peer_id === '*')) {
                        return null;
                    }
                    const d = (r.raw_dist_m !== undefined && r.raw_dist_m !== null)
                        ? Number(r.raw_dist_m)
                        : ((r.distance_m !== undefined && r.distance_m !== null)
                            ? Number(r.distance_m)
                            : ((r.dist_m !== undefined && r.dist_m !== null)
                                ? Number(r.dist_m)
                                : (r.distance_mm !== undefined && r.distance_mm !== null ? Number(r.distance_mm) / 1000.0 : null)));
                    if (d === 0.0 && (r.protocol === 'TDoA' || r.type === 'tdoa')) {
                        return null;
                    }
                    return (d !== null && d >= -2.0 && d <= 16.0) ? d : null;
                }
            },
            dist_comp_m: {
                id: 'dist_comp_m',
                label: 'Distância Compensada (Alvo TWR Ground-Truth)',
                unit: 'm',
                provenance: 'APP_CALCULATED',
                description: 'Distância estabilizada no alvo físico pelo padrão Two-Way Ranging (elimina dente de serra)',
                decimals: 4,
                isValid: (v) => v !== null && v !== undefined && !isNaN(v) && v >= -2.0 && v <= 16.0,
                extract: (r) => {
                    if (r.src === '0001' && (r.dst === '*' || r.dst === '000*' || r.peer_id === '*')) {
                        return null;
                    }
                    const d = (r.dist_comp_m !== undefined && r.dist_comp_m !== null)
                        ? Number(r.dist_comp_m)
                        : ((r.ref_dist_m !== undefined && r.ref_dist_m !== null)
                            ? Number(r.ref_dist_m)
                            : ((r.dist_m !== undefined && r.dist_m !== null) ? Number(r.dist_m) : null));
                    if (d === 0.0 && (r.protocol === 'TDoA' || r.type === 'tdoa')) {
                        return null;
                    }
                    return (d !== null && d >= -2.0 && d <= 16.0) ? d : null;
                }
            },
            drift_ppm: {
                id: 'drift_ppm',
                label: 'Drift de Relógio',
                unit: 'ppm',
                provenance: 'FIRMWARE_COMPUTED',
                description: 'Desvio de frequência de relógio (Carrier Frequency Offset) medido pelo rádio DW3000',
                decimals: 3,
                isValid: (v) => v !== null && v !== undefined && !isNaN(v) && Math.abs(v) <= 100.0,
                extract: (r) => {
                    const ppm = (r.clock_drift_ppm !== undefined && r.clock_drift_ppm !== null)
                        ? Number(r.clock_drift_ppm)
                        : (r.drift_ppm !== undefined && r.drift_ppm !== null ? Number(r.drift_ppm) : null);
                    return (ppm !== null && Math.abs(ppm) <= 100.0) ? ppm : null;
                }
            },
            drift_dist_m: {
                id: 'drift_dist_m',
                label: 'Drift Equivalente em Distância',
                unit: 'm',
                provenance: 'APP_CALCULATED',
                description: 'Erro acumulado por desvio de relógio: c * drift_ppm * 1e-6 * dt_sync',
                decimals: 4,
                isValid: (v) => v !== null && v !== undefined && !isNaN(v),
                extract: (r) => {
                    if (r.real_error_m !== undefined && r.real_error_m !== null && !isNaN(r.real_error_m)) {
                        return Number(r.real_error_m);
                    }
                    if (r.drift_equiv_dist_m !== undefined && r.drift_equiv_dist_m !== null && !isNaN(r.drift_equiv_dist_m)) {
                        return Number(r.drift_equiv_dist_m);
                    }
                    const ppm = (r.clock_drift_ppm !== undefined && r.clock_drift_ppm !== null)
                        ? Number(r.clock_drift_ppm)
                        : (r.drift_ppm !== undefined && r.drift_ppm !== null ? Number(r.drift_ppm) : null);
                    if (ppm !== null && !isNaN(ppm)) {
                        const dt_s = Number(r.sync_period_s || (r.sync_period_ms ? r.sync_period_ms / 1000.0 : 0.5));
                        return SPEED_OF_LIGHT_MPS * (ppm * 1e-6) * dt_s;
                    }
                    return null;
                }
            },
            freq_hz: {
                id: 'freq_hz',
                label: 'Frequência de Eventos',
                unit: 'Hz',
                provenance: 'APP_CALCULATED',
                description: 'Taxa física de pacotes do canal baseada em timestamps de hardware Δt_hw',
                decimals: 1,
                isValid: (v) => v !== null && v !== undefined && !isNaN(v) && v > 0 && v < 1000.0,
                extract: (r) => {
                    if (r.rate_hz !== undefined && r.rate_hz !== null && !isNaN(r.rate_hz) && r.rate_hz > 0) {
                        return Number(r.rate_hz);
                    }
                    if (r.f_rf_event_hz !== undefined && r.f_rf_event_hz !== null && !isNaN(r.f_rf_event_hz) && r.f_rf_event_hz > 0) {
                        return Number(r.f_rf_event_hz);
                    }
                    return null;
                }
            }
        }
    };

    // Paleta Cromática Canónica por Nó Remoto e Protocolo (Dinâmica e Invariante à Rotação de Master)
    const NODE_PALETTES = {
        '0001': {
            name: 'Node 1',
            twrMtoS: { border: '#0284c7', bg: 'rgba(2, 132, 199, 0.15)' },
            twrStoM: { border: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
            tdoa:    { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.18)', dash: [4, 4] }
        },
        '0002': {
            name: 'Node 2',
            twrMtoS: { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)' },
            twrStoM: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)' },
            tdoa:    { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.18)', dash: [4, 4] }
        },
        '0003': {
            name: 'Node 3',
            twrMtoS: { border: '#ffd600', bg: 'rgba(255, 214, 0, 0.15)' },
            twrStoM: { border: '#f72585', bg: 'rgba(247, 37, 133, 0.15)' },
            tdoa:    { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)', dash: [4, 4] }
        },
        '0004': {
            name: 'Node 4',
            twrMtoS: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
            twrStoM: { border: '#ff6d00', bg: 'rgba(255, 109, 0, 0.15)' },
            tdoa:    { border: '#ffffff', bg: 'rgba(255, 255, 255, 0.20)', dash: [4, 4] }
        },
        '0005': {
            name: 'Node 5',
            twrMtoS: { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)' },
            twrStoM: { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)' },
            tdoa:    { border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.18)', dash: [4, 4] }
        },
        '0006': {
            name: 'Node 6',
            twrMtoS: { border: '#e879f9', bg: 'rgba(232, 121, 249, 0.15)' },
            twrStoM: { border: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)' },
            tdoa:    { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', dash: [4, 4] }
        }
    };

    function resolveChannelInfo(chKey) {
        const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
        const match = chKey.match(/^([0-9A-Fa-f]{4})->([0-9A-Fa-f]{4})(?::(tdoa|twr))?/i);
        if (!match) {
            return {
                border: '#38bdf8',
                bg: 'rgba(56, 189, 248, 0.15)',
                name: chKey,
                proto: chKey.toLowerCase().includes('tdoa') ? 'TDoA' : 'TWR',
                isPrimary: false,
                remoteNode: null,
                src: '',
                dst: ''
            };
        }
        const src = match[1].toUpperCase();
        const dst = match[2].toUpperCase();
        const isTdoa = match[3] ? (match[3].toLowerCase() === 'tdoa') : chKey.toLowerCase().includes('tdoa');
        const proto = isTdoa ? 'TDoA' : 'TWR';

        const isSrcMaster = (src === master);
        const isDstMaster = (dst === master);
        const isPrimary = (isSrcMaster || isDstMaster);
        const remoteNode = isSrcMaster ? dst : (isDstMaster ? src : dst);
        const palette = NODE_PALETTES[remoteNode] || NODE_PALETTES['0002'];

        const masterNum = parseInt(master, 16);
        const remoteNum = parseInt(remoteNode, 16);
        const mTag = 'M' + masterNum.toString().padStart(2, '0');
        const sTag = 'S' + remoteNum.toString().padStart(2, '0');

        let name = '';
        let border = '#38bdf8';
        let bg = 'rgba(56, 189, 248, 0.15)';
        let dash = undefined;

        if (isPrimary) {
            if (isTdoa) {
                name = `${mTag} → ${sTag} [TDoA]`;
                border = palette.tdoa.border;
                bg = palette.tdoa.bg;
                dash = palette.tdoa.dash;
            } else {
                if (isSrcMaster) {
                    name = `${mTag} → ${sTag} [TWR]`;
                    border = palette.twrMtoS.border;
                    bg = palette.twrMtoS.bg;
                } else {
                    name = `${sTag} → ${mTag} [TWR]`;
                    border = palette.twrStoM.border;
                    bg = palette.twrStoM.bg;
                }
            }
        } else {
            const sSrc = 'S' + parseInt(src, 16).toString().padStart(2, '0');
            const sDst = 'S' + parseInt(dst, 16).toString().padStart(2, '0');
            name = `${sSrc} → ${sDst} [${proto}]`;
            border = isTdoa ? '#94a3b8' : '#64748b';
            bg = 'rgba(100, 116, 139, 0.12)';
            dash = [3, 3];
        }

        return {
            border,
            bg,
            name,
            proto,
            dash,
            isPrimary,
            remoteNode,
            masterNode: master,
            src,
            dst
        };
    }

    // Paleta Cromática Canónica por Ligação Direcional e Protocolo (9 Cores 100% Distintas e Exclusivas)
    const CHANNEL_COLORS = {
        // Módulo 2 (S02) - 3 Cores Exclusivas:
        // 1. Azul Real Cobalto (M01 -> S02 [TWR])
        '0001->0002': { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', name: 'M01 → S02 [TWR]', proto: 'TWR' },
        '0001->0002:twr': { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', name: 'M01 → S02 [TWR]', proto: 'TWR' },
        // 2. Verde Brilhante (S02 -> M01 [TWR])
        '0002->0001': { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', name: 'S02 → M01 [TWR]', proto: 'TWR' },
        '0002->0001:twr': { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', name: 'S02 → M01 [TWR]', proto: 'TWR' },
        // 3. Ciano Elétrico (M01 -> S02 [TDoA])
        '0001->0002:tdoa': { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.15)', name: 'M01 → S02 [TDoA]', proto: 'TDoA', dash: [4, 4] },
        '0002->0001:tdoa': { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.15)', name: 'M01 → S02 [TDoA]', proto: 'TDoA', dash: [4, 4] },

        // Módulo 3 (S03) - 3 Cores Exclusivas:
        // 4. Amarelo Canário Puro (M01 -> S03 [TWR])
        '0001->0003': { border: '#ffd600', bg: 'rgba(255, 214, 0, 0.15)', name: 'M01 → S03 [TWR]', proto: 'TWR' },
        '0001->0003:twr': { border: '#ffd600', bg: 'rgba(255, 214, 0, 0.15)', name: 'M01 → S03 [TWR]', proto: 'TWR' },
        // 5. Rosa Choque / Magenta (S03 -> M01 [TWR])
        '0003->0001': { border: '#f72585', bg: 'rgba(247, 37, 133, 0.15)', name: 'S03 → M01 [TWR]', proto: 'TWR' },
        '0003->0001:twr': { border: '#f72585', bg: 'rgba(247, 37, 133, 0.15)', name: 'S03 → M01 [TWR]', proto: 'TWR' },
        // 6. Vermelho Escarlate Vivo (M01 -> S03 [TDoA])
        '0001->0003:tdoa': { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', name: 'M01 → S03 [TDoA]', proto: 'TDoA', dash: [4, 4] },
        '0003->0001:tdoa': { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', name: 'M01 → S03 [TDoA]', proto: 'TDoA', dash: [4, 4] },

        // Módulo 4 (S04) - 3 Cores Exclusivas:
        // 7. Roxo / Violeta (M01 -> S04 [TWR])
        '0001->0004': { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', name: 'M01 → S04 [TWR]', proto: 'TWR' },
        '0001->0004:twr': { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', name: 'M01 → S04 [TWR]', proto: 'TWR' },
        // 8. Laranja Fogo (S04 -> M01 [TWR])
        '0004->0001': { border: '#ff6d00', bg: 'rgba(255, 109, 0, 0.15)', name: 'S04 → M01 [TWR]', proto: 'TWR' },
        '0004->0001:twr': { border: '#ff6d00', bg: 'rgba(255, 109, 0, 0.15)', name: 'S04 → M01 [TWR]', proto: 'TWR' },
        // 9. Branco Puro com Brilho (M01 -> S04 [TDoA])
        '0001->0004:tdoa': { border: '#ffffff', bg: 'rgba(255, 255, 255, 0.20)', name: 'M01 → S04 [TDoA]', proto: 'TDoA', dash: [4, 4] },
        '0004->0001:tdoa': { border: '#ffffff', bg: 'rgba(255, 255, 255, 0.20)', name: 'M01 → S04 [TDoA]', proto: 'TDoA', dash: [4, 4] },

        // Módulo 5 (S05) - 3 Cores Exclusivas:
        '0001->0005': { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)', name: 'M01 → S05 [TWR]', proto: 'TWR' },
        '0001->0005:twr': { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)', name: 'M01 → S05 [TWR]', proto: 'TWR' },
        '0005->0001': { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)', name: 'S05 → M01 [TWR]', proto: 'TWR' },
        '0005->0001:twr': { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)', name: 'S05 → M01 [TWR]', proto: 'TWR' },
        '0001->0005:tdoa': { border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.18)', name: 'M01 → S05 [TDoA]', proto: 'TDoA', dash: [4, 4] },
        '0005->0001:tdoa': { border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.18)', name: 'M01 → S05 [TDoA]', proto: 'TDoA', dash: [4, 4] },

        // Módulo 6 (S06) - 3 Cores Exclusivas:
        '0001->0006': { border: '#e879f9', bg: 'rgba(232, 121, 249, 0.15)', name: 'M01 → S06 [TWR]', proto: 'TWR' },
        '0001->0006:twr': { border: '#e879f9', bg: 'rgba(232, 121, 249, 0.15)', name: 'M01 → S06 [TWR]', proto: 'TWR' },
        '0006->0001': { border: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)', name: 'S06 → M01 [TWR]', proto: 'TWR' },
        '0006->0001:twr': { border: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)', name: 'S06 → M01 [TWR]', proto: 'TWR' },
        '0001->0006:tdoa': { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', name: 'M01 → S06 [TDoA]', proto: 'TDoA', dash: [4, 4] },
        '0006->0001:tdoa': { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', name: 'M01 → S06 [TDoA]', proto: 'TDoA', dash: [4, 4] }
    };

    function normalizeId(id) {
        if (!id) return '';
        let s = String(id).trim().toUpperCase().replace(/^0X/, '');
        if (s.length < 4 && !isNaN(parseInt(s, 16))) {
            s = s.padStart(4, '0');
        }
        return s;
    }

    /**
     * Classe do Componente Unificado de Gráficos UWB
     */
    class UnifiedUwbChart {
        /**
         * @param {Object} options
         * @param {string} options.canvasId - ID do elemento canvas (ex: 'live-chart' ou 'analysis-chart')
         * @param {string} options.mode - 'live' | 'analysis'
         * @param {string} [options.controlsContainerId] - ID do container dos controlos e filtros
         * @param {string} [options.statsContainerId] - ID do container das estatísticas
         * @param {Function} [options.onFilterChange] - Callback opcional aquando da alteração de filtros
         */
        constructor(options) {
            this.canvasId = options.canvasId;
            this.mode = options.mode || 'analysis';
            this.controlsContainerId = options.controlsContainerId;
            this.statsContainerId = options.statsContainerId;
            this.onFilterChange = options.onFilterChange || null;

            // Variáveis dos Eixos
            this.xAxis = 't_global'; // 't_global' | 'elapsed' | 'seq' | 'seq_rf'
            this.yAxis = 'dist_m';   // 'dist_m' | 'drift_ppm' | 'drift_dist_m' | 'freq_hz'

            // Configuração da Janela e Estilo
            this.windowDuration_s = (this.mode === 'live') ? 60 : null; // Live = padrão 60s
            this.styleType = 'line_points'; // 'line_points' | 'line' | 'points'

            // Filtros Interativos Combináveis (Interseção Rigorosa)
            this.filters = {
                modules: new Set(),     // '0001'..'0006'
                pairs: new Set(),       // '0001-0002', 'hub-0002', etc.
                directions: new Set(),  // '0001->0002:tdoa', etc.
                protocol: 'all',        // 'all' | 'tdoa' | 'twr'
                scope: 'primary',       // Padrão: 'primary' (Só Hub - foco no par Master-Slave)
                hideAllLinks: false     // Quando true ('Nenhum'), oculta temporariamente todas as séries RF
            };
            this.detectedPairs = new Set();
            this._lastQuickLinksSignature = '';

            // Dados
            this.chart = null;
            this.rawRecords = [];
            this.records = [];
            this.t0_hardware_us = null;

            // Contador de ciclos do algoritmo normalizado interno
            this.liveCycleCounter = 0;
            this.liveStreamLastRaw = {};

            // Estado de animação e streaming em tempo real (60 FPS contínuo sem saltos nem flash)
            this._animRunning = false;
            this.latestHardwareX = null;
            this.lastPacketWallMs = null;
            this._displayMaxT = null;
            this._lastAnimFrameMs = null;
            this._lastChartUpdateMs = 0;
            this._lastStatsUpdateMs = 0;
            this._lastNavRebuildMs = 0;
            this._cachedStatsByChannel = new Map();
            this.needsRebuild = true;
            this.isUserNavigating = false; // Flag de pan/zoom manual que pausa o avanço automático
            this.isActivelyGesturing = false; // Flag de arrasto/zoom ativo pelo utilizador no canvas
            this._navRebuildTimeout = null;
            this.isPaused = false;         // Flag de pausa manual do gráfico solicitada pelo utilizador
            this.channelBuffers = options.channelBuffers || new Map();
        }

        init() {
            if (this.controlsContainerId) {
                this.renderControlsUI(this.controlsContainerId);
            }
            this.initChart();
            if (this.mode === 'live') {
                this.updateLiveTrackingStatus();
                this.startLiveAnimationLoop();
            }
        }

        startLiveAnimationLoop() {
            if (this._animRunning) return;
            this._animRunning = true;

            const tick = (now) => {
                if (!this._animRunning) return;

                // Não consome ciclos se a vista Live estiver oculta (liberta CPU para navegação noutras abas)
                const liveSec = document.getElementById('view-live');
                if (liveSec && !liveSec.classList.contains('active')) {
                    this._lastAnimFrameMs = null;
                    requestAnimationFrame(tick);
                    return;
                }

                if (this.mode === 'live' && this.chart && this.windowDuration_s && (this.xAxis === 't_global' || this.xAxis === 'elapsed')) {
                    const streamStale = Boolean(this.lastPacketWallMs && (now - this.lastPacketWallMs) > 2500);
                    if (!this.isUserNavigating && !this.isPaused && this.latestHardwareX !== null) {
                        const dtWall = (this._lastAnimFrameMs !== null)
                            ? Math.min((now - this._lastAnimFrameMs) / 1000.0, 0.08)
                            : 0.016;
                        this._lastAnimFrameMs = now;

                        if (streamStale) {
                            if (this._displayMaxT === null) {
                                this._displayMaxT = this.latestHardwareX;
                            }
                        } else if (this._displayMaxT === null || Math.abs(this.latestHardwareX - this._displayMaxT) > 5.0) {
                            this._displayMaxT = this.latestHardwareX;
                        } else {
                            const error = this.latestHardwareX - this._displayMaxT;
                            const pllRateAdjustment = Math.max(-0.25, Math.min(0.25, error * 1.5));
                            this._displayMaxT += dtWall * (1.0 + pllRateAdjustment);
                        }

                        const smoothMaxT = this._displayMaxT;
                        const smoothMinT = smoothMaxT - this.windowDuration_s;

                        this.chart.options.scales.x.min = smoothMinT;
                        this.chart.options.scales.x.max = smoothMaxT;

                        if (this.needsRebuild) {
                            this.needsRebuild = false;
                            this._lastChartUpdateMs = now;
                            this.applyFiltersAndRebuild(smoothMinT, smoothMaxT);
                        } else if (!streamStale && (now - this._lastChartUpdateMs) >= 32) {
                            this._lastChartUpdateMs = now;
                            this.chart.update('none');
                        }
                    } else if (this.isPaused) {
                        this._lastAnimFrameMs = null;
                        if (this.needsRebuild) {
                            this.needsRebuild = false;
                            const xScale = this.chart && this.chart.scales && this.chart.scales.x;
                            const curMin = (xScale && isFinite(xScale.min)) ? xScale.min : ((this.chart && isFinite(this.chart.options.scales.x.min)) ? this.chart.options.scales.x.min : undefined);
                            const curMax = (xScale && isFinite(xScale.max)) ? xScale.max : ((this.chart && isFinite(this.chart.options.scales.x.max)) ? this.chart.options.scales.x.max : undefined);
                            this.applyFiltersAndRebuild(curMin, curMax);
                        }
                    } else if (this.isUserNavigating) {
                        this._lastAnimFrameMs = null;
                        // Durante arrasto ou zoom ativo (isActivelyGesturing), NÃO interromper o motor gráfico do Chart.js
                        if (!this.isActivelyGesturing && this.needsRebuild) {
                            this.needsRebuild = false;
                            const xScale = this.chart && this.chart.scales && this.chart.scales.x;
                            const curMin = (xScale && isFinite(xScale.min)) ? xScale.min : ((this.chart && isFinite(this.chart.options.scales.x.min)) ? this.chart.options.scales.x.min : undefined);
                            const curMax = (xScale && isFinite(xScale.max)) ? xScale.max : ((this.chart && isFinite(this.chart.options.scales.x.max)) ? this.chart.options.scales.x.max : undefined);
                            this.applyFiltersAndRebuild(curMin, curMax);
                        }
                    } else if (this.needsRebuild) {
                        this.needsRebuild = false;
                        this.applyFiltersAndRebuild();
                    }
                } else if (this.needsRebuild) {
                    this.needsRebuild = false;
                    this.applyFiltersAndRebuild();
                }

                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        togglePause() {
            if (typeof window.toggleGlobalPagePause === 'function') {
                window.toggleGlobalPagePause();
                return;
            }
            this.isPaused = !this.isPaused;
            this.updatePauseUI();
            this.updateLiveTrackingStatus();
            if (window.LiveState) {
                window.LiveState.isPaused = this.isPaused;
            }
            if (!this.isPaused) {
                this._displayMaxT = null;
                this.latestHardwareX = null;
                this._lastAnimFrameMs = null;
                this.needsRebuild = true;
            }
        }

        updatePauseUI() {
            const uid = this.canvasId;
            const btn = document.getElementById(`${uid}-btn-pause`);
            const icon = document.getElementById(`${uid}-pause-icon`);
            const text = document.getElementById(`${uid}-pause-text`);
            const cardBtn = document.getElementById('btn-live-chart-card-pause');
            const cardIcon = document.getElementById('live-card-pause-icon');
            const cardText = document.getElementById('live-card-pause-text');

            if (this.isPaused) {
                if (btn) {
                    btn.style.color = '#fff';
                    btn.style.background = 'var(--amber)';
                    btn.style.borderColor = 'var(--amber)';
                    btn.title = 'Gráfico em pausa (congelado). Clique para retomar o avanço contínuo a 60 FPS';
                }
                if (icon) icon.textContent = '▶';
                if (text) text.textContent = 'Retomar';
                if (cardBtn) {
                    cardBtn.style.color = '#fff';
                    cardBtn.style.background = 'var(--amber)';
                    cardBtn.style.borderColor = 'var(--amber)';
                }
                if (cardIcon) cardIcon.textContent = '▶';
                if (cardText) cardText.textContent = 'Retomar Gráfico';
            } else {
                if (btn) {
                    btn.style.color = 'var(--cyan)';
                    btn.style.background = '';
                    btn.style.borderColor = 'rgba(56,189,248,0.4)';
                    btn.title = 'Pausar avanço automático do gráfico para inspecionar medições';
                }
                if (icon) icon.textContent = '⏸';
                if (text) text.textContent = 'Pausar';
                if (cardBtn) {
                    cardBtn.style.color = 'var(--cyan)';
                    cardBtn.style.background = '';
                    cardBtn.style.borderColor = 'rgba(6,182,212,0.4)';
                }
                if (cardIcon) cardIcon.textContent = '⏸';
                if (cardText) cardText.textContent = 'Pausar Gráfico';
            }
        }

        updateLiveTrackingStatus() {
            const statusEl = document.getElementById(`${this.canvasId}-status`) || document.getElementById('live-chart-status');
            if (!statusEl) return;
            if (this.mode !== 'live') return;

            if (this.isPaused) {
                statusEl.innerHTML = `
                    <span style="display:inline-flex; align-items:center; gap:6px; color:var(--amber); font-weight:700; background:rgba(245,158,11,0.12); padding:3px 8px; border-radius:5px; border:1px solid rgba(245,158,11,0.35);">
                        <span>⏸ Gráfico em Pausa (Congelado)</span>
                    </span>
                `;
            } else if (this.isUserNavigating) {
                statusEl.innerHTML = `
                    <span style="display:inline-flex; align-items:center; gap:6px; color:var(--amber); font-weight:700; background:rgba(245,158,11,0.12); padding:3px 8px; border-radius:5px; border:1px solid rgba(245,158,11,0.35);" title="Use o botão 'Voltar ao Direto' abaixo ou duplo-clique no gráfico para retomar">
                        <span>⏸ Inspecção Histórica</span>
                    </span>
                `;
            } else {
                statusEl.innerHTML = `
                    <span style="display:inline-flex; align-items:center; gap:6px; color:var(--emerald); font-weight:600; background:rgba(16,185,129,0.12); padding:3px 8px; border-radius:5px; border:1px solid rgba(16,185,129,0.35);">
                        <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--emerald); box-shadow:0 0 6px var(--emerald);"></span>
                        <span>Direto 60 FPS Ativo</span>
                    </span>
                `;
            }
            this.updateResetZoomUI();
        }

        updateResetZoomUI() {
            const uid = this.canvasId;
            const btnZoom = document.getElementById(`${uid}-btn-reset-zoom`);
            if (!btnZoom) return;
            if (this.isUserNavigating) {
                btnZoom.style.color = '#fff';
                btnZoom.style.background = 'var(--cyan)';
                btnZoom.style.borderColor = 'var(--cyan)';
                btnZoom.innerHTML = '<span>▶</span><span>Voltar ao Direto</span>';
                btnZoom.title = 'Inspecção histórica ativa. Clique aqui ou duplo-clique no gráfico para voltar ao avanço em direto (60 FPS)';
            } else {
                btnZoom.style.color = '';
                btnZoom.style.background = '';
                btnZoom.style.borderColor = '';
                btnZoom.innerHTML = '<span>⟲</span><span>Zoom</span>';
                btnZoom.title = 'Repor Zoom (duplo-clique no gráfico para repor; scroll ou arrasto para navegar)';
            }
        }

        scheduleNavRebuild() {
            this.isActivelyGesturing = false;
            if (this._navRebuildTimeout) clearTimeout(this._navRebuildTimeout);
            this._navRebuildTimeout = setTimeout(() => {
                if (this.isUserNavigating && this.chart) {
                    const xScale = this.chart.scales && this.chart.scales.x;
                    const curMin = (xScale && isFinite(xScale.min)) ? xScale.min : undefined;
                    const curMax = (xScale && isFinite(xScale.max)) ? xScale.max : undefined;
                    this.applyFiltersAndRebuild(curMin, curMax);
                }
            }, 100);
        }

        resumeLiveTracking() {
            this.isUserNavigating = false;
            this.isActivelyGesturing = false;
            if (this._navRebuildTimeout) {
                clearTimeout(this._navRebuildTimeout);
                this._navRebuildTimeout = null;
            }
            if (this.isPaused) {
                this.isPaused = false;
                if (window.LiveState) window.LiveState.isPaused = false;
                if (typeof window.updateGlobalPauseUI === 'function') window.updateGlobalPauseUI();
                this.updatePauseUI();
            }
            this._displayMaxT = null;
            this.latestHardwareX = null;
            this._lastAnimFrameMs = null;
            this.needsRebuild = true;
            this.updateLiveTrackingStatus();
            this.updateResetZoomUI();
            if (this.chart) {
                if (typeof this.chart.resetZoom === 'function') {
                    try { this.chart.resetZoom(); } catch (e) {}
                }
                if (this.chart.options && this.chart.options.scales) {
                    if (this.chart.options.scales.x) {
                        delete this.chart.options.scales.x.min;
                        delete this.chart.options.scales.x.max;
                    }
                    if (this.chart.options.scales.y) {
                        delete this.chart.options.scales.y.min;
                        delete this.chart.options.scales.y.max;
                    }
                }
                this.chart.update('none');
            }
        }

        initChart() {
            const canvas = document.getElementById(this.canvasId);
            if (!canvas) return;

            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }

            const ctx = canvas.getContext('2d');
            const xDef = AXIS_DEFS.x[this.xAxis] || AXIS_DEFS.x.t_global;
            const yDef = AXIS_DEFS.y[this.yAxis] || AXIS_DEFS.y.dist_m;

            if (canvas && !canvas._hasDblClickResume) {
                canvas._hasDblClickResume = true;
                canvas.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    this.resumeLiveTracking();
                });
            }

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: []
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 0 },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            titleColor: '#38bdf8',
                            titleFont: { size: 12, weight: 'bold', family: 'ui-monospace, monospace' },
                            bodyColor: '#f8fafc',
                            bodyFont: { size: 11, family: 'ui-monospace, monospace' },
                            borderColor: 'rgba(56, 189, 248, 0.35)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                title: (items) => {
                                    if (!items || items.length === 0) return '';
                                    const curXDef = AXIS_DEFS.x[this.xAxis] || AXIS_DEFS.x.t_global;
                                    const pt = items[0].raw;
                                    const xVal = (pt && pt.x !== undefined) ? pt.x : items[0].parsed.x;
                                    const rawObj = pt ? pt.raw : null;

                                    if (this.xAxis === 'seq') {
                                        const seqNum = Math.round(xVal);
                                        const tgVal = (rawObj && rawObj.t_global_us != null)
                                            ? (Number(rawObj.t_global_us) / 1e6).toFixed(4) + 's'
                                            : (rawObj && rawObj.elapsed_s != null ? Number(rawObj.elapsed_s).toFixed(2) + 's' : null);
                                        const tgPart = tgVal ? ` | TG: ${tgVal}` : '';
                                        return `Sequência: Ciclo #${seqNum}${tgPart}`;
                                    }
                                    if (this.xAxis === 'seq_rf') {
                                        const rfNum = Math.round(xVal);
                                        const tgVal = (rawObj && rawObj.t_global_us != null)
                                            ? (Number(rawObj.t_global_us) / 1e6).toFixed(4) + 's'
                                            : null;
                                        const tgPart = tgVal ? ` | TG: ${tgVal}` : '';
                                        return `Sequência RF: Pacote #${rfNum}${tgPart}`;
                                    }
                                    if (this.xAxis === 'elapsed') {
                                        const seqPart = (rawObj && rawObj.seq != null) ? ` | Ciclo #${rawObj.seq}` : '';
                                        return `Tempo Decorrido: +${Number(xVal).toFixed(3)}s${seqPart}`;
                                    }
                                    // Padrão: 't_global'
                                    const seqPart = (rawObj && rawObj.seq != null) ? ` | Ciclo #${rawObj.seq}` : '';
                                    return `Tempo Global TG: ${Number(xVal).toFixed(4)}s${seqPart}`;
                                },
                                label: (ctx) => {
                                    const curYDef = AXIS_DEFS.y[this.yAxis] || AXIS_DEFS.y.dist_m;
                                    const pt = ctx.raw || {};
                                    const yVal = (pt.y !== null && pt.y !== undefined) ? pt.y : ctx.parsed.y;
                                    const yStr = (yVal !== null && !isNaN(yVal))
                                        ? `${yVal.toFixed(curYDef.decimals)} ${curYDef.unit}`
                                        : 'Inválido / Sem dados';
                                    const dsLabel = ctx.dataset.label || '';
                                    // Evitar duplicação de protocolo se já fizer parte do nome do dataset
                                    const protoSuffix = (pt.protocol && !dsLabel.includes(pt.protocol)) ? ` [${pt.protocol}]` : '';
                                    return ` ${dsLabel}${protoSuffix}: ${yStr}`;
                                }
                            }
                        },
                        zoom: {
                            pan: {
                                enabled: true,
                                mode: 'x',
                                threshold: 8,
                                onPanStart: () => {
                                    this.isUserNavigating = true;
                                    this.isActivelyGesturing = true;
                                    this.updateLiveTrackingStatus();
                                },
                                onPan: () => {
                                    this.isActivelyGesturing = true;
                                },
                                onPanComplete: () => {
                                    this.isActivelyGesturing = false;
                                    this.scheduleNavRebuild();
                                },
                                onPanRejected: () => {
                                    this.isActivelyGesturing = false;
                                }
                            },
                            zoom: {
                                wheel: {
                                    enabled: true,
                                    speed: 0.08
                                },
                                pinch: { enabled: true },
                                mode: 'x',
                                onZoomStart: () => {
                                    this.isUserNavigating = true;
                                    this.isActivelyGesturing = true;
                                    this.updateLiveTrackingStatus();
                                },
                                onZoom: () => {
                                    this.isActivelyGesturing = true;
                                },
                                onZoomComplete: () => {
                                    this.isActivelyGesturing = false;
                                    this.scheduleNavRebuild();
                                },
                                onZoomRejected: () => {
                                    this.isActivelyGesturing = false;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            display: true,
                            grid: {
                                color: (ctx) => {
                                    if (ctx.tick && ctx.tick.value !== undefined) {
                                        const v = ctx.tick.value;
                                        if (this.xAxis === 't_global' || this.xAxis === 'elapsed') {
                                            if (Math.abs(v % 10) < 0.01) return 'rgba(255, 255, 255, 0.16)';
                                            if (Math.abs(v % 2) < 0.01) return 'rgba(255, 255, 255, 0.08)';
                                        } else {
                                            if (v % 50 === 0) return 'rgba(255, 255, 255, 0.16)';
                                            if (v % 10 === 0) return 'rgba(255, 255, 255, 0.08)';
                                        }
                                    }
                                    return 'rgba(255, 255, 255, 0.05)';
                                },
                                borderColor: 'rgba(255, 255, 255, 0.25)',
                                drawTicks: true,
                                tickColor: 'rgba(255, 255, 255, 0.35)',
                                tickLength: 6
                            },
                            title: {
                                display: true,
                                text: `${xDef.label} (${xDef.unit})`,
                                color: '#38bdf8',
                                font: { size: 12, weight: 'bold', family: 'ui-monospace, monospace' }
                            },
                            ticks: {
                                color: '#f8fafc',
                                font: { size: 11, weight: '600', family: 'ui-monospace, monospace' },
                                maxRotation: 0,
                                maxTicksLimit: 28,
                                autoSkip: true,
                                autoSkipPadding: 10,
                                callback: (v) => {
                                    const curXDef = AXIS_DEFS.x[this.xAxis] || AXIS_DEFS.x.t_global;
                                    return curXDef.formatTick(v);
                                }
                            }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            grid: {
                                color: (ctx) => {
                                    if (ctx.tick && Math.abs(ctx.tick.value) < 0.001) {
                                        return 'rgba(56, 189, 248, 0.4)'; // Linha de zero em destaque
                                    }
                                    return 'rgba(255, 255, 255, 0.07)';
                                },
                                borderColor: 'rgba(255, 255, 255, 0.25)',
                                drawTicks: true,
                                tickColor: 'rgba(255, 255, 255, 0.35)',
                                tickLength: 6
                            },
                            title: {
                                display: true,
                                text: `${yDef.label} (${yDef.unit})`,
                                color: '#34d399',
                                font: { size: 12, weight: 'bold', family: 'ui-monospace, monospace' }
                            },
                            ticks: {
                                color: '#f8fafc',
                                font: { size: 11, weight: '600', family: 'ui-monospace, monospace' },
                                maxTicksLimit: 14,
                                callback: (v) => {
                                    const curYDef = AXIS_DEFS.y[this.yAxis] || AXIS_DEFS.y.dist_m;
                                    const dec = (curYDef.decimals >= 2) ? 2 : curYDef.decimals;
                                    return `${Number(v).toFixed(dec)} ${curYDef.unit}`;
                                }
                            }
                        }
                    }
                }
            });
        }

        renderControlsUI(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const uid = this.canvasId;
            const isLive = (this.mode === 'live');

            container.innerHTML = `
                <!-- 1. Barra de Configuração de Eixos, Janela e Controles Rápidos (Linha Única Sem Quebra e Sem Scroll) -->
                <div class="uwb-chart-axes-bar" style="display:flex; flex-wrap:nowrap; align-items:center; justify-content:space-between; gap:5px; margin-bottom:5px; overflow:hidden;">
                    <div style="display:flex; flex-wrap:nowrap; align-items:center; gap:5px; flex-shrink:1; min-width:0;">
                        <!-- Eixo X -->
                        <div class="uwb-axis-control-item">
                            <span class="uwb-axis-badge" style="background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:1px 4px; font-size:9.5px;">
                                X
                            </span>
                            <select id="${uid}-select-x" class="input-select" style="width:125px; min-width:110px; max-width:130px; font-size:11px;">
                                <option value="t_global" ${this.xAxis === 't_global' ? 'selected' : ''}>Tempo Global (TG)</option>
                                <option value="elapsed" ${this.xAxis === 'elapsed' ? 'selected' : ''}>Decorrido (Δt)</option>
                                <option value="seq" ${this.xAxis === 'seq' ? 'selected' : ''}>Ciclos Seq.</option>
                                <option value="seq_rf" ${this.xAxis === 'seq_rf' ? 'selected' : ''}>Seq. RF (HW)</option>
                            </select>
                        </div>

                        <!-- Eixo Y -->
                        <div class="uwb-axis-control-item">
                            <span class="uwb-axis-badge" style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4); padding:1px 4px; font-size:9.5px;">
                                Y
                            </span>
                            <select id="${uid}-select-y" class="input-select" style="width:130px; min-width:120px; max-width:140px; font-size:11px;">
                                <option value="dist_m" ${this.yAxis === 'dist_m' ? 'selected' : ''}>Distância Bruta</option>
                                <option value="dist_comp_m" ${this.yAxis === 'dist_comp_m' ? 'selected' : ''}>Dist. Compensada</option>
                                <option value="drift_ppm" ${this.yAxis === 'drift_ppm' ? 'selected' : ''}>Drift (ppm)</option>
                                <option value="drift_dist_m" ${this.yAxis === 'drift_dist_m' ? 'selected' : ''}>Drift Dist. (m)</option>
                                <option value="freq_hz" ${this.yAxis === 'freq_hz' ? 'selected' : ''}>Frequência (Hz)</option>
                            </select>
                        </div>

                        <!-- Janela Temporal / Escala X -->
                        <div class="uwb-axis-control-item">
                            <span class="uwb-axis-badge" style="background:rgba(251,191,36,0.18); color:#fbbf24; border:1px solid rgba(251,191,36,0.4); padding:1px 3px; font-size:9.5px;">
                                ⏱️
                            </span>
                            <select id="${uid}-select-window" class="input-select" style="width:95px; min-width:85px; max-width:105px; font-size:11px;">
                                <option value="1" ${this.windowDuration_s === 1 ? 'selected' : ''}>Janela 1s</option>
                                <option value="10" ${this.windowDuration_s === 10 ? 'selected' : ''}>Janela 10s</option>
                                <option value="30" ${this.windowDuration_s === 30 ? 'selected' : ''}>Janela 30s</option>
                                <option value="60" ${this.windowDuration_s === 60 ? 'selected' : ''}>Janela 60s</option>
                                <option value="120" ${this.windowDuration_s === 120 ? 'selected' : ''}>Janela 2m</option>
                                <option value="300" ${this.windowDuration_s === 300 ? 'selected' : ''}>Janela 5m</option>
                                <option value="custom" ${(![1, 10, 30, 60, 120, 300, null].includes(this.windowDuration_s)) ? 'selected' : ''}>Personalizado...</option>
                                <option value="all" ${this.windowDuration_s === null ? 'selected' : ''}>Todo Ensaio</option>
                            </select>
                            <div id="${uid}-custom-window-wrap" style="display:${(![1, 10, 30, 60, 120, 300, null].includes(this.windowDuration_s)) ? 'inline-flex' : 'none'}; align-items:center; gap:2px;">
                                <input type="number" id="${uid}-input-custom-window" min="0.001" max="0.999" step="0.05" class="input-text" style="font-size:10.5px; padding:1px 3px; width:48px; height:20px; font-weight:700; color:#fbbf24; text-align:center; background:#0f172a; border:1px solid rgba(251,191,36,0.4); border-radius:3px;" value="${(this.windowDuration_s && this.windowDuration_s < 1) ? this.windowDuration_s : 0.5}" placeholder="0.5">
                                <span style="font-size:10px; color:#fbbf24; font-weight:700;">s</span>
                            </div>
                        </div>

                        <!-- Estilo de Traçado -->
                        <div class="uwb-axis-control-item">
                            <span class="uwb-axis-badge" style="background:rgba(148,163,184,0.18); color:#f1f5f9; border:1px solid rgba(148,163,184,0.4); padding:1px 3px; font-size:9.5px;">
                                📈
                            </span>
                            <select id="${uid}-select-style" class="input-select" style="width:100px; min-width:90px; max-width:105px; font-size:11px;">
                                <option value="line_points" ${this.styleType === 'line_points' ? 'selected' : ''}>Linha + Pontos</option>
                                <option value="line" ${this.styleType === 'line' ? 'selected' : ''}>Só Linha</option>
                                <option value="points" ${this.styleType === 'points' ? 'selected' : ''}>Só Pontos</option>
                            </select>
                        </div>
                    </div>

                    <!-- Botões de Ação Rápida (Compactos Sem Estourar Largura) -->
                    <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                        ${isLive ? `
                            <button type="button" class="btn btn-outline btn-xs" id="${uid}-btn-pause" title="Pausar ou Retomar avanço do gráfico" style="height:25px; padding:0 8px; font-weight:700; color:var(--cyan); border-color:rgba(56,189,248,0.5); display:inline-flex; align-items:center; gap:3px; border-radius:5px; font-size:10.5px;">
                                <span id="${uid}-pause-icon">${this.isPaused ? '▶' : '⏸'}</span>
                                <span id="${uid}-pause-text">${this.isPaused ? 'Retomar' : 'Pausar'}</span>
                            </button>
                        ` : ''}
                        <button type="button" class="btn btn-outline btn-xs" id="${uid}-btn-reset-zoom" title="Repor Zoom e voltar ao Direto (Ctrl+Scroll para Zoom)" style="height:25px; padding:0 7px; border-radius:5px; display:inline-flex; align-items:center; gap:3px; font-size:10.5px; font-weight:700;">
                            <span>⟲</span>
                            <span>Zoom</span>
                        </button>

                        <!-- Botão Accordion de Filtros com Badge Dinâmico -->
                        <button type="button" class="btn btn-outline btn-xs" id="${uid}-btn-toggle-filters" title="Abrir ou Ocultar gaveta de filtros de séries" style="height:25px; padding:0 8px; border-radius:5px; display:inline-flex; align-items:center; gap:4px; font-weight:700; color:var(--cyan); border-color:rgba(56,189,248,0.5); background:rgba(56,189,248,0.1); font-size:10.5px; cursor:pointer;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:11px;height:11px;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                            <span>Filtros</span>
                            <span id="${uid}-filter-badge" style="background:rgba(56,189,248,0.25); color:#38bdf8; padding:0 4px; border-radius:6px; font-size:9.5px; font-family:var(--font-mono); font-weight:800;">(15)</span>
                            <span id="${uid}-filter-arrow" style="font-size:9px;">▾</span>
                        </button>

                        ${isLive ? `
                            <button type="button" class="btn btn-outline btn-xs" id="${uid}-btn-clear-data" title="Limpar pontos atuais do gráfico" style="height:25px; padding:0 7px; border-radius:5px; color:#f87171; border-color:rgba(239,68,68,0.5); display:inline-flex; align-items:center; gap:3px; font-size:10.5px; font-weight:700;">
                                <span>⌫</span>
                                <span>Limpar Gráfico</span>
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- 1.5. Barra de Seletor Rápido de Links RF (Toggle Chips Visíveis no Topo) -->
                <div id="${uid}-quick-links-bar" class="uwb-quick-links-bar" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; margin-bottom:6px; padding:4px 8px; background:rgba(15,23,42,0.88); border:1px solid rgba(56,189,248,0.22); border-radius:6px;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; min-width:0;">
                        <span class="uwb-quick-links-label" style="font-size:10px; font-weight:800; color:var(--cyan); text-transform:uppercase; letter-spacing:0.4px; display:inline-flex; align-items:center; gap:4px; margin-right:2px;">
                            <span>🔗 Links RF:</span>
                        </span>
                        <button type="button" class="uwb-quick-pill uwb-quick-link-action active" id="${uid}-btn-quick-links-all" title="Mostrar todos os links RF ativos no gráfico">Todos</button>
                        <button type="button" class="uwb-quick-pill uwb-quick-link-action" id="${uid}-btn-quick-links-none" title="Ocultar todos os links RF do gráfico">Nenhum</button>
                        <div style="width:1px; height:14px; background:rgba(255,255,255,0.12); margin:0 2px;"></div>
                        <div id="${uid}-quick-links-chips" class="uwb-quick-links-chips" style="display:inline-flex; align-items:center; gap:5px; flex-wrap:wrap;"></div>
                    </div>
                    <div id="${uid}-quick-links-summary" style="font-size:9.5px; font-family:var(--font-mono); color:var(--text-muted); flex-shrink:0;"></div>
                </div>

                <!-- 2. Painel de Filtros Retrátil e Modular (Alta Densidade e Reorganização Completa) -->
                <div id="${uid}-filters-panel" class="uwb-chart-filters-panel" style="display:none; margin-bottom:8px; background:rgba(15,23,42,0.95); border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:8px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.4);">
                    
                    <!-- Linha 1: Módulos (com atalhos rápidos TDoA/TWR por módulo) e Filtro Global de Protocolo -->
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.07);">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="font-size:10px; font-weight:800; color:var(--cyan); text-transform:uppercase; letter-spacing:0.4px;">📡 Módulos:</span>
                            
                            <!-- Chips dos 6 Módulos com Sub-Pills TDoA / TWR -->
                            ${[
                                { id: '0001', name: 'N01', col: '#0284c7' },
                                { id: '0002', name: 'N02', col: '#2563eb' },
                                { id: '0003', name: 'N03', col: '#ffd600' },
                                { id: '0004', name: 'N04', col: '#8b5cf6' },
                                { id: '0005', name: 'N05', col: '#14b8a6' },
                                { id: '0006', name: 'N06', col: '#fb7185' }
                            ].map(m => `
                                <div class="uwb-filter-chip" style="--chip-accent:${m.col}; display:inline-flex; align-items:center; gap:4px; padding:2px 5px; border-radius:5px; border:1px solid ${m.col}50; background:rgba(15,23,42,0.8);">
                                    <label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer; margin:0;" title="Ver todos os dados do módulo 0x${m.id}">
                                        <input type="checkbox" class="${uid}-cb-mod uwb-custom-checkbox" value="${m.id}" style="--cb-color:${m.col}; cursor:pointer;">
                                        <span class="uwb-node-badge" style="background:${m.col}25; color:${m.col}; font-weight:700; font-size:10px;">${m.name}</span>
                                    </label>
                                    <div style="display:inline-flex; align-items:center; gap:2px; margin-left:2px; border-left:1px solid rgba(255,255,255,0.1); padding-left:3px;">
                                        <button type="button" class="btn-node-proto-sub" data-node="${m.id}" data-proto="tdoa" title="Ver apenas TDoA de 0x${m.id}" style="border:1px solid rgba(0,229,255,0.3); background:rgba(0,229,255,0.08); color:#00e5ff; font-size:8.5px; font-weight:800; padding:1px 3px; border-radius:3px; cursor:pointer;">TDoA</button>
                                        <button type="button" class="btn-node-proto-sub" data-node="${m.id}" data-proto="twr" title="Ver apenas TWR de 0x${m.id}" style="border:1px solid rgba(168,85,247,0.3); background:rgba(168,85,247,0.08); color:#c084fc; font-size:8.5px; font-weight:800; padding:1px 3px; border-radius:3px; cursor:pointer;">TWR</button>
                                    </div>
                                </div>
                            `).join('')}

                            <button type="button" class="uwb-quick-pill" id="${uid}-btn-mod-all" title="Selecionar todos os módulos" style="cursor:pointer;">Todos</button>
                            <button type="button" class="uwb-quick-pill" id="${uid}-btn-mod-none" title="Limpar filtro de módulos" style="cursor:pointer;">Limpar</button>
                        </div>

                        <!-- Protocolo Global e Ação Limpar -->
                        <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
                            <span style="font-size:10px; font-weight:800; color:var(--amber); text-transform:uppercase; letter-spacing:0.4px;">Protocolo:</span>
                            <button type="button" class="uwb-quick-pill ${this.filters.protocol === 'all' ? 'active' : ''}" id="${uid}-btn-proto-all" style="cursor:pointer;">Todos</button>
                            <button type="button" class="uwb-quick-pill ${this.filters.protocol === 'tdoa' ? 'active' : ''}" id="${uid}-btn-proto-tdoa" style="color:#00e5ff; border-color:rgba(0,229,255,0.4); cursor:pointer;">📡 Só TDoA</button>
                            <button type="button" class="uwb-quick-pill ${this.filters.protocol === 'twr' ? 'active' : ''}" id="${uid}-btn-proto-twr" style="color:#c084fc; border-color:rgba(168,85,247,0.4); cursor:pointer;">👑 Só TWR</button>
                            <button type="button" class="uwb-quick-pill" id="${uid}-btn-clear-filters" style="color:#f87171; border-color:rgba(239,68,68,0.4); background:rgba(239,68,68,0.08); font-weight:800; margin-left:6px; cursor:pointer;" title="Limpar todos os filtros e mostrar toda a telemetria">✕ Limpar Filtros</button>
                        </div>
                    </div>

                    <!-- Linha 2: Pares com Hub Coordenador, Dropdown de Pares Específicos e Âmbito de Rede -->
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-top:6px;">
                        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            <span style="font-size:10px; font-weight:800; color:var(--purple); text-transform:uppercase; letter-spacing:0.4px;">🔗 Pares com Hub:</span>
                            ${['0001', '0002', '0003', '0004', '0005', '0006'].map(nid => `
                                <label class="uwb-filter-chip" style="cursor:pointer; display:inline-flex; align-items:center; gap:3px; padding:2px 5px; border-radius:4px; background:rgba(15,23,42,0.8); border:1px solid rgba(168,85,247,0.3);" title="Par Hub Coordenador ↔ Nó 0x${nid}">
                                    <input type="checkbox" class="${uid}-cb-hub-pair uwb-custom-checkbox" value="hub-${nid}" style="--cb-color:#a855f7; cursor:pointer;">
                                    <span style="font-family:var(--font-mono); font-size:9.5px; font-weight:700; color:#cbd5e1;">Hub↔N${parseInt(nid, 16)}</span>
                                </label>
                            `).join('')}
                            <button type="button" class="uwb-quick-pill" id="${uid}-btn-hub-pair-all" style="cursor:pointer;">Todos</button>
                            <button type="button" class="uwb-quick-pill" id="${uid}-btn-hub-pair-none" style="cursor:pointer;">Limpar</button>
                        </div>

                        <!-- Dropdown de Pares Específicos e Âmbito de Tráfego -->
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <span style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px;">Par Específico:</span>
                            <select id="${uid}-select-pair" class="input-select" style="font-size:10.5px; padding:1px 5px; width:160px; height:23px; font-family:var(--font-mono); cursor:pointer;">
                                <option value="">-- Qualquer Par --</option>
                                <option value="0001-0002">N01 ↔ N02</option>
                                <option value="0001-0003">N01 ↔ N03</option>
                                <option value="0001-0004">N01 ↔ N04</option>
                                <option value="0001-0005">N01 ↔ N05</option>
                                <option value="0001-0006">N01 ↔ N06</option>
                                <option value="0002-0003">N02 ↔ N03</option>
                                <option value="0002-0004">N02 ↔ N04</option>
                                <option value="0002-0005">N02 ↔ N05</option>
                                <option value="0002-0006">N02 ↔ N06</option>
                                <option value="0003-0004">N03 ↔ N04</option>
                                <option value="0003-0005">N03 ↔ N05</option>
                                <option value="0003-0006">N03 ↔ N06</option>
                                <option value="0004-0005">N04 ↔ N05</option>
                                <option value="0004-0006">N04 ↔ N06</option>
                                <option value="0005-0006">N05 ↔ N06</option>
                            </select>

                            <div style="width:1px; height:16px; background:rgba(255,255,255,0.1); margin:0 3px;"></div>

                            <span style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px;">Âmbito:</span>
                            <button type="button" class="uwb-quick-pill ${this.filters.scope === 'all' ? 'active' : ''}" id="${uid}-btn-scope-all" style="cursor:pointer;" title="Toda a Swarm (Hub + Mesh)">🌐 Toda Swarm</button>
                            <button type="button" class="uwb-quick-pill ${this.filters.scope === 'primary' ? 'active' : ''}" id="${uid}-btn-scope-primary" style="cursor:pointer;" title="Apenas transmissões entre o Hub e os nós remotos">⭐ Só Hub</button>
                            <button type="button" class="uwb-quick-pill ${this.filters.scope === 'mesh' ? 'active' : ''}" id="${uid}-btn-scope-mesh" style="cursor:pointer;" title="Apenas tráfego secundário entre nós escravos">🔬 Só Mesh</button>
                        </div>
                    </div>
                </div>
            `;

            // Listeners Eixos
            const selX = document.getElementById(`${uid}-select-x`);
            if (selX) selX.addEventListener('change', (e) => this.setXAxis(e.target.value));

            const selY = document.getElementById(`${uid}-select-y`);
            if (selY) selY.addEventListener('change', (e) => this.setYAxis(e.target.value));

            // Listener Janela
            const selWin = document.getElementById(`${uid}-select-window`);
            const customWrap = document.getElementById(`${uid}-custom-window-wrap`);
            const customInput = document.getElementById(`${uid}-input-custom-window`);

            if (selWin) {
                selWin.addEventListener('change', (e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                        if (customWrap) customWrap.style.display = 'inline-flex';
                        if (customInput) {
                            customInput.focus();
                            let num = parseFloat(customInput.value);
                            if (isNaN(num) || num <= 0 || num >= 1.0) {
                                num = 0.5;
                                customInput.value = '0.5';
                            }
                            this.windowDuration_s = num;
                        }
                    } else {
                        if (customWrap) customWrap.style.display = 'none';
                        this.windowDuration_s = (val === 'all') ? null : Number(val);
                    }
                    this.applyFiltersAndRebuild();
                });
            }

            if (customInput) {
                const applyCustom = () => {
                    let num = parseFloat(customInput.value);
                    if (!isNaN(num) && num > 0) {
                        if (num >= 1.0) {
                            num = 0.999;
                            customInput.value = '0.999';
                        } else if (num < 0.001) {
                            num = 0.001;
                            customInput.value = '0.001';
                        }
                        this.windowDuration_s = num;
                        this.applyFiltersAndRebuild();
                    }
                };
                customInput.addEventListener('input', applyCustom);
                customInput.addEventListener('change', applyCustom);
            }

            // Listener Estilo
            const selStyle = document.getElementById(`${uid}-select-style`);
            if (selStyle) {
                selStyle.addEventListener('change', (e) => {
                    this.styleType = e.target.value;
                    this.applyFiltersAndRebuild();
                });
            }

            // 1. Checkboxes Módulos
            container.querySelectorAll(`.${uid}-cb-mod`).forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) { this.filters.hideAllLinks = false; this.filters.modules.add(cb.value); }
                    else this.filters.modules.delete(cb.value);
                    this.applyFiltersAndRebuild();
                });
            });

            // 2. Sub-Botões de Isolamento Rápido de Protocolo por Módulo (TDoA / TWR de Nó Específico)
            container.querySelectorAll('.btn-node-proto-sub').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const nId = btn.getAttribute('data-node');
                    const proto = btn.getAttribute('data-proto'); // 'tdoa' | 'twr'

                    // Isolamento inequívoco: seleciona apenas esse módulo e esse protocolo com o Hub
                    this.filters.modules.clear();
                    this.filters.modules.add(nId);
                    this.filters.protocol = proto;
                    this.filters.scope = 'primary';
                    this.filters.pairs.clear();
                    this.filters.directions.clear();

                    // Atualizar UI dos checkboxes
                    container.querySelectorAll(`.${uid}-cb-mod`).forEach(cb => {
                        cb.checked = (cb.value === nId);
                    });
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            });

            // Quick-Actions Módulos
            const btnModAll = document.getElementById(`${uid}-btn-mod-all`);
            if (btnModAll) {
                btnModAll.addEventListener('click', () => {
                    container.querySelectorAll(`.${uid}-cb-mod`).forEach(cb => {
                        cb.checked = true;
                        this.filters.modules.add(cb.value);
                    });
                    this.applyFiltersAndRebuild();
                });
            }
            const btnModNone = document.getElementById(`${uid}-btn-mod-none`);
            if (btnModNone) {
                btnModNone.addEventListener('click', () => {
                    container.querySelectorAll(`.${uid}-cb-mod`).forEach(cb => {
                        cb.checked = false;
                    });
                    this.filters.modules.clear();
                    this.applyFiltersAndRebuild();
                });
            }

            // 3. Pares com o Hub
            container.querySelectorAll(`.${uid}-cb-hub-pair`).forEach(cb => {
                cb.addEventListener('change', () => {
                    if (cb.checked) { this.filters.hideAllLinks = false; this.filters.pairs.add(cb.value); }
                    else this.filters.pairs.delete(cb.value);
                    this.applyFiltersAndRebuild();
                });
            });
            const btnHubPairAll = document.getElementById(`${uid}-btn-hub-pair-all`);
            if (btnHubPairAll) {
                btnHubPairAll.addEventListener('click', () => {
                    container.querySelectorAll(`.${uid}-cb-hub-pair`).forEach(cb => {
                        cb.checked = true;
                        this.filters.pairs.add(cb.value);
                    });
                    this.applyFiltersAndRebuild();
                });
            }
            const btnHubPairNone = document.getElementById(`${uid}-btn-hub-pair-none`);
            if (btnHubPairNone) {
                btnHubPairNone.addEventListener('click', () => {
                    container.querySelectorAll(`.${uid}-cb-hub-pair`).forEach(cb => {
                        cb.checked = false;
                        this.filters.pairs.delete(cb.value);
                    });
                    this.applyFiltersAndRebuild();
                });
            }

            // 4. Dropdown de Par Específico (Todos os 15 pares possíveis)
            const selPair = document.getElementById(`${uid}-select-pair`);
            if (selPair) {
                selPair.addEventListener('change', (e) => {
                    const pVal = e.target.value;
                    // Limpa pares anteriores e define o par selecionado
                    container.querySelectorAll(`.${uid}-cb-hub-pair`).forEach(cb => { cb.checked = false; });
                    this.filters.pairs.clear();
                    if (pVal) {
                        this.filters.hideAllLinks = false;
                        this.filters.pairs.add(pVal);
                    }
                    this.applyFiltersAndRebuild();
                });
            }

            // 5. Botões Globais de Protocolo
            const btnProtoAll = document.getElementById(`${uid}-btn-proto-all`);
            const btnProtoTdoa = document.getElementById(`${uid}-btn-proto-tdoa`);
            const btnProtoTwr = document.getElementById(`${uid}-btn-proto-twr`);
            if (btnProtoAll) {
                btnProtoAll.addEventListener('click', () => {
                    this.filters.protocol = 'all';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }
            if (btnProtoTdoa) {
                btnProtoTdoa.addEventListener('click', () => {
                    this.filters.protocol = 'tdoa';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }
            if (btnProtoTwr) {
                btnProtoTwr.addEventListener('click', () => {
                    this.filters.protocol = 'twr';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }

            // 6. Botões de Âmbito (Scope)
            const btnScopeAll = document.getElementById(`${uid}-btn-scope-all`);
            const btnScopePrimary = document.getElementById(`${uid}-btn-scope-primary`);
            const btnScopeMesh = document.getElementById(`${uid}-btn-scope-mesh`);
            if (btnScopeAll) {
                btnScopeAll.addEventListener('click', () => {
                    this.filters.scope = 'all';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }
            if (btnScopePrimary) {
                btnScopePrimary.addEventListener('click', () => {
                    this.filters.scope = 'primary';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }
            if (btnScopeMesh) {
                btnScopeMesh.addEventListener('click', () => {
                    this.filters.scope = 'mesh';
                    this.syncFilterButtonsUI();
                    this.applyFiltersAndRebuild();
                });
            }

            // Botão Limpar Tudo
            const btnClear = document.getElementById(`${uid}-btn-clear-filters`);
            if (btnClear) btnClear.addEventListener('click', () => this.clearFilters());

            // Botão Pausar / Retomar Gráfico (Live)
            const btnPause = document.getElementById(`${uid}-btn-pause`);
            if (btnPause) {
                btnPause.addEventListener('click', () => {
                    this.togglePause();
                });
            }

            // Botão Limpar Dados do Gráfico (Live / Toolbar)
            const btnClearData = document.getElementById(`${uid}-btn-clear-data`);
            if (btnClearData) {
                btnClearData.addEventListener('click', () => {
                    if (this.mode === 'live' && typeof window.clearLiveChartData === 'function') {
                        window.clearLiveChartData();
                    } else {
                        this.clearData();
                    }
                });
            }

            // Botão Reset Zoom
            const btnZoom = document.getElementById(`${uid}-btn-reset-zoom`);
            if (btnZoom) {
                btnZoom.addEventListener('click', () => {
                    this.resumeLiveTracking();
                });
            }

            // Botão Accordion de Filtros (Expandir / Recolher Gaveta)
            // Botão Accordion de Filtros (Expandir / Recolher Gaveta)
            const btnToggleFilters = document.getElementById(`${uid}-btn-toggle-filters`);
            const filtersPanel = document.getElementById(`${uid}-filters-panel`);
            const filterArrow = document.getElementById(`${uid}-filter-arrow`);
            if (btnToggleFilters && filtersPanel) {
                btnToggleFilters.addEventListener('click', () => {
                    const isHidden = (filtersPanel.style.display === 'none' || filtersPanel.style.display === '');
                    filtersPanel.style.display = isHidden ? 'block' : 'none';
                    if (filterArrow) filterArrow.textContent = isHidden ? '▴' : '▾';
                    btnToggleFilters.style.background = isHidden ? 'rgba(56,189,248,0.2)' : 'rgba(56,189,248,0.08)';
                    btnToggleFilters.style.borderColor = isHidden ? 'var(--cyan)' : 'rgba(56,189,248,0.4)';
                });
            }
            // Botões de Seletor Rápido de Links RF (Todos / Nenhum)
            const btnQuickAll = document.getElementById(`${uid}-btn-quick-links-all`);
            if (btnQuickAll) {
                btnQuickAll.addEventListener('click', () => {
                    this.selectAllQuickLinks();
                });
            }
            const btnQuickNone = document.getElementById(`${uid}-btn-quick-links-none`);
            if (btnQuickNone) {
                btnQuickNone.addEventListener('click', () => {
                    this.selectNoQuickLinks();
                });
            }

            this.renderQuickLinkChips(true);
            this.updateFilterBadge();
        }

        getAvailableRfPairs() {
            const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
            const pairsSet = new Set();

            // 1. Pares detetados nos registos brutos ou buffers de canal
            if (this.detectedPairs && this.detectedPairs.size > 0) {
                this.detectedPairs.forEach(p => pairsSet.add(p));
            }
            if (this.channelBuffers && this.channelBuffers.size > 0) {
                this.channelBuffers.forEach((arr, chKey) => {
                    if (!arr || arr.length === 0) return;
                    const parts = String(chKey).replace(/:(tdoa|twr)$/i, '').split('->');
                    if (parts.length === 2) {
                        const s = normalizeId(parts[0]);
                        const d = normalizeId(parts[1]);
                        if (s && d && s !== '0000' && d !== '0000' && s !== d) {
                            pairsSet.add([s, d].sort().join('-'));
                        }
                    }
                });
            }
            if (this.rawRecords && this.rawRecords.length > 0) {
                const scanLim = Math.min(this.rawRecords.length, 2500);
                const startIdx = this.rawRecords.length - scanLim;
                for (let i = startIdx; i < this.rawRecords.length; i++) {
                    const r = this.rawRecords[i];
                    if (!r) continue;
                    const s = normalizeId(r.src || r.src_addr || '');
                    const d = normalizeId(r.dst || r.dst_addr || '');
                    if (s && d && s !== '0000' && d !== '0000' && s !== d && !s.includes('*') && !d.includes('*')) {
                        const pairKey = [s, d].sort().join('-');
                        pairsSet.add(pairKey);
                        this.detectedPairs.add(pairKey);
                    }
                }
            }

            // 2. Garantir sempre os pares canónicos primários (0001 <-> 0002, 0001 <-> 0003, 0001 <-> 0004)
            // mais quaisquer outros escravos ativos no enxame
            ['0002', '0003', '0004'].forEach(slaveId => {
                if (slaveId !== master) {
                    pairsSet.add([master, slaveId].sort().join('-'));
                }
            });

            return Array.from(pairsSet).sort((a, b) => {
                const aHasMaster = a.includes(master) ? 0 : 1;
                const bHasMaster = b.includes(master) ? 0 : 1;
                if (aHasMaster !== bHasMaster) return aHasMaster - bHasMaster;
                return a.localeCompare(b);
            });
        }

        toggleQuickLinkPair(pairKey) {
            if (!pairKey) return;
            const uid = this.canvasId;

            if (this.filters.hideAllLinks) {
                this.filters.hideAllLinks = false;
                this.filters.pairs.clear();
                this.filters.pairs.add(pairKey);
            } else if (this.filters.pairs.size === 0) {
                // Estava em modo "Todos": clicar num chip isola imediatamente esse link RF
                this.filters.pairs.clear();
                this.filters.pairs.add(pairKey);
            } else if (this.filters.pairs.has(pairKey)) {
                this.filters.pairs.delete(pairKey);
            } else {
                this.filters.pairs.add(pairKey);
            }

            // Se o par selecionado for inter-escravos (Mesh) e o scope estiver restrito a 'primary', alargar para 'all'
            const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
            if (this.filters.pairs.has(pairKey) && !pairKey.includes(master) && this.filters.scope === 'primary') {
                this.filters.scope = 'all';
            }

            // Sincronizar checkboxes e dropdown do painel retrátil
            document.querySelectorAll(`.${uid}-cb-hub-pair`).forEach(cb => {
                const nid = cb.value.replace('hub-', '');
                const hubPair = [master, nid].sort().join('-');
                cb.checked = this.filters.pairs.has(cb.value) || this.filters.pairs.has(hubPair);
            });
            const selPair = document.getElementById(`${uid}-select-pair`);
            if (selPair) {
                selPair.value = (this.filters.pairs.size === 1) ? Array.from(this.filters.pairs)[0] : '';
            }

            this.syncFilterButtonsUI();
            this.renderQuickLinkChips(true);
            this.applyFiltersAndRebuild();
        }

        selectAllQuickLinks() {
            const uid = this.canvasId;
            this.filters.hideAllLinks = false;
            this.filters.pairs.clear();
            this.filters.modules.clear();
            this.filters.directions.clear();

            document.querySelectorAll(`.${uid}-cb-mod, .${uid}-cb-hub-pair, .${uid}-cb-dir`).forEach(cb => {
                cb.checked = false;
            });
            const selPair = document.getElementById(`${uid}-select-pair`);
            if (selPair) selPair.value = '';

            this.syncFilterButtonsUI();
            this.renderQuickLinkChips(true);
            this.applyFiltersAndRebuild();
        }

        selectNoQuickLinks() {
            const uid = this.canvasId;
            this.filters.hideAllLinks = true;
            this.filters.pairs.clear();
            this.filters.modules.clear();
            this.filters.directions.clear();

            document.querySelectorAll(`.${uid}-cb-mod, .${uid}-cb-hub-pair, .${uid}-cb-dir`).forEach(cb => {
                cb.checked = false;
            });
            const selPair = document.getElementById(`${uid}-select-pair`);
            if (selPair) selPair.value = '';

            this.syncFilterButtonsUI();
            this.renderQuickLinkChips(true);
            this.applyFiltersAndRebuild();
        }

        renderQuickLinkChips(force = false) {
            const uid = this.canvasId;
            const chipsContainer = document.getElementById(`${uid}-quick-links-chips`);
            if (!chipsContainer) return;

            const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
            const availablePairs = this.getAvailableRfPairs();
            const isNone = Boolean(this.filters.hideAllLinks);
            const isAll = !isNone && this.filters.pairs.size === 0 && this.filters.modules.size === 0 && this.filters.directions.size === 0;

            const activeSet = new Set();
            availablePairs.forEach(pairKey => {
                if (isNone) return;
                if (isAll) {
                    activeSet.add(pairKey);
                    return;
                }
                const [nA, nB] = pairKey.split('-');
                const isPrimary = (nA === master || nB === master);
                const remoteNode = (nA === master) ? nB : ((nB === master) ? nA : null);

                let pairActive = false;
                if (this.filters.pairs.size > 0) {
                    pairActive = this.filters.pairs.has(pairKey) ||
                        (isPrimary && remoteNode && this.filters.pairs.has(`hub-${remoteNode}`));
                } else if (this.filters.modules.size > 0) {
                    pairActive = this.filters.modules.has(nA) || this.filters.modules.has(nB);
                } else {
                    pairActive = true;
                }
                if (pairActive) activeSet.add(pairKey);
            });

            const sig = `${master}|${isAll}|${isNone}|${availablePairs.join(',')}|${Array.from(activeSet).join(',')}`;
            if (!force && this._lastQuickLinksSignature === sig) {
                return;
            }
            this._lastQuickLinksSignature = sig;

            const btnAll = document.getElementById(`${uid}-btn-quick-links-all`);
            const btnNone = document.getElementById(`${uid}-btn-quick-links-none`);
            if (btnAll) btnAll.classList.toggle('active', isAll);
            if (btnNone) btnNone.classList.toggle('active', isNone);

            chipsContainer.innerHTML = availablePairs.map(pairKey => {
                const [nA, nB] = pairKey.split('-');
                const isPrimary = (nA === master || nB === master);
                const remoteNode = (nA === master) ? nB : ((nB === master) ? nA : nB);
                const palette = NODE_PALETTES[remoteNode] || NODE_PALETTES['0002'];
                const accent = isPrimary ? (palette.tdoa?.border || palette.twrMtoS?.border || '#38bdf8') : '#94a3b8';
                const isChecked = activeSet.has(pairKey);
                const isIsolated = !isAll && !isNone && activeSet.has(pairKey);
                const labelText = `${nA} ↔ ${nB}`;

                return `
                    <label class="uwb-filter-chip uwb-quick-link-chip ${isChecked ? 'is-active' : 'is-muted'} ${isIsolated ? 'is-isolated' : ''}" data-pair="${pairKey}" style="--chip-accent:${accent}; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:2px 7px; border-radius:5px; border:1px solid ${isChecked ? accent : 'rgba(255,255,255,0.12)'}; background:${isChecked ? 'rgba(15,23,42,0.92)' : 'rgba(15,23,42,0.45)'}; opacity:${isChecked ? '1' : '0.55'};" title="Alternar link RF 0x${nA} ↔ 0x${nB} (clique para isolar/alternar)">
                        <input type="checkbox" class="${uid}-cb-quick-link uwb-custom-checkbox" value="${pairKey}" ${isChecked ? 'checked' : ''} style="--cb-color:${accent}; cursor:pointer;">
                        <span style="width:6px; height:6px; border-radius:50%; background:${accent}; box-shadow:${isChecked ? `0 0 6px ${accent}` : 'none'}; display:inline-block;"></span>
                        <span style="font-family:var(--font-mono); font-size:10px; font-weight:700; color:${isChecked ? '#f8fafc' : '#94a3b8'};">${labelText}</span>
                    </label>
                `;
            }).join('');

            chipsContainer.querySelectorAll(`.${uid}-cb-quick-link`).forEach(cb => {
                cb.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.toggleQuickLinkPair(cb.value);
                });
            });

            const summaryEl = document.getElementById(`${uid}-quick-links-summary`);
            if (summaryEl) {
                if (isNone) {
                    summaryEl.innerHTML = '<span style="color:#f87171;">0 links visíveis (Ocultos)</span>';
                } else if (isAll) {
                    summaryEl.innerHTML = `<span style="color:#38bdf8;">Todos os links (${availablePairs.length})</span>`;
                } else {
                    summaryEl.innerHTML = `<span style="color:#fbbf24;">${activeSet.size}/${availablePairs.length} links ativos</span>`;
                }
            }
        }

        syncFilterButtonsUI() {
            const uid = this.canvasId;
            const btnProtoAll = document.getElementById(`${uid}-btn-proto-all`);
            const btnProtoTdoa = document.getElementById(`${uid}-btn-proto-tdoa`);
            const btnProtoTwr = document.getElementById(`${uid}-btn-proto-twr`);
            if (btnProtoAll) btnProtoAll.classList.toggle('active', this.filters.protocol === 'all');
            if (btnProtoTdoa) btnProtoTdoa.classList.toggle('active', this.filters.protocol === 'tdoa');
            if (btnProtoTwr) btnProtoTwr.classList.toggle('active', this.filters.protocol === 'twr');

            const btnScopeAll = document.getElementById(`${uid}-btn-scope-all`);
            const btnScopePrimary = document.getElementById(`${uid}-btn-scope-primary`);
            const btnScopeMesh = document.getElementById(`${uid}-btn-scope-mesh`);
            if (btnScopeAll) btnScopeAll.classList.toggle('active', this.filters.scope === 'all');
            if (btnScopePrimary) btnScopePrimary.classList.toggle('active', this.filters.scope === 'primary');
            if (btnScopeMesh) btnScopeMesh.classList.toggle('active', this.filters.scope === 'mesh');
        }

        updateFilterBadge() {
            const uid = this.canvasId;
            const badge = document.getElementById(`${uid}-filter-badge`);
            if (!badge) return;

            const hasMod = this.filters.modules.size > 0;
            const hasPair = this.filters.pairs.size > 0;
            const hasDir = this.filters.directions.size > 0;
            const hasProto = this.filters.protocol && this.filters.protocol !== 'all';
            const hasScope = this.filters.scope && this.filters.scope !== 'all';
            const hasHideAll = Boolean(this.filters.hideAllLinks);

            if (!hasMod && !hasPair && !hasDir && !hasProto && !hasScope && !hasHideAll) {
                badge.textContent = '(Todos)';
                badge.style.color = '#38bdf8';
                badge.style.background = 'rgba(56,189,248,0.22)';
                return;
            }

            const activeVisible = this.chart?.data?.datasets?.filter(d => (d.data?.length || 0) > 0)?.length || 0;
            badge.textContent = `(${activeVisible} canais)`;
            badge.style.color = '#fbbf24';
            badge.style.background = 'rgba(251,191,36,0.28)';
        }

        setXAxis(newX) {
            if (!AXIS_DEFS.x[newX]) return;
            this.xAxis = newX;
            const xDef = AXIS_DEFS.x[this.xAxis];

            if (this.chart && this.chart.options.scales.x) {
                this.chart.options.scales.x.title.text = `${xDef.label} (${xDef.unit})`;
                delete this.chart.options.scales.x.min;
                delete this.chart.options.scales.x.max;
            }

            const selX = document.getElementById(`${this.canvasId}-select-x`);
            if (selX && selX.value !== newX) selX.value = newX;

            this.applyFiltersAndRebuild();
        }

        setYAxis(newY) {
            if (!AXIS_DEFS.y[newY]) return;
            this.yAxis = newY;
            const yDef = AXIS_DEFS.y[this.yAxis];

            if (this.chart && this.chart.options.scales.y) {
                this.chart.options.scales.y.title.text = `${yDef.label} (${yDef.unit})`;
                this.chart.options.scales.y.ticks.callback = (v) => `${Number(v).toFixed(yDef.decimals >= 2 ? 2 : yDef.decimals)} ${yDef.unit}`;
            }

            const selY = document.getElementById(`${this.canvasId}-select-y`);
            if (selY && selY.value !== newY) selY.value = newY;

            this.applyFiltersAndRebuild();
        }

        clearFilters() {
            this.filters.modules.clear();
            this.filters.pairs.clear();
            this.filters.directions.clear();
            this.filters.protocol = 'all';
            this.filters.scope = 'primary';
            this.filters.hideAllLinks = false;

            const uid = this.canvasId;
            document.querySelectorAll(`.${uid}-cb-mod, .${uid}-cb-hub-pair, .${uid}-cb-dir`).forEach(cb => {
                cb.checked = false;
            });
            const selPair = document.getElementById(`${uid}-select-pair`);
            if (selPair) selPair.value = '';

            this.syncFilterButtonsUI();
            this.renderQuickLinkChips(true);
            this.updateFilterBadge();
            this.applyFiltersAndRebuild();
        }

        clearData() {
            this.rawRecords = [];
            this.records = [];
            this.t0_hardware_us = null;
            this.latestHardwareX = null;
            this.lastPacketWallMs = null;
            this._displayMaxT = null;
            this._lastAnimFrameMs = null;
            this.isUserNavigating = false;
            this._lastStatsUpdate = null;
            this._lastStatsUpdateMs = 0;
            if (this._cachedStatsByChannel) this._cachedStatsByChannel.clear();
            this.needsRebuild = true;
            if (this.channelBuffers) this.channelBuffers.clear();
            this.liveCycleCounter = 0;
            this.liveStreamLastRaw = {};
            if (this.isPaused) {
                this.isPaused = false;
                this.updatePauseUI();
            }
            if (this.chart) {
                if (typeof this.chart.resetZoom === 'function') {
                    try { this.chart.resetZoom(); } catch (e) {}
                }
                (this.chart.data.datasets || []).forEach(ds => { ds.data = []; });
                this.chart.data.datasets = [];
                if (this.chart.options && this.chart.options.scales && this.chart.options.scales.x) {
                    delete this.chart.options.scales.x.min;
                    delete this.chart.options.scales.x.max;
                }
                this.chart.update('none');
            }
            this.updateLiveTrackingStatus();
            this.updateStatsStrip();
        }

        matchesFilters(r) {
            if (this.filters.hideAllLinks) return false;
            const src = normalizeId(r.src || r.src_addr || '');
            const dst = normalizeId(r.dst || r.dst_addr || '');

            // Eliminar medições inválidas ou auto-medições espúrias (src === dst)
            if (!src || !dst || src === '0000' || dst === '0000' || src === dst) return false;

            const proto = (r.protocol || r.lastProto || (r.packet_type ? r.packet_type : (r.type === 'tdoa' ? 'TDOA' : 'TWR'))).toUpperCase();
            const isTdoa = (proto === 'TDOA' || proto === 'OWR');
            const protoNorm = isTdoa ? 'TDoA' : 'TWR';

            const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
            const isSrcMaster = (src === master);
            const isDstMaster = (dst === master);
            const isPrimary = (isSrcMaster || isDstMaster);
            const remoteNode = isSrcMaster ? dst : (isDstMaster ? src : null);

            // 1. Âmbito de Tráfego (Scope)
            if (this.filters.scope === 'primary' && !isPrimary) return false;
            if (this.filters.scope === 'mesh' && isPrimary) return false;

            // 2. Protocolo Global (all | tdoa | twr)
            if (this.filters.protocol && this.filters.protocol !== 'all') {
                if (this.filters.protocol.toUpperCase() !== protoNorm.toUpperCase()) return false;
            }

            // 3. Módulos UWB (passa se src OU dst corresponder a qualquer módulo selecionado)
            if (this.filters.modules && this.filters.modules.size > 0) {
                if (!this.filters.modules.has(src) && !this.filters.modules.has(dst)) {
                    return false;
                }
            }

            // 4. Pares Bidirecionais (suporta '0001-0002' e 'hub-0002')
            if (this.filters.pairs && this.filters.pairs.size > 0) {
                const pairKey = [src, dst].sort().join('-');
                const matchesPair = this.filters.pairs.has(pairKey) ||
                    (isPrimary && (this.filters.pairs.has(`hub-${src}`) || this.filters.pairs.has(`hub-${dst}`)));
                if (!matchesPair) return false;
            }

            // 5. Sentidos / Séries Específicas
            if (this.filters.directions && this.filters.directions.size > 0) {
                const protoSuffix = isTdoa ? ':tdoa' : ':twr';
                const keyWithProto = `${src}->${dst}${protoSuffix}`;
                const keyWithoutProto = `${src}->${dst}`;

                let match = this.filters.directions.has(keyWithProto) || this.filters.directions.has(keyWithoutProto);

                // Suporte a tags dinâmicas com o Hub
                if (!match && remoteNode) {
                    if (isSrcMaster && this.filters.directions.has(`hub->${remoteNode}${protoSuffix}`)) match = true;
                    if (isDstMaster && this.filters.directions.has(`${remoteNode}->hub${protoSuffix}`)) match = true;
                }

                // Apenas para TDoA de 1-via: se gravado pelo escravo com src invertido
                if (!match && isTdoa) {
                    match = this.filters.directions.has(`${dst}->${src}:tdoa`) || this.filters.directions.has(`${dst}->${src}`);
                }

                if (!match) return false;
            }

            return true;
        }

        /**
         * Normaliza a sequência para garantir uma escala unificada de ciclos do algoritmo
         * independentemente do protocolo (TWR vs TDoA), preservando deltas físicos e perdas de pacotes.
         */
        normalizeSequence(records) {
            if (!Array.isArray(records) || records.length === 0) return records;

            let maxSeq = -Infinity, minSeq = Infinity;
            records.forEach(r => {
                if (r && r.seq != null && !isNaN(r.seq)) {
                    const s = Number(r.seq);
                    if (s < minSeq) minSeq = s;
                    if (s > maxSeq) maxSeq = s;
                }
            });

            // Se existir salto astronómico entre protocolos (ex: TWR em 50 e TDoA em 1.7M) ou contadores absolutos de hardware:
            if (maxSeq - minSeq > 10000 || minSeq === 0) {
                let currentCycle = 1;
                const lastRawByProto = {};

                records.forEach((r, idx) => {
                    if (r.seq_raw === undefined) {
                        r.seq_raw = r.seq;
                    }
                    const rawS = (r.seq_raw !== undefined && r.seq_raw !== null && !isNaN(r.seq_raw)) ? Number(r.seq_raw) : null;
                    const proto = (r.protocol || r.packet_type || 'TWR').toUpperCase();
                    const prevRaw = lastRawByProto[proto];

                    if (rawS !== null && prevRaw !== undefined) {
                        const delta = rawS - prevRaw;
                        if (delta > 0 && delta < 10000) {
                            currentCycle += delta;
                        } else if (delta !== 0) {
                            currentCycle += 1;
                        }
                    } else {
                        if (idx > 0) currentCycle += 1;
                    }

                    if (rawS !== null) lastRawByProto[proto] = rawS;
                    r.seq = currentCycle;
                    r.algo_cycle = currentCycle;
                });
            } else {
                records.forEach(r => {
                    if (r.seq_raw === undefined) r.seq_raw = r.seq;
                    if (r.algo_cycle === undefined) r.algo_cycle = r.seq;
                });
            }

            return records;
        }

        extractX(r, index, t0_hw_us) {
            if (!r) return null;
            if (this.xAxis === 'seq') {
                // Ciclos do Algoritmo SwarmLoc normalizados (unificados entre protocolos)
                if (r.seq !== undefined && r.seq !== null && !isNaN(r.seq)) {
                    return Number(r.seq);
                }
                if (r.algo_cycle !== undefined && r.algo_cycle !== null && !isNaN(r.algo_cycle)) {
                    return Number(r.algo_cycle);
                }
                return (index !== undefined && index !== null) ? (index + 1) : null;
            }
            if (this.xAxis === 'seq_rf') {
                // Contador bruto de pacotes RF do hardware (DW3000 / beacons)
                const rawVal = (r.seq_raw !== undefined && r.seq_raw !== null) ? r.seq_raw : r.seq;
                if (rawVal !== undefined && rawVal !== null && !isNaN(rawVal)) {
                    return Number(rawVal);
                }
                return (index !== undefined && index !== null) ? (index + 1) : null;
            }
            if (this.xAxis === 'elapsed') {
                if (r.elapsed_s !== undefined && r.elapsed_s !== null && !isNaN(r.elapsed_s)) {
                    return Number(r.elapsed_s);
                }
                const hwUs = (r.t_global_us !== undefined && r.t_global_us !== null)
                    ? Number(r.t_global_us)
                    : ((r.t_local_us !== undefined && r.t_local_us !== null) ? Number(r.t_local_us) : null);
                if (hwUs !== null && t0_hw_us !== null && hwUs >= t0_hw_us) {
                    return Math.max(0, (hwUs - t0_hw_us) / 1e6);
                }
                if (r.epoch !== undefined && r.epoch !== null && !isNaN(r.epoch) && this.t0_epoch) {
                    return Math.max(0, (r.epoch - this.t0_epoch) / 1000.0);
                }
                return (index !== undefined && index !== null) ? (index + 1) : null;
            }
            // 't_global': tempo global sincronizado do DW3000 / firmware
            if (r.t_global_s !== undefined && r.t_global_s !== null && !isNaN(r.t_global_s)) {
                return Number(r.t_global_s);
            }
            if (r.t_global_us !== undefined && r.t_global_us !== null && !isNaN(r.t_global_us)) {
                const tgSec = Number(r.t_global_us) / 1e6;
                // Descarta pontos anómalos de fallback em 0s se a base de hardware já estiver em regime (>1000s)
                if (t0_hw_us !== null && t0_hw_us > 1000000 && tgSec < 1.0) {
                    return null;
                }
                return tgSec;
            }
            if (r.t_local_us !== undefined && r.t_local_us !== null && !isNaN(r.t_local_us)) {
                return Number(r.t_local_us) / 1e6;
            }
            if (r.epoch !== undefined && r.epoch !== null && !isNaN(r.epoch)) {
                return Number(r.epoch) / 1000.0;
            }
            if (r.timestamp_ms !== undefined && r.timestamp_ms !== null && !isNaN(r.timestamp_ms)) {
                return Number(r.timestamp_ms) / 1000.0;
            }
            return null;
        }

        extractY(r) {
            const yDef = AXIS_DEFS.y[this.yAxis] || AXIS_DEFS.y.dist_m;
            return yDef.extract(r);
        }

        setData(records) {
            const rawArr = Array.isArray(records) ? records : [];
            this.rawRecords = this.normalizeSequence(rawArr);
            if (this.mode === 'live') {
                this.ingestLiveBatch(this.rawRecords, this.channelBuffers);
            } else {
                this.applyFiltersAndRebuild();
            }
        }

        ingestLiveBatch(records, channelBuffers) {
            this.rawRecords = records || [];
            if (channelBuffers) {
                this.channelBuffers = channelBuffers;
            }
            if (!this.isPaused && !this.isUserNavigating) {
                this.needsRebuild = true;
            }

            // Identificar o t0 de hardware caso ainda não esteja registado
            if (this.t0_hardware_us === null && this.rawRecords.length > 0) {
                for (let i = 0; i < this.rawRecords.length; i++) {
                    const rec = this.rawRecords[i];
                    const tg = rec.t_global_us != null ? Number(rec.t_global_us) : (rec.t_local_us != null ? Number(rec.t_local_us) : null);
                    if (tg !== null && tg > 1000000) {
                        this.t0_hardware_us = tg;
                        break;
                    }
                }
            }

            // Atualizar o maior timestamp X recebido (sem interromper no 1.º elemento se a cauda estiver fora de ordem)
            let maxTailX = null;
            if (this.rawRecords.length > 0) {
                const tailLen = Math.min(this.rawRecords.length, 200);
                for (let i = this.rawRecords.length - 1; i >= this.rawRecords.length - tailLen; i--) {
                    const r = this.rawRecords[i];
                    const xVal = this.extractX(r, i, this.t0_hardware_us);
                    if (xVal != null && !isNaN(xVal) && isFinite(xVal)) {
                        if (maxTailX === null || xVal > maxTailX) {
                            maxTailX = xVal;
                        }
                    }
                }
            }
            if (this.channelBuffers && this.channelBuffers.size > 0) {
                this.channelBuffers.forEach((arr) => {
                    if (!arr || arr.length === 0) return;
                    const startCheck = Math.max(0, arr.length - 10);
                    for (let i = arr.length - 1; i >= startCheck; i--) {
                        const xVal = this.extractX(arr[i], i, this.t0_hardware_us);
                        if (xVal != null && !isNaN(xVal) && isFinite(xVal)) {
                            if (maxTailX === null || xVal > maxTailX) {
                                maxTailX = xVal;
                            }
                        }
                    }
                });
            }
            if (maxTailX !== null) {
                if (this.latestHardwareX === null || maxTailX > this.latestHardwareX || Math.abs(maxTailX - this.latestHardwareX) > 300.0) {
                    this.latestHardwareX = maxTailX;
                }
                this.lastPacketWallMs = performance.now();
            }

            // Para eixos estáticos ou não temporais, agenda render imediato
            if (this.xAxis === 'seq' || this.xAxis === 'seq_rf' || !this.windowDuration_s) {
                this.scheduleRender();
            }
        }

        scheduleRender() {
            if (this.renderRafPending) return;
            this.renderRafPending = true;
            requestAnimationFrame(() => {
                this.renderRafPending = false;
                this.applyFiltersAndRebuild();
            });
        }

        applyFiltersAndRebuild(smoothMinT, smoothMaxT) {
            if (!this.chart) this.initChart();
            if (!this.chart) return;
            this.renderQuickLinkChips();
            this.updateFilterBadge();

            // 1. Identificar t0 de hardware (filtrando anomalias não-inicializadas < 1s)
            let t0_hw_us = this.t0_hardware_us;
            if (t0_hw_us === null) {
                for (let i = 0; i < this.rawRecords.length; i++) {
                    const rec = this.rawRecords[i];
                    const tg = rec.t_global_us != null ? Number(rec.t_global_us) : (rec.t_local_us != null ? Number(rec.t_local_us) : null);
                    if (tg !== null && tg > 1000000) {
                        t0_hw_us = tg;
                        break;
                    }
                }
                this.t0_hardware_us = t0_hw_us;
            }

            // 2. Determinar limites temporais no modo Live
            let maxT = (smoothMaxT !== undefined && isFinite(smoothMaxT)) ? smoothMaxT : -Infinity;
            let minT = (smoothMinT !== undefined && isFinite(smoothMinT)) ? smoothMinT : -Infinity;

            if (this.mode === 'live' && this.windowDuration_s && (this.xAxis === 't_global' || this.xAxis === 'elapsed')) {
                if (maxT === -Infinity) {
                    const xScale = this.chart && this.chart.scales && this.chart.scales.x;
                    if ((this.isPaused || this.isUserNavigating) && xScale && isFinite(xScale.max)) {
                        maxT = xScale.max;
                        minT = xScale.min;
                    } else if ((this.isPaused || this.isUserNavigating) && this.chart && isFinite(this.chart.options.scales.x.max)) {
                        maxT = this.chart.options.scales.x.max;
                        minT = this.chart.options.scales.x.min;
                    } else if (this.rawRecords.length > 0) {
                        const tail = this.rawRecords.slice(-50);
                        tail.forEach((r, idx) => {
                            const t = this.extractX(r, idx, t0_hw_us);
                            if (t != null && !isNaN(t) && isFinite(t) && t > maxT) maxT = t;
                        });
                        if (maxT > -Infinity && isFinite(maxT)) {
                            minT = maxT - this.windowDuration_s;
                        }
                    }
                }
            }

            // 3. Agrupamento e isolamento estrito por canal de rádio
            // Se existirem channelBuffers dedicados (Live), usá-los para garantir preservação completa sem atropelamento
            const channelGroups = new Map();

            if (this.mode === 'live' && this.channelBuffers && this.channelBuffers.size > 0) {
                this.channelBuffers.forEach((ptsArray, chKey) => {
                    if (!ptsArray || ptsArray.length === 0) return;
                    const parts = chKey.replace(/:(tdoa|twr)$/i, '').split('->');
                    if (parts.length === 2) {
                        const s = normalizeId(parts[0]);
                        const d = normalizeId(parts[1]);
                        if (!s || !d || s === '0000' || d === '0000' || s === d) return;
                    }
                    const sample = ptsArray[ptsArray.length - 1];
                    if (this.matchesFilters(sample)) {
                        channelGroups.set(chKey, ptsArray);
                    }
                });
            } else {
                let rawSource = this.rawRecords;
                if (this.mode === 'live' && this.windowDuration_s && (this.xAxis === 't_global' || this.xAxis === 'elapsed')) {
                    const safeTail = Math.min(this.rawRecords.length, Math.max(400, Math.ceil(this.windowDuration_s * 2000)));
                    if (this.rawRecords.length > safeTail) {
                        rawSource = this.rawRecords.slice(-safeTail);
                    }
                }
                this.records = rawSource.filter(r => this.matchesFilters(r));

                this.records.forEach((r, idx) => {
                    const src = normalizeId(r.src || r.src_addr || '');
                    const dst = normalizeId(r.dst || r.dst_addr || '');
                    if (!src || !dst) return;
                    const proto = (r.protocol || r.lastProto || (r.packet_type ? r.packet_type : (r.type === 'tdoa' ? 'TDOA' : 'TWR'))).toUpperCase();
                    const isTdoa = (proto === 'TDOA' || proto === 'OWR');
                    const channelKey = isTdoa ? `${src}->${dst}:tdoa` : `${src}->${dst}:twr`;
                    if (!channelGroups.has(channelKey)) {
                        channelGroups.set(channelKey, []);
                    }
                    channelGroups.get(channelKey).push(r);
                });
            }

            if (typeof this.onFilterChange === 'function') {
                this.onFilterChange({
                    totalRaw: this.rawRecords.length,
                    totalFiltered: this.records ? this.records.length : this.rawRecords.length,
                    filters: this.filters
                });
            }

            // 4. Ordenação determinística de canais
            const sortedChannelKeys = Array.from(channelGroups.keys()).sort((a, b) => {
                const slaveA = a.replace(':tdoa', '').replace(/^0001->/, '');
                const slaveB = b.replace(':tdoa', '').replace(/^0001->/, '');
                return slaveA.localeCompare(slaveB) || a.localeCompare(b);
            });

            const datasets = [];
            const showLines = (this.styleType === 'line_points' || this.styleType === 'line');
            const showPoints = (this.styleType === 'line_points' || this.styleType === 'points');

            sortedChannelKeys.forEach(chKey => {
                const items = channelGroups.get(chKey);
                const colInfo = resolveChannelInfo(chKey);
                const isTwr = colInfo.proto === 'TWR';

                // Tolerâncias científicas rigorosas de continuidade:
                // TDoA (250-1000 Hz, nominal inter-packet 2-4ms): tolerância a jitter e perda de pacotes RF (200ms)
                // TWR (sincronização periódica a cada 10s nominal): continuidade Sample & Hold de até 35s
                const syncPeriod = Number(this.syncPeriod_s || 10.0);
                const maxAllowedGap = isTwr ? Math.max(2.5, Math.min(syncPeriod * 1.5, 12.0)) : 0.200;

                const pts = [];
                const isTimeAxis = (this.xAxis === 't_global' || this.xAxis === 'elapsed');
                const isWindowed = (this.mode === 'live' && this.windowDuration_s && isFinite(minT) && isFinite(maxT) && isTimeAxis);

                let channelStats = null;
                if (isWindowed) {
                    // Varredura O(K) pela cauda: imune a saltos/desordenações de timestamp (ex: rotação de Master)
                    const searchTarget = minT - maxAllowedGap;
                    const visibleRev = [];
                    let lastBefore = null;
                    let firstAfter = null;
                    let consecutiveBeforeTarget = 0;

                    for (let i = items.length - 1; i >= 0; i--) {
                        const r = items[i];
                        const xVal = this.extractX(r, i, t0_hw_us);
                        const yVal = this.extractY(r);
                        if (xVal === null || isNaN(xVal) || yVal === null || isNaN(yVal)) continue;

                        if (xVal > maxT) {
                            if ((xVal - maxT) <= maxAllowedGap) {
                                if (!firstAfter || xVal < firstAfter.x) {
                                    firstAfter = { x: xVal, y: yVal, protocol: colInfo.proto, seq: r.seq || i, raw: r };
                                }
                            }
                            continue;
                        }
                        if (xVal < minT) {
                            if (!lastBefore || xVal > lastBefore.x) {
                                lastBefore = { x: xVal, y: yVal, protocol: colInfo.proto, seq: r.seq || i, raw: r };
                            }
                            if (xVal < searchTarget) {
                                consecutiveBeforeTarget++;
                                if (consecutiveBeforeTarget >= 64) {
                                    break;
                                }
                            } else {
                                consecutiveBeforeTarget = 0;
                            }
                            continue;
                        }
                        consecutiveBeforeTarget = 0;
                        visibleRev.push({ x: xVal, y: yVal, protocol: colInfo.proto, seq: r.seq || i, raw: r });
                    }

                    const visiblePts = visibleRev.reverse();
                    if (firstAfter) {
                        visiblePts.push(firstAfter);
                    }
                    // Monotonicidade estrita no eixo temporal: assegura que as amostras avançam unicamente da esquerda para a direita (x_i <= x_{i+1})
                    visiblePts.sort((a, b) => a.x - b.x);

                    // Estatísticas exatas sobre todos os pontos visíveis antes da decimação visual (throttled a ~4 Hz)
                    const nowMs = performance.now();
                    if ((nowMs - this._lastStatsUpdateMs) >= 220 || !this._cachedStatsByChannel.has(chKey)) {
                        const nVis = visiblePts.length;
                        if (nVis > 0) {
                            let sum = 0;
                            const valsArr = new Float64Array(nVis);
                            for (let i = 0; i < nVis; i++) {
                                const v = visiblePts[i].y;
                                valsArr[i] = v;
                                sum += v;
                            }
                            const mean = sum / nVis;
                            let varSum = 0;
                            for (let i = 0; i < nVis; i++) {
                                const d = valsArr[i] - mean;
                                varSum += d * d;
                            }
                            const stdDev = nVis >= 2 ? Math.sqrt(varSum / (nVis - 1)) : 0;
                            valsArr.sort();
                            const median = (nVis % 2 === 0) ? (valsArr[nVis / 2 - 1] + valsArr[nVis / 2]) / 2 : valsArr[Math.floor(nVis / 2)];
                            const devArr = new Float64Array(nVis);
                            for (let i = 0; i < nVis; i++) {
                                devArr[i] = Math.abs(valsArr[i] - median);
                            }
                            devArr.sort();
                            const madVal = (nVis % 2 === 0) ? (devArr[nVis / 2 - 1] + devArr[nVis / 2]) / 2 : devArr[Math.floor(nVis / 2)];
                            channelStats = { n: nVis, mean, stdDev, madVal };
                        } else {
                            channelStats = { n: 0, mean: 0, stdDev: 0, madVal: 0 };
                        }
                        this._cachedStatsByChannel.set(chKey, channelStats);
                    } else {
                        channelStats = this._cachedStatsByChannel.get(chKey);
                    }

                    if (isTwr && lastBefore && visiblePts.length > 0 && (minT - lastBefore.x) <= maxAllowedGap && (visiblePts[0].x - minT) <= maxAllowedGap) {
                        pts.push({
                            x: minT,
                            y: lastBefore.y,
                            protocol: lastBefore.protocol,
                            seq: lastBefore.seq,
                            raw: lastBefore.raw,
                            isBoundary: true
                        });
                    } else if (!isTwr && lastBefore && visiblePts.length > 0) {
                        if ((visiblePts[0].x - lastBefore.x) <= maxAllowedGap && (visiblePts[0].x >= lastBefore.x)) {
                            pts.push(lastBefore);
                        }
                    }

                    for (let i = 0; i < visiblePts.length; i++) {
                        const p = visiblePts[i];
                        if (pts.length > 0) {
                            const prevPt = pts[pts.length - 1];
                            const dt = p.x - prevPt.x;
                            if (prevPt.y !== null && (dt > maxAllowedGap || dt < 0)) {
                                pts.push({
                                    x: prevPt.x + 0.0001,
                                    y: null,
                                    isBoundary: true
                                });
                            }
                        }
                        pts.push(p);
                    }

                    if (isTwr) {
                        // Se não há dados visíveis na janela, NÃO sintetizar linhas falsas de minT a maxT!
                        if (pts.length > 0) {
                            const lastValid = pts[pts.length - 1];
                            // Só prolongar até à borda direita se a medição for recente (<= 3s)
                            if (lastValid && lastValid.y !== null && (maxT - lastValid.x) > 0.001) {
                                if ((maxT - lastValid.x) <= Math.min(maxAllowedGap, 3.0)) {
                                    pts.push({
                                        x: maxT,
                                        y: lastValid.y,
                                        protocol: lastValid.protocol,
                                        seq: lastValid.seq,
                                        raw: lastValid.raw,
                                        isBoundary: true
                                    });
                                } else {
                                    // Canal silencioso/inativo: quebrar linha de forma limpa em vez de desenhar linha fantasma infinita
                                    pts.push({
                                        x: lastValid.x + 0.0001,
                                        y: null,
                                        isBoundary: true
                                    });
                                }
                            }
                        }
                    }
                } else {
                    // Modo estático (Análise pós-ensaio / Eixos sequenciais)
                    const rawPts = [];
                    for (let i = 0; i < items.length; i++) {
                        const r = items[i];
                        const xVal = this.extractX(r, i, t0_hw_us);
                        const yVal = this.extractY(r);
                        if (xVal === null || isNaN(xVal) || yVal === null || isNaN(yVal)) continue;
                        rawPts.push({
                            x: xVal,
                            y: yVal,
                            protocol: colInfo.proto,
                            seq: r.seq || i,
                            raw: r
                        });
                    }
                    if (isTimeAxis) {
                        rawPts.sort((a, b) => a.x - b.x);
                    }
                    for (let i = 0; i < rawPts.length; i++) {
                        const p = rawPts[i];
                        if (pts.length > 0 && isTimeAxis) {
                            const prevPt = pts[pts.length - 1];
                            if (prevPt.y !== null && (p.x - prevPt.x) > maxAllowedGap) {
                                pts.push({ x: prevPt.x + 0.0001, y: null, isBoundary: true });
                            }
                        }
                        pts.push(p);
                    }
                }

                let renderPts = pts;
                if (isWindowed && pts.length > 1800) {
                    const targetBuckets = 420;
                    const decimated = [];
                    let segStart = 0;
                    const pushSegment = (startIdx, endIdx, budget) => {
                        const segLen = endIdx - startIdx;
                        if (segLen <= 0) return;
                        if (segLen <= budget || budget < 4) {
                            for (let k = startIdx; k < endIdx; k++) decimated.push(pts[k]);
                            return;
                        }
                        const buckets = Math.max(1, Math.floor(budget / 3));
                        const step = segLen / buckets;
                        for (let b = 0; b < buckets; b++) {
                            const bStart = startIdx + Math.floor(b * step);
                            const bEnd = Math.min(endIdx, startIdx + Math.floor((b + 1) * step));
                            if (bStart >= bEnd) continue;
                            let minIdx = bStart, maxIdx = bStart;
                            for (let k = bStart + 1; k < bEnd; k++) {
                                if (pts[k].y < pts[minIdx].y) minIdx = k;
                                if (pts[k].y > pts[maxIdx].y) maxIdx = k;
                            }
                            if (b === 0 && minIdx !== bStart && maxIdx !== bStart) decimated.push(pts[bStart]);
                            if (minIdx < maxIdx) {
                                decimated.push(pts[minIdx]);
                                decimated.push(pts[maxIdx]);
                            } else if (maxIdx < minIdx) {
                                decimated.push(pts[maxIdx]);
                                decimated.push(pts[minIdx]);
                            } else {
                                decimated.push(pts[minIdx]);
                            }
                            if (b === buckets - 1 && (bEnd - 1) !== minIdx && (bEnd - 1) !== maxIdx) {
                                decimated.push(pts[bEnd - 1]);
                            }
                        }
                    };
                    for (let i = 0; i < pts.length; i++) {
                        if (pts[i].y === null) {
                            const segBudget = Math.max(8, Math.round((i - segStart) / pts.length * (targetBuckets * 3)));
                            pushSegment(segStart, i, segBudget);
                            decimated.push(pts[i]);
                            segStart = i + 1;
                        }
                    }
                    if (segStart < pts.length) {
                        const segBudget = Math.max(8, Math.round((pts.length - segStart) / pts.length * (targetBuckets * 3)));
                        pushSegment(segStart, pts.length, segBudget);
                    }
                    renderPts = decimated;
                }

                const isShortWindow = (this.windowDuration_s !== null && this.windowDuration_s <= 2.5);
                const useStaticRadius = !isTwr && renderPts.length > 300;
                datasets.push({
                    label: `${colInfo.name}`,
                    channelKey: chKey,
                    data: renderPts,
                    _channelStats: channelStats,
                    borderColor: colInfo.border,
                    backgroundColor: colInfo.bg,
                    borderDash: colInfo.dash,
                    borderWidth: showLines ? (isTwr ? 2.5 : 1.2) : 0,
                    showLine: showLines,
                    borderDash: colInfo.dash || [],
                    pointRadius: useStaticRadius ? (showPoints ? (renderPts.length > 600 ? 0.6 : 1.0) : 0) : ((ctx) => {
                        const pt = ctx.raw;
                        if (!pt || pt.isBoundary || pt.y === null) return 0;
                        if (!showPoints) return 0;
                        if (isTwr) return isShortWindow ? 3.0 : 4.0;
                        return isShortWindow ? (renderPts.length > 150 ? 0.8 : 1.2) : (renderPts.length > 250 ? 0.8 : 1.4);
                    }),
                    pointHoverRadius: useStaticRadius ? (showPoints ? 4 : 0) : ((ctx) => {
                        const pt = ctx.raw;
                        if (!pt || pt.isBoundary || pt.y === null) return 0;
                        return showPoints ? 6 : 0;
                    }),
                    pointBackgroundColor: colInfo.border,
                    tension: isTwr ? 0 : 0.04,
                    spanGaps: false
                });
            });

            // Mutação In-Place dos Datasets (Evita flashes e recriação de controladores do Chart.js)
            const existingMap = new Map();
            (this.chart.data.datasets || []).forEach(ds => {
                if (ds.channelKey) existingMap.set(ds.channelKey, ds);
            });

            const mergedDatasets = [];
            datasets.forEach(newDs => {
                const ex = existingMap.get(newDs.channelKey);
                if (ex) {
                    ex.data = newDs.data;
                    ex._channelStats = newDs._channelStats;
                    ex.borderWidth = newDs.borderWidth;
                    ex.showLine = newDs.showLine;
                    ex.pointRadius = newDs.pointRadius;
                    ex.pointHoverRadius = newDs.pointHoverRadius;
                    ex.borderDash = newDs.borderDash;
                    ex.borderColor = newDs.borderColor;
                    ex.backgroundColor = newDs.backgroundColor;
                    ex.tension = newDs.tension;
                    ex.spanGaps = false;
                    mergedDatasets.push(ex);
                    existingMap.delete(newDs.channelKey);
                } else {
                    mergedDatasets.push(newDs);
                }
            });

            existingMap.forEach(ds => {
                ds.data = [];
                mergedDatasets.push(ds);
            });

            this.chart.data.datasets = mergedDatasets;

            // 5. Tratamento de Escala do Eixo X
            if (this.xAxis === 't_global' || this.xAxis === 'elapsed') {
                if (this.windowDuration_s && isFinite(minT) && isFinite(maxT)) {
                    this.chart.options.scales.x.min = minT;
                    this.chart.options.scales.x.max = maxT;
                } else {
                    delete this.chart.options.scales.x.min;
                    delete this.chart.options.scales.x.max;
                }
            } else {
                const allXs = [];
                mergedDatasets.forEach(ds => {
                    (ds.data || []).forEach(p => {
                        if (p && typeof p.x === 'number' && isFinite(p.x) && p.y !== null) {
                            allXs.push(p.x);
                        }
                    });
                });
                if (allXs.length > 0) {
                    allXs.sort((a, b) => a - b);
                    this.chart.options.scales.x.min = allXs[0];
                    this.chart.options.scales.x.max = allXs[allXs.length - 1];
                }
            }

            this.chart.update('none');
            const nowStatsMs = performance.now();
            if (this.mode !== 'live' || (nowStatsMs - this._lastStatsUpdateMs) >= 220) {
                this._lastStatsUpdateMs = nowStatsMs;
                this.updateStatsStrip();
            }
        }

        updateStatsStrip() {
            if (!this.statsContainerId) return;
            const container = document.getElementById(this.statsContainerId);
            if (!container) return;

            // Throttle na reconstrução de DOM das estatísticas a ~3 Hz (evita reflow e stutter a 60 FPS)
            const now = performance.now();
            if (this._lastStatsUpdate && (now - this._lastStatsUpdate) < 300) {
                return;
            }
            this._lastStatsUpdate = now;

            const yDef = AXIS_DEFS.y[this.yAxis] || AXIS_DEFS.y.dist_m;

            if (!this.chart || !this.chart.data.datasets || this.chart.data.datasets.length === 0) {
                container.innerHTML = `
                    <div style="padding:10px 14px; text-align:center; color:var(--text-muted); font-size:11.5px; font-style:italic;">
                        A aguardar dados válidos para a combinação ativa de eixos e filtros...
                    </div>
                `;
                return;
            }

            const master = (window.LiveState?.currentMasterId || '0001').toUpperCase().padStart(4, '0');
            const masterNum = parseInt(master, 16);
            const mTag = `M${masterNum.toString().padStart(2, '0')}`;

            // Agrupador por Nó Remoto para canais primários com o Hub Coordenador
            const primaryNodesMap = new Map();
            const meshCards = [];

            const allNodeIds = ['0001', '0002', '0003', '0004', '0005', '0006'];
            allNodeIds.forEach(nid => {
                if (nid !== master) {
                    primaryNodesMap.set(nid, {
                        remoteNode: nid,
                        remoteNum: parseInt(nid, 16),
                        color: (NODE_PALETTES[nid]?.tdoa?.border || '#38bdf8'),
                        tdoa: null,
                        twr: null
                    });
                }
            });

            this.chart.data.datasets.forEach(ds => {
                const chKey = ds.channelKey || ds.label;
                const chInfo = resolveChannelInfo(chKey);

                // Rejeitar auto-medições espúrias (src === dst) ou endereços vazios
                if (!chInfo.src || !chInfo.dst || chInfo.src === chInfo.dst || chInfo.src === '0000' || chInfo.dst === '0000') return;

                let n = 0, mean = 0, stdDev = 0, madVal = 0;
                if (ds._channelStats) {
                    n = ds._channelStats.n;
                    if (n === 0) return;
                    mean = ds._channelStats.mean;
                    stdDev = ds._channelStats.stdDev;
                    madVal = ds._channelStats.madVal;
                } else {
                    const vals = ds.data ? ds.data.filter(p => p && p.y !== null && !isNaN(p.y)).map(p => p.y) : [];
                    n = vals.length;
                    if (n === 0) return;

                    mean = vals.reduce((a, b) => a + b, 0) / n;
                    const variance = n >= 2 ? vals.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1) : 0;
                    stdDev = Math.sqrt(variance);

                    const sorted = [...vals].sort((a, b) => a - b);
                    const median = (n % 2 === 0) ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
                    const diffs = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
                    madVal = (n % 2 === 0) ? (diffs[n / 2 - 1] + diffs[n / 2]) / 2 : diffs[Math.floor(n / 2)];
                }

                const statObj = {
                    n, mean, stdDev, madVal,
                    color: ds.borderColor,
                    label: ds.label,
                    proto: chInfo.proto,
                    channelKey: chKey
                };

                if (chInfo.isPrimary && primaryNodesMap.has(chInfo.remoteNode)) {
                    const pEntry = primaryNodesMap.get(chInfo.remoteNode);
                    if (chInfo.proto === 'TDoA') {
                        pEntry.tdoa = statObj;
                    } else {
                        if (!pEntry.twr || n > pEntry.twr.n) {
                            pEntry.twr = statObj;
                        }
                    }
                } else if (!chInfo.isPrimary && n >= 3) {
                    meshCards.push({
                        ...statObj,
                        name: chInfo.name
                    });
                }
            });

            // 1. Renderizar os Cards Principais Estruturados (1 por Nó Remoto)
            let primaryCardsHtml = '';
            primaryNodesMap.forEach((entry, rNode) => {
                const sTag = `S${entry.remoteNum.toString().padStart(2, '0')}`;
                const hasTdoa = entry.tdoa !== null;
                const hasTwr = entry.twr !== null;
                if (!hasTdoa && !hasTwr) return;

                let deltaHtml = '';
                if (hasTdoa && hasTwr && (this.yAxis === 'dist_m' || this.yAxis === 'dist_comp_m')) {
                    const deltaM = entry.tdoa.mean - entry.twr.mean;
                    const deltaSign = deltaM >= 0 ? '+' : '';
                    const deltaCm = (deltaM * 100).toFixed(1);
                    deltaHtml = `
                        <div style="margin-top:6px; padding:3px 8px; background:rgba(0,0,0,0.35); border-radius:4px; display:flex; justify-content:space-between; align-items:center; font-size:10px; font-family:var(--font-mono);">
                            <span style="color:var(--text-muted);">Δ(TDoA - TWR):</span>
                            <strong style="color:${Math.abs(deltaM) > 0.5 ? '#f87171' : '#34d399'};">${deltaSign}${deltaCm} cm</strong>
                        </div>
                    `;
                }

                const renderMetricRow = (stat, protoName, badgeClass) => {
                    if (!stat) {
                        return `
                            <div style="padding:4px 6px; background:rgba(255,255,255,0.02); border-radius:4px; margin-top:4px; display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); font-style:italic;">
                                <span class="badge ${badgeClass}" style="font-size:9px; padding:0 4px;">${protoName}</span>
                                <span>Sem amostras na janela</span>
                            </div>
                        `;
                    }
                    return `
                        <div style="padding:4px 7px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:5px; margin-top:4px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <span class="badge ${badgeClass}" style="font-size:9px; padding:1px 5px; font-weight:700;">${protoName}</span>
                                    <span style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono);">N=${stat.n}</span>
                                </div>
                                <div style="display:flex; align-items:baseline; gap:3px;">
                                    <span style="color:var(--text-muted); font-size:10px;">µ =</span>
                                    <span style="font-size:14px; font-weight:800; color:#f8fafc; font-family:var(--font-mono);">${stat.mean.toFixed(yDef.decimals)}</span>
                                    <span style="font-size:9px; color:var(--text-muted);">${yDef.unit}</span>
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; padding-top:2px; border-top:1px solid rgba(255,255,255,0.04);">
                                <span title="Desvio Padrão Amostral">σ: ±${stat.n >= 2 ? stat.stdDev.toFixed(yDef.decimals) : '--'} ${yDef.unit}</span>
                                <span title="Desvio Absoluto Mediano">MAD: ${stat.n >= 2 ? stat.madVal.toFixed(yDef.decimals) : '--'}</span>
                            </div>
                        </div>
                    `;
                };

                primaryCardsHtml += `
                    <div class="live-stat-card" style="border:1px solid ${entry.color}50; background:rgba(15,23,42,0.85); border-radius:7px; padding:8px 9px; box-shadow:0 2px 8px rgba(0,0,0,0.3);">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:4px;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="width:8px; height:8px; border-radius:50%; background:${entry.color}; box-shadow:0 0 6px ${entry.color}; flex-shrink:0;"></span>
                                <strong style="font-size:11.5px; color:#f8fafc; font-family:var(--font-mono);">📡 ${sTag} (0x${rNode})</strong>
                            </div>
                            <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">↔ 👑 ${mTag}</span>
                        </div>
                        <div style="margin-top:4px;">
                            ${renderMetricRow(entry.tdoa, 'TDoA', 'badge-emerald')}
                            ${renderMetricRow(entry.twr, 'TWR', 'badge-cyan')}
                        </div>
                        ${deltaHtml}
                    </div>
                `;
            });

            // 2. Renderizar Secção Mesh Secundária Colapsável
            let meshSectionHtml = '';
            if (meshCards.length > 0) {
                let meshCardsHtml = '';
                meshCards.forEach(mc => {
                    const isTwr = mc.proto === 'TWR';
                    meshCardsHtml += `
                        <div style="background:rgba(15,23,42,0.6); border:1px solid rgba(148,163,184,0.2); border-radius:5px; padding:5px 7px; font-size:10.5px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:700; color:#cbd5e1; font-family:var(--font-mono); font-size:10px;">${mc.name}</span>
                                <span class="badge ${isTwr ? 'badge-cyan' : 'badge-emerald'}" style="font-size:8.5px; padding:0 4px;">${mc.proto} (N=${mc.n})</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:3px;">
                                <span style="font-size:12px; font-weight:800; color:#f8fafc; font-family:var(--font-mono);">µ = ${mc.mean.toFixed(yDef.decimals)} ${yDef.unit}</span>
                                <span style="font-size:9px; color:var(--text-muted); font-family:var(--font-mono);">σ: ±${mc.stdDev.toFixed(yDef.decimals)}</span>
                            </div>
                        </div>
                    `;
                });

                meshSectionHtml = `
                    <details style="margin-top:10px; border:1px solid rgba(255,255,255,0.08); border-radius:6px; background:rgba(15,23,42,0.4); padding:6px 10px;">
                        <summary style="cursor:pointer; font-size:11px; font-weight:700; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
                            <span>🔍 Diagnóstico Mesh Inter-Escravos (${meshCards.length} canais secundários)</span>
                        </summary>
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:6px; margin-top:8px;">
                            ${meshCardsHtml}
                        </div>
                    </details>
                `;
            }

            container.innerHTML = `
                <div class="live-stats-strip-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:11.5px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="color:var(--text-main); font-size:12px; display:flex; align-items:center; gap:5px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M18 20V10M12 20V4M6 20v-6"></path></svg>
                            Estatísticas Estruturadas (Nós Remotos ↔ Hub Coordenador 0x${master}) — ${yDef.label} (${yDef.unit})
                        </strong>
                        <span class="prov-badge prov-app">[SciMetrics Estruturado]</span>
                    </div>
                    <span style="font-size:10.5px; color:var(--text-muted); font-family:var(--font-mono);">
                        ${this.records.length} amostras filtradas (${this.rawRecords.length} no total)
                    </span>
                </div>
                <div class="live-stats-cards-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:8px; width:100%; margin-top:8px;">
                    ${primaryCardsHtml}
                </div>
                ${meshSectionHtml}
            `;
        }

        appendLiveRecord(r) {
            // Normalizar ciclo do registo ao vivo
            if (r.seq_raw === undefined) r.seq_raw = r.seq;
            if (r.algo_cycle !== undefined && r.algo_cycle !== null) {
                r.seq = r.algo_cycle;
            } else if (r.seq !== undefined && r.seq !== null) {
                const rawS = Number(r.seq);
                const proto = (r.protocol || r.packet_type || 'TWR').toUpperCase();
                const prevRaw = this.liveStreamLastRaw[proto];
                if (prevRaw !== undefined && rawS !== null) {
                    const delta = rawS - prevRaw;
                    if (delta > 0 && delta < 10000) {
                        this.liveCycleCounter += delta;
                    } else if (delta !== 0) {
                        this.liveCycleCounter += 1;
                    }
                } else {
                    this.liveCycleCounter += 1;
                }
                this.liveStreamLastRaw[proto] = rawS;
                r.seq = this.liveCycleCounter;
                r.algo_cycle = this.liveCycleCounter;
            } else {
                this.liveCycleCounter += 1;
                r.seq = this.liveCycleCounter;
                r.algo_cycle = this.liveCycleCounter;
            }

            this.rawRecords.push(r);
            if (this.rawRecords.length > 3500) {
                this.rawRecords.splice(0, this.rawRecords.length - 3000);
            }
            this.applyFiltersAndRebuild();
        }

        syncLiveBuffer(messages) {
            this.setData(messages);
        }
    }

    // Exportações globais
    window.UnifiedUwbChart = UnifiedUwbChart;
    window.UWB_AXIS_DEFS = AXIS_DEFS;

})(window);
