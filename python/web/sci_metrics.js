/**
 * sci_metrics.js - Motor Canónico de Métricas Científicas da Plataforma SwarmLoc (Frontend)
 * =========================================================================================
 * Fonte única de verdade matemática para estatística descritiva, metrologia de distância,
 * intervalos temporais, frequências (observada vs RF), jitter, deriva de relógio (drift),
 * classificação física UWB (OWR, SS-TWR, DS-TWR, TDoA), filtragem de entidades/ligações
 * e sistema explícito de proveniência científica.
 *
 * Equivalência estrita com SwarmLoc/python/scientific_metrics.py:
 * - Desvio-padrão amostral com correção de Bessel (ddof=1, divisor n - 1).
 * - Tratamento consistente de dados em falta / inválidos («Não fornecido pelo módulo»).
 * - Cálculo de frequências observadas vs RF física.
 * - Filtragem canónica por módulo, ligação (par A <-> B) e sentido (A -> B).
 */

(function (global) {
    'use strict';

    const DWT_TIME_UNITS = 1.0 / (499.2e6 * 128.0); // ~15.650040064102564 ps por tick
    const SPEED_OF_LIGHT = 299702547.0;             // m/s (c_ar unificado com firmware)
    const TS_40BIT_MAX = 1099511627776;             // 2^40
    const TS_40BIT_HALF = 549755813888;             // 2^39
    const CANONICAL_ALGO_VERSION = 'SciMetrics-v2.1';

    function normalizeNodeId(nodeId) {
        if (nodeId === null || nodeId === undefined) return '';
        const s = String(nodeId).trim().toUpperCase();
        if (!s || s === '*' || s === 'FFFF' || s === '0XFFFF' || s === 'DESCONHECIDO' || s === 'NONE') {
            return s;
        }
        const clean = s.replace(/^0X/, '');
        const val = parseInt(clean, 16);
        if (!isNaN(val) && isFinite(val) && /^[0-9A-F]+$/.test(clean)) {
            return '0x' + val.toString(16).toUpperCase().padStart(4, '0');
        }
        return s;
    }

    function normalizeLinkDirection(src, dst) {
        const ns = normalizeNodeId(src);
        const nd = normalizeNodeId(dst);
        if (!ns || !nd) return '';
        return `${ns} -> ${nd}`;
    }

    function tsDiff40BitSigned(tLater, tEarlier) {
        let diff = (Number(tLater) - Number(tEarlier)) % TS_40BIT_MAX;
        if (diff < 0) diff += TS_40BIT_MAX;
        if (diff >= TS_40BIT_HALF) {
            diff -= TS_40BIT_MAX;
        }
        return diff;
    }

    function calculateTofFromTimestamps(t1, t2, t3, t4, t5 = 0, t6 = 0) {
        let raw_tof_ds_m = null;
        let raw_tof_ss_m = null;
        let tof_ds_ns = null;
        let tof_ss_ns = null;
        let rtt1_ticks = null;
        let reply1_ticks = null;
        let rtt2_ticks = null;
        let reply2_ticks = null;

        if (t1 > 0 && t2 > 0 && t3 > 0 && t4 > 0) {
            const rtt1 = tsDiff40BitSigned(t4, t1);
            const reply1 = tsDiff40BitSigned(t3, t2);
            rtt1_ticks = rtt1;
            reply1_ticks = reply1;
            if (rtt1 > 0 && reply1 > 0 && rtt1 >= reply1) {
                const tofTicksSs = (rtt1 - reply1) / 2.0;
                const candSsS = tofTicksSs * DWT_TIME_UNITS;
                const candSsM = Math.round(candSsS * SPEED_OF_LIGHT * 10000) / 10000;
                if (candSsM >= 0.0 && candSsM <= 100.0) {
                    raw_tof_ss_m = candSsM;
                    tof_ss_ns = Math.round(candSsS * 1e9 * 10000) / 10000;
                }

                if (t5 > 0 && t6 > 0) {
                    const rtt2 = tsDiff40BitSigned(t6, t3);
                    const reply2 = tsDiff40BitSigned(t5, t4);
                    rtt2_ticks = rtt2;
                    reply2_ticks = reply2;
                    const denom = rtt1 + rtt2 + reply1 + reply2;
                    if (rtt2 > 0 && reply2 > 0 && denom > 0) {
                        const tofTicksDs = (rtt1 * rtt2 - reply1 * reply2) / denom;
                        const candDsS = tofTicksDs * DWT_TIME_UNITS;
                        const candDsM = Math.round(candDsS * SPEED_OF_LIGHT * 10000) / 10000;
                        if (candDsM >= 0.0 && candDsM <= 100.0) {
                            raw_tof_ds_m = candDsM;
                            tof_ds_ns = Math.round(candDsS * 1e9 * 10000) / 10000;
                        }
                    }
                }
            }
        }

        return {
            raw_tof_ds_m,
            raw_tof_ss_m,
            tof_ds_ns,
            tof_ss_ns,
            rtt1_ticks,
            reply1_ticks,
            rtt2_ticks,
            reply2_ticks
        };
    }

    function classifyPhysicalMeasurementModel(rec) {
        const durUs = Number((rec && rec.round_duration_us) || 0);
        const pkt = String((rec && (rec.packet_type || rec.protocol || rec.type)) || '').toUpperCase();
        const src = normalizeNodeId(rec && (rec.src_addr || rec.src || rec.node_id));
        const isOwr = (pkt.includes('TDOA') || pkt.includes('OWR') || (durUs > 0 && durUs <= 5));

        if (isOwr) {
            return {
                code: 'OWR_SYNC_TOF',
                short_label: 'OWR Sync (Beacon 1-via)',
                protocol_family: 'TDoA',
                physical_model: 'One-Way Ranging (ToF Unidirecional com Relógio Global Sincronizado)',
                formula: 'ToF = t_RX,global - t_TX,beacon = (α · t_RX,local + β) - t_TX,beacon ; d = c · ToF',
                scientific_note: 'Observação unidirecional num único recetor sincronizado (OWR). Para TDoA hiperbólico clássico são necessárias observações simultâneas do mesmo beacon em múltiplos recetores.'
            };
        } else if (src === '0x0001') {
            return {
                code: 'SS_TWR_CFO',
                short_label: 'SS-TWR + CFO (Master)',
                protocol_family: 'TWR',
                physical_model: 'Single-Sided Two-Way Ranging com Compensação CFO (Carrier Integrator)',
                formula: 'ToF = ((t4 - t1) - (1 - cfo) · (t3 - t2)) / 2 ; d = c · ToF',
                scientific_note: 'Calculado no iniciador da ronda usando t1..t4 e o desvio de frequência portadora lido no registo DW3000.'
            };
        }
        return {
            code: 'DS_TWR_FILTERED',
            short_label: 'DS-TWR 3-Msg (Slave)',
            protocol_family: 'TWR',
            physical_model: 'Asymmetric Double-Sided Two-Way Ranging (3 Mensagens: Poll, Resp, Final)',
            formula: 'ToF = (R_a · R_b - D_a · D_b) / (R_a + R_b + D_a + D_b) ; d = c · ToF',
            scientific_note: 'Imunidade de 2.ª ordem à deriva de relógio entre módulos independentes; utilizado também para atualizar o modelo afim TG = α·TL + β.'
        };
    }

    function filterRecordsByEntity(records, opts = {}) {
        if (!records || !Array.isArray(records) || records.length === 0) return [];
        const {
            module_id = null,
            link_pair = null,
            direction = null,
            protocol = null,
            t_min_s = null,
            t_max_s = null
        } = opts;

        const targetMod = (module_id && String(module_id).toLowerCase() !== 'all')
            ? normalizeNodeId(module_id)
            : null;

        let pairNodes = null;
        if (link_pair && String(link_pair).toLowerCase() !== 'all') {
            const parts = String(link_pair)
                .replace(/<->/g, '->')
                .replace(/↔/g, '->')
                .replace(/→/g, '->')
                .split('->')
                .map(p => normalizeNodeId(p))
                .filter(Boolean);
            if (parts.length === 2) {
                pairNodes = [parts[0], parts[1]];
            }
        }

        let dirNodes = null;
        if (direction && String(direction).toLowerCase() !== 'all') {
            const parts = String(direction)
                .replace(/→/g, '->')
                .split('->')
                .map(p => normalizeNodeId(p))
                .filter(Boolean);
            if (parts.length === 2) {
                dirNodes = [parts[0], parts[1]];
            }
        }

        const protoClean = (protocol && String(protocol).toLowerCase() !== 'all')
            ? String(protocol).trim().toUpperCase()
            : null;

        let t0S = 0.0;
        const tsVals = [];
        for (let i = 0; i < records.length; i++) {
            const ms = Number(records[i] && records[i].timestamp_ms);
            if (!isNaN(ms) && ms > 0) tsVals.push(ms / 1000.0);
        }
        if (tsVals.length > 0) {
            t0S = Math.min(...tsVals);
        }

        const filtered = [];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (!r) continue;
            const parsed = (r.parsed && typeof r.parsed === 'object') ? r.parsed : {};
            const rawSrc = r.src_addr || parsed.src || r.node_id;
            const rawDst = r.dst_addr || parsed.dst || r.peer_id;
            const rType = String(r.packet_type || r.protocol || parsed.mode || r.type || '').toUpperCase();

            let src, dst;
            if (rType.includes('TDOA') && parsed.measurer) {
                src = normalizeNodeId(parsed.measurer);
                dst = normalizeNodeId(parsed.beacon_src || '0x0001');
            } else {
                src = normalizeNodeId(rawSrc);
                dst = normalizeNodeId(rawDst);
            }

            if (targetMod) {
                if (src !== targetMod && dst !== targetMod) continue;
            }
            if (pairNodes) {
                const [na, nb] = pairNodes;
                if (!((src === na && dst === nb) || (src === nb && dst === na))) continue;
            }
            if (dirNodes) {
                const [da, db] = dirNodes;
                if (!(src === da && dst === db)) continue;
            }
            if (protoClean) {
                const durUs = Number(r.round_duration_us || 0);
                const recProto = (rType.includes('TDOA') || rType.includes('OWR') || (durUs > 0 && durUs <= 5)) ? 'TDOA' : 'TWR';
                if ((protoClean === 'TDOA' || protoClean === 'OWR') && recProto !== 'TDOA') continue;
                if (protoClean === 'TWR' && recProto !== 'TWR') continue;
            }
            if (t_min_s !== null || t_max_s !== null) {
                let elS = r.elapsed_s !== undefined && r.elapsed_s !== null ? Number(r.elapsed_s) : null;
                if ((elS === null || isNaN(elS)) && r.timestamp_ms !== undefined && r.timestamp_ms !== null) {
                    elS = Math.max(0.0, (Number(r.timestamp_ms) / 1000.0) - t0S);
                }
                if (elS !== null && !isNaN(elS)) {
                    if (t_min_s !== null && !isNaN(Number(t_min_s)) && elS < Number(t_min_s)) continue;
                    if (t_max_s !== null && !isNaN(Number(t_max_s)) && elS > Number(t_max_s)) continue;
                }
            }
            filtered.push(r);
        }
        return filtered;
    }

    function filterValidNumbers(values, minVal = null, maxVal = null) {
        if (!values || !Array.isArray(values)) return [];
        const valids = [];
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v === null || v === undefined || v === '') continue;
            const num = Number(v);
            if (isNaN(num) || !isFinite(num)) continue;
            if (minVal !== null && num < minVal) continue;
            if (maxVal !== null && num > maxVal) continue;
            valids.push(num);
        }
        return valids;
    }

    function computeDescriptiveStats(values, refVal = null, totalRawCount = null) {
        const valids = filterValidNumbers(values);
        const n = valids.length;
        if (n === 0) return null;

        const nTotal = (totalRawCount !== null && totalRawCount >= n) ? totalRawCount : (Array.isArray(values) ? values.length : n);
        const nInvalid = Math.max(0, nTotal - n);

        valids.sort((a, b) => a - b);
        const sumVal = valids.reduce((a, b) => a + b, 0);
        const meanVal = sumVal / n;

        // Variância e Desvio-Padrão amostral (graus de liberdade n - 1)
        let variance = 0.0;
        let stdVal = 0.0;
        if (n > 1) {
            const sqDiffs = valids.reduce((acc, v) => acc + Math.pow(v - meanVal, 2), 0);
            variance = sqDiffs / (n - 1);
            stdVal = Math.sqrt(variance);
        }

        // Erro padrão da média e Intervalo de Confiança a 95%
        const se = n > 0 ? (stdVal / Math.sqrt(n)) : 0.0;
        const tCrit = n > 30 ? 1.96 : (n > 10 ? 2.05 : (n > 2 ? 2.20 : 12.71));
        const ci95 = [meanVal - tCrit * se, meanVal + tCrit * se];

        // Mediana empírica
        const medianVal = (n % 2 === 0)
            ? (valids[n / 2 - 1] + valids[n / 2]) / 2.0
            : valids[Math.floor(n / 2)];

        // MAD (Median Absolute Deviation) e estimador consistente de sigma
        const absDevs = valids.map(v => Math.abs(v - medianVal)).sort((a, b) => a - b);
        const madVal = (n % 2 === 0)
            ? (absDevs[n / 2 - 1] + absDevs[n / 2]) / 2.0
            : absDevs[Math.floor(n / 2)];
        const madSigma = 1.4826 * madVal;

        // Percentis empíricos
        function getPercentile(pct) {
            const idx = Math.max(0, Math.min(n - 1, Math.round(pct * (n - 1))));
            return valids[idx];
        }

        const p5 = getPercentile(0.05);
        const q1 = getPercentile(0.25);
        const q3 = getPercentile(0.75);
        const p95 = getPercentile(0.95);
        const p99 = getPercentile(0.99);
        const iqr = q3 - q1;

        const minVal = valids[0];
        const maxVal = valids[n - 1];
        const spanVal = maxVal - minVal;

        // Outliers Tukey (1.5 * IQR) e 3-sigma
        const fenceLow = q1 - 1.5 * iqr;
        const fenceHigh = q3 + 1.5 * iqr;
        const outliersIqr = valids.filter(v => v < fenceLow || v > fenceHigh);
        const outliers3s = stdVal > 1e-12 ? valids.filter(v => Math.abs(v - meanVal) > 3.0 * stdVal) : [];

        // Assimetria (Skewness g1) e Curtose em Excesso (Excess Kurtosis g2)
        let skewness = 0.0;
        let kurtosis = 0.0;
        if (n > 2 && stdVal > 1e-12) {
            const m3 = valids.reduce((acc, v) => acc + Math.pow((v - meanVal) / stdVal, 3), 0);
            skewness = (n / ((n - 1) * (n - 2))) * m3;
        }
        if (n > 3 && stdVal > 1e-12) {
            const m4 = valids.reduce((acc, v) => acc + Math.pow((v - meanVal) / stdVal, 4), 0);
            const t1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * m4;
            const t2 = (3.0 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3));
            kurtosis = t1 - t2;
        }

        // Metrologia referenciada (Bias e RMSE) - apenas quando há Ground-Truth explícito
        let bias_mm = null;
        let rmse_mm = null;
        if (refVal !== null && refVal !== undefined && refVal !== '') {
            const rf = Number(refVal);
            if (!isNaN(rf) && isFinite(rf)) {
                bias_mm = (meanVal - rf) * 1000.0;
                const sumSqErr = valids.reduce((acc, v) => acc + Math.pow(v - rf, 2), 0);
                rmse_mm = Math.sqrt(sumSqErr / n) * 1000.0;
            }
        }

        return {
            n,
            n_valid: n,
            n_invalid: nInvalid,
            n_total: nTotal,
            mean: meanVal,
            variance,
            std: stdVal,
            std_mm: stdVal * 1000.0,
            se,
            ci95,
            median: medianVal,
            mad: madVal,
            mad_mm: madVal * 1000.0,
            mad_sigma: madSigma,
            mad_sigma_mm: madSigma * 1000.0,
            p5,
            q1,
            q3,
            p95,
            p99,
            iqr,
            iqr_mm: iqr * 1000.0,
            min: minVal,
            max: maxVal,
            span: spanVal,
            skewness,
            kurtosis,
            outliers_iqr_count: outliersIqr.length,
            outliers_3s_count: outliers3s.length,
            bias_mm,
            rmse_mm,
            has_ground_truth: bias_mm !== null,
            algo_version: CANONICAL_ALGO_VERSION
        };
    }

    function unwrapSequenceNumbers(seqList, wrapLimit = null) {
        if (!seqList || !Array.isArray(seqList) || seqList.length < 2) {
            return {
                total_emitted: 0,
                dropped_packets: 0,
                duplicate_packets: 0,
                out_of_order_packets: 0,
                loss_rate: 0.0,
                anomalies: []
            };
        }

        let totalEmitted = 0;
        let dropped = 0;
        let duplicates = 0;
        let outOfOrder = 0;
        const anomalies = [];

        for (let i = 1; i < seqList.length; i++) {
            const sPrev = seqList[i - 1];
            const sCurr = seqList[i];
            if (sPrev === null || sCurr === null || isNaN(sPrev) || isNaN(sCurr)) continue;

            let d = 0;
            if (sCurr >= sPrev) {
                d = sCurr - sPrev;
                if (d > 10000 && wrapLimit === null) {
                    anomalies.push(`Salto de sequencia anomalo em i=${i}: ${sPrev} -> ${sCurr} (delta=${d})`);
                }
            } else {
                if (wrapLimit !== null) {
                    d = (sCurr - sPrev) % wrapLimit;
                    if (d < 0) d += wrapLimit;
                } else if (sPrev > 4000000000 && sCurr < 100000000) {
                    d = (sCurr + 4294967296) - sPrev;
                } else if (sPrev > 50000 && sPrev <= 65536 && sCurr < 15000) {
                    d = (sCurr + 65536) - sPrev;
                } else {
                    outOfOrder += 1;
                    anomalies.push(`Salto de sequencia decrescente nao esperado em i=${i}: ${sPrev} -> ${sCurr}`);
                    d = 0;
                }
            }

            if (d > 0) {
                totalEmitted += d;
                if (d > 1) {
                    dropped += (d - 1);
                }
            } else if (d === 0 && sCurr === sPrev) {
                duplicates += 1;
                anomalies.push(`Numero de sequencia duplicado em i=${i}: ${sCurr}`);
            }
        }

        const totalExpected = totalEmitted > 0 ? totalEmitted + 1 : seqList.length;
        const lossRate = totalExpected > 0 ? dropped / totalExpected : 0.0;

        return {
            total_emitted: totalEmitted,
            dropped_packets: dropped,
            duplicate_packets: duplicates,
            out_of_order_packets: outOfOrder,
            loss_rate: Math.round(lossRate * 10000) / 10000,
            anomalies
        };
    }

    function computeTimingAndRates(timestampsS, seqNumbers = null, fPhyConfiguredHz = null, rxTimestampsS = null, wrapLimit = null) {
        const ts = filterValidNumbers(timestampsS);
        const n = ts.length;
        if (n < 2) {
            return {
                n,
                is_valid: false,
                status: 'insufficient_data',
                span_s: 0.0,
                dt_mean_ms: null,
                dt_median_ms: null,
                dt_min_ms: null,
                dt_max_ms: null,
                jitter_ms: null,
                f_phy_configured_hz: fPhyConfiguredHz,
                f_tx_observed_hz: null,
                f_rx_observed_hz: null,
                f_uart_observed_hz: null,
                f_trial_observed_hz: null,
                f_visual_update_hz: null,
                freq_observed_hz: null,
                freq_radio_rf_hz: null,
                dropped_packets_rf: 0,
                duplicate_packets: 0,
                out_of_order_packets: 0,
                packet_loss_rate: 0.0,
                anomalies: [],
                dt_list_ms: []
            };
        }

        let sortedTs;
        let sortedSeq = null;

        if (seqNumbers && Array.isArray(seqNumbers) && seqNumbers.length === timestampsS.length) {
            const pairs = [];
            for (let i = 0; i < timestampsS.length; i++) {
                if (timestampsS[i] !== null && seqNumbers[i] !== null) {
                    pairs.push({ t: Number(timestampsS[i]), s: Number(seqNumbers[i]) });
                }
            }
            pairs.sort((a, b) => a.t - b.t);
            sortedTs = pairs.map(p => p.t);
            sortedSeq = pairs.map(p => p.s);
        } else {
            sortedTs = [...ts].sort((a, b) => a - b);
        }

        const spanS = sortedTs[sortedTs.length - 1] - sortedTs[0];
        const dtListMs = [];
        for (let i = 1; i < sortedTs.length; i++) {
            const dtMs = Math.round((sortedTs[i] - sortedTs[i - 1]) * 10000000.0) / 10000.0;
            if (dtMs > 0) {
                dtListMs.push(dtMs);
            }
        }

        let dtMean = 0.0, dtMedian = 0.0, dtMin = 0.0, dtMax = 0.0, jitterMs = 0.0;
        if (dtListMs.length > 0) {
            dtMean = dtListMs.reduce((a, b) => a + b, 0) / dtListMs.length;
            const sortedDt = [...dtListMs].sort((a, b) => a - b);
            const mIdx = Math.floor(sortedDt.length / 2);
            dtMedian = (sortedDt.length % 2 === 0) ? (sortedDt[mIdx - 1] + sortedDt[mIdx]) / 2.0 : sortedDt[mIdx];
            dtMin = sortedDt[0];
            dtMax = sortedDt[sortedDt.length - 1];

            if (dtListMs.length > 1) {
                const varDt = dtListMs.reduce((acc, d) => acc + Math.pow(d - dtMean, 2), 0) / (dtListMs.length - 1);
                jitterMs = Math.sqrt(varDt);
            }
        }

        const fUartObs = (spanS > 1e-6) ? Math.round(((sortedTs.length - 1) / spanS) * 100) / 100 : 0.0;
        let fTxObs = fUartObs;
        let droppedRf = 0;
        let dupCnt = 0;
        let oooCnt = 0;
        let lossRate = 0.0;
        let seqAnomalies = [];

        if (sortedSeq && sortedSeq.length >= 2 && spanS > 1e-6) {
            const unwrapRes = unwrapSequenceNumbers(sortedSeq, wrapLimit);
            const totalEmitted = unwrapRes.total_emitted;
            droppedRf = unwrapRes.dropped_packets;
            dupCnt = unwrapRes.duplicate_packets || 0;
            oooCnt = unwrapRes.out_of_order_packets || 0;
            lossRate = unwrapRes.loss_rate;
            seqAnomalies = unwrapRes.anomalies;
            if (totalEmitted > 0) {
                fTxObs = Math.round((totalEmitted / spanS) * 100) / 100;
            }
        }

        let fRxObs = null;
        if (rxTimestampsS && Array.isArray(rxTimestampsS)) {
            const validRx = filterValidNumbers(rxTimestampsS);
            if (validRx.length >= 2) {
                const sRx = [...validRx].sort((a, b) => a - b);
                const rxSpan = sRx[sRx.length - 1] - sRx[0];
                if (rxSpan > 1e-6) {
                    fRxObs = Math.round(((sRx.length - 1) / rxSpan) * 100) / 100;
                }
            }
        }

        return {
            n: sortedTs.length,
            is_valid: true,
            status: 'ok',
            span_s: Math.round(spanS * 10000) / 10000,
            dt_mean_ms: Math.round(dtMean * 100) / 100,
            dt_median_ms: Math.round(dtMedian * 100) / 100,
            dt_min_ms: Math.round(dtMin * 100) / 100,
            dt_max_ms: Math.round(dtMax * 100) / 100,
            jitter_ms: Math.round(jitterMs * 100) / 100,
            f_phy_configured_hz: fPhyConfiguredHz,
            f_tx_observed_hz: fTxObs,
            f_rx_observed_hz: fRxObs,
            f_uart_observed_hz: fUartObs,
            f_trial_observed_hz: fUartObs,
            f_visual_update_hz: null,
            freq_observed_hz: fUartObs,
            freq_radio_rf_hz: fTxObs,
            dropped_packets_rf: droppedRf,
            duplicate_packets: dupCnt,
            out_of_order_packets: oooCnt,
            packet_loss_rate: lossRate,
            anomalies: seqAnomalies,
            dt_list_ms: dtListMs
        };
    }

    function computeLinearDriftRegression(elapsedS, driftPpmSeries) {
        const pairs = [];
        const len = Math.min((elapsedS || []).length, (driftPpmSeries || []).length);
        for (let i = 0; i < len; i++) {
            const t = elapsedS[i];
            const d = driftPpmSeries[i];
            if (t === null || t === undefined || d === null || d === undefined) continue;
            const ft = Number(t);
            const fd = Number(d);
            if (!isNaN(ft) && isFinite(ft) && !isNaN(fd) && isFinite(fd)) {
                pairs.push([ft, fd]);
            }
        }
        const n = pairs.length;
        if (n === 0) {
            return {
                n_valid: 0,
                status: 'insufficient_data',
                status_label: 'Não calculável com os dados disponíveis',
                mean_ppm: null,
                std_ppm: null,
                median_ppm: null,
                min_ppm: null,
                max_ppm: null,
                alpha_ratio: null,
                slope_ppm_per_s: null,
                intercept_ppm: null,
                r_squared: null,
                residual_rms_ppm: null,
                t_span_s: 0.0,
                algo_version: CANONICAL_ALGO_VERSION
            };
        }
        const drifts = pairs.map(p => p[1]);
        const stats = computeDescriptiveStats(drifts);
        const meanPpm = stats ? Math.round(stats.mean * 10000) / 10000 : null;
        const stdPpm = stats ? Math.round(stats.std * 10000) / 10000 : null;
        const alphaRatio = meanPpm !== null ? Math.round((1.0 + meanPpm * 1e-6) * 1e9) / 1e9 : null;

        if (n < 2) {
            return {
                n_valid: n,
                status: 'single_sample',
                status_label: 'Amostra única (regressão linear requer N >= 2)',
                mean_ppm: meanPpm,
                std_ppm: 0.0,
                median_ppm: meanPpm,
                min_ppm: meanPpm,
                max_ppm: meanPpm,
                alpha_ratio: alphaRatio,
                slope_ppm_per_s: null,
                intercept_ppm: null,
                r_squared: null,
                residual_rms_ppm: null,
                t_span_s: 0.0,
                algo_version: CANONICAL_ALGO_VERSION
            };
        }

        const ts = pairs.map(p => p[0]);
        const tMean = ts.reduce((a, b) => a + b, 0) / n;
        const dMean = drifts.reduce((a, b) => a + b, 0) / n;
        let sTt = 0.0, sTd = 0.0, sDd = 0.0;
        for (let i = 0; i < n; i++) {
            const dt = pairs[i][0] - tMean;
            const dd = pairs[i][1] - dMean;
            sTt += dt * dt;
            sTd += dt * dd;
            sDd += dd * dd;
        }
        let slope = null, intercept = null, rSq = null, resRms = null;
        if (sTt > 1e-12) {
            slope = sTd / sTt;
            intercept = dMean - slope * tMean;
            rSq = sDd > 1e-12 ? Math.max(0.0, Math.min(1.0, (sTd * sTd) / (sTt * sDd))) : 1.0;
            let sumResSq = 0.0;
            for (let i = 0; i < n; i++) {
                const res = pairs[i][1] - (slope * pairs[i][0] + intercept);
                sumResSq += res * res;
            }
            resRms = Math.sqrt(sumResSq / n);
        }

        return {
            n_valid: n,
            status: 'ok',
            status_label: 'Calculado pela aplicação (OLS + Bessel)',
            mean_ppm: meanPpm,
            std_ppm: stdPpm,
            median_ppm: stats ? Math.round(stats.median * 10000) / 10000 : null,
            min_ppm: stats ? Math.round(stats.min * 10000) / 10000 : null,
            max_ppm: stats ? Math.round(stats.max * 10000) / 10000 : null,
            alpha_ratio: alphaRatio,
            slope_ppm_per_s: slope !== null ? Math.round(slope * 1e6) / 1e6 : null,
            intercept_ppm: intercept !== null ? Math.round(intercept * 10000) / 10000 : null,
            r_squared: rSq !== null ? Math.round(rSq * 10000) / 10000 : null,
            residual_rms_ppm: resRms !== null ? Math.round(resRms * 10000) / 10000 : null,
            t_span_s: Math.round((Math.max(...ts) - Math.min(...ts)) * 10000) / 10000,
            algo_version: CANONICAL_ALGO_VERSION
        };
    }

    const PROVENANCE_CATALOG = {
        dist_firmware_m: {
            category: 'FIRMWARE_COMPUTED',
            badge: 'Calculado no firmware',
            label: 'Distância publicada pelo módulo (dist_m / dist_mm)',
            inputs: 'Timestamps DW3000 de 40 bits (t1..t4 em SS-TWR+CFO ou t1..t6 em DS-TWR; t_RX,G - t_TX em OWR)',
            formula: 'd_fw = c · ToF_fw (convertido de mm inteiros para m: dist_mm / 1000.0)',
            units: 'm (metros, resolução 1 mm)',
            validity_criteria: '0 < d_fw <= 100 m e status == 0 (OK)',
            limitations: 'Inclui atraso de antena configurado no firmware e eventual filtro EMA no nó.'
        },
        raw_tof_ds_m: {
            category: 'APP_CALCULATED',
            badge: 'Calculado pela aplicação',
            label: 'Distância DS-TWR recalculada na aplicação a partir de t1..t6',
            inputs: 'Timestamps brutos DW3000 t1, t2, t3, t4, t5, t6 (ticks de 15.65 ps, 40 bits)',
            formula: 'ToF = (R_a·R_b - D_a·D_b) / (R_a + R_b + D_a + D_b) · DWT_TIME_UNITS ; d = c · ToF',
            units: 'm (metros)',
            validity_criteria: 't1..t6 > 0, R_a >= D_a > 0, R_b > 0, D_b > 0, 0 <= d <= 100 m',
            limitations: 'Disponível apenas nos registos binários de 54B onde t1..t6 são gravados; na UART texto t1..t6 não são transmitidos.'
        },
        raw_tof_ss_m: {
            category: 'APP_CALCULATED',
            badge: 'Calculado pela aplicação',
            label: 'Distância SS-TWR bruta recalculada na aplicação a partir de t1..t4',
            inputs: 'Timestamps brutos DW3000 t1, t2, t3, t4 (ticks de 15.65 ps, 40 bits)',
            formula: 'ToF = ((t4 - t1) - (t3 - t2)) / 2 · DWT_TIME_UNITS ; d = c · ToF',
            units: 'm (metros)',
            validity_criteria: 't1..t4 > 0, R_a >= D_a > 0, 0 <= d <= 100 m',
            limitations: 'Sem compensação CFO na fórmula bruta simples; sensível ao desvio de relógio durante D_a.'
        },
        clock_drift_ppm: {
            category: 'FIRMWARE_MODEL',
            badge: 'Estimativa de modelo (Firmware)',
            label: 'Deriva relativa do oscilador (Clock Drift / CFO)',
            inputs: 'Registo Carrier Integrator do DW3000 ou razão de intervalos Δt_remoto / Δt_local',
            formula: 'drift_ppm = (α - 1) · 10^6 ppm (convenção: >0 indica relógio remoto mais rápido)',
            units: 'ppm (partes por milhão, 1 ppm = 1 µs/s)',
            validity_criteria: '|drift_ppm| <= 100 ppm (especificação cristal UWB IEEE 802.15.4z)',
            limitations: 'Na estrutura binária de 54B é quantizado em centésimos de ppm (int16); em TDoA UART representa a inclinação α do modelo afim.'
        },
        sync_model_tg: {
            category: 'FIRMWARE_MODEL',
            badge: 'Estimativa de modelo',
            label: 'Tempo Global Sincronizado (TG = α · TL + β)',
            inputs: 'Tempo local do módulo (TL em µs) e parâmetros α (escala) e β (offset) ancorados na última ronda TWR',
            formula: 'TG(TL) = T_master_ref + α · (TL - T_local_ref)',
            units: 'µs (microssegundos)',
            validity_criteria: 'sync_valid == 1 e idade da âncora < SYNC_STALE_US',
            limitations: 'Enviado explicitamente na telemetria UART TDoA; não armazenado no registo binário de 54B (que guarda apenas timestamp_ms local).'
        },
        descriptive_stats: {
            category: 'APP_CALCULATED',
            badge: 'Calculado pela aplicação',
            label: 'Estatísticas Descritivas e Dispersão (Média, Mediana, s, MAD, IQR, Percentis)',
            inputs: 'Amostras válidas de distância ou tempo filtradas por módulo/ligação/intervalo',
            formula: 's = sqrt(Σ(x_i - x̄)^2 / (N - 1)) [Bessel ddof=1]; MAD = median(|x_i - median(X)|); σ_MAD = 1.4826 · MAD',
            units: 'm (média, mediana, min, max) e mm (s, MAD, IQR, Bias, RMSE)',
            validity_criteria: 'Amostras finitas com status == 0; Bias e RMSE exigem Ground-Truth explícito.',
            limitations: 'Sem distância de referência (Ground-Truth) configurada pelo utilizador, avalia apenas precisão/estabilidade (dispersão), nunca exatidão absoluta.'
        },
        frequency_5_layers: {
            category: 'APP_CALCULATED',
            badge: 'Calculado pela aplicação',
            label: 'Decomposição Canónica das 5 Frequências do Sistema',
            inputs: 'Contadores de sequência (seq), timestamps do módulo (t_local_us / timestamp_ms) e timestamps de receção no PC (t_rx_host)',
            formula: 'f_RF = Δseq_unwrapped / Δt_módulo ; f_UART = (N - 1) / Δt_módulo ; f_Host = (N - 1) / Δt_host_pc',
            units: 'Hz (1/s)',
            validity_criteria: 'N >= 2 amostras válidas com Δt > 1 µs (sem fallbacks nominais)',
            limitations: 'Em ensaios binários históricos (flash RAM), f_Host e f_UI não se aplicam porque os dados foram gravados localmente no módulo.'
        }
    };

    const SciMetrics = {
        DWT_TIME_UNITS,
        SPEED_OF_LIGHT,
        CANONICAL_ALGO_VERSION,
        PROVENANCE_CATALOG,
        normalizeNodeId,
        normalizeLinkDirection,
        tsDiff40BitSigned,
        calculateTofFromTimestamps,
        classifyPhysicalMeasurementModel,
        filterRecordsByEntity,
        filterValidNumbers,
        computeDescriptiveStats,
        unwrapSequenceNumbers,
        computeTimingAndRates,
        computeLinearDriftRegression
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SciMetrics;
    }
    if (typeof window !== 'undefined') {
        window.SciMetrics = SciMetrics;
    }
})(typeof window !== 'undefined' ? window : this);
