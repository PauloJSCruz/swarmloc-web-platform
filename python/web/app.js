// Motor Canónico de Métricas Científicas carregado via /web/sci_metrics.js


/**
 * ==============================================================================
 * SwarmLoc UWB - Scientific Engineering SPA Application Logic
 * Modular, Reactive, High-Density Scientific Workspace
 * ==============================================================================
 */

const AppState = {
    currentView: 'catalog', // 'catalog' | 'trial-detail' | 'comparison'
    currentTrialId: null,
    currentDetailTab: 'summary',
    catalog: [],
    filesMeta: {},
    trialNotes: {},
    selectedForCompare: new Set(),
    activeTrialDetail: null,
    rawRecords: [],
    rawFilter: {
        page: 1,
        pageSize: 25,
        search: '',
        node: 'all',
        status: 'all'
    },
    charts: {
        temporalDist: null,
        temporalDrift: null,
        temporalDt: null,
        histDist: null,
        ecdfDist: null,
        qqDist: null,
        boxDist: null,
        blandAltman: null,
        diffSeries: null,
        subHistCharts: [],
        compSeries: null,
        protocolClockTimeline: null,
        protocolDistImpact: null,
        protocolSawtoothSim: null
    },
    selectedProtocolPair: null,
    selectedProtocolNode: null,
    protoSimK: 0.5,
    protoDistView: 'real',
    statsHistMode: 'subpanels', // 'subpanels' | 'boxcomp' | 'ecdfcomp' | 'residuals' | 'global'
    statsToolView: 'all', // 'all' | 'hist' | 'ecdf' | 'qq' | 'box'
    densityToggles: { gauss: true, kde: true },
    selectedTemporalLinks: new Set()
};

// ==============================================================================
// PALETA CIENTÍFICA DE ALTO CONTRASTE E DISTINÇÃO MORFOLÓGICA
// ==============================================================================
// Garante distinção absoluta de cores (ângulos de matiz separados) e formas de ponto

const NODE_COLORS = {
    '0001': { border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.2)', text: '#00e5ff', label: 'Node 0x0001 (Master)' },
    '0002': { border: '#00f59b', bg: 'rgba(0, 245, 155, 0.2)', text: '#00f59b', label: 'Node 0x0002 (Slave)' },
    '0003': { border: '#ffb703', bg: 'rgba(255, 183, 3, 0.2)', text: '#ffb703', label: 'Node 0x0003 (Slave)' },
    '0004': { border: '#f72585', bg: 'rgba(247, 37, 133, 0.2)', text: '#f72585', label: 'Node 0x0004 (Slave)' },
    '0005': { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.2)', text: '#14b8a6', label: 'Node 0x0005 (Slave)' },
    '0006': { border: '#fb7185', bg: 'rgba(251, 113, 133, 0.2)', text: '#fb7185', label: 'Node 0x0006 (Slave)' },
    'default': { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.2)', text: '#38bdf8', label: 'Nó' }
};

function getNodeColor(nodeId) {
    const clean = (nodeId || '').replace(/^0x/i, '');
    return NODE_COLORS[clean] || NODE_COLORS['default'];
}

// Mapeamento específico por Link Direcional para evitar colisões entre links que partilham o mesmo nó
const LINK_PALETTE = {
    // 9 Cores 100% Únicas e Distintas (3 por Módulo)
    // Módulo 2 (S02): Azul Real (#2563eb), Verde Brilhante (#22c55e), Ciano Elétrico (#00e5ff)
    '0001->0002': {
        border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', text: '#2563eb',
        pointStyle: 'circle', pointIcon: '○', dash: [5, 4],
        name: '👑 M01 → S02 [TWR]', fullName: 'Master (0001) → Slave 2 [TWR]'
    },
    '0001->0002:twr': {
        border: '#2563eb', bg: 'rgba(37, 99, 235, 0.15)', text: '#2563eb',
        pointStyle: 'circle', pointIcon: '○', dash: [5, 4],
        name: '👑 M01 → S02 [TWR]', fullName: 'Master (0001) → Slave 2 [TWR]'
    },
    '0002->0001': {
        border: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e',
        pointStyle: 'circle', pointIcon: '●', dash: [],
        name: '📡 S02 → M01 [TWR]', fullName: 'Slave 2 (0002) → Master [TWR]'
    },
    '0002->0001:twr': {
        border: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e',
        pointStyle: 'circle', pointIcon: '○', dash: [4, 3],
        name: '📡 S02 → M01 [TWR]', fullName: 'Slave 2 (0002) → Master [TWR]'
    },
    '0001->0002:tdoa': {
        border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.15)', text: '#00e5ff',
        pointStyle: 'circle', pointIcon: '●', dash: [4, 4],
        name: '📡 M01 → S02 [TDoA]', fullName: 'Master (0001) → Slave 2 [TDoA]'
    },
    '0002->0001:tdoa': {
        border: '#00e5ff', bg: 'rgba(0, 229, 255, 0.15)', text: '#00e5ff',
        pointStyle: 'circle', pointIcon: '●', dash: [4, 4],
        name: '📡 M01 → S02 [TDoA]', fullName: 'Slave 2 (0002) → Master [TDoA]'
    },

    // Módulo 3 (S03): Amarelo Canário (#ffd600), Rosa Choque (#f72585), Vermelho Vivo (#ef4444)
    '0001->0003': {
        border: '#ffd600', bg: 'rgba(255, 214, 0, 0.15)', text: '#ffd600',
        pointStyle: 'rectRot', pointIcon: '◇', dash: [5, 4],
        name: '👑 M01 → S03 [TWR]', fullName: 'Master (0001) → Slave 3 [TWR]'
    },
    '0001->0003:twr': {
        border: '#ffd600', bg: 'rgba(255, 214, 0, 0.15)', text: '#ffd600',
        pointStyle: 'rectRot', pointIcon: '◇', dash: [5, 4],
        name: '👑 M01 → S03 [TWR]', fullName: 'Master (0001) → Slave 3 [TWR]'
    },
    '0003->0001': {
        border: '#f72585', bg: 'rgba(247, 37, 133, 0.15)', text: '#f72585',
        pointStyle: 'rectRot', pointIcon: '◆', dash: [],
        name: '📡 S03 → M01 [TWR]', fullName: 'Slave 3 (0003) → Master [TWR]'
    },
    '0003->0001:twr': {
        border: '#f72585', bg: 'rgba(247, 37, 133, 0.15)', text: '#f72585',
        pointStyle: 'rectRot', pointIcon: '◇', dash: [4, 3],
        name: '📡 S03 → M01 [TWR]', fullName: 'Slave 3 (0003) → Master [TWR]'
    },
    '0001->0003:tdoa': {
        border: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444',
        pointStyle: 'rectRot', pointIcon: '◆', dash: [4, 4],
        name: '📡 M01 → S03 [TDoA]', fullName: 'Master (0001) → Slave 3 [TDoA]'
    },
    '0003->0001:tdoa': {
        border: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444',
        pointStyle: 'rectRot', pointIcon: '◆', dash: [4, 4],
        name: '📡 M01 → S03 [TDoA]', fullName: 'Slave 3 (0003) → Master [TDoA]'
    },

    // Módulo 4 (S04): Roxo Violeta (#8b5cf6), Laranja Fogo (#ff6d00), Branco Puro (#ffffff)
    '0001->0004': {
        border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', text: '#8b5cf6',
        pointStyle: 'triangle', pointIcon: '△', dash: [5, 4],
        name: '👑 M01 → S04 [TWR]', fullName: 'Master (0001) → Slave 4 [TWR]'
    },
    '0001->0004:twr': {
        border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', text: '#8b5cf6',
        pointStyle: 'triangle', pointIcon: '△', dash: [5, 4],
        name: '👑 M01 → S04 [TWR]', fullName: 'Master (0001) → Slave 4 [TWR]'
    },
    '0004->0001': {
        border: '#ff6d00', bg: 'rgba(255, 109, 0, 0.15)', text: '#ff6d00',
        pointStyle: 'triangle', pointIcon: '▲', dash: [],
        name: '📡 S04 → M01 [TWR]', fullName: 'Slave 4 (0004) → Master [TWR]'
    },
    '0004->0001:twr': {
        border: '#ff6d00', bg: 'rgba(255, 109, 0, 0.15)', text: '#ff6d00',
        pointStyle: 'triangle', pointIcon: '△', dash: [4, 3],
        name: '📡 S04 → M01 [TWR]', fullName: 'Slave 4 (0004) → Master [TWR]'
    },
    '0001->0004:tdoa': {
        border: '#ffffff', bg: 'rgba(255, 255, 255, 0.20)', text: '#ffffff',
        pointStyle: 'triangle', pointIcon: '▲', dash: [4, 4],
        name: '📡 M01 → S04 [TDoA]', fullName: 'Master (0001) → Slave 4 [TDoA]'
    },
    '0004->0001:tdoa': {
        border: '#ffffff', bg: 'rgba(255, 255, 255, 0.20)', text: '#ffffff',
        pointStyle: 'triangle', pointIcon: '▲', dash: [4, 4],
        name: '📡 M01 → S04 [TDoA]', fullName: 'Slave 4 (0004) → Master [TDoA]'
    },

    // Módulo 5 (S05): Turquesa (#14b8a6), Verde-Lima (#84cc16), Turquesa Claro (#2dd4bf)
    '0001->0005': {
        border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)', text: '#14b8a6',
        pointStyle: 'rect', pointIcon: '□', dash: [5, 4],
        name: '👑 M01 → S05 [TWR]', fullName: 'Master (0001) → Slave 5 [TWR]'
    },
    '0001->0005:twr': {
        border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)', text: '#14b8a6',
        pointStyle: 'rect', pointIcon: '□', dash: [5, 4],
        name: '👑 M01 → S05 [TWR]', fullName: 'Master (0001) → Slave 5 [TWR]'
    },
    '0005->0001': {
        border: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)', text: '#84cc16',
        pointStyle: 'rect', pointIcon: '■', dash: [],
        name: '📡 S05 → M01 [TWR]', fullName: 'Slave 5 (0005) → Master [TWR]'
    },
    '0005->0001:twr': {
        border: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)', text: '#84cc16',
        pointStyle: 'rect', pointIcon: '□', dash: [4, 3],
        name: '📡 S05 → M01 [TWR]', fullName: 'Slave 5 (0005) → Master [TWR]'
    },
    '0001->0005:tdoa': {
        border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.18)', text: '#2dd4bf',
        pointStyle: 'rect', pointIcon: '■', dash: [4, 4],
        name: '📡 M01 → S05 [TDoA]', fullName: 'Master (0001) → Slave 5 [TDoA]'
    },
    '0005->0001:tdoa': {
        border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.18)', text: '#2dd4bf',
        pointStyle: 'rect', pointIcon: '■', dash: [4, 4],
        name: '📡 M01 → S05 [TDoA]', fullName: 'Slave 5 (0005) → Master [TDoA]'
    },

    // Módulo 6 (S06): Fúcsia (#e879f9), Coral (#fb7185), Âmbar (#fbbf24)
    '0001->0006': {
        border: '#e879f9', bg: 'rgba(232, 121, 249, 0.15)', text: '#e879f9',
        pointStyle: 'star', pointIcon: '☆', dash: [5, 4],
        name: '👑 M01 → S06 [TWR]', fullName: 'Master (0001) → Slave 6 [TWR]'
    },
    '0001->0006:twr': {
        border: '#e879f9', bg: 'rgba(232, 121, 249, 0.15)', text: '#e879f9',
        pointStyle: 'star', pointIcon: '☆', dash: [5, 4],
        name: '👑 M01 → S06 [TWR]', fullName: 'Master (0001) → Slave 6 [TWR]'
    },
    '0006->0001': {
        border: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)', text: '#fb7185',
        pointStyle: 'star', pointIcon: '★', dash: [],
        name: '📡 S06 → M01 [TWR]', fullName: 'Slave 6 (0006) → Master [TWR]'
    },
    '0006->0001:twr': {
        border: '#fb7185', bg: 'rgba(251, 113, 133, 0.15)', text: '#fb7185',
        pointStyle: 'star', pointIcon: '☆', dash: [4, 3],
        name: '📡 S06 → M01 [TWR]', fullName: 'Slave 6 (0006) → Master [TWR]'
    },
    '0001->0006:tdoa': {
        border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', text: '#fbbf24',
        pointStyle: 'star', pointIcon: '★', dash: [4, 4],
        name: '📡 M01 → S06 [TDoA]', fullName: 'Master (0001) → Slave 6 [TDoA]'
    },
    '0006->0001:tdoa': {
        border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', text: '#fbbf24',
        pointStyle: 'star', pointIcon: '★', dash: [4, 4],
        name: '📡 M01 → S06 [TDoA]', fullName: 'Slave 6 (0006) → Master [TDoA]'
    },
    // Master Broadcast
    '0001->FFFF': {
        border: '#818cf8', bg: 'rgba(129, 140, 248, 0.12)', text: '#818cf8',
        pointStyle: 'cross', pointIcon: '✕', dash: [2, 2],
        name: '👑 M01 → Broadcast', fullName: 'Master (0001) → Broadcast (FFFF)'
    }
};

const FALLBACK_LINK_PALETTE = [
    { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', text: '#38bdf8', pointStyle: 'circle', pointIcon: '', dash: [] },
    { border: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', text: '#34d399', pointStyle: 'circle', pointIcon: '', dash: [5, 4] },
    { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)', text: '#fbbf24', pointStyle: 'circle', pointIcon: '', dash: [] },
    { border: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', text: '#f43f5e', pointStyle: 'circle', pointIcon: '', dash: [5, 4] },
    { border: '#a78bfa', bg: 'rgba(167, 139, 250, 0.12)', text: '#a78bfa', pointStyle: 'circle', pointIcon: '', dash: [] },
    { border: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)', text: '#fb923c', pointStyle: 'circle', pointIcon: '', dash: [5, 4] },
    { border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.12)', text: '#2dd4bf', pointStyle: 'circle', pointIcon: '', dash: [] },
    { border: '#e879f9', bg: 'rgba(232, 121, 249, 0.12)', text: '#e879f9', pointStyle: 'circle', pointIcon: '', dash: [5, 4] }
];

function getLinkColor(linkLabel, src, dst, fallbackIdx = 0) {
    const cleanSrc = (src || '').replace(/^0x/i, '').trim();
    const cleanDst = (dst || '').replace(/^0x/i, '').trim();
    const lbl = String(linkLabel || '');
    const isTdoa = (lbl.includes('[TDoA]') || lbl.includes('[TDOA]') || lbl.includes(':tdoa'));
    const isTwr = (lbl.includes('[TWR]') || lbl.includes(':twr'));

    if (isTdoa && LINK_PALETTE[`${cleanSrc}->${cleanDst}:tdoa`]) {
        return LINK_PALETTE[`${cleanSrc}->${cleanDst}:tdoa`];
    }
    if (isTwr && LINK_PALETTE[`${cleanSrc}->${cleanDst}:twr`]) {
        return LINK_PALETTE[`${cleanSrc}->${cleanDst}:twr`];
    }

    const key = `${cleanSrc}->${cleanDst}`;
    if (LINK_PALETTE[key]) return LINK_PALETTE[key];
    
    if (linkLabel) {
        const clean = linkLabel.replace(/\[.*?\]/g, '').replace(/0x/g, '').replace(/\s+/g, '');
        const parts = clean.split('->');
        if (parts.length === 2) {
            const key2 = `${parts[0]}->${parts[1]}`;
            if (LINK_PALETTE[key2]) return LINK_PALETTE[key2];
        }
    }
    
    return FALLBACK_LINK_PALETTE[fallbackIdx % FALLBACK_LINK_PALETTE.length];
}

function formatLinkBadge(linkLabel, src, dst, idx = 0) {
    const col = getLinkColor(linkLabel, src, dst, idx);
    let label = (linkLabel || `${src || ''} -> ${dst || ''}`).trim();
    let protoBadge = '';
    if (label.includes('[TWR]')) {
        protoBadge = '<span class="badge-proto-twr">TWR</span>';
        label = label.replace('[TWR]', '').trim();
    } else if (label.includes('[TDoA]') || label.includes('[TDOA]')) {
        protoBadge = '<span class="badge-proto-tdoa">TDoA</span>';
        label = label.replace(/\[TDoA\]|\[TDOA\]/g, '').trim();
    }
    label = label.replace(/->/g, ' → ');
    return `<span class="link-badge-pill" style="--badge-col:${col.border};"><span class="link-badge-dot"></span><span class="link-badge-text">${label}${protoBadge}</span></span>`;
}

// ==============================================================================
// MOTOR DE NORMALIZAÇÃO DE LINKS E SÉRIES UWB (SHARED ACROSS LIVE & TRIALS)
// ==============================================================================

/**
 * Normaliza e padroniza a identificação, nomes, ícones e cores de qualquer link UWB
 * @param {string} src - Endereço do nó emissor (ex: '0001', '0x0001', 'COM6')
 * @param {string} dst - Endereço do nó destinatário (ex: '0002', '0x0002')
 * @param {string} proto - Protocolo de rádio ('TWR', 'TDoA', etc.)
 * @param {number} fallbackIdx - Índice de cor de reserva se desconhecido
 */
function getNormalizedLinkDisplay(src, dst, proto = '', fallbackIdx = 0) {
    let cleanSrc = String(src || '').replace(/^0x/i, '').trim().toUpperCase();
    let cleanDst = String(dst || '').replace(/^0x/i, '').trim().toUpperCase();
    if (cleanSrc.length < 4 && !isNaN(parseInt(cleanSrc, 16))) cleanSrc = cleanSrc.padStart(4, '0');
    if (cleanDst.length < 4 && !isNaN(parseInt(cleanDst, 16))) cleanDst = cleanDst.padStart(4, '0');

    const key = `${cleanSrc}->${cleanDst}`;
    const col = getLinkColor('', cleanSrc, cleanDst, fallbackIdx);
    const isMasterTx = (cleanSrc === '0001');
    const isSlaveTx = (cleanDst === '0001');

    let cleanProto = (proto || '').toUpperCase().trim();
    if (!cleanProto) {
        cleanProto = isMasterTx ? 'TWR' : (isSlaveTx ? 'TWR' : 'UWB');
    }

    let label = key;
    let shortLabel = key;
    let fullTitle = key;

    if (isMasterTx) {
        const sNum = cleanDst.replace(/^00/, 'S');
        label = `👑 M01 → ${sNum} [TWR]`;
        shortLabel = `M01 → ${sNum}`;
        fullTitle = `Master Hub (0001) → Slave ${parseInt(cleanDst, 16)} [DS-TWR Master]`;
    } else if (isSlaveTx) {
        const sNum = cleanSrc.replace(/^00/, 'S');
        label = `📡 ${sNum} → M01 [${cleanProto}]`;
        shortLabel = `${sNum} → M01`;
        fullTitle = `Slave ${parseInt(cleanSrc, 16)} (${cleanSrc}) → Master Hub [${cleanProto}]`;
    } else {
        label = `${cleanSrc} → ${cleanDst} [${cleanProto}]`;
        shortLabel = `${cleanSrc} → ${cleanDst}`;
        fullTitle = `${cleanSrc} → ${cleanDst}`;
    }

    return {
        key,
        src: cleanSrc,
        dst: cleanDst,
        proto: cleanProto,
        label,
        shortLabel,
        fullTitle,
        col
    };
}

/**
 * Gera o HTML padronizado para pills/chips de links de rádio (Live, Ensaio Temporal, Custom Studio)
 */
// createLinkPillHtml removido (substituído por UnifiedUwbChart)


/**
 * Lógica unificada para filtrar links através dos presets da barra de ferramentas
 */
function applyLinkPreset(availableItems, activeSet, preset) {
    if (!activeSet) activeSet = new Set();
    const p = String(preset || '').toLowerCase();

    const linkKeys = availableItems.map(item => {
        if (typeof item === 'string') return item;
        return item.link_label || `${item.src}->${item.dst}`;
    });

    if (p === 'all' || p === 'todos') {
        linkKeys.forEach(k => activeSet.add(k));
    } else if (p === 'none' || p === 'nenhum' || p === 'limpar') {
        activeSet.clear();
    } else if (p === 'invert' || p === 'inverter') {
        const next = new Set();
        linkKeys.forEach(k => {
            if (!activeSet.has(k)) next.add(k);
        });
        activeSet.clear();
        next.forEach(k => activeSet.add(k));
    } else if (p === 'twr_only' || p === 'proto_twr' || p === 'twr' || p === 'master_tx') {
        activeSet.clear();
        availableItems.forEach((item, idx) => {
            const k = linkKeys[idx];
            const proto = String(item.protocol || item.lastProto || '').toUpperCase();
            if (proto === 'TWR' || k.includes(':twr') || k.includes('[TWR]') || k.includes('0001->') || k.includes('M01')) {
                activeSet.add(k);
            }
        });
    } else if (p === 'tdoa_only' || p === 'proto_tdoa' || p === 'tdoa' || p === 'slave_tx') {
        activeSet.clear();
        availableItems.forEach((item, idx) => {
            const k = linkKeys[idx];
            const proto = String(item.protocol || item.lastProto || '').toUpperCase();
            if (proto === 'TDOA' || k.includes(':tdoa') || k.includes('[TDoA]') || k.includes('[TDOA]')) {
                activeSet.add(k);
            }
        });
    } else if (p.includes('0002') || p === 's02') {
        activeSet.clear();
        linkKeys.forEach(k => {
            if (k.includes('0002') || k.includes('S02')) activeSet.add(k);
        });
    } else if (p.includes('0003') || p === 's03') {
        activeSet.clear();
        linkKeys.forEach(k => {
            if (k.includes('0003') || k.includes('S03')) activeSet.add(k);
        });
    } else if (p.includes('0004') || p === 's04') {
        activeSet.clear();
        linkKeys.forEach(k => {
            if (k.includes('0004') || k.includes('S04')) activeSet.add(k);
        });
    } else if (p.includes('0005') || p === 's05') {
        activeSet.clear();
        linkKeys.forEach(k => {
            if (k.includes('0005') || k.includes('S05')) activeSet.add(k);
        });
    } else if (p.includes('0006') || p === 's06') {
        activeSet.clear();
        linkKeys.forEach(k => {
            if (k.includes('0006') || k.includes('S06')) activeSet.add(k);
        });
    }
    return activeSet;
}

/**
 * Constrói a configuração padronizada de dataset para o Chart.js com estilos normalizados
 */
function buildStandardDatasetConfig({
    label,
    linkKey = '',
    data = [],
    col,
    styleType = 'scatter_line',
    hidden = false,
    extraOptions = {}
}) {
    let showLine = true;
    let pointRadius = 3;
    let tension = 0.05;
    let stepped = false;
    let type = extraOptions.type || 'scatter';

    if (styleType === 'points' || styleType === 'scatter') {
        showLine = false;
        pointRadius = 4;
    } else if (styleType === 'line') {
        showLine = true;
        pointRadius = 0;
    } else if (styleType === 'spline') {
        showLine = true;
        pointRadius = 2.5;
        tension = 0.35;
    } else if (styleType === 'stepped') {
        showLine = true;
        stepped = 'before';
        pointRadius = 2.5;
    } else if (styleType === 'bar') {
        type = 'bar';
    }

    return {
        type: type,
        label: label,
        linkKey: linkKey,
        data: data,
        borderColor: col.border,
        backgroundColor: col.bg,
        borderWidth: 2,
        borderDash: col.dash || [],
        pointStyle: col.pointStyle || 'circle',
        pointRadius: pointRadius,
        pointHoverRadius: 6,
        pointBorderColor: col.border,
        pointBackgroundColor: col.bg,
        showLine: showLine,
        stepped: stepped,
        tension: tension,
        spanGaps: true,
        hidden: hidden,
        ...extraOptions
    };
}

/**
 * Formata a faixa estatística instantânea idêntica em todos os gráficos
 */
function formatStatsStripHtml(values, metricTitle = 'Distância Medida', unit = 'm', extraRightHtml = '') {
    const stats = window.SciMetrics.computeDescriptiveStats(values);
    if (!stats || stats.n === 0) {
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; font-family:var(--font-mono); font-size:11px; color:#64748b;">
                <span><strong>Métrica:</strong> <strong style="color:var(--cyan);">${metricTitle}</strong></span>
                <span style="margin-left:auto;">A aguardar dados / Nenhuma amostra selecionada</span>
            </div>
        `;
    }

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; font-family:var(--font-mono); font-size:11px; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; gap:16px; align-items:center;">
                <span><strong>${metricTitle}:</strong> Média <strong style="color:var(--cyan);">${stats.mean.toFixed(3)} ${unit}</strong></span>
                <span>Desvio (σ): <strong style="color:var(--amber);">±${stats.std.toFixed(3)} ${unit}</strong></span>
                <span>Intervalo: <strong>[${stats.min.toFixed(3)} .. ${stats.max.toFixed(3)}] ${unit}</strong></span>
                <span>Amplitude (Δ): <strong>${stats.span.toFixed(3)} ${unit}</strong></span>
            </div>
            <div style="margin-left:auto; display:flex; gap:12px; align-items:center; color:#94a3b8;">
                <span>Amostras: <strong style="color:var(--text);">${stats.n} pts</strong></span>
                ${extraRightHtml}
            </div>
        </div>
    `;
}


function switchStatsHistMode(mode) {
    AppState.statsHistMode = mode;
    ['subpanels', 'boxcomp', 'ecdfcomp', 'residuals', 'global'].forEach(m => {
        const btn = document.getElementById(`btn-mode-${m}`);
        if (btn) btn.classList.toggle('active', m === mode);
    });
    renderTabStats();
}

function switchStatsTool(tool) {
    AppState.statsToolView = tool;
    
    // Se o utilizador estiver em "Todos os Links" e clicar numa ferramenta comparativa específica
    const select = document.getElementById('stats-link-select');
    if (select && select.value === 'all') {
        if (tool === 'box') {
            switchStatsHistMode('boxcomp');
            return;
        } else if (tool === 'ecdf') {
            switchStatsHistMode('ecdfcomp');
            return;
        } else if (tool === 'hist') {
            switchStatsHistMode('subpanels');
            return;
        }
    }
    
    applyStatsToolVisibility();
    setTimeout(() => {
        ['histDist', 'ecdfDist', 'qqDist', 'boxDist'].forEach(k => {
            if (AppState.charts[k]) AppState.charts[k].resize();
        });
    }, 50);
}

function applyStatsToolVisibility() {
    const tool = AppState.statsToolView || 'all';
    const histCard = document.getElementById('stats-histogram-main-card');
    const advGrid = document.getElementById('stats-advanced-distributions-grid');
    const ecdfCard = document.getElementById('stats-ecdf-card');
    const qqCard = document.getElementById('stats-qq-card');
    const boxCard = document.getElementById('stats-box-card');

    ['all', 'hist', 'ecdf', 'qq', 'box'].forEach(t => {
        const btn = document.getElementById(`btn-tool-${t}`);
        if (btn) btn.classList.toggle('active', t === tool);
    });

    if (tool === 'all') {
        if (histCard) histCard.style.display = 'block';
        if (advGrid) {
            advGrid.style.display = 'grid';
            advGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(420px, 1fr))';
        }
        if (ecdfCard) ecdfCard.style.display = 'block';
        if (qqCard) qqCard.style.display = 'block';
        if (boxCard) boxCard.style.display = 'block';
    } else if (tool === 'hist') {
        if (histCard) histCard.style.display = 'block';
        if (advGrid) advGrid.style.display = 'none';
    } else if (tool === 'ecdf') {
        if (histCard) histCard.style.display = 'none';
        if (advGrid) {
            advGrid.style.display = 'block';
            advGrid.style.gridTemplateColumns = '1fr';
        }
        if (ecdfCard) ecdfCard.style.display = 'block';
        if (qqCard) qqCard.style.display = 'none';
        if (boxCard) boxCard.style.display = 'none';
    } else if (tool === 'qq') {
        if (histCard) histCard.style.display = 'none';
        if (advGrid) {
            advGrid.style.display = 'block';
            advGrid.style.gridTemplateColumns = '1fr';
        }
        if (ecdfCard) ecdfCard.style.display = 'none';
        if (qqCard) qqCard.style.display = 'block';
        if (boxCard) boxCard.style.display = 'none';
    } else if (tool === 'box') {
        if (histCard) histCard.style.display = 'none';
        if (advGrid) {
            advGrid.style.display = 'block';
            advGrid.style.gridTemplateColumns = '1fr';
        }
        if (ecdfCard) ecdfCard.style.display = 'none';
        if (qqCard) qqCard.style.display = 'none';
        if (boxCard) boxCard.style.display = 'block';
    }
}

function onDensityToggleChange() {
    const chkGauss = document.getElementById('chk-hist-gauss');
    const chkKde = document.getElementById('chk-hist-kde');
    AppState.densityToggles = {
        gauss: chkGauss ? chkGauss.checked : true,
        kde: chkKde ? chkKde.checked : true
    };
    renderTabStats();
}

// ==============================================================================
// 1. INICIALIZAÇÃO E COMUNICAÇÃO COM O BACKEND
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    detectModulePorts();
    loadCatalog();
});

async function loadCatalog() {
    setLoading(true);
    try {
        const resp = await fetch('/api/catalog');
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        
        AppState.catalog = data.trials || [];
        AppState.filesMeta = data.files_meta || {};
        AppState.trialNotes = data.notes || {};
        
        renderCatalog();
        updateGlobalStats();
    } catch (err) {
        console.error('Erro ao carregar catálogo:', err);
        showToast('Falha ao comunicar com o servidor SwarmLoc', 'error');
    } finally {
        setLoading(false);
    }
}

async function refreshServerFiles() {
    setLoading(true);
    try {
        const resp = await fetch('/api/load_server_files', { method: 'POST' });
        const data = await resp.json();
        showToast(`Carregados ${data.trials ? data.trials.length : 0} ensaios do disco do servidor`, 'success');
        await loadCatalog();
    } catch (err) {
        showToast('Erro ao atualizar ficheiros do servidor', 'error');
    } finally {
        setLoading(false);
    }
}

// ==============================================================================
// 2. NAVEGAÇÃO E GESTÃO DE VISTAS (SPA ROUTING)
// ==============================================================================

function switchView(viewName, trialId = null) {
    let resolvedView = viewName;
    if (viewName === 'analysis') {
        if (AppState.currentTrialId && AppState.currentView === 'trial-detail') {
            resolvedView = 'trial-detail';
            trialId = trialId || AppState.currentTrialId;
        } else if (AppState.currentView === 'comparison' && AppState.selectedForCompare.size >= 2) {
            resolvedView = 'comparison';
        } else {
            resolvedView = 'catalog';
        }
    }
    AppState.currentView = resolvedView;
    
    // Atualizar as abas principais do topo (1. Análise vs 2. Telemetria Live vs 3. Documentação)
    const isLive = (resolvedView === 'live');
    const isDocs = (resolvedView === 'docs');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.view === 'analysis') {
            btn.classList.toggle('active', !isLive && !isDocs);
        } else if (btn.dataset.view === 'live') {
            btn.classList.toggle('active', isLive);
        } else if (btn.dataset.view === 'docs') {
            btn.classList.toggle('active', isDocs);
        } else {
            btn.classList.toggle('active', btn.dataset.view === resolvedView);
        }
    });
    
    // Alternar visibilidade das secções
    document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.remove('active');
    });
    
    const targetSec = document.getElementById(`view-${resolvedView}`);
    if (targetSec) targetSec.classList.add('active');
    
    // Atualizar breadcrumbs
    updateBreadcrumbs(resolvedView, trialId);
    
    if (resolvedView === 'catalog') {
        AppState.currentTrialId = null;
        renderCatalog();
    } else if (resolvedView === 'trial-detail' && trialId) {
        if (AppState.currentTrialId !== trialId || !AppState.activeTrialDetail) {
            openTrialDetail(trialId);
        }
    } else if (resolvedView === 'comparison') {
        renderComparisonView();
    } else if (resolvedView === 'live') {
        initLiveTelemetryView();
    } else if (resolvedView === 'docs') {
        if (typeof checkDocsStatus === 'function') {
            checkDocsStatus();
        }
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchView = switchView;

function showCatalogSubView() {
    AppState.currentTrialId = null;
    switchView('catalog');
}
window.showCatalogSubView = showCatalogSubView;

function updateBreadcrumbs(viewName, trialId = null) {
    const crumb = document.getElementById('app-breadcrumbs');
    if (!crumb) return;
    
    if (viewName === 'catalog') {
        crumb.innerHTML = `<span class="breadcrumb-current">1. Análise — Seleção do Ensaio e Catálogo</span>`;
    } else if (viewName === 'trial-detail') {
        const t = AppState.catalog.find(x => x.id === trialId) || { id: trialId, time: trialId };
        const label = t.user_title || t.time || t.id;
        crumb.innerHTML = `
            <span class="link" onclick="showCatalogSubView()">1. Análise (Catálogo)</span>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Ensaio ${escapeHtml(label)}</span>
        `;
    } else if (viewName === 'comparison') {
        crumb.innerHTML = `
            <span class="link" onclick="showCatalogSubView()">1. Análise (Catálogo)</span>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Comparação Multi-Ensaio (${AppState.selectedForCompare.size})</span>
        `;
    } else if (viewName === 'live') {
        crumb.innerHTML = `
            <span class="link" onclick="showCatalogSubView()">1. Análise</span>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">2. Telemetria Live (Tempo Real)</span>
        `;
    }
}

// ==============================================================================
// 3. VISTA: CATÁLOGO DE ENSAIOS
// ==============================================================================

function updateGlobalStats() {
    const trials = AppState.catalog;
    let totalSamples = 0;
    let totalSuccess = 0;
    const uniqueNodes = new Set();
    
    trials.forEach(t => {
        totalSamples += (t.total_records || 0);
        totalSuccess += (t.valid_records || 0);
        (t.nodes || []).forEach(n => uniqueNodes.add(n));
    });
    
    const overallSuccess = totalSamples > 0 ? (totalSuccess / totalSamples * 100).toFixed(1) : '0.0';
    
    document.getElementById('stat-total-trials').textContent = trials.length;
    document.getElementById('stat-total-samples').textContent = totalSamples.toLocaleString();
    document.getElementById('stat-success-rate').textContent = `${overallSuccess}%`;
    document.getElementById('stat-unique-nodes').textContent = uniqueNodes.size;
}

function renderCatalog() {
    const container = document.getElementById('catalog-grid');
    if (!container) return;
    
    const searchTerm = (document.getElementById('catalog-search')?.value || '').toLowerCase().trim();
    const nodeFilter = document.getElementById('catalog-node-filter')?.value || 'all';
    const statusFilter = document.getElementById('catalog-status-filter')?.value || 'all';
    const sortBy = document.getElementById('catalog-sort-by')?.value || 'date-desc';
    
    // Filtrar ensaios
    let filtered = AppState.catalog.filter(t => {
        // Texto
        if (searchTerm) {
            const matchId = (t.id || '').toLowerCase().includes(searchTerm);
            const matchTime = (t.time || '').toLowerCase().includes(searchTerm);
            const matchTitle = (t.user_title || '').toLowerCase().includes(searchTerm);
            const matchCampaign = (t.campaign || '').toLowerCase().includes(searchTerm);
            if (!matchId && !matchTime && !matchTitle && !matchCampaign) return false;
        }
        // Nó
        if (nodeFilter !== 'all') {
            if (!(t.nodes || []).includes(nodeFilter)) return false;
        }
        // Status de Validação
        if (statusFilter !== 'all') {
            if (t.integrity_status !== statusFilter) return false;
        }
        return true;
    });
    
    // Ordenar ensaios
    filtered.sort((a, b) => {
        if (sortBy === 'date-desc') return (b.id || '').localeCompare(a.id || '');
        if (sortBy === 'date-asc') return (a.id || '').localeCompare(b.id || '');
        if (sortBy === 'samples-desc') return (b.total_records || 0) - (a.total_records || 0);
        if (sortBy === 'success-desc') return (b.success_rate || 0) - (a.success_rate || 0);
        return 0;
    });
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted); background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg);">
                <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Nenhum ensaio corresponde aos filtros ativos</div>
                <div style="font-size: 12px;">Experimente limpar a pesquisa ou arrastar novos ficheiros .bin/.csv para a área abaixo.</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filtered.map(t => {
        const isSelected = AppState.selectedForCompare.has(t.id);
        const userTitle = t.user_title ? `<div class="trial-user-title">${escapeHtml(t.user_title)}</div>` : '';
        const campaignTag = t.campaign ? `<span class="trial-campaign-tag">${escapeHtml(t.campaign)}</span>` : '';
        
        // Nós badges
        const nodeBadges = (t.nodes || []).map(n => {
            const col = getNodeColor(n);
            return `<span class="node-pill" style="border-color:${col.border}; color:${col.border}; background:${col.bg};">0x${escapeHtml(n)}</span>`;
        }).join('');
        
        // Integridade
        const isOk = t.integrity_status === 'VALID';
        const integrityBadge = isOk 
            ? `<span class="integrity-indicator integrity-ok"><span class="integrity-dot"></span>Íntegro (${t.success_rate}%)</span>`
            : `<span class="integrity-indicator integrity-warn"><span class="integrity-dot"></span>${escapeHtml(t.integrity_note || 'Com Anomalias')}</span>`;

        return `
            <div class="trial-card ${isSelected ? 'selected' : ''}" id="card-trial-${t.id}" onclick="handleTrialCardClick('${t.id}', event)">
                <div>
                    <div class="trial-card-top">
                        <div class="trial-checkbox-wrapper">
                            <input type="checkbox" class="trial-checkbox" id="chk-${t.id}" ${isSelected ? 'checked' : ''} onchange="toggleTrialSelection('${t.id}', event)">
                            <div>
                                <div class="trial-identifier">${escapeHtml(t.id)}</div>
                                <div class="trial-card-time">${escapeHtml(t.time || t.id)}</div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${String(t.id).startsWith('stream_') ? '<span class="badge" style="background:rgba(239,68,68,0.2); color:#f87171; border:1px solid rgba(239,68,68,0.5); font-weight:700;">📡 Gravação Live</span>' : ''}
                            <span class="badge badge-cyan">${escapeHtml(t.ranging_methods?.join(', ') || 'DS-TWR')}</span>
                        </div>
                    </div>

                    ${campaignTag}
                    ${userTitle}

                    <div class="trial-nodes-row">
                        ${nodeBadges}
                    </div>

                    <div class="trial-metrics-grid">
                        <div class="trial-metric-item">
                            <span class="t-m-label">Registos</span>
                            <span class="t-m-val">${t.total_records}</span>
                        </div>
                        <div class="trial-metric-item">
                            <span class="t-m-label">Duração</span>
                            <span class="t-m-val">${(t.duration_s || 0).toFixed(1)} <small style="font-size:10px;font-weight:400;">s</small></span>
                        </div>
                        <div class="trial-metric-item">
                            <span class="t-m-label">Taxa</span>
                            <span class="t-m-val">${(t.sample_rate_hz || 0).toFixed(1)} <small style="font-size:10px;font-weight:400;">Hz</small></span>
                        </div>
                        <div class="trial-metric-item">
                            <span class="t-m-label">Links</span>
                            <span class="t-m-val">${t.links ? t.links.length : 1} pares</span>
                        </div>
                        <div class="trial-metric-item">
                            <span class="t-m-label">Jitter Médio</span>
                            <span class="t-m-val">${t.jitter_mm !== null ? '± ' + t.jitter_mm.toFixed(1) + ' mm' : '--'}</span>
                        </div>
                        <div class="trial-metric-item">
                            <span class="t-m-label">Drift Médio</span>
                            <span class="t-m-val">${t.mean_drift_ppm !== null ? (t.mean_drift_ppm > 0 ? '+' : '') + t.mean_drift_ppm.toFixed(2) + ' ppm' : '--'}</span>
                        </div>
                        <div class="trial-metric-item" style="border-top:1px solid rgba(16,185,129,0.25);">
                            <span class="t-m-label" style="color:var(--emerald);">Freq TDoA</span>
                            <span class="t-m-val" style="color:var(--emerald); font-weight:700;">${(t.tdoa_freq_hz && t.tdoa_freq_hz > 0) ? t.tdoa_freq_hz.toFixed(1) + ' Hz' : '--'}</span>
                        </div>
                        <div class="trial-metric-item" style="border-top:1px solid rgba(56,189,248,0.25);">
                            <span class="t-m-label" style="color:var(--cyan);">Freq TWR</span>
                            <span class="t-m-val" style="color:var(--cyan); font-weight:700;">${t.sync_period_s === 0 ? '0.0 Hz' : ((t.twr_freq_hz && t.twr_freq_hz > 0) ? t.twr_freq_hz.toFixed(1) + ' Hz' : '--')}</span>
                        </div>
                        <div class="trial-metric-item" style="border-top:1px solid rgba(168,85,247,0.25);">
                            <span class="t-m-label" style="color:var(--purple);">Período Sync (k)</span>
                            <span class="t-m-val" style="color:var(--purple); font-weight:700;">${t.sync_period_s === 0 ? '0 s (Desativado)' : ((t.sync_period_s && t.sync_period_s > 0) ? (t.sync_period_s < 1 ? t.sync_period_ms + ' ms' : t.sync_period_s.toFixed(2) + ' s') : '--')}</span>
                        </div>
                    </div>

                    ${(t.links && t.links.length > 0) ? `
                        <div style="background:var(--bg-base); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:8px 10px; margin-bottom:12px;">
                            <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:4px;">Distâncias por Link / Módulo:</div>
                            ${t.links.map(l => {
                                const col = getLinkColor(l.link_label, l.src, l.dst);
                                return `
                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.03);">
                                    <span class="mono-cell" style="display:inline-flex; align-items:center; gap:6px; font-weight:600;"><span class="link-dot" style="background:${col.border};"></span><span>${escapeHtml(l.link_label)}:</span></span>
                                    <span class="mono-cell"><strong style="color:${col.border};">${l.mean_dist.toFixed(3)} m</strong> <span style="color:var(--text-muted); font-size:10px;">(±${l.std_mm.toFixed(1)} mm)</span></span>
                                </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>

                <div class="trial-card-footer">
                    ${integrityBadge}
                    <div style="display:flex; gap:6px; margin-left:auto;">
                        <button class="btn btn-outline-danger btn-sm" onclick="openClearLogsModal('trial', '${t.id}', event)" title="Eliminar este ensaio (.bin e .csv) permanentemente do disco" style="padding:5px 8px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="switchView('trial-detail', '${t.id}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20M13 5l7 7-7 7"/></svg>
                            Analisar Ensaio
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    updateComparisonBar();
}

function handleTrialCardClick(trialId, ev) {
    if (!ev) {
        switchView('trial-detail', trialId);
        return;
    }
    // Não navegar se o clique foi no checkbox ou no botão de apagar
    if (ev.target.closest('.trial-checkbox-wrapper') || 
        ev.target.closest('input[type="checkbox"]') || 
        ev.target.closest('.btn-outline-danger') ||
        ev.target.closest('button[onclick*="openClearLogsModal"]')) {
        return;
    }
    switchView('trial-detail', trialId);
}
window.handleTrialCardClick = handleTrialCardClick;

function toggleTrialSelection(trialId, ev) {
    if (ev) ev.stopPropagation();
    if (AppState.selectedForCompare.has(trialId)) {
        AppState.selectedForCompare.delete(trialId);
    } else {
        AppState.selectedForCompare.add(trialId);
    }
    
    const card = document.getElementById(`card-trial-${trialId}`);
    if (card) card.classList.toggle('selected', AppState.selectedForCompare.has(trialId));
    
    updateComparisonBar();
}

function updateComparisonBar() {
    const bar = document.getElementById('comparison-action-bar');
    const countEl = document.getElementById('comparison-count');
    const count = AppState.selectedForCompare.size;
    
    if (count > 0) {
        bar.classList.add('visible');
        countEl.textContent = count;
    } else {
        bar.classList.remove('visible');
    }
}

function clearTrialSelection() {
    AppState.selectedForCompare.clear();
    document.querySelectorAll('.trial-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.trial-card').forEach(c => c.classList.remove('selected'));
    updateComparisonBar();
}

function openComparisonFromSelection() {
    if (AppState.selectedForCompare.size < 2) {
        showToast('Selecione pelo menos 2 ensaios para comparação', 'warning');
        return;
    }
    switchView('comparison');
}
window.toggleTrialSelection = toggleTrialSelection;
window.clearTrialSelection = clearTrialSelection;
window.openComparisonFromSelection = openComparisonFromSelection;


// ==============================================================================
// 4. VISTA: DETALHE DO ENSAIO (TRIAL DETAIL)
// ==============================================================================

AppState.analysisFilter = {
    module_id: 'all',
    link_pair: 'all',
    direction: 'all',
    protocol: 'all',
    t_min_s: '',
    t_max_s: ''
};
AppState.fullTrialDetail = null;

async function openTrialDetail(trialId) {
    AppState.currentTrialId = trialId;
    setLoading(true);
    
    try {
        const resp = await fetch(`/api/trial/${encodeURIComponent(trialId)}`);
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        
        AppState.fullTrialDetail = data;
        AppState.activeTrialDetail = data;
        AppState.rawRecords = data.records || [];
        AppState.selectedTemporalLinks = new Set((data.groups || []).map(g => g.link_label));
        
        populateAnalysisFilterControls(data);
        renderTrialHeader(data);
        switchDetailTab(AppState.currentDetailTab);
    } catch (err) {
        console.error('Erro ao abrir ensaio:', err);
        showToast('Falha ao descarregar dados aprofundados do ensaio', 'error');
    } finally {
        setLoading(false);
    }
}

function populateAnalysisFilterControls(data) {
    const modSel = document.getElementById('analysis-filter-module');
    const pairSel = document.getElementById('analysis-filter-pair');
    const dirSel = document.getElementById('analysis-filter-direction');
    if (!modSel || !pairSel || !dirSel) return;

    const nodes = (data.trial_info && data.trial_info.nodes) ? data.trial_info.nodes : [];
    const groups = data.groups || [];

    modSel.innerHTML = `<option value="all">Todos os Módulos (${nodes.length || 'Todos'})</option>` +
        nodes.map(n => {
            const clean = String(n).replace(/^0x/i, '').padStart(4, '0');
            return `<option value="0x${clean}">Módulo 0x${clean}</option>`;
        }).join('');

    const pairSet = new Set();
    const dirSet = new Set();
    groups.forEach(g => {
        const s = String(g.src || '').replace(/^0x/i, '').padStart(4, '0');
        const d = String(g.dst || '').replace(/^0x/i, '').padStart(4, '0');
        if (s && d) {
            const sorted = [`0x${s}`, `0x${d}`].sort();
            pairSet.add(`${sorted[0]} <-> ${sorted[1]}`);
            dirSet.add(`0x${s} -> 0x${d}`);
        }
    });

    pairSel.innerHTML = `<option value="all">Todos os Pares (${pairSet.size || 'Todos'})</option>` +
        Array.from(pairSet).map(p => `<option value="${escapeHtml(p)}">Par ${escapeHtml(p.replace('<->', '↔'))}</option>`).join('');

    dirSel.innerHTML = `<option value="all">Todas as Direções (${dirSet.size || 'Todas'})</option>` +
        Array.from(dirSet).map(d => `<option value="${escapeHtml(d)}">Direção ${escapeHtml(d.replace('->', '→'))}</option>`).join('');

    // Reset filter UI
    AppState.analysisFilter = { module_id: 'all', link_pair: 'all', direction: 'all', protocol: 'all', t_min_s: '', t_max_s: '' };
    const protoSel = document.getElementById('analysis-filter-protocol');
    if (protoSel) protoSel.value = 'all';
    const tMinInput = document.getElementById('analysis-filter-tmin');
    const tMaxInput = document.getElementById('analysis-filter-tmax');
    if (tMinInput) tMinInput.value = '';
    if (tMaxInput) tMaxInput.value = '';
    updateAnalysisActiveFilterBanner(data.records ? data.records.length : 0, data.records ? data.records.length : 0);
}

async function applyAnalysisEntityFilters() {
    if (!AppState.currentTrialId) return;
    const modVal = document.getElementById('analysis-filter-module')?.value || 'all';
    const pairVal = document.getElementById('analysis-filter-pair')?.value || 'all';
    const dirVal = document.getElementById('analysis-filter-direction')?.value || 'all';
    const protoVal = document.getElementById('analysis-filter-protocol')?.value || 'all';
    const tMinVal = document.getElementById('analysis-filter-tmin')?.value || '';
    const tMaxVal = document.getElementById('analysis-filter-tmax')?.value || '';

    AppState.analysisFilter = {
        module_id: modVal,
        link_pair: pairVal,
        direction: dirVal,
        protocol: protoVal,
        t_min_s: tMinVal,
        t_max_s: tMaxVal
    };

    const params = new URLSearchParams();
    if (modVal !== 'all') params.set('module_id', modVal);
    if (pairVal !== 'all') params.set('link_pair', pairVal);
    if (dirVal !== 'all') params.set('direction', dirVal);
    if (protoVal !== 'all') params.set('protocol', protoVal);
    if (tMinVal !== '') params.set('t_min_s', tMinVal);
    if (tMaxVal !== '') params.set('t_max_s', tMaxVal);

    setLoading(true);
    try {
        const qs = params.toString();
        const url = `/api/trial/${encodeURIComponent(AppState.currentTrialId)}${qs ? '?' + qs : ''}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        AppState.activeTrialDetail = data;
        AppState.rawRecords = data.records || [];
        AppState.selectedTemporalLinks = new Set((data.groups || []).map(g => g.link_label));
        const totalUnfiltered = (AppState.fullTrialDetail && AppState.fullTrialDetail.records)
            ? AppState.fullTrialDetail.records.length
            : (data.filter_applied?.n_before_filter || AppState.rawRecords.length);
        updateAnalysisActiveFilterBanner(AppState.rawRecords.length, totalUnfiltered);
        renderTrialHeader(data);
        switchDetailTab(AppState.currentDetailTab);
    } catch (e) {
        console.error('Erro ao aplicar filtro científico:', e);
        showToast('Erro ao aplicar filtro científico ao ensaio', 'error');
    } finally {
        setLoading(false);
    }
}
window.applyAnalysisEntityFilters = applyAnalysisEntityFilters;

function resetAnalysisEntityFilters() {
    const modSel = document.getElementById('analysis-filter-module');
    const pairSel = document.getElementById('analysis-filter-pair');
    const dirSel = document.getElementById('analysis-filter-direction');
    const protoSel = document.getElementById('analysis-filter-protocol');
    const tMinInput = document.getElementById('analysis-filter-tmin');
    const tMaxInput = document.getElementById('analysis-filter-tmax');
    if (modSel) modSel.value = 'all';
    if (pairSel) pairSel.value = 'all';
    if (dirSel) dirSel.value = 'all';
    if (protoSel) protoSel.value = 'all';
    if (tMinInput) tMinInput.value = '';
    if (tMaxInput) tMaxInput.value = '';
    applyAnalysisEntityFilters();
}
window.resetAnalysisEntityFilters = resetAnalysisEntityFilters;

function updateAnalysisActiveFilterBanner(nFiltered, nTotal) {
    const banner = document.getElementById('analysis-active-filter-banner');
    if (!banner) return;
    const f = AppState.analysisFilter || {};
    const parts = [];
    if (f.module_id && f.module_id !== 'all') parts.push(`Módulo = ${f.module_id}`);
    if (f.link_pair && f.link_pair !== 'all') parts.push(`Par = ${f.link_pair.replace('<->', '↔')}`);
    if (f.direction && f.direction !== 'all') parts.push(`Direção = ${f.direction.replace('->', '→')}`);
    if (f.protocol && f.protocol !== 'all') parts.push(`Protocolo = ${f.protocol}`);
    if (f.t_min_s !== '' || f.t_max_s !== '') parts.push(`Intervalo t ∈ [${f.t_min_s || '0'} .. ${f.t_max_s || '∞'}] s`);

    if (parts.length === 0) {
        banner.innerHTML = `<strong>Filtro Ativo:</strong> Todos os módulos e links do ensaio (${nTotal} registos). Sem mistura de links em distribuições estatísticas.`;
    } else {
        banner.innerHTML = `<strong>Filtro Científico Ativo:</strong> <span style="color:var(--emerald); font-weight:700;">${escapeHtml(parts.join(' | '))}</span> — a mostrar <strong>${nFiltered}</strong> de ${nTotal} registos em todas as secções, gráficos, tabelas e exportação.`;
    }
}

function exportFilteredTrialCsv() {
    if (!AppState.currentTrialId) return;
    const f = AppState.analysisFilter || {};
    const params = new URLSearchParams({ format: 'csv' });
    if (f.module_id && f.module_id !== 'all') params.set('module_id', f.module_id);
    if (f.link_pair && f.link_pair !== 'all') params.set('link_pair', f.link_pair);
    if (f.direction && f.direction !== 'all') params.set('direction', f.direction);
    if (f.protocol && f.protocol !== 'all') params.set('protocol', f.protocol);
    if (f.t_min_s !== undefined && f.t_min_s !== '') params.set('t_min_s', f.t_min_s);
    if (f.t_max_s !== undefined && f.t_max_s !== '') params.set('t_max_s', f.t_max_s);
    window.open(`/api/export/${encodeURIComponent(AppState.currentTrialId)}?${params.toString()}`, '_blank');
}
window.exportFilteredTrialCsv = exportFilteredTrialCsv;

function renderTrialHeader(data) {
    const headerEl = document.getElementById('trial-persistent-header');
    if (!headerEl) return;
    
    const t = data.trial_info || {};
    const kpi = data.kpi || {};
    const notes = data.user_notes || {};
    
    const nodeBadges = (t.nodes || []).map(n => {
        const col = getNodeColor(n);
        return `<span class="node-pill" style="border-color:${col.border}; color:${col.border}; background:${col.bg};">0x${escapeHtml(n)}</span>`;
    }).join(' ');

    let refDistText = '';
    const refDists = notes.ref_distances || {};
    const linkEntries = Object.entries(refDists);
    if (linkEntries.length > 0) {
        refDistText = linkEntries.map(([nodeId, val]) => `<span class="badge badge-emerald">Ref 0x${escapeHtml(nodeId)}: ${parseFloat(val).toFixed(3)} m</span>`).join(' ');
    } else if (notes.ref_distance_m) {
        refDistText = `<span class="badge badge-emerald">Ref Nominal: ${parseFloat(notes.ref_distance_m).toFixed(3)} m</span>`;
    } else {
        refDistText = `<span class="badge badge-gray">Sem Ground-Truth Nominal</span>`;
    }

    headerEl.innerHTML = `
        <div class="tph-top-bar">
            <div class="tph-title-group">
                <button class="btn btn-outline btn-sm" onclick="switchView('catalog')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Catálogo
                </button>
                <div class="tph-trial-id">${escapeHtml(t.id)}</div>
                ${notes.title ? `<div class="tph-user-name">"${escapeHtml(notes.title)}"</div>` : ''}
                ${notes.campaign ? `<span class="trial-campaign-tag">${escapeHtml(notes.campaign)}</span>` : ''}
            </div>
            <div class="tph-actions">
                ${refDistText}
                <button class="btn btn-secondary btn-sm" onclick="exportTrialData('${t.id}', 'csv')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    Exportar CSV
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="openClearLogsModal('trial', '${t.id}')" title="Eliminar permanentemente este ensaio (.bin e .csv) do servidor">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Eliminar Ensaio
                </button>
            </div>
        </div>
        <div class="tph-metadata-strip">
            <div class="tph-meta-item">Data/Hora: <strong>${escapeHtml(t.time || t.id)}</strong></div>
            <div class="tph-meta-item">Nós: ${nodeBadges}</div>
            <div class="tph-meta-item">Métodos: <strong>${escapeHtml(t.ranging_methods?.join(', ') || 'DS-TWR')}</strong></div>
            <div class="tph-meta-item">Período Sync (k): <strong style="color:var(--purple);">${t.sync_period_s === 0 ? '0 s (Puro TWR Contínuo)' : ((t.sync_period_s && t.sync_period_s > 0) ? (t.sync_period_s < 1 ? t.sync_period_ms + ' ms (' + t.sync_period_s.toFixed(3) + ' s)' : t.sync_period_s.toFixed(2) + ' s (' + t.sync_period_ms + ' ms)') : 'N/A')}</strong></div>
            <div class="tph-meta-item">Amostras: <strong>${kpi.total_samples || 0}</strong></div>
            <div class="tph-meta-item">Sucesso: <strong>${kpi.success_rate || 0}%</strong></div>
            <div class="tph-meta-item">Duração: <strong>${(t.duration_s || 0).toFixed(1)} s</strong></div>
            <div class="tph-meta-item">Frequência: <strong>${(t.sample_rate_hz || 0).toFixed(1)} Hz</strong></div>
        </div>
    `;
}

function switchDetailTab(tabName) {
    AppState.currentDetailTab = tabName;
    
    document.querySelectorAll('.section-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabName);
    });
    
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.remove('active');
    });
    
    const target = document.getElementById(`tab-pane-${tabName}`);
    if (target) target.classList.add('active');
    
    if (!AppState.activeTrialDetail) return;
    
    // Renderizar conteúdo específico da aba ativa
    if (tabName === 'summary') renderTabSummary();
    else if (tabName === 'temporal') renderTabTemporal();
    else if (tabName === 'multilat-3d' && typeof window.renderTabMultilat3D === 'function') window.renderTabMultilat3D();
    else if (tabName === 'raw-data') renderTabRawData();
    else if (tabName === 'notes') renderTabNotes();
}

// ------------------------------------------------------------------------------
// ABA A: Resumo Experimental
// ------------------------------------------------------------------------------
function renderTabSummary() {
    const data = AppState.activeTrialDetail;
    const kpi = data.kpi || {};
    const t = data.trial_info || {};
    const notes = data.user_notes || {};
    const groups = data.groups || [];
    
    // KPIs executivos
    document.getElementById('sum-kpi-samples').textContent = (kpi.total_samples || 0).toLocaleString();
    document.getElementById('sum-kpi-success').textContent = `${kpi.success_rate || 0}%`;
    document.getElementById('sum-kpi-jitter').textContent = `± ${(kpi.mean_jitter_mm || 0).toFixed(1)} mm`;
    document.getElementById('sum-kpi-drift').textContent = `${(kpi.mean_drift_ppm || 0) > 0 ? '+' : ''}${(kpi.mean_drift_ppm || 0).toFixed(2)} ppm`;
    document.getElementById('sum-kpi-duration').textContent = `${(t.duration_s || 0).toFixed(1)} s`;
    document.getElementById('sum-kpi-rate').textContent = `${(t.sample_rate_hz || 0).toFixed(1)} Hz`;

    // Frequências segmentadas TDoA vs TWR
    const tdoaRateEl = document.getElementById('sum-kpi-tdoa-rate');
    const twrRateEl = document.getElementById('sum-kpi-twr-rate');
    if (tdoaRateEl) {
        const tdoaHz = kpi.tdoa_freq_hz || 0;
        const tdoaDt = kpi.tdoa_mean_dt_ms || (tdoaHz > 0 ? (1000.0 / tdoaHz).toFixed(1) : 0);
        tdoaRateEl.textContent = tdoaHz > 0 ? `${tdoaHz.toFixed(1)} Hz` : '-- Hz';
        const sub = document.getElementById('sum-kpi-tdoa-sub');
        if (sub && tdoaHz > 0) sub.textContent = `Δt ≈ ${tdoaDt} ms (Taxa Máx)`;
    }
    if (twrRateEl) {
        const twrHz = kpi.twr_freq_hz || 0;
        const twrDt = kpi.twr_mean_dt_ms || (twrHz > 0 ? (1000.0 / twrHz).toFixed(1) : 0);
        twrRateEl.textContent = twrHz > 0 ? `${twrHz.toFixed(1)} Hz` : '-- Hz';
        const sub = document.getElementById('sum-kpi-twr-sub');
        if (sub && twrHz > 0) sub.textContent = `Δt ≈ ${twrDt} ms (Sync DS-TWR)`;
    }
    
    const kSyncS = (t.sync_period_s !== undefined && t.sync_period_s !== null) ? t.sync_period_s : (kpi.sync_period_s !== undefined ? kpi.sync_period_s : 0.0);
    const kSyncMs = (t.sync_period_ms !== undefined && t.sync_period_ms !== null) ? t.sync_period_ms : (kpi.sync_period_ms || (kSyncS > 0 ? Math.round(kSyncS * 1000) : 0));
    const syncPeriodEl = document.getElementById('sum-kpi-sync-period');
    if (syncPeriodEl) {
        syncPeriodEl.textContent = kSyncS === 0 ? '0 s (Puro TWR Contínuo)' : (kSyncS > 0 ? (kSyncS < 1 ? `${kSyncMs} ms (${kSyncS.toFixed(3)}s)` : `${kSyncS.toFixed(2)} s (${kSyncMs} ms)`) : 'N/A');
    }
    
    // Alerta Científico
    const alertEl = document.getElementById('summary-scientific-alert');
    const refDists = notes.ref_distances || {};
    const linkEntries = Object.entries(refDists);
    if (linkEntries.length > 0) {
        alertEl.className = 'scientific-alert';
        alertEl.innerHTML = `
            <strong>Metrologia com Referências Nominais Configuradas por Nó:</strong><br>
            ${linkEntries.map(([nodeKey, refVal]) => {
                const g = groups.find(x => x.src.includes(nodeKey) || x.dst.includes(nodeKey));
                const dev = g ? (g.mean_dist - parseFloat(refVal)) * 1000 : null;
                return `• Nó 0x${escapeHtml(nodeKey)}: Ref Nominal = <strong>${parseFloat(refVal).toFixed(3)} m</strong> | Medido = <strong>${g ? g.mean_dist.toFixed(3) + ' m' : '--'}</strong> | Desvio Sistemático = <strong>${dev !== null ? (dev > 0 ? '+' : '') + dev.toFixed(1) + ' mm' : '--'}</strong>`;
            }).join('<br>')}
        `;
    } else if (notes.ref_distance_m) {
        alertEl.className = 'scientific-alert';
        alertEl.innerHTML = `<strong>Referência Nominal Global:</strong> ${parseFloat(notes.ref_distance_m).toFixed(3)} m configurada.`;
    } else {
        alertEl.className = 'scientific-alert scientific-alert-warning';
        alertEl.innerHTML = `
            <strong>Princípio de Rigor Científico:</strong> Cada link/módulo no enxame representa um vetor e uma distância física independente.
            As análises estatísticas e metrológicas são calculadas <strong>estritamente por link de rádio individual</strong>, evitando a criação de médias artificiais sem significado físico.
        `;
    }
    
    // Tabela de Grupos / Links com Proveniência e Modelos Físicos
    const groupsBody = document.getElementById('summary-links-table-body');
    if (groupsBody) {
        groupsBody.innerHTML = groups.map((g, idx) => {
            const col = getLinkColor(g.link_label, g.src, g.dst, idx);
            const isTdoa = g.protocol === 'TDoA' || (g.link_label && g.link_label.includes('TDoA'));
            const freqHz = g.freq_hz || 0;
            const rfHz = g.f_tx_estimated_hz || freqHz;
            const dtMs = g.mean_dt_ms || (freqHz > 0 ? 1000.0 / freqHz : 0);
            const freqBadge = freqHz > 0 
                ? `<span class="badge ${isTdoa ? 'badge-emerald' : 'badge-cyan'}" style="font-family:var(--font-mono); font-weight:700;">${freqHz.toFixed(1)} Hz</span> <span style="font-size:10px; color:var(--text-muted);">(RF: ${rfHz.toFixed(1)} Hz | Δt ≈ ${dtMs.toFixed(1)} ms)</span>`
                : '<span style="color:var(--text-muted); font-size:11px;">--</span>';

            const phyLabel = (g.physical_model && g.physical_model.model_label)
                ? g.physical_model.model_label
                : (isTdoa ? 'OWR Sync (ToF 1-via c/ Relógios Sincronizados)' : 'DS-TWR (3-Msg + Filtro Firmware)');
            const phyBadge = `<span class="prov-badge ${isTdoa ? 'prov-model' : 'prov-firmware'}" title="${escapeHtml(phyLabel)}">${isTdoa ? 'OWR Sync' : 'DS-TWR 3-Msg'}</span>`;

            const nInvalid = g.n_invalid !== undefined ? g.n_invalid : Math.max(0, (g.n_total || 0) - (g.n_ok || 0));
            const nLostRf = g.dropped_packets_rf || 0;

            const madMm = g.mad_mm !== undefined && g.mad_mm !== null ? g.mad_mm : 0;
            const iqrMm = g.iqr_mm !== undefined && g.iqr_mm !== null ? g.iqr_mm : 0;
            const dispHtml = `± ${g.std_mm.toFixed(1)} mm <span style="font-size:10px; color:var(--text-muted);">(MAD: ${madMm.toFixed(1)} | IQR: ${iqrMm.toFixed(1)} mm)</span>`;

            let gtHtml = '';
            if (g.has_ground_truth && g.ref_distance_m !== null && g.ref_distance_m !== undefined) {
                const bias = g.bias_mm !== null && g.bias_mm !== undefined ? `${g.bias_mm > 0 ? '+' : ''}${g.bias_mm.toFixed(1)} mm` : '--';
                const rmse = g.rmse_mm !== null && g.rmse_mm !== undefined ? `${g.rmse_mm.toFixed(1)} mm` : '--';
                gtHtml = `<span class="prov-badge prov-ref" title="Distância de referência configurada: ${Number(g.ref_distance_m).toFixed(3)} m">Ref ${Number(g.ref_distance_m).toFixed(3)}m</span> <span style="font-size:11px;">Viés: <strong>${bias}</strong> | RMSE: <strong>${rmse}</strong></span>`;
            } else {
                gtHtml = `<span style="color:var(--text-muted); font-size:10.5px;" title="Sem distância real de referência configurada. Apenas métricas de dispersão/estabilidade (σ, MAD, IQR) são válidas.">Não aplicável (Sem Ground-Truth)</span>`;
            }

            return `
                <tr>
                    <td class="mono-cell">${formatLinkBadge(g.link_label, g.src, g.dst, idx)}</td>
                    <td class="mono-cell">${phyBadge}</td>
                    <td class="mono-cell">${freqBadge}</td>
                    <td class="mono-cell">${g.n_total}</td>
                    <td class="mono-cell" style="color: ${g.success_rate > 95 ? 'var(--emerald)' : 'var(--amber)'};">${g.n_ok} (${g.success_rate}%) / ${nInvalid} inv / ${nLostRf} perd.</td>
                    <td class="mono-cell"><strong style="color:${col.border};">${g.mean_dist.toFixed(3)} m</strong> <span class="prov-badge prov-firmware" style="font-size:9px;">[Módulo]</span></td>
                    <td class="mono-cell">${dispHtml}</td>
                    <td class="mono-cell">${g.median_dist.toFixed(3)} m <span style="font-size:10px; color:var(--text-muted);">[${g.min_dist.toFixed(3)}..${g.max_dist.toFixed(3)}]</span></td>
                    <td class="mono-cell">${gtHtml}</td>
                    <td class="mono-cell">${g.mean_drift > 0 ? '+' : ''}${g.mean_drift.toFixed(2)} ppm</td>
                </tr>
            `;
        }).join('');
    }

    // Tabela Canónica das 5 Frequências do Sistema (Secção E)
    const freq5Body = document.getElementById('summary-5freq-table-body');
    if (freq5Body) {
        const fUartObs = t.sample_rate_hz || 0;
        const fTdoaRf = kpi.tdoa_freq_hz || 0;
        const fTwrSync = kpi.twr_freq_hz || (kSyncS > 0 ? (1.0 / kSyncS) : 0);
        // Estimar f_rf_event_hz global por link (média dos f_tx_estimated_hz dos links ativos)
        const linkRfRates = groups.map(g => g.f_tx_estimated_hz || g.freq_hz || 0).filter(v => v > 0);
        const fRfEvent = linkRfRates.length > 0
            ? (linkRfRates.reduce((a, b) => a + b, 0) / linkRfRates.length)
            : (fTdoaRf > 0 ? fTdoaRf : fUartObs);

        const rows5 = [
            {
                name: '1. Frequência de Eventos RF UWB (f_rf_event_hz)',
                val: fRfEvent > 0 ? `${fRfEvent.toFixed(2)} Hz` : 'Não aplicável (N < 2)',
                def: 'Taxa real de emissão de tramas UWB no ar, corrigida por pacotes RF perdidos (Δseq > 1).',
                formula: '(seq_N - seq_1) / ((t_N - t_1) · 10⁻⁶)',
                domain: 'Relógio Hardware Módulo (timestamp_ms / t_local_us + seq)',
                provClass: 'prov-app',
                provLabel: '[Calculado App]'
            },
            {
                name: '2. Frequência de Execução do Protocolo Sync DS-TWR (f_protocol_sync_hz)',
                val: kSyncS === 0 ? `${fTwrSync.toFixed(2)} Hz (Puro TWR Contínuo)` : (fTwrSync > 0 ? `${fTwrSync.toFixed(2)} Hz (k = ${kSyncS} s)` : '0.00 Hz'),
                def: 'Cadência de rondas completas de sincronização/ranging DS-TWR entre coordenador e nós.',
                formula: '1 / k_sync_s  ou  N_rondas_TWR / ΔT_s',
                domain: 'Relógio Protocolo UWB (Master Scheduling)',
                provClass: 'prov-app',
                provLabel: '[Calculado App]'
            },
            {
                name: '3. Frequência de Publicação UART / Registo (f_uart_tx_hz)',
                val: fUartObs > 0 ? `${fUartObs.toFixed(2)} Hz` : 'Não aplicável (N < 2)',
                def: 'Taxa de registos efetivamente gravados/publicados pelo módulo sem correção de perdas RF.',
                formula: '(N_recebidos - 1) / ((t_N - t_1) · 10⁻⁶)',
                domain: 'Relógio Local do Módulo (timestamp_ms / t_local_us)',
                provClass: 'prov-app',
                provLabel: '[Calculado App]'
            },
            {
                name: '4. Frequência de Receção no Computador Host (f_host_rx_hz)',
                val: 'Não aplicável em ensaio offline (Exclusivo Telemetria Live)',
                def: 'Taxa de chegada de pacotes à porta série virtual USB-CDC medida pelo sistema operativo do PC.',
                formula: '(N_rx - 1) / (t_rx_host_N - t_rx_host_1)',
                domain: 'Relógio do Computador Host (time.time() / epoch)',
                provClass: 'prov-missing',
                provLabel: '[Domínio PC Host]'
            },
            {
                name: '5. Taxa de Atualização Gráfica da Interface (f_ui_render_hz)',
                val: 'Estático (Análise Offline) / 4.0 Hz (Polling Live 250 ms)',
                def: 'Frequência de redesenho do canvas Chart.js e tabelas DOM no navegador.',
                formula: '1 / Δt_poll_ui (250 ms = 4.0 Hz)',
                domain: 'Relógio Browser (requestAnimationFrame / setInterval)',
                provClass: 'prov-app',
                provLabel: '[Interface Web]'
            }
        ];

        freq5Body.innerHTML = rows5.map(r => `
            <tr>
                <td class="mono-cell" style="font-weight:700; color:var(--text-main);">${escapeHtml(r.name)}</td>
                <td class="mono-cell" style="font-weight:700; color:var(--cyan);">${escapeHtml(r.val)}</td>
                <td style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(r.def)}</td>
                <td class="mono-cell" style="font-size:11px; color:var(--emerald);">${escapeHtml(r.formula)}</td>
                <td class="mono-cell" style="font-size:11px;">${escapeHtml(r.domain)}</td>
                <td><span class="prov-badge ${r.provClass}">${escapeHtml(r.provLabel)}</span></td>
            </tr>
        `).join('');
    }
}

// ------------------------------------------------------------------------------
// FUNÇÕES AUXILIARES METROLÓGICAS E DE GROUND-TRUTH POR LINK
// ------------------------------------------------------------------------------
function getLinkGroupRecords(g, records, isMatchFn = null) {
    if (g && Array.isArray(g.records) && g.records.length > 0) {
        return isMatchFn ? g.records.filter(isMatchFn) : g.records;
    }
    const targetLabel = g ? (g.link_label || '') : '';
    const baseTarget = g ? (g.base_label || (g.src && g.dst ? `${g.src} -> ${g.dst}` : '')) : '';
    const srcTarget = g ? g.src : null;
    const dstTarget = g ? g.dst : null;
    const protoTarget = g ? (g.protocol || '') : '';

    return (records || []).filter(r => {
        if (isMatchFn && !isMatchFn(r)) return false;
        const proto = (r.packet_type || r.protocol || (r.round_duration_us === 1 ? 'TDoA' : 'TWR')).toUpperCase();
        const fullLabel = `${r.src_addr} -> ${r.dst_addr} [${proto}]`;
        const baseLabel = `${r.src_addr} -> ${r.dst_addr}`;
        if (targetLabel && (fullLabel === targetLabel || baseLabel === targetLabel)) return true;
        if (baseTarget && baseLabel === baseTarget) {
            if (protoTarget && proto !== protoTarget.toUpperCase()) return false;
            return true;
        }
        if (srcTarget && dstTarget && r.src_addr === srcTarget && r.dst_addr === dstTarget) {
            if (protoTarget && proto !== protoTarget.toUpperCase()) return false;
            return true;
        }
        return false;
    });
}

function getRefDistanceForLink(linkLabel, src, dst, userNotes) {
    if (!userNotes) return null;
    const refDistances = userNotes.ref_distances || {};
    const cleanDst = (dst || '').replace(/^0x/i, '');
    const cleanSrc = (src || '').replace(/^0x/i, '');
    
    // 1. Verificar pelo nó escravo/destino
    if (refDistances[cleanDst] !== undefined && refDistances[cleanDst] !== null && refDistances[cleanDst] !== '') {
        return parseFloat(refDistances[cleanDst]);
    }
    // 2. Verificar pelo nó fonte (se não for o master 0001)
    if (refDistances[cleanSrc] !== undefined && refDistances[cleanSrc] !== null && cleanSrc !== '0001' && refDistances[cleanSrc] !== '') {
        return parseFloat(refDistances[cleanSrc]);
    }
    // 3. Fallback legado
    if (userNotes.ref_distance_m !== undefined && userNotes.ref_distance_m !== null && userNotes.ref_distance_m !== '') {
        return parseFloat(userNotes.ref_distance_m);
    }
    return null;
}

// ==============================================================================
// FUNÇÕES ESTATÍSTICAS E DISTRIBUIÇÕES CIENTÍFICAS
// ==============================================================================

/**
 * Aproximação analítica de Acklam para a função quantil normal inversa (normInv / probit).
 * Permite calcular quantis teóricos com precisão relativa de 10^-9 sem bibliotecas externas.
 */
function normInv(p) {
    if (p <= 0) return -8.0;
    if (p >= 1) return 8.0;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479808389902e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const p_low = 0.02425;
    const p_high = 1 - p_low;
    let q, r;
    if (p < p_low) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    if (p <= p_high) {
        q = p - 0.5;
        r = q * q;
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/**
 * Aproximação analítica de Abramowitz & Stegun para a função de erro erf(x)
 * Erro residual absoluto inferior a 1.5e-7.
 */
function erf(x) {
    const sign = (x >= 0) ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

/**
 * Função de Distribuição Cumulativa Teórica Normal Contínua Phi(x)
 */
function normCDF(x, mean, std) {
    if (std <= 1e-9) return x >= mean ? 1.0 : 0.0;
    const z = (x - mean) / (std * Math.SQRT2);
    return 0.5 * (1.0 + erf(z));
}

/**
 * Estimativa Não-Paramétrica de Densidade Contínua por Kernel Gaussiano (KDE)
 * Aplica a regra de largura de banda ótima de Silverman: h = 1.06 * min(s, IQR/1.34) * n^(-1/5)
 */
function calculateKDE(valids, stats, binWidth) {
    const n = valids.length;
    if (n === 0) return { h: 0.005 };
    let spread = stats.std;
    if (stats.iqr && stats.iqr > 0) {
        spread = Math.min(spread, stats.iqr / 1.34);
    }
    if (spread <= 1e-6) spread = stats.std > 1e-6 ? stats.std : 0.01;
    const h = Math.max(0.001, 1.06 * spread * Math.pow(n, -0.2));
    return { h };
}

function calculateLinkStats(recs, refM = null) {
    if (!recs || recs.length === 0) return null;
    const valids = recs.filter(r => r.status === 'OK' && r.distance_m !== null).map(r => r.distance_m);
    if (valids.length === 0) return null;
    return window.SciMetrics.computeDescriptiveStats(valids, refM);
}

// ------------------------------------------------------------------------------
// ABA B: Exploração Temporal (Diferenciação Cromática e Morfológica Completa)
// ------------------------------------------------------------------------------
// ==============================================================================
// OPERACOES NOS GRAFICOS: ZOOM, PAN, BOX ZOOM, EXPORTACAO E ESTATISTICAS
// ==============================================================================
function getZoomPluginOptions(isBoxDefault = false) {
    return {
        pan: {
            enabled: !isBoxDefault,
            mode: 'xy',
            modifierKey: null,
            threshold: 5
        },
        zoom: {
            wheel: {
                enabled: true,
                speed: 0.08
            },
            pinch: {
                enabled: true
            },
            drag: {
                enabled: isBoxDefault,
                backgroundColor: 'rgba(56, 189, 248, 0.22)',
                borderColor: '#38bdf8',
                borderWidth: 1.5
            },
            mode: 'xy'
        }
    };
}

function zoomChartById(canvasId, factor) {
    const chart = Chart.getChart(canvasId);
    if (chart && typeof chart.zoom === 'function') {
        chart.zoom(factor);
    }
}

function resetChartZoomById(canvasId) {
    const chart = Chart.getChart(canvasId);
    if (chart && typeof chart.resetZoom === 'function') {
        chart.resetZoom();
    }
}

function toggleDragBoxZoom(canvasId, btnId) {
    const chart = Chart.getChart(canvasId);
    if (!chart || !chart.options.plugins || !chart.options.plugins.zoom) return;
    const zoomOpts = chart.options.plugins.zoom;
    const isDrag = !zoomOpts.zoom.drag.enabled;
    zoomOpts.zoom.drag.enabled = isDrag;
    zoomOpts.pan.enabled = !isDrag;
    chart.update('none');
    
    const btn = document.getElementById(btnId);
    if (btn) {
        if (isDrag) {
            btn.innerHTML = '🔲 Box (Ativo)';
            btn.classList.add('active');
            btn.title = 'Modo Box Zoom ativo: clique e arraste para desenhar o retangulo de zoom';
        } else {
            btn.innerHTML = '🖐 Pan';
            btn.classList.remove('active');
            btn.title = 'Modo Pan ativo: clique e arraste para mover o grafico';
        }
    }
}

function exportChartPngById(canvasId, filename) {
    const chart = Chart.getChart(canvasId);
    if (!chart) return;
    const a = document.createElement('a');
    a.download = filename || `${canvasId}.png`;
    a.href = chart.toBase64Image();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ==============================================================================
// GRAFICO DE ANALISES TEMPORAIS & ESTUDIO CIENTIFICO (UnifiedUwbChart)
// ==============================================================================
function renderTabTemporal() {
    const data = AppState.activeTrialDetail;
    if (!data) return;
    const canvas = document.getElementById("analysis-chart");
    if (!canvas) return;

    if (window.UnifiedUwbChart) {
        if (!AppState.analysisChart) {
            AppState.analysisChart = new window.UnifiedUwbChart({
                canvasId: "analysis-chart",
                mode: "analysis",
                controlsContainerId: "analysis-chart-controls-panel",
                statsContainerId: "analysis-chart-stats-strip"
            });
            AppState.analysisChart.init();
        }
        AppState.analysisChart.setData(data.records || []);
    }
}

function renderCustomAxisChart() {
    renderTabTemporal();
}

// ------------------------------------------------------------------------------
// GESTÃO UNIFICADA DE ANÁLISES TEMPORAIS & HISTÓRICAS
// Nota: Os gráficos de histograma, dispersão e protocolo legados foram integrados
// e unificados a 100% no componente canónico 'UnifiedUwbChart' (renderTabTemporal).
// ------------------------------------------------------------------------------

// ABA E: Dados Crus (54 Bytes) e Tabela Paginada
// ------------------------------------------------------------------------------
function renderTabRawData() {
    updateRawDataTable();
}

function updateRawDataTable() {
    const tableBody = document.getElementById('raw-table-body');
    if (!tableBody) return;
    
    const search = AppState.rawFilter.search.toLowerCase().trim();
    const nodeF = AppState.rawFilter.node;
    const statusF = AppState.rawFilter.status;
    
    let filtered = AppState.rawRecords.filter(r => {
        if (search) {
            const matchSeq = String(r.seq).includes(search);
            const matchSrc = (r.src_addr || '').toLowerCase().includes(search);
            const matchDst = (r.dst_addr || '').toLowerCase().includes(search);
            if (!matchSeq && !matchSrc && !matchDst) return false;
        }
        if (nodeF !== 'all') {
            if (r.src_addr !== nodeF && r.dst_addr !== nodeF) return false;
        }
        if (statusF !== 'all') {
            if (r.status !== statusF) return false;
        }
        return true;
    });
    
    AppState.rawFilter.total = filtered.length;
    const totalPages = Math.ceil(filtered.length / AppState.rawFilter.pageSize) || 1;
    if (AppState.rawFilter.page > totalPages) AppState.rawFilter.page = totalPages;
    if (AppState.rawFilter.page < 1) AppState.rawFilter.page = 1;
    
    const startIdx = (AppState.rawFilter.page - 1) * AppState.rawFilter.pageSize;
    const endIdx = startIdx + AppState.rawFilter.pageSize;
    const pageRecords = filtered.slice(startIdx, endIdx);
    
    // Atualizar controlos de paginação
    document.getElementById('raw-page-info').textContent = `Página ${AppState.rawFilter.page} de ${totalPages} (${filtered.length} registos)`;
    document.getElementById('raw-prev-btn').disabled = AppState.rawFilter.page <= 1;
    document.getElementById('raw-next-btn').disabled = AppState.rawFilter.page >= totalPages;
    
    tableBody.innerHTML = pageRecords.map(r => {
        const isOk = r.status === 'OK';
        const statusBadge = isOk 
            ? `<span class="badge badge-emerald">OK</span>` 
            : `<span class="badge badge-red">FALHA (${r.error_code})</span>`;
            
        const distStr = r.distance_m !== null ? `<strong>${r.distance_m.toFixed(3)} m</strong>` : '<span style="color:var(--text-faint);">--</span>';
        const driftStr = r.clock_drift_ppm !== null ? `${r.clock_drift_ppm > 0 ? '+' : ''}${r.clock_drift_ppm.toFixed(2)}` : '--';

        return `
            <tr>
                <td class="mono-cell">${r.seq}</td>
                <td class="mono-cell">${r.timestamp_ms}</td>
                <td class="mono-cell"><span class="node-pill node-pill-slave">${escapeHtml(r.src_addr)}</span></td>
                <td class="mono-cell"><span class="node-pill node-pill-master">${escapeHtml(r.dst_addr)}</span></td>
                <td class="mono-cell">${distStr}</td>
                <td class="mono-cell">${r.round_duration_us} µs</td>
                <td class="mono-cell">${driftStr} ppm</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="inspectRawRecord(${r.seq})">
                        Inspecionar (54B)
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function onRawSearchChange(val) {
    AppState.rawFilter.search = val;
    AppState.rawFilter.page = 1;
    updateRawDataTable();
}

function onRawNodeFilterChange(val) {
    AppState.rawFilter.node = val;
    AppState.rawFilter.page = 1;
    updateRawDataTable();
}

function onRawStatusFilterChange(val) {
    AppState.rawFilter.status = val;
    AppState.rawFilter.page = 1;
    updateRawDataTable();
}

function onRawPageSizeChange(val) {
    AppState.rawFilter.pageSize = parseInt(val, 10);
    AppState.rawFilter.page = 1;
    updateRawDataTable();
}

function prevRawPage() {
    if (AppState.rawFilter.page > 1) {
        AppState.rawFilter.page--;
        updateRawDataTable();
    }
}

function nextRawPage() {
    const totalPages = Math.ceil(AppState.rawFilter.total / AppState.rawFilter.pageSize) || 1;
    if (AppState.rawFilter.page < totalPages) {
        AppState.rawFilter.page++;
        updateRawDataTable();
    }
}

// ------------------------------------------------------------------------------
// MODAL DE INSPEÇÃO BIT-A-BIT DE REGISTO 54B & TELEMETRIA LIVE COM PROVENIÊNCIA
// ------------------------------------------------------------------------------
function inspectRawRecord(seq) {
    const rec = AppState.rawRecords.find(r => r.seq === seq);
    if (!rec) return;
    
    const modal = document.getElementById('record-inspector-modal');
    const body = document.getElementById('inspector-modal-body');
    if (!modal || !body) return;
    
    const hasT16 = (rec.t1 && rec.t1 !== '0x0000000000') || (rec.t2 && rec.t2 !== '0x0000000000');
    const phyModel = rec.physical_model_label || (rec.protocol === 'TDoA' ? 'OWR Sync (ToF Unidirecional c/ Relógios Sincronizados)' : 'DS-TWR (3 Mensagens Simétrico)');

    body.innerHTML = `
        <div class="inspector-grid">
            <div class="inspector-section">
                <div class="inspector-section-title">1. Cabeçalho do Registo & Rota <span class="prov-badge prov-module">[Dados do Módulo]</span></div>
                <div class="inspector-row"><span class="inspector-row-label">N.º Sequência (seq):</span><span class="inspector-row-val">#${rec.seq}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Timestamp Local (MCU):</span><span class="inspector-row-val">${rec.timestamp_ms} ms (${rec.t_local_us !== undefined ? rec.t_local_us + ' µs' : '--'})</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Endereço Origem (src):</span><span class="inspector-row-val">${rec.src_addr}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Endereço Destino (dst):</span><span class="inspector-row-val">${rec.dst_addr}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Papel / Protocolo:</span><span class="inspector-row-val">${rec.role} / ${rec.protocol || 'DS-TWR'}</span></div>
            </div>
            
            <div class="inspector-section">
                <div class="inspector-section-title">2. Métricas de Distância & Modelo Físico</div>
                <div class="inspector-row"><span class="inspector-row-label">Modelo Físico Classificado:</span><span class="inspector-row-val"><span class="prov-badge prov-firmware">${escapeHtml(phyModel)}</span></span></div>
                <div class="inspector-row"><span class="inspector-row-label">Distância Publicada <span class="prov-badge prov-firmware">[Firmware]</span>:</span><span class="inspector-row-val" style="color:var(--cyan);font-weight:700;">${rec.distance_m !== null ? rec.distance_m.toFixed(4) + ' m (' + rec.distance_mm + ' mm)' : 'INVÁLIDO / FALHA'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Duração da Ronda:</span><span class="inspector-row-val">${rec.round_duration_us} µs</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Status da Transação:</span><span class="inspector-row-val">${rec.status} (Código: ${rec.error_code})</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Clock Drift / CFO <span class="prov-badge prov-module">[Módulo]</span>:</span><span class="inspector-row-val">${rec.clock_drift_ppm !== null && rec.clock_drift_ppm !== undefined ? rec.clock_drift_ppm + ' ppm' : '«Não fornecido pelo módulo»'}</span></div>
            </div>
        </div>
        
        <div class="inspector-section" style="margin-top:14px;">
            <div class="inspector-section-title">3. Timestamps DW3000 de 40 Bits (T1 .. T6) e ToF Independente da Aplicação</div>
            ${hasT16 ? `
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px;">
                    <div class="inspector-row"><span class="inspector-row-label">T1 (Poll TX):</span><span class="inspector-row-val">${rec.t1 || '0x0000000000'}</span></div>
                    <div class="inspector-row"><span class="inspector-row-label">T2 (Poll RX):</span><span class="inspector-row-val">${rec.t2 || '0x0000000000'}</span></div>
                    <div class="inspector-row"><span class="inspector-row-label">T3 (Resp TX):</span><span class="inspector-row-val">${rec.t3 || '0x0000000000'}</span></div>
                    <div class="inspector-row"><span class="inspector-row-label">T4 (Resp RX):</span><span class="inspector-row-val">${rec.t4 || '0x0000000000'}</span></div>
                    <div class="inspector-row"><span class="inspector-row-label">T5 (Final TX):</span><span class="inspector-row-val">${rec.t5 || '0x0000000000'}</span></div>
                    <div class="inspector-row"><span class="inspector-row-label">T6 (Final RX):</span><span class="inspector-row-val">${rec.t6 || '0x0000000000'}</span></div>
                </div>
            ` : `
                <div style="padding:8px 12px; margin-bottom:10px; background:rgba(148,163,184,0.08); border:1px dashed rgba(148,163,184,0.3); border-radius:4px; font-size:11.5px; color:var(--text-muted);">
                    <span class="prov-badge prov-missing">[Não Fornecido pelo Módulo]</span> Registo originado de telemetria textual UART ou beacon passivo OWR/TDoA sem despejo binário dos 6 registos de 40 bits (T1..T6).
                </div>
            `}
            
            <div class="inspector-grid">
                <div class="inspector-row"><span class="inspector-row-label">ToF SS-TWR <span class="prov-badge prov-app">[App]</span>:</span><span class="inspector-row-val">${rec.raw_tof_ss_m !== null && rec.raw_tof_ss_m !== undefined ? rec.raw_tof_ss_m.toFixed(4) + ' m' : '«Não fornecido pelo módulo (requer T1..T4)»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">ToF DS-TWR <span class="prov-badge prov-app">[App]</span>:</span><span class="inspector-row-val">${rec.raw_tof_ds_m !== null && rec.raw_tof_ds_m !== undefined ? rec.raw_tof_ds_m.toFixed(4) + ' m' : '«Não fornecido pelo módulo (requer T1..T6)»'}</span></div>
            </div>
        </div>
    `;
    
    modal.classList.add('active');
}

function inspectLiveRecord(msgId) {
    const pt = LiveState.historyBuffer.find(x => x.id === msgId) || LiveState.messages.find(x => x.id === msgId);
    if (!pt) return;
    const modal = document.getElementById('record-inspector-modal');
    const body = document.getElementById('inspector-modal-body');
    if (!modal || !body) return;

    const rawMsg = LiveState.messages.find(x => x.id === msgId) || pt;
    const p = rawMsg.parsed || pt;
    const prov = p.provenance || {};

    body.innerHTML = `
        <div class="inspector-grid">
            <div class="inspector-section">
                <div class="inspector-section-title">1. Identificação & Domínios Temporais</div>
                <div class="inspector-row"><span class="inspector-row-label">ID Mensagem Host / Porta:</span><span class="inspector-row-val">#${pt.id || '--'} (${escapeHtml(rawMsg.port || pt.port || 'UART')})</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Rota Direcional (src → dst):</span><span class="inspector-row-val">0x${escapeHtml(pt.src || p.src || '--')} → 0x${escapeHtml(pt.dst || p.dst || '--')} [${escapeHtml(p.mode || pt.type || 'UWB')}]</span></div>
                <div class="inspector-row"><span class="inspector-row-label">N.º Sequência RF (seq) <span class="prov-badge prov-module">[Módulo]</span>:</span><span class="inspector-row-val">${pt.seq !== null && pt.seq !== undefined ? '#' + pt.seq : '«Não fornecido pelo módulo»'} ${p.seq_anomaly && p.seq_anomaly !== 'OK' ? `<span class="badge badge-amber">${escapeHtml(p.seq_anomaly)}</span>` : ''}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Tempo Local Módulo (TL) <span class="prov-badge prov-module">[Módulo]</span>:</span><span class="inspector-row-val">${pt.t_local_us !== null && pt.t_local_us !== undefined ? pt.t_local_us + ' µs' : '«Não fornecido pelo módulo»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Tempo Global Sync (TG) <span class="prov-badge prov-model">[Modelo]</span>:</span><span class="inspector-row-val">${pt.t_global_us !== null && pt.t_global_us !== undefined ? pt.t_global_us + ' µs' : '«Não fornecido pelo módulo»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Receção Computador (Host RX) <span class="prov-badge prov-app">[Host PC]</span>:</span><span class="inspector-row-val">${escapeHtml(pt.time_full || rawMsg.time || '--')} (+${Number(pt.elapsed_s || 0).toFixed(3)} s)</span></div>
            </div>
            <div class="inspector-section">
                <div class="inspector-section-title">2. Grandezas Publicadas & Proveniência</div>
                <div class="inspector-row"><span class="inspector-row-label">Modelo Físico:</span><span class="inspector-row-val"><span class="prov-badge prov-firmware">${escapeHtml(p.physical_model_label || (p.mode === 'TDoA' ? 'OWR Sync (ToF 1-via)' : 'DS-TWR / SS-TWR'))}</span></span></div>
                <div class="inspector-row"><span class="inspector-row-label">Distância (dist_m) <span class="prov-badge ${p.mode === 'TDoA' ? 'prov-model' : 'prov-firmware'}">[${escapeHtml(prov.dist_m || 'Módulo')}]</span>:</span><span class="inspector-row-val" style="color:var(--cyan);font-weight:700;">${pt.dist_m !== null && pt.dist_m !== undefined ? Number(pt.dist_m).toFixed(4) + ' m' : '«Não fornecido pelo módulo»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">ToF / Δt (tof_ns) <span class="prov-badge prov-firmware">[Módulo]</span>:</span><span class="inspector-row-val">${pt.tdoa_diff !== null && pt.tdoa_diff !== undefined ? Number(pt.tdoa_diff).toFixed(3) + ' ns' : '«Não fornecido pelo módulo»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Deriva Relógio / CFO <span class="prov-badge prov-module">[Módulo]</span>:</span><span class="inspector-row-val">${pt.clock_drift_ppm !== null && pt.clock_drift_ppm !== undefined ? Number(pt.clock_drift_ppm).toFixed(3) + ' ppm' : '«Não fornecido pelo módulo»'}</span></div>
                <div class="inspector-row"><span class="inspector-row-label">Potência Prx / Fp <span class="prov-badge prov-missing">[CIR]</span>:</span><span class="inspector-row-val">${pt.prx_dbm !== null && pt.prx_dbm !== undefined ? pt.prx_dbm.toFixed(1) + ' dBm' : '«Não fornecido pelo módulo»'}</span></div>
            </div>
        </div>
        <div class="inspector-section" style="margin-top:12px;">
            <div class="inspector-section-title">3. Linha UART Original Recebida pelo Computador</div>
            <div style="font-family:var(--font-mono); font-size:11.5px; padding:8px 10px; background:#020617; border:1px solid var(--border-subtle); border-radius:4px; color:#38bdf8; word-break:break-all;">
                ${escapeHtml(rawMsg.text || JSON.stringify(pt))}
            </div>
        </div>
    `;
    modal.classList.add('active');
}
window.inspectLiveRecord = inspectLiveRecord;

function closeInspectorModal() {
    const modal = document.getElementById('record-inspector-modal');
    if (modal) modal.classList.remove('active');
}

function openProvenanceModal(focusMetric = null) {
    const modal = document.getElementById('provenance-inspector-modal');
    const body = document.getElementById('provenance-modal-body');
    if (!modal || !body) return;

    const catalog = (window.SciMetrics && window.SciMetrics.PROVENANCE_CATALOG) ? window.SciMetrics.PROVENANCE_CATALOG : {};
    const entries = Object.entries(catalog);

    const catBadgeMap = {
        module_data: { cls: 'prov-module', text: 'Dados do Módulo' },
        firmware_calc: { cls: 'prov-firmware', text: 'Calculado no Firmware' },
        app_calc: { cls: 'prov-app', text: 'Calculado pela Aplicação' },
        model_estimate: { cls: 'prov-model', text: 'Estimativa de Modelo' },
        reference_value: { cls: 'prov-ref', text: 'Valor de Referência' },
        missing_module_data: { cls: 'prov-missing', text: 'Não Fornecido pelo Módulo' }
    };

    body.innerHTML = `
        <div style="margin-bottom:12px; padding:10px 14px; background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.25); border-radius:var(--radius-sm); font-size:12px; color:var(--text-main); line-height:1.5;">
            <strong>Princípio Científico Fundamental:</strong> O SwarmLoc distingue explicitamente as observações publicadas pelos módulos UWB STM32/DW3000 dos valores calculados ou inferidos pela aplicação Python/JS. Campos ausentes na telemetria nunca são substituídos por zero nem por estimativas sintéticas.
        </div>
        <div class="table-responsive">
            <table class="scientific-table">
                <thead>
                    <tr>
                        <th>Grandeza / Campo</th>
                        <th>Categoria de Proveniência</th>
                        <th>Unidade</th>
                        <th>Fórmula Matemática / Método</th>
                        <th>Dados de Entrada</th>
                        <th>Pressupostos & Limitações</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(([key, item]) => {
                        const b = catBadgeMap[item.category] || { cls: 'prov-app', text: item.badge || item.category };
                        const isHighlight = (focusMetric && focusMetric === key);
                        return `
                            <tr style="${isHighlight ? 'background:rgba(56,189,248,0.14);' : ''}">
                                <td class="mono-cell"><strong>${escapeHtml(item.label || key)}</strong><br><span style="font-size:10px; color:var(--text-muted);">${escapeHtml(key)}</span></td>
                                <td><span class="prov-badge ${b.cls}">${escapeHtml(b.text)}</span></td>
                                <td class="mono-cell">${escapeHtml(item.unit || '--')}</td>
                                <td class="mono-cell" style="font-size:11px; color:var(--cyan);">${escapeHtml(item.formula || '--')}</td>
                                <td class="mono-cell" style="font-size:10.5px;">${escapeHtml((item.inputs || []).join(', '))}</td>
                                <td style="font-size:11px; color:var(--text-muted);">${escapeHtml(item.assumptions || '')} ${item.limitations ? '<br><em>Limitação: ' + escapeHtml(item.limitations) + '</em>' : ''}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    modal.classList.add('active');
}
window.openProvenanceModal = openProvenanceModal;

function closeProvenanceModal() {
    const modal = document.getElementById('provenance-inspector-modal');
    if (modal) modal.classList.remove('active');
}
window.closeProvenanceModal = closeProvenanceModal;




// ------------------------------------------------------------------------------
// ABA F: Notas e Contexto Experimental (com Ground-Truth por Nó/Link)
// ------------------------------------------------------------------------------
function renderTabNotes() {
    const data = AppState.activeTrialDetail;
    if (!data) return;
    const notes = data.user_notes || {};
    
    const titleEl = document.getElementById('note-trial-title');
    const campEl = document.getElementById('note-trial-campaign');
    const commEl = document.getElementById('note-trial-comments');
    if (titleEl) titleEl.value = notes.title || '';
    if (campEl) campEl.value = notes.campaign || '';
    if (commEl) commEl.value = notes.comments || '';
    
    // Distâncias nominais ground-truth por nó/link
    const container = document.getElementById('notes-ref-distances-container');
    if (container) {
        // Obter nós presentes no ensaio
        let nodes = (data.trial_info?.nodes || []).map(n => n.replace(/^0x/i, '')).filter(n => n !== '0001');
        if (nodes.length === 0) {
            const groupDsts = (data.groups || []).map(g => (g.dst || '').replace(/^0x/i, ''));
            nodes = [...new Set(groupDsts)].filter(n => n && n !== '0001');
        }
        
        const refDistances = notes.ref_distances || {};
        
        if (nodes.length > 0) {
            container.innerHTML = nodes.map(node => {
                const col = getNodeColor(node);
                const currentVal = (refDistances[node] !== undefined && refDistances[node] !== null)
                    ? refDistances[node] 
                    : (notes.ref_distance_m !== undefined && notes.ref_distance_m !== null ? notes.ref_distance_m : '');
                    
                return `
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; background:var(--bg-card); padding:10px 14px; border:1px solid var(--border-default); border-radius:var(--radius-sm);">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="node-pill" style="border-color:${col.border}; color:${col.border}; font-weight:700;">Nó 0x${escapeHtml(node)}</span>
                            <span style="font-size:12px; color:var(--text-muted);">Link Master (0x0001) ↔ Slave (0x${escapeHtml(node)})</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:12px; color:var(--text-main); font-weight:600;">Distância Nominal:</span>
                            <input type="number" step="0.001" class="input-text ref-node-input" data-node="${escapeHtml(node)}" value="${escapeHtml(String(currentVal))}" placeholder="Ex: 1.020" style="width:110px; text-align:right;">
                            <span style="font-size:12px; color:var(--text-muted);">metros</span>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="number" step="0.001" id="single-ref-dist-input" class="input-text" value="${escapeHtml(String(notes.ref_distance_m || ''))}" placeholder="Ex: 2.000" style="width:160px;">
                    <span style="font-size:12px; color:var(--text-muted);">metros</span>
                </div>
            `;
        }
    }
}
window.renderTabNotes = renderTabNotes;

async function saveTrialNotes() {
    if (!AppState.currentTrialId) return;
    
    const title = (document.getElementById('note-trial-title')?.value || '').trim();
    const campaign = (document.getElementById('note-trial-campaign')?.value || '').trim();
    const comments = (document.getElementById('note-trial-comments')?.value || '').trim();
    
    // Recolher distâncias nominais por nó
    const ref_distances = {};
    const nodeInputs = document.querySelectorAll('.ref-node-input');
    let firstRefM = null;
    
    nodeInputs.forEach(input => {
        const node = input.getAttribute('data-node');
        const valStr = input.value.trim();
        if (valStr !== '') {
            const val = parseFloat(valStr);
            if (!isNaN(val)) {
                ref_distances[node] = val;
                if (firstRefM === null) firstRefM = val;
            }
        }
    });
    
    const singleInput = document.getElementById('single-ref-dist-input');
    if (singleInput && singleInput.value.trim() !== '') {
        const val = parseFloat(singleInput.value.trim());
        if (!isNaN(val)) firstRefM = val;
    }
    
    setLoading(true);
    try {
        const resp = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trial_id: AppState.currentTrialId,
                title,
                campaign,
                ref_distance_m: firstRefM,
                ref_distances,
                comments
            })
        });
        
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        showToast('Metadados e distâncias de referência por nó guardados com sucesso!', 'success');
        
        // Recarregar dados do ensaio atual e catálogo
        await loadCatalog();
        await openTrialDetail(AppState.currentTrialId);
    } catch (err) {
        showToast('Erro ao guardar notas no servidor', 'error');
    } finally {
        setLoading(false);
    }
}
window.saveTrialNotes = saveTrialNotes;

// ==============================================================================
// 5. VISTA: COMPARAÇÃO MULTI-ENSAIO
// ==============================================================================

async function renderComparisonView() {
    const selectedIds = Array.from(AppState.selectedForCompare);
    const container = document.getElementById('comparison-results-area');
    const chipContainer = document.getElementById('comparison-chips-container');
    
    if (selectedIds.length === 0) {
        if (AppState.charts.compSeries) {
            AppState.charts.compSeries.destroy();
            AppState.charts.compSeries = null;
        }
        if (container) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-muted); background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg);">
                    <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Nenhum ensaio selecionado para comparação</div>
                    <div style="font-size: 12px; margin-bottom: 14px;">Volte ao Catálogo e ative as caixas de seleção dos ensaios que deseja comparar.</div>
                    <button class="btn btn-primary" onclick="switchView('catalog')">Ir para o Catálogo</button>
                </div>
            `;
        }
        if (chipContainer) chipContainer.innerHTML = '';
        return;
    }
    
    // Renderizar chips de ensaios selecionados
    if (chipContainer) {
        chipContainer.innerHTML = selectedIds.map(id => `
            <span class="comp-trial-chip">
                <span>Ensaio ${escapeHtml(id)}</span>
                <span class="comp-trial-remove" onclick="removeTrialFromCompare('${escapeHtml(id)}')">&times;</span>
            </span>
        `).join('') + `
            <button class="btn btn-outline btn-sm" onclick="clearTrialSelection(); renderComparisonView();">Limpar Todos</button>
        `;
    }
    
    setLoading(true);
    try {
        const resp = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trial_ids: selectedIds })
        });
        
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        
        renderComparisonContent(data);
    } catch (err) {
        showToast('Erro ao calcular comparação multi-ensaio', 'error');
    } finally {
        setLoading(false);
    }
}
window.renderComparisonView = renderComparisonView;

function removeTrialFromCompare(trialId) {
    AppState.selectedForCompare.delete(trialId);
    const cb = document.getElementById(`chk-${trialId}`);
    if (cb) cb.checked = false;
    const card = document.getElementById(`card-trial-${trialId}`);
    if (card) card.classList.remove('selected');
    updateComparisonBar();
    renderComparisonView();
}
window.removeTrialFromCompare = removeTrialFromCompare;

function renderComparisonContent(data) {
    const container = document.getElementById('comparison-results-area');
    if (!container) return;
    
    const trials = data.trials || [];
    
    // Tabela de Síntese Comparativa
    let tableRows = trials.map(t => {
        const k = t.kpi || {};
        let distDisplay = '--';
        if (k.mean_distance_m !== null && k.mean_distance_m !== undefined) {
            distDisplay = `<strong>${k.mean_distance_m.toFixed(3)} m</strong>`;
        } else if (t.links && t.links.length > 0) {
            distDisplay = t.links.map(l => `<span style="font-size:11px; white-space:nowrap;">${escapeHtml(l.link_label)}: <strong>${l.mean_dist.toFixed(3)}m</strong></span>`).join('<br>');
        }
        return `
            <tr>
                <td class="mono-cell"><strong>${escapeHtml(t.id)}</strong></td>
                <td>${escapeHtml(t.user_title || t.time || t.id)}</td>
                <td class="mono-cell">${(t.nodes || []).map(n => `0x${escapeHtml(n)}`).join(', ')}</td>
                <td class="mono-cell">${k.total_samples || 0}</td>
                <td class="mono-cell" style="color: ${k.success_rate > 95 ? 'var(--emerald)' : 'var(--amber)'};">${k.success_rate || 0}%</td>
                <td class="mono-cell">${distDisplay}</td>
                <td class="mono-cell">± ${(k.mean_jitter_mm || 0).toFixed(1)} mm</td>
                <td class="mono-cell">${(k.mean_drift_ppm || 0) > 0 ? '+' : ''}${(k.mean_drift_ppm || 0).toFixed(2)} ppm</td>
                <td class="mono-cell">${(t.duration_s || 0).toFixed(1)} s</td>
            </tr>
        `;
    }).join('');
    
    // Renderizar HTML dos resultados
    container.innerHTML = `
        <div class="section-card">
            <div class="section-card-header">
                <div class="section-card-title">1. Tabela de Síntese Comparativa de Desempenho</div>
            </div>
            <div class="table-responsive">
                <table class="scientific-table">
                    <thead>
                        <tr>
                            <th>ID do Ensaio</th>
                            <th>Designação / Campanha</th>
                            <th>Nós Envolvidos</th>
                            <th>Amostras</th>
                            <th>Sucesso</th>
                            <th>Dist Média (µ)</th>
                            <th>Jitter (1σ)</th>
                            <th>Drift Médio</th>
                            <th>Duração</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="section-card">
            <div class="section-card-header">
                <div class="section-card-title">2. Séries Temporais Sobrepostas (Alinhamento de Rondas)</div>
            </div>
            <div class="chart-canvas-wrapper" style="height: 340px;">
                <canvas id="chart-comparison-overlay"></canvas>
            </div>
        </div>
    `;
    
    // Gráfico de Séries Sobrepostas
    const ctxComp = document.getElementById('chart-comparison-overlay')?.getContext('2d');
    if (ctxComp && typeof Chart !== 'undefined') {
        if (AppState.charts.compSeries) AppState.charts.compSeries.destroy();
        
        const datasets = [];
        let colorIdx = 0;
        
        trials.forEach(t => {
            const groups = t.links || [];
            if (groups.length > 1) {
                groups.forEach(g => {
                    const col = getLinkColor(g.link_label, g.src, g.dst, colorIdx);
                    colorIdx++;
                    const linkRecs = (t.records || []).filter(r => `${r.src_addr} -> ${r.dst_addr}` === g.link_label && r.status === 'OK' && r.distance_m !== null);
                    if (linkRecs.length > 0) {
                        datasets.push({
                            label: `${col.pointIcon || '●'} Ensaio ${t.id} [${g.link_label}]`,
                            data: linkRecs.map(r => ({ x: r.seq, y: r.distance_m })),
                            borderColor: col.border,
                            backgroundColor: col.bg,
                            borderWidth: 2,
                            borderDash: col.dash,
                            pointStyle: col.pointStyle,
                            pointRadius: 4,
                            pointHoverRadius: 7,
                            showLine: true,
                            tension: 0.03
                        });
                    }
                });
            } else {
                const col = FALLBACK_LINK_PALETTE[colorIdx % FALLBACK_LINK_PALETTE.length];
                colorIdx++;
                const valid = (t.records || []).filter(r => r.status === 'OK' && r.distance_m !== null);
                datasets.push({
                    label: `${col.pointIcon || '●'} Ensaio ${t.id} (${t.user_title || t.time})`,
                    data: valid.map(r => ({ x: r.seq, y: r.distance_m })),
                    borderColor: col.border,
                    backgroundColor: col.bg,
                    borderWidth: 2,
                    pointStyle: col.pointStyle,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    showLine: true,
                    tension: 0.03
                });
            }
        });
        
        AppState.charts.compSeries = new Chart(ctxComp, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                scales: {
                    x: {
                        type: 'linear',
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        title: { display: true, text: 'N.º Sequência Relativo da Ronda', color: '#94a3b8' },
                        ticks: { color: '#cbd5e1' }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        title: { display: true, text: 'Distância Medida (m)', color: '#94a3b8' },
                        ticks: { color: '#cbd5e1' }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#e2e8f0',
                            usePointStyle: true,
                            boxWidth: 10,
                            padding: 12,
                            font: { size: 11, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: '#475569',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)} m`
                        }
                    }
                }
            }
        });
    }
}
window.renderComparisonContent = renderComparisonContent;

// 6. AQUISIÇÃO DIRETA DE MÓDULOS & CARREGAMENTO DE FICHEIROS
// ==============================================================================

async function detectModulePorts() {
    const pill = document.getElementById('module-detection-pill');
    if (pill) {
        pill.className = 'badge badge-amber';
        pill.textContent = 'A detetar portas...';
    }

    try {
        const resp = await fetch('/api/modules/ports');
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        const ports = data.ports || [];
        AppState.detectedPorts = ports;

        renderPortCheckboxes(ports);

        if (pill) {
            if (ports.length > 0) {
                pill.className = 'badge badge-emerald';
                const portNames = ports.map(p => p.device).join(', ');
                pill.textContent = `${ports.length} Módulo(s) Detetado(s): ${portNames}`;
            } else {
                pill.className = 'badge badge-amber';
                pill.textContent = 'Nenhum módulo USB/Serial detetado';
            }
        }
    } catch (err) {
        console.warn('Erro ao detetar portas série:', err);
        if (pill) {
            pill.className = 'badge badge-amber';
            pill.textContent = 'Deteção de portas indisponível';
        }
    }
}
window.detectModulePorts = detectModulePorts;

function renderPortCheckboxes(ports) {
    const container = document.getElementById('module-ports-checkboxes');
    if (!container) return;
    if (!ports || ports.length === 0) {
        container.innerHTML = `<span style="color:var(--text-muted); font-size:11px; font-style:italic;">Nenhum módulo USB/Serial detetado.</span>`;
        return;
    }

    let html = '';
    ports.forEach((p, idx) => {
        const dev = p.device;
        const role = (p.role || '').toLowerCase();
        const hint = (p.role_hint || '').toLowerCase();
        const isMaster = role === 'master' || hint.includes('master');
        const isSlave = role === 'slave' || hint.includes('slave');

        let badgeHtml = '';
        if (p.role_hint) {
            const badgeClass = isMaster ? 'badge-emerald' : (isSlave ? 'badge-cyan' : 'badge-slate');
            badgeHtml = ` <span class="badge ${badgeClass}" style="font-size:9px; padding:1px 5px; margin-left:4px;">${escapeHtml(p.role_hint)}</span>`;
        }

        // Por defeito, todos os módulos detetados vêm sempre selecionados para descarregar o enxame completo
        const isChecked = true;

        const selClass = isChecked ? 'selected' : '';
        html += `
            <label class="port-chip ${selClass}" id="chip-port-${escapeHtml(dev)}" onclick="togglePortChip('${escapeHtml(dev)}')">
                <input type="checkbox" id="chk-port-${escapeHtml(dev)}" value="${escapeHtml(dev)}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); syncPortChip('${escapeHtml(dev)}')">
                <span style="font-family:var(--font-mono); font-weight:600;">${escapeHtml(dev)}</span>${badgeHtml}
            </label>
        `;
    });
    container.innerHTML = html;
}

function syncPortChip(dev) {
    const chk = document.getElementById(`chk-port-${dev}`);
    const chip = document.getElementById(`chip-port-${dev}`);
    if (chk && chip) {
        if (chk.checked) chip.classList.add('selected');
        else chip.classList.remove('selected');
    }
}
window.syncPortChip = syncPortChip;

function togglePortChip(dev) {
    const chk = document.getElementById(`chk-port-${dev}`);
    if (chk) {
        chk.checked = !chk.checked;
        syncPortChip(dev);
    }
}
window.togglePortChip = togglePortChip;

function selectDownloadPreset(preset) {
    const checkboxes = document.querySelectorAll('#module-ports-checkboxes input[type="checkbox"]');
    const ports = AppState.detectedPorts || [];

    if (preset === 'pair' || preset === 'pair12') {
        let masterFound = false;
        let slaveFound = false;
        const selectedDevs = [];

        checkboxes.forEach((chk, idx) => {
            const dev = chk.value;
            const pInfo = ports.find(p => p.device === dev) || {};
            const role = (pInfo.role || '').toLowerCase();
            const hint = (pInfo.role_hint || '').toLowerCase();
            const isMaster = role === 'master' || hint.includes('master');
            const isSlave = role === 'slave' || hint.includes('slave');

            if (isMaster && !masterFound) {
                chk.checked = true;
                masterFound = true;
                selectedDevs.push(`${dev} (${pInfo.role_hint || 'Master'})`);
            } else if (isSlave && !slaveFound) {
                chk.checked = true;
                slaveFound = true;
                selectedDevs.push(`${dev} (${pInfo.role_hint || 'Slave'})`);
            } else {
                chk.checked = false;
            }
            syncPortChip(dev);
        });

        // Fallback genérico se os papéis ainda não foram identificados por texto
        if (selectedDevs.length < 2 && checkboxes.length >= 2) {
            checkboxes.forEach((chk, idx) => {
                chk.checked = (idx < 2);
                syncPortChip(chk.value);
            });
            showToast(`Selecionadas as duas primeiras portas: ${checkboxes[0].value} e ${checkboxes[1].value}`, 'info');
        } else if (selectedDevs.length > 0) {
            showToast(`Selecionado par ativo: ${selectedDevs.join(' + ')}`, 'info');
        }
    } else if (preset === 'all') {
        checkboxes.forEach(chk => {
            chk.checked = true;
            syncPortChip(chk.value);
        });
        showToast(`Selecionados todos os ${checkboxes.length} módulos detetados`, 'info');
    } else if (preset === 'slaves') {
        let count = 0;
        checkboxes.forEach(chk => {
            const dev = chk.value;
            const pInfo = ports.find(p => p.device === dev) || {};
            const role = (pInfo.role || '').toLowerCase();
            const hint = (pInfo.role_hint || '').toLowerCase();
            const isMaster = role === 'master' || hint.includes('master');
            chk.checked = !isMaster;
            if (chk.checked) count++;
            syncPortChip(dev);
        });
        showToast(`Selecionados ${count} nós escravos UWB`, 'info');
    } else if (preset === 'none') {
        checkboxes.forEach(chk => {
            chk.checked = false;
            syncPortChip(chk.value);
        });
        showToast('Nenhum módulo selecionado', 'info');
    }
}
window.selectDownloadPreset = selectDownloadPreset;

function openPortBusyModal(portName) {
    const modal = document.getElementById('port-busy-modal');
    const portEl = document.getElementById('busy-port-name');
    if (portEl) portEl.textContent = portName || 'COM';
    if (modal) modal.classList.add('active');
}
window.openPortBusyModal = openPortBusyModal;

function closePortBusyModal() {
    const modal = document.getElementById('port-busy-modal');
    if (modal) modal.classList.remove('active');
}
window.closePortBusyModal = closePortBusyModal;

async function confirmReleaseAndDownload() {
    closePortBusyModal();
    await downloadFromModules(true);
}
window.confirmReleaseAndDownload = confirmReleaseAndDownload;

async function downloadFromModules(forceRelease = false) {
    const btn = document.getElementById('btn-download-modules');
    const statusBox = document.getElementById('module-download-status');

    // Recolher portas selecionadas via checkboxes
    const checkedBoxes = document.querySelectorAll('#module-ports-checkboxes input[type="checkbox"]:checked');
    let selectedPorts = Array.from(checkedBoxes).map(c => c.value);

    // Fallback de segurança se não houver checkboxes renderizados
    if (selectedPorts.length === 0) {
        const select = document.getElementById('module-port-select');
        const selVal = select ? select.value : 'all';
        if (selVal === 'all') {
            selectedPorts = AppState.detectedPorts ? AppState.detectedPorts.map(p => p.device) : [];
        } else if (selVal) {
            selectedPorts = [selVal];
        }
    }

    if (selectedPorts.length === 0) {
        showToast('Selecione pelo menos um módulo/porta para descarregar.', 'warning');
        return;
    }

    const portSummary = selectedPorts.join(', ');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span style="display:inline-block; animation:spin 1s linear infinite; margin-right:4px;">⟳</span> ${forceRelease ? 'A libertar e descarregar...' : 'A descarregar...'}`;
    }
    if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.innerHTML = `<span style="color:var(--cyan);">${forceRelease ? 'A fechar ligação bloqueadora e a descarregar' : 'A solicitar despejo binário (' + escapeHtml(portSummary) + ')... Aguarde.'}</span>`;
    }

    try {
        const resp = await fetch('/api/modules/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ports: selectedPorts, baud: 115200, timeout: 20.0, force_release: forceRelease })
        });

        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();

        if (data.status === 'port_busy') {
            if (statusBox) {
                statusBox.innerHTML = `<span style="color:var(--amber); font-weight:600;">Porta série ${escapeHtml(data.busy_names || portSummary)} ocupada por outro processo. Confirmação solicitada...</span>`;
            }
            openPortBusyModal(data.busy_names || portSummary);
            return;
        }

        if (data.status === 'success') {
            const count = data.downloaded ? data.downloaded.length : 0;
            const summary = (data.downloaded || []).map(d => `${d.role} ${d.node_id} (${d.record_count} reg)`).join(', ');
            showToast(`Sucesso! ${count} módulo(s) descarregados: ${summary}`, 'success');

            if (statusBox) {
                statusBox.innerHTML = `
                    <span style="color:var(--emerald); font-weight:600;">
                        Download concluído com sucesso (${count} módulos): ${summary}. Guardado na pasta do ensaio e pronto para análise!
                    </span>
                `;
            }
            await loadCatalog();

            // Se foi criado um novo ensaio, abrir automaticamente o detalhe
            if (data.created_trial_id && AppState.catalog.some(t => t.id === data.created_trial_id)) {
                setTimeout(() => {
                    openTrialDetail(data.created_trial_id);
                }, 800);
            }
        } else {
            showToast(data.message || 'Nenhum ensaio recebido dos módulos.', 'warning');
            if (statusBox) {
                const errText = (data.errors && data.errors.length > 0) ? ` (${data.errors.join('; ')})` : '';
                statusBox.innerHTML = `<span style="color:var(--amber);">${data.message || 'Sem dados de ensaio nos módulos.'}${errText}</span>`;
            }
        }
    } catch (err) {
        console.error('Falha no download de módulos:', err);
        showToast('Erro de comunicação série durante o download dos módulos.', 'error');
        if (statusBox) {
            statusBox.innerHTML = `<span style="color:var(--red);">Erro de comunicação com os módulos via porta série.</span>`;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Descarregar Módulos Selecionados
            `;
        }
    }
}
window.downloadFromModules = downloadFromModules;

function triggerFileInput() {
    const fileInput = document.getElementById('catalog-file-input');
    if (fileInput) fileInput.click();
}
window.triggerFileInput = triggerFileInput;

function handleFileSelect(files) {
    if (files && files.length > 0) {
        handleFileUpload(files);
    }
}
window.handleFileSelect = handleFileSelect;

async function scanServerFiles() {
    setLoading(true);
    try {
        const resp = await fetch('/api/load_server_files', { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        showToast(`Servidor atualizado! ${data.new_files_found || 0} novos ficheiros indexados.`, 'info');
        await loadCatalog();
    } catch (err) {
        showToast('Erro ao re-escanear ficheiros no servidor', 'error');
    } finally {
        setLoading(false);
    }
}
window.scanServerFiles = scanServerFiles;

async function handleFileUpload(files) {
    const statusBox = document.getElementById('file-upload-status');
    const formData = new FormData();
    let count = 0;
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.name.endsWith('.bin') || f.name.endsWith('.csv')) {
            formData.append(`file_${i}`, f);
            count++;
        }
    }
    
    if (count === 0) {
        showToast('Nenhum ficheiro binário (.bin) ou tabular (.csv) válido selecionado.', 'warning');
        return;
    }
    
    setLoading(true);
    if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.innerHTML = `<span style="color:var(--cyan);">A carregar e a converter ${count} ficheiro(s)...</span>`;
    }

    try {
        const resp = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();
        
        showToast(`Sucesso! ${count} ficheiro(s) carregado(s) e indexado(s).`, 'success');
        if (statusBox) {
            statusBox.innerHTML = `<span style="color:var(--emerald); font-weight:600;">${count} ficheiro(s) carregado(s) com sucesso!</span>`;
        }
        await loadCatalog();
    } catch (err) {
        showToast('Erro durante o envio de ficheiros para o servidor', 'error');
        if (statusBox) {
            statusBox.innerHTML = `<span style="color:var(--red);">Erro no carregamento de ficheiros.</span>`;
        }
    } finally {
        setLoading(false);
    }
}
window.handleFileUpload = handleFileUpload;

function exportTrialData(trialId, format = 'csv') {
    window.open(`/api/export/${encodeURIComponent(trialId)}?format=${format}`, '_blank');
}

// ==============================================================================
// 6. GESTÃO E ELIMINAÇÃO DEFINITIVA DE LOGS (.bin e .csv)
// ==============================================================================

AppState.pendingDeletion = null;

async function openClearLogsModal(scope = 'all', trialId = null, event = null) {
    if (event) event.stopPropagation();

    AppState.pendingDeletion = { scope, trialId };
    const modal = document.getElementById('clear-logs-modal');
    if (!modal) return;

    const titleEl = document.getElementById('clear-modal-title');
    const descEl = document.getElementById('clear-modal-desc');
    const listEl = document.getElementById('clear-modal-files-list');
    const btnConfirm = document.getElementById('btn-confirm-delete-action');

    if (scope === 'all') {
        if (titleEl) titleEl.textContent = 'Limpar Todos os Logs do Servidor (.bin e .csv)';
        if (descEl) descEl.innerHTML = `Tem a certeza de que deseja eliminar <strong>todos os registos experimentais</strong>? Esta ação apagará permanentemente todos os ensaios, ficheiros binários brutos (<code style="color:var(--cyan);">.bin</code>) e tabelas convertidas (<code style="color:var(--emerald);">.csv</code>) armazenados no servidor.`;
    } else {
        if (titleEl) titleEl.textContent = `Eliminar Ensaio: ${escapeHtml(trialId)}`;
        if (descEl) descEl.innerHTML = `Tem a certeza de que deseja eliminar o ensaio <strong>"${escapeHtml(trialId)}"</strong>? Serão removidos permanentemente do disco do servidor todos os ficheiros binários (<code style="color:var(--cyan);">.bin</code>) e ficheiros convertidos (<code style="color:var(--emerald);">.csv</code>) associados a esta execução.`;
    }

    if (listEl) {
        listEl.innerHTML = '<span style="color:var(--text-muted); font-style:italic;">A verificar ficheiros no disco...</span>';
    }

    modal.classList.add('active');

    // Carregar pré-visualização real do backend
    try {
        const query = scope === 'trial' ? `scope=trial&trial_id=${encodeURIComponent(trialId)}` : 'scope=all';
        const resp = await fetch(`/api/logs/preview?${query}`);
        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const data = await resp.json();

        const files = data.files || [];
        if (files.length === 0) {
            if (listEl) listEl.innerHTML = '<span style="color:var(--text-muted);">Nenhum ficheiro correspondente encontrado no disco.</span>';
            if (btnConfirm) btnConfirm.disabled = true;
        } else {
            if (btnConfirm) btnConfirm.disabled = false;
            const totalKb = (data.total_bytes / 1024).toFixed(1);
            if (listEl) {
                listEl.innerHTML = `
                    <div style="margin-bottom:6px; color:var(--text-muted); font-size:10px;">
                        Total: <strong>${files.length} ficheiros</strong> (~${totalKb} KB)
                    </div>
                    ${files.map(f => {
                        const sizeKb = (f.bytes / 1024).toFixed(1);
                        const isBin = f.ext === '.bin';
                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.03);">
                                <span style="color:${isBin ? 'var(--cyan)' : 'var(--emerald)'};">
                                    <span class="badge ${isBin ? 'badge-cyan' : 'badge-emerald'}" style="font-size:9px; padding:1px 5px; margin-right:6px;">${isBin ? 'BIN' : 'CSV'}</span>
                                    ${escapeHtml(f.filename)}
                                </span>
                                <span style="color:var(--text-muted); font-size:10px;">${sizeKb} KB</span>
                            </div>
                        `;
                    }).join('')}
                `;
            }
        }
    } catch (err) {
        console.error('Erro na pré-visualização de ficheiros:', err);
        if (listEl) {
            listEl.innerHTML = '<span style="color:var(--red);">Erro ao obter lista de ficheiros do servidor.</span>';
        }
    }
}

function closeClearLogsModal() {
    const modal = document.getElementById('clear-logs-modal');
    if (modal) modal.classList.remove('active');
    AppState.pendingDeletion = null;
}

async function executeDeleteLogs() {
    if (!AppState.pendingDeletion) return;
    const { scope, trialId } = AppState.pendingDeletion;
    const btnConfirm = document.getElementById('btn-confirm-delete-action');

    if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = `<span style="display:inline-block; animation:spin 1s linear infinite;">⏳</span> A eliminar do disco...`;
    }

    try {
        const resp = await fetch('/api/logs/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, trial_id: trialId })
        });

        if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
        const result = await resp.json();

        closeClearLogsModal();

        const count = result.count || 0;
        const freedKb = ((result.freed_bytes || 0) / 1024).toFixed(1);
        showToast(`${count} ficheiro(s) (.bin e .csv) removidos do disco (~${freedKb} KB libertados)`, 'success');

        // Se estávamos a ver o ensaio que acabou de ser apagado, voltar ao catálogo
        if (scope === 'trial' && AppState.currentView === 'trial-detail' && AppState.currentTrialId === trialId) {
            switchView('catalog');
        } else if (scope === 'all') {
            switchView('catalog');
        }

        // Recarregar catálogo atualizado do servidor
        await loadCatalog();
    } catch (err) {
        console.error('Erro ao eliminar logs:', err);
        showToast('Falha ao eliminar ficheiros do disco do servidor', 'error');
    } finally {
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Confirmar Eliminação
            `;
        }
    }
}

// Exportações para o escopo global
window.openClearLogsModal = openClearLogsModal;
window.closeClearLogsModal = closeClearLogsModal;
window.executeDeleteLogs = executeDeleteLogs;

// ==============================================================================
// 7. UTILITÁRIOS (TOASTS, LOADING, SANITIZAÇÃO)
// ==============================================================================

function setLoading(isLoading) {
    const el = document.getElementById('global-loading-indicator');
    if (el) el.style.display = isLoading ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `badge badge-${type === 'error' ? 'red' : type === 'success' ? 'emerald' : type === 'warning' ? 'amber' : 'blue'}`;
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        padding: 10px 16px; font-size: 12px; box-shadow: var(--shadow-lg);
        animation: fadeIn 0.2s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Exportações globais para interação HTML/DOM
window.switchStatsHistMode = switchStatsHistMode;
window.switchStatsTool = switchStatsTool;
window.onDensityToggleChange = onDensityToggleChange;


window.zoomChartById = zoomChartById;
window.resetChartZoomById = resetChartZoomById;
window.toggleDragBoxZoom = toggleDragBoxZoom;
window.exportChartPngById = exportChartPngById;
window.renderTabTemporal = renderTabTemporal;

// ==============================================================================
// 12. TELEMETRIA EM TEMPO REAL & PAINEL DE CONTROLO UART
// ==============================================================================

const DEFAULT_LIVE_LINKS = [
    { key: '0001->0002', src: '0001', dst: '0002', label: '👑 M01 → S02', fullLabel: 'Módulo 1 → Módulo 2 [Direta 0.550m ±15mm]' },
    { key: '0002->0001', src: '0002', dst: '0001', label: '📡 S02 → M01', fullLabel: 'Módulo 2 → Módulo 1 [Direta 0.550m ±15mm]' },
    { key: '0001->0003', src: '0001', dst: '0003', label: '👑 M01 → S03', fullLabel: 'Módulo 1 → Módulo 3 [Direta 0.300m ±15mm]' },
    { key: '0003->0001', src: '0003', dst: '0001', label: '📡 S03 → M01', fullLabel: 'Módulo 3 → Módulo 1 [Direta 0.300m ±15mm]' },
    { key: '0001->0004', src: '0001', dst: '0004', label: '👑 M01 → S04', fullLabel: 'Módulo 1 → Módulo 4 [Direta 0.850m ±15mm]' },
    { key: '0004->0001', src: '0004', dst: '0001', label: '📡 S04 → M01', fullLabel: 'Módulo 4 → Módulo 1 [Direta 0.850m ±15mm]' },
    { key: '0002->0003', src: '0002', dst: '0003', label: '📡 S02 → S03', fullLabel: 'Módulo 2 → Módulo 3 [Derivada 0.250m ±30mm]' },
    { key: '0003->0002', src: '0003', dst: '0002', label: '📡 S03 → S02', fullLabel: 'Módulo 3 → Módulo 2 [Derivada 0.250m ±30mm]' },
    { key: '0002->0004', src: '0002', dst: '0004', label: '📡 S02 → S04', fullLabel: 'Módulo 2 → Módulo 4 [Derivada 0.300m ±30mm]' },
    { key: '0004->0002', src: '0004', dst: '0002', label: '📡 S04 → S02', fullLabel: 'Módulo 4 → Módulo 2 [Derivada 0.300m ±30mm]' },
    { key: '0003->0004', src: '0003', dst: '0004', label: '📡 S03 → S04', fullLabel: 'Módulo 3 → Módulo 4 [Derivada 0.550m ±30mm]' },
    { key: '0004->0003', src: '0004', dst: '0003', label: '📡 S04 → S03', fullLabel: 'Módulo 4 → Módulo 3 [Derivada 0.550m ±30mm]' },
    { key: '0001->0005', src: '0001', dst: '0005', label: '👑 M01 → S05', fullLabel: 'Módulo 1 → Módulo 5 [Direta]' },
    { key: '0005->0001', src: '0005', dst: '0001', label: '📡 S05 → M01', fullLabel: 'Módulo 5 → Módulo 1 [Direta]' },
    { key: '0001->0006', src: '0001', dst: '0006', label: '👑 M01 → S06', fullLabel: 'Módulo 1 → Módulo 6 [Direta]' },
    { key: '0006->0001', src: '0006', dst: '0001', label: '📡 S06 → M01', fullLabel: 'Módulo 6 → Módulo 1 [Direta]' }
];

const LiveState = {
    isConnected: false,
    pollInterval: null,
    lastId: 0,
    messages: [],
    nodes: {},
    activeFilter: 'all',
    activeNodeFilter: 'all',
    autoScroll: true,
    chart: null,
    chartDatasets: {},
    maxChartPoints: 60,
    bufferMode: 'window_1s',
    metric: 'dist_m',
    xAxisMode: 'elapsed_s',
    yScaleMode: 'auto',
    customYMin: 0,
    customYMax: 5,
    zeroBaseline: false,
    styleType: 'line_points',
    boxZoomEnabled: false,
    t0Epoch: null,
    t0_global_us: null,
    sampleCounter: 0,
    historyBuffer: [],
    channelBuffers: new Map(),
    lastPacketTimes: {},
    syncPeriod_s: 0.5,
    syncPeriod_ms: 500,
    tdoaFreqHz: 0.0,
    twrFreqHz: 0.0,
    consoleTimeFormat: 'both',
    detectedLinks: new Map(),
    activeLinks: new Set(['0002->0001', '0003->0001', '0004->0001', '0005->0001', '0006->0001', '0001->0002', '0001->0003', '0001->0004', '0001->0005', '0001->0006']),
    currentMasterId: null,
    prevMasterId: null,
    nextMasterId: null,
    masterConfirmed: false,
    lastMasterChangeEpoch: 0,
    lastMasterChangeReason: '',
    lastMasterSeenEpoch: 0,
    activeMasterSource: 'TELEMETRIA_UART'
};

DEFAULT_LIVE_LINKS.forEach(l => LiveState.detectedLinks.set(l.key, l));

function onLivePortSelectChange() {
    const sel = document.getElementById('live-port-select');
    const warn = document.getElementById('live-port-single-warning');
    if (!sel || !warn) return;
    if (sel.value && sel.value !== 'all') {
        warn.style.display = 'flex';
    } else {
        warn.style.display = 'none';
    }
}
window.onLivePortSelectChange = onLivePortSelectChange;

async function initLiveTelemetryView() {
    initLiveChart();
    renderLiveNodeCards(LiveState.nodes);
    renderLiveLinkChips();
    updateLivePortsDropdown();
    updateSyncPeriodBadges();
    updateLiveFrequencyBadges();

    // Iniciar polling regular de estado se ainda não estiver ativo (50ms para fluxo contínuo em tempo real)
    if (!LiveState.pollInterval) {
        LiveState.pollInterval = setInterval(pollLiveStatus, 50);
    }
    // Fazer uma chamada inicial imediata
    pollLiveStatus();
}

async function updateLivePortsDropdown() {
    try {
        const resp = await fetch('/api/modules/ports');
        const data = await resp.json();
        const ports = data.ports || [];

        const portSelect = document.getElementById('live-port-select');
        const cmdTargetSelect = document.getElementById('live-cmd-target');
        if (!portSelect || !cmdTargetSelect) return;

        const currentPortVal = portSelect.value;
        const currentTargetVal = cmdTargetSelect.value;

        let portOptions = '<option value="all">Todas as Portas Conectadas (Master + Slaves - Recomendado)</option>';
        let cmdOptions = '<option value="master">Destino: Master (0x0001)</option><option value="all">Destino: Todos os Módulos</option>';

        ports.forEach(p => {
            const roleStr = p.role ? ` (${p.role_hint || p.role})` : '';
            portOptions += `<option value="${p.device}">${p.device}${roleStr}</option>`;
            cmdOptions += `<option value="${p.device}">Porta ${p.device}${roleStr}</option>`;
        });

        portSelect.innerHTML = portOptions;
        cmdTargetSelect.innerHTML = cmdOptions;

        if (currentPortVal) portSelect.value = currentPortVal;
        if (currentTargetVal) cmdTargetSelect.value = currentTargetVal;
        onLivePortSelectChange();
    } catch (e) {
        console.error('Erro ao listar portas para telemetria:', e);
    }
}

async function toggleLiveConnection() {
    const btn = document.getElementById('btn-live-toggle');
    const btnText = document.getElementById('btn-live-toggle-text');
    const portSelect = document.getElementById('live-port-select');
    const baudSelect = document.getElementById('live-baud-select');

    if (!LiveState.isConnected) {
        const port = portSelect ? portSelect.value : 'all';
        const baud = baudSelect ? parseInt(baudSelect.value) : 115200;

        if (btnText) btnText.innerText = 'A conectar...';
        if (btn) btn.disabled = true;

        try {
            const resp = await fetch('/api/live/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ port: port, baud: baud })
            });
            const res = await resp.json();
            if (res.status === 'success') {
                LiveState.isConnected = true;
                showToast(`Telemetria conectada a ${res.connected_ports ? res.connected_ports.join(', ') : 'porta(s)'}!`);
                sendLiveCommand('l', 'all');
            } else {
                showToast(`Falha ao conectar: ${res.message || 'Erro de comunicação'}`);
            }
        } catch (e) {
            showToast(`Erro ao conectar telemetria: ${e.message}`);
        } finally {
            if (btn) btn.disabled = false;
            updateLiveConnectionUI();
        }
    } else {
        if (btnText) btnText.innerText = 'A desligar...';
        if (btn) btn.disabled = true;

        try {
            const resp = await fetch('/api/live/disconnect', { method: 'POST' });
            const res = await resp.json();
            LiveState.isConnected = false;
            showToast('Telemetria desconectada.');
        } catch (e) {
            showToast(`Erro ao desconectar: ${e.message}`);
        } finally {
            if (btn) btn.disabled = false;
            updateLiveConnectionUI();
        }
    }
}

function updateLiveConnectionUI() {
    const btn = document.getElementById('btn-live-toggle');
    const btnText = document.getElementById('btn-live-toggle-text');
    const badge = document.getElementById('nav-live-badge');

    if (LiveState.isConnected) {
        if (btn) {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-danger');
        }
        if (btnText) btnText.innerText = 'Desconectar';
        if (badge) {
            badge.innerText = '● AO VIVO';
            badge.className = 'live-pulse-badge online';
        }
    } else {
        if (btn) {
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-primary');
        }
        if (btnText) btnText.innerText = 'Conectar Telemetria';
        if (badge) {
            badge.innerText = 'OFFLINE';
            badge.className = 'live-pulse-badge offline';
        }
    }
}

let isLivePolling = false;
async function pollLiveStatus() {
    if (AppState.currentView !== 'live') return;
    if (isLivePolling) return;
    // CONGELAMENTO TOTAL DA PÁGINA NO INSTANTE T:
    // Se a página estiver em pausa, interrompe o polling. Nenhum elemento visual
    // (nós, tabelas, taxas, consola, gráficos) é modificado, permitindo estudar
    // rigorosamente todas as medições estáticas no mesmo instante exato.
    if (LiveState.isPaused || (LiveState.unifiedChart && LiveState.unifiedChart.isPaused)) {
        return;
    }
    isLivePolling = true;
    try {
        const resp = await fetch(`/api/live/status?since_id=${LiveState.lastId}`);
        if (!resp.ok) return;
        const data = await resp.json();

        // Sincronizar estado de conexão
        if (data.is_connected !== LiveState.isConnected) {
            LiveState.isConnected = data.is_connected;
            updateLiveConnectionUI();
        }

        // Sincronizar período/frequência de sincronismo ativo (k) e meta TDoA (f)
        let badgesNeedUpdate = false;
        if (data.sync_period_s !== undefined && data.sync_period_s !== null) {
            if (data.sync_period_s !== LiveState.syncPeriod_s || data.sync_period_ms !== LiveState.syncPeriod_ms) {
                LiveState.syncPeriod_s = data.sync_period_s;
                LiveState.syncPeriod_ms = data.sync_period_ms || Math.round(data.sync_period_s * 1000);
                badgesNeedUpdate = true;
            }
        }
        if (data.sync_freq_hz !== undefined && data.sync_freq_hz !== LiveState.syncFreq_hz) {
            LiveState.syncFreq_hz = data.sync_freq_hz;
            badgesNeedUpdate = true;
        }
        if (data.tdoa_target_freq_hz !== undefined && data.tdoa_target_freq_hz !== LiveState.tdoaTargetFreqHz) {
            LiveState.tdoaTargetFreqHz = data.tdoa_target_freq_hz;
            badgesNeedUpdate = true;
        }
        if (badgesNeedUpdate) {
            updateSyncPeriodBadges();
        }

        // Sincronizar frequências medidas de protocolo
        if (data.tdoa_freq_hz !== undefined && data.tdoa_freq_hz !== null) {
            LiveState.tdoaFreqHz = data.tdoa_freq_hz;
        }
        if (data.twr_freq_hz !== undefined && data.twr_freq_hz !== null) {
            LiveState.twrFreqHz = data.twr_freq_hz;
        }

        // Sincronizar estado da gravação de stream em tempo real
        if (data.recording !== undefined) {
            updateLiveRecordingUI(data.recording);
        }
        if (data.radio_phy_freq_hz !== undefined && data.radio_phy_freq_hz !== null) {
            LiveState.radioPhyFreqHz = data.radio_phy_freq_hz;
        }
        updateLiveFrequencyBadges();

        // 1. Processar metadados de Coordenação e Rotação do Master (E8.40) ANTES dos cartões
        const rot = data.master_rotation || data;
        const hasRotData = Boolean(rot && (rot.current_master_id !== undefined || rot.master_confirmed !== undefined || rot.active_master_source !== undefined));

        if (hasRotData) {
            LiveState.currentMasterId = rot.current_master_id || null;
            LiveState.prevMasterId = rot.prev_master_id || null;
            LiveState.nextMasterId = rot.next_master_id || null;
            LiveState.masterConfirmed = Boolean(rot.master_confirmed);
            let changeEpoch = rot.last_change_epoch || (rot.last_master_change_elapsed_s ? Date.now() - rot.last_master_change_elapsed_s * 1000 : 0);
            if (changeEpoch > 0 && changeEpoch < 1e11) changeEpoch *= 1000;
            LiveState.lastMasterChangeEpoch = changeEpoch;
            LiveState.lastMasterChangeReason = rot.last_change_reason || rot.last_master_change_reason || 'Inicialização do Protocolo Hardware';
            LiveState.lastMasterSeenEpoch = rot.last_master_seen_epoch || 0;
            LiveState.activeMasterSource = 'TELEMETRIA_UART';
        } else if (data.nodes) {
            // Fallback robusto se o backend ainda estiver a emitir formato legado
            const nodesArr = Object.values(data.nodes);
            const activeMaster = nodesArr.find(n => (n.role && n.role.toLowerCase() === 'master') || n.node_id === '0000' || n.node_id === '0001' || n.port === 'COM6');
            if (activeMaster && activeMaster.is_online) {
                LiveState.currentMasterId = String(activeMaster.node_id || '0001').replace(/^0x/i, '').padStart(4, '0');
                LiveState.masterConfirmed = true;
                LiveState.prevMasterId = null;
                LiveState.nextMasterId = '0002';
                LiveState.lastMasterChangeReason = 'Master Físico Ativo (COM6 / Beacons)';
                LiveState.activeMasterSource = 'TELEMETRIA_UART';
            } else if (LiveState.isConnected) {
                LiveState.currentMasterId = '0001';
                LiveState.masterConfirmed = true;
                LiveState.lastMasterChangeReason = 'Master Padrão SwarmLoc (COM6)';
                LiveState.activeMasterSource = 'TELEMETRIA_UART';
            }
        }

        updateLiveMasterRotationUI();

        if (data.nodes) {
            LiveState.nodes = data.nodes;
            renderLiveNodeCards(data.nodes);
        }

        // Se o servidor tiver reiniciado o buffer (last_id menor que lastId do cliente), ressincronizar imediatamente a 0
        if (data.last_id !== undefined && data.last_id < LiveState.lastId) {
            LiveState.lastId = 0;
            if (LiveState.unifiedChart) LiveState.unifiedChart.clearData();
        }

        if (data.messages && data.messages.length > 0) {
            LiveState.lastId = data.last_id || LiveState.lastId;
            appendLiveConsoleMessages(data.messages);
            updateLiveChartWithMessages(data.messages);
        }

        updateLiveIntegrityAndRates(data);
        renderLiveTelemetryTable(false);
        const nowSwarmMs = performance.now();
        if (!window._lastSwarmDynRenderMs || (nowSwarmMs - window._lastSwarmDynRenderMs) >= 200) {
            window._lastSwarmDynRenderMs = nowSwarmMs;
            renderSwarmDynamicTable(data);
            const live3dWrap = document.getElementById('live-multilat-3d-collapsible');
            if (live3dWrap && live3dWrap.style.display !== 'none' && window.LiveMultilat3D) {
                window.LiveMultilat3D.pollLive3D();
            }
        }
    } catch (e) {
        console.error('[pollLiveStatus] Erro na atualizacao:', e);
    } finally {
        isLivePolling = false;
    }
}

function updateLiveMasterRotationUI() {
    const crownBadge = document.getElementById('live-master-crown-badge');
    const crownIcon = document.getElementById('live-master-crown-icon');
    const crownText = document.getElementById('live-master-crown-text');
    const prevVal = document.getElementById('live-master-prev-val');
    const nextVal = document.getElementById('live-master-next-val');
    const lastTime = document.getElementById('live-master-last-time');
    const reasonText = document.getElementById('live-master-reason-text');
    const sourcePill = document.getElementById('live-master-source-pill');

    if (!crownBadge) return;

    const effectiveMasterId = LiveState.currentMasterId || (LiveState.isConnected ? '0001' : null);
    const hasMaster = Boolean(effectiveMasterId);

    if (hasMaster && effectiveMasterId) {
        crownBadge.style.color = '#facc15';
        if (crownIcon) crownIcon.textContent = '👑';
        if (crownText) crownText.innerHTML = `MASTER: <strong style="color:#ffffff;">0x${escapeHtml(effectiveMasterId)}</strong>`;
    } else {
        crownBadge.style.color = '#f87171';
        if (crownIcon) crownIcon.textContent = '⚠️';
        if (crownText) crownText.textContent = 'Sem master';
    }

    if (prevVal) {
        prevVal.textContent = LiveState.prevMasterId ? `0x${LiveState.prevMasterId}` : '--';
    }
    if (nextVal) {
        nextVal.textContent = LiveState.nextMasterId ? `0x${LiveState.nextMasterId}` : '--';
    }
    if (lastTime) {
        if (LiveState.lastMasterChangeEpoch && LiveState.lastMasterChangeEpoch > 0) {
            let epochMs = LiveState.lastMasterChangeEpoch;
            if (epochMs < 1e11) epochMs *= 1000;
            const ageSec = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
            if (ageSec < 5) {
                lastTime.textContent = 'Agora mesmo';
            } else if (ageSec < 60) {
                lastTime.textContent = `há ${ageSec}s`;
            } else if (ageSec < 3600) {
                const m = Math.floor(ageSec / 60);
                const s = ageSec % 60;
                lastTime.textContent = `há ${m}m ${s}s`;
            } else {
                lastTime.textContent = 'Em regime';
            }
        } else {
            lastTime.textContent = 'Em regime';
        }
    }
    if (reasonText) {
        reasonText.textContent = LiveState.lastMasterChangeReason || 'Inicialização do Protocolo Hardware';
    }

    if (sourcePill) {
        sourcePill.className = 'badge';
        sourcePill.style.background = 'rgba(16, 185, 129, 0.15)';
        sourcePill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        sourcePill.style.color = '#34d399';
        sourcePill.innerHTML = '<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981;"></span> 📡 Telemetria UART Real';
        sourcePill.title = 'Aquisição direta e exclusiva das portas série UART dos rádios físicos DW3000';
    }
}

window.updateLiveMasterRotationUI = updateLiveMasterRotationUI;

function renderLiveNodeCards(nodes) {
    const container = document.getElementById('live-nodes-container');
    if (!container) return;

    // Filtrar estritamente os 6 nós legítimos do enxame SwarmLoc (0001 a 0006), eliminando nós fantasmas
    const validNodeKeys = Object.keys(nodes).filter(nid => {
        const clean = nid.replace(/^0x/i, '').trim().padStart(4, '0');
        if (clean === '0000' && nodes['0001']) return false;
        return ['0001', '0002', '0003', '0004', '0005', '0006'].includes(clean);
    });

    // Ordenação estrita e invariante solicitada: sempre 1..6 (0x0001 a 0x0006)
    // independentemente de qual nó seja o Master ou das transições de liderança
    const canonicalOrder = ['0001', '0002', '0003', '0004', '0005', '0006'];
    const sortedKeys = validNodeKeys.sort((a, b) => {
        const cleanA = a.replace(/^0x/i, '').trim().padStart(4, '0');
        const cleanB = b.replace(/^0x/i, '').trim().padStart(4, '0');
        const idxA = canonicalOrder.indexOf(cleanA);
        const idxB = canonicalOrder.indexOf(cleanB);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return cleanA.localeCompare(cleanB);
    });

    if (sortedKeys.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; grid-column:1/-1;">A aguardar deteção de nós...</div>';
        return;
    }

    let html = '';
    sortedKeys.forEach(nid => {
        const n = nodes[nid];
        const cleanNid = String(n.node_id || nid || '').replace(/^0x/i, '').padStart(4, '0');
        // Identificação rigorosa do Master físico:
        const isPhysicalMaster = Boolean(cleanNid === '0000' || cleanNid === '0001' || n.port === 'COM6' || (n.role && n.role.toLowerCase() === 'master'));
        const isConfirmedMaster = Boolean(
            (LiveState.masterConfirmed && LiveState.currentMasterId)
                ? (cleanNid === String(LiveState.currentMasterId).replace(/^0x/i, '').padStart(4, '0'))
                : (n.role && n.role.toLowerCase() === 'master' ? true : (cleanNid === '0001' || cleanNid === '0000'))
        );
        const isDesignatedNext = Boolean(LiveState.nextMasterId && cleanNid === LiveState.nextMasterId && !isConfirmedMaster);
        const isMaster = isConfirmedMaster;
        const cardClass = isConfirmedMaster ? 'master-card' : 'slave-card';
        const isOnline = Boolean(n.is_online);

        // Estado de comunicação observável (nunca afirma estado elétrico se apenas a porta série/UART está sem pacotes)
        const commCode = n.comm_state_code || (!LiveState.isConnected ? 'SERIAL_DISCONNECTED' : (isOnline ? 'ACTIVE_RX' : ((n.packet_count || 0) > 0 ? 'STALE_RX' : 'NO_SESSION_DATA')));
        const commLabel = n.comm_state_label || (
            commCode === 'ACTIVE_RX' ? 'Receção ativa' :
            commCode === 'STALE_RX' ? 'Sem dados recentes' :
            commCode === 'COMM_INTERRUPTED' ? 'Comunicação interrompida' :
            commCode === 'SERIAL_DISCONNECTED' ? 'Porta série desconectada' : 'Sem dados na sessão'
        );
        const statusBadge = isOnline 
            ? `<span class="live-status-indicator online" style="white-space:nowrap !important; font-size:10px; padding:2px 6px;" title="Estado observável na porta UART">● ${escapeHtml(commLabel)}</span>`
            : `<span class="live-status-indicator offline" style="white-space:nowrap !important; font-size:10px; padding:2px 6px;" title="Estado observável na porta UART">○ ${escapeHtml(commLabel)}</span>`;

        const portBadge = n.port ? `<span style="font-family:var(--font-mono); font-size:10.5px; color:var(--cyan); white-space:nowrap;">${n.port}</span>` : '<span style="color:var(--text-faint); font-size:10px; white-space:nowrap;">UART</span>';
        const dtStr = (n.dt_sec !== null && n.dt_sec !== undefined) ? `Δt=${n.dt_sec}s` : 'Sem receção';

        let distDisplay = '--';
        if (isMaster) {
            distDisplay = 'Hub Coordenador';
        } else if (n.last_dist_m !== null && n.last_dist_m !== undefined) {
            distDisplay = `${parseFloat(n.last_dist_m).toFixed(4)} m`;
        }

        let tdoaDisplay = '--';
        if (isMaster) {
            tdoaDisplay = 'Relógio Base (0 ns)';
        } else if (n.last_tdoa !== null && n.last_tdoa !== undefined) {
            const v = parseFloat(n.last_tdoa);
            tdoaDisplay = Math.abs(v) < 1000 ? `${v >= 0 ? '+' : ''}${v.toFixed(3)} ns` : `${v.toFixed(0)} ticks`;
        } else if (n.last_dist_m !== null && n.last_dist_m !== undefined) {
            const tof_ns = parseFloat(n.last_dist_m) / 0.299702547;
            tdoaDisplay = `+${tof_ns.toFixed(3)} ns (ToF)`;
        }

        let driftDisplay = '--';
        if (isMaster) {
            driftDisplay = '0.00 ppm (Base)';
        } else if (n.clock_drift_ppm !== null && n.clock_drift_ppm !== undefined) {
            const d = parseFloat(n.clock_drift_ppm);
            if (!isNaN(d) && Math.abs(d) <= 50.0) {
                driftDisplay = `${d >= 0 ? '+' : ''}${d.toFixed(3)} ppm`;
            }
        }

        let tgDisplay = '--';
        if (n.t_global_us !== null && n.t_global_us !== undefined) {
            const tg_us = parseInt(n.t_global_us, 10);
            const tg_s = (tg_us / 1000000.0).toFixed(6);
            const tg_ns = (BigInt(tg_us) * 1000n).toString();
            tgDisplay = `${tg_ns} ns ~= ${tg_s} s${isMaster ? ' (Base)' : ''}`;
        }

        let errorDisplay = '--';
        if (isMaster) {
            errorDisplay = '<span style="color:#38bdf8; font-weight:700;">0.0 cm</span> <span style="color:#94a3b8; font-size:10px;">(Relógio Base)</span>';
        } else if (n.real_error_m !== null && n.real_error_m !== undefined) {
            const errM = parseFloat(n.real_error_m);
            let errStr = '';
            if (Math.abs(errM) >= 1.0) {
                errStr = `${errM >= 0 ? '+' : ''}${errM.toFixed(3)} m`;
            } else if (Math.abs(errM) >= 0.01) {
                errStr = `${errM >= 0 ? '+' : ''}${(errM * 100.0).toFixed(1)} cm`;
            } else {
                errStr = `${errM >= 0 ? '+' : ''}${(errM * 1000.0).toFixed(1)} mm`;
            }

            let rateStr = '';
            if (n.real_error_rate_mps !== null && n.real_error_rate_mps !== undefined) {
                const rate = parseFloat(n.real_error_rate_mps);
                if (Math.abs(rate) >= 1.0) {
                    rateStr = `${rate >= 0 ? '+' : ''}${rate.toFixed(2)} m/s`;
                } else if (Math.abs(rate) >= 0.01) {
                    rateStr = `${rate >= 0 ? '+' : ''}${(rate * 100.0).toFixed(1)} cm/s`;
                } else {
                    rateStr = `${rate >= 0 ? '+' : ''}${(rate * 1000.0).toFixed(1)} mm/s`;
                }
            }

            const ageStr = (n.sync_elapsed_ms !== null && n.sync_elapsed_ms !== undefined) ? ` | ha ${n.sync_elapsed_ms} ms` : '';
            const ratePart = rateStr ? ` (Taxa: ${rateStr}${ageStr})` : (ageStr ? ` (${ageStr.replace(' | ', '')})` : '');
            const errColor = Math.abs(errM) < 0.05 ? '#34d399' : (Math.abs(errM) < 0.20 ? '#fbbf24' : '#f87171');
            errorDisplay = `<span style="color:${errColor}; font-weight:700;">${errStr}</span><span style="color:#94a3b8; font-size:10px;">${escapeHtml(ratePart)}</span>`;
        } else if (isOnline) {
            errorDisplay = '<span style="color:#94a3b8; font-style:italic; font-size:10.5px;">A aguardar calibração TWR...</span>';
        }

        const effectiveKS = (n.sync_period_s !== undefined && n.sync_period_s !== null) ? n.sync_period_s : LiveState.syncPeriod_s;
        const effectiveKMs = (n.sync_period_ms !== undefined && n.sync_period_ms !== null) ? n.sync_period_ms : LiveState.syncPeriod_ms;
        const isSyncDisabled = (effectiveKS === 0 || LiveState.syncPeriod_s === 0);

        const isTwr = isSyncDisabled || (n.mode && (n.mode.includes('TWR') || n.mode.includes('Ranging')));
        const modeBadge = isTwr 
            ? '<span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:3px; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.35); color:#34d399; white-space:nowrap;">DS-TWR</span>'
            : '<span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:3px; background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.35); color:#c084fc; white-space:nowrap;">OWR Sync</span>';

        let nodeHeaderHtml = '';
        if (isConfirmedMaster) {
            nodeHeaderHtml = `<span style="font-weight:800; font-size:13.5px; font-family:var(--font-mono); color:#facc15; white-space:nowrap;">👑 0x${cleanNid}</span>`;
        } else if (isDesignatedNext) {
            nodeHeaderHtml = `<span style="font-weight:800; font-size:13.5px; font-family:var(--font-mono); color:var(--text-main); white-space:nowrap;">📡 0x${cleanNid} <span style="color:#38bdf8; font-weight:700; font-size:12px;" title="Sucessor Designado ao Papel de Master">→ ⏳👑</span></span>`;
        } else {
            nodeHeaderHtml = `<span style="font-weight:800; font-size:13px; font-family:var(--font-mono); color:var(--text-main); white-space:nowrap;">📡 0x${cleanNid}</span>`;
        }

        const kDisplay = isSyncDisabled
            ? '0 s (Puro TWR)'
            : (effectiveKS < 1 ? `${effectiveKMs} ms` : `${effectiveKS.toFixed(2)} s`);

        // Taxas Reais de Hardware Fidedignas (Sem Fórmulas Estáticas nem Limitações de 10 Hz)
        let realPhyTdoaHz = (n.f_rf_event_hz && n.f_rf_event_hz > 0) ? n.f_rf_event_hz : ((n.tdoa_freq_hz && n.tdoa_freq_hz > 0) ? n.tdoa_freq_hz : (LiveState.radioPhyFreqHz || null));
        if (realPhyTdoaHz && realPhyTdoaHz > 2500.0) realPhyTdoaHz = 2500.0;
        const masterTdoaDisplay = realPhyTdoaHz ? `${realPhyTdoaHz.toFixed(1)} Hz` : (LiveState.radioPhyFreqHz > 0 ? `${LiveState.radioPhyFreqHz.toFixed(1)} Hz` : '-- Hz');

        const tdoaFreqDisplay = isSyncDisabled
            ? '0.0 Hz (Desat.)'
            : (isOnline ? masterTdoaDisplay : '-- Hz');

        const realTwrHz = (n.twr_freq_hz && n.twr_freq_hz > 0) ? n.twr_freq_hz : ((LiveState.twrFreqHz && LiveState.twrFreqHz > 0) ? LiveState.twrFreqHz : (LiveState.radioPhyFreqHz || 150.0));
        const twrFreqDisplay = isSyncDisabled
            ? (isOnline ? (realTwrHz ? `${realTwrHz.toFixed(1)} Hz (Puro TWR)` : '150.0 Hz (Puro TWR)') : '-- Hz')
            : (realTwrHz ? `${realTwrHz.toFixed(1)} Hz` : (LiveState.syncPeriod_s > 0 ? `${Math.min(150.0, 1.0 / LiveState.syncPeriod_s).toFixed(1)} Hz` : '-- Hz'));

        const isFilteredThisMod = (LiveState.entityFilter && LiveState.entityFilter.mode === 'module' && LiveState.entityFilter.value === `0x${cleanNid}`);

        html += `
            <div class="live-node-card ${cardClass} ${isOnline ? 'online' : ''}" onclick="setLiveEntityFilter('module', '0x${cleanNid}')" title="Clique para filtrar toda a Telemetria Live pelo módulo 0x${cleanNid}" style="cursor:pointer; padding: 8px 12px; margin: 0; display:flex; flex-direction:column; justify-content:space-between; min-height: 94px; ${isConfirmedMaster ? 'border-color:rgba(234,179,8,0.7) !important; box-shadow:0 0 16px rgba(234,179,8,0.3) !important; background:linear-gradient(180deg, rgba(30,41,59,0.9) 0%, rgba(35,28,10,0.35) 100%) !important;' : (isDesignatedNext ? 'border-color:rgba(56,189,248,0.45) !important;' : '')} ${isFilteredThisMod ? 'outline: 2px solid var(--cyan); box-shadow: 0 0 12px rgba(56,189,248,0.35);' : ''}">
                <!-- Linha 1: Identificação, Papel, Porta e Status Observável (100% sem quebras de linha) -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:4px; min-width:0;">
                    <div style="display:flex; align-items:center; gap:5px; flex-shrink:1; min-width:0; overflow:hidden; white-space:nowrap;">
                        ${nodeHeaderHtml}
                        ${modeBadge}
                        ${portBadge}
                    </div>
                    <div style="flex-shrink:0;">
                        ${statusBadge}
                    </div>
                </div>

                <!-- Linha 2: Métrica Principal de Distância em Destaque + Frequências Instantâneas -->
                <div style="display:flex; justify-content:space-between; align-items:baseline; margin: 3px 0; padding: 3px 0; border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); gap:6px;">
                    <div style="font-size:${isMaster ? '16.5px' : '21px'}; font-weight:800; font-family:var(--font-mono); color:${isOnline ? (isMaster ? '#38bdf8' : '#34d399') : 'var(--text-muted)'}; line-height:1.1; letter-spacing:-0.5px; white-space:nowrap; flex-shrink:0;">
                        ${distDisplay}
                    </div>
                    <div style="font-size:11px; font-family:var(--font-mono); text-align:right; white-space:nowrap;">
                        <span style="color:#38bdf8;" title="Taxa TWR">TWR: <strong style="font-size:11.5px; font-weight:800; color:#38bdf8;">${twrFreqDisplay}</strong></span>
                        <span style="margin: 0 2px; opacity:0.35;">|</span>
                        <span style="color:#c084fc;" title="Taxa TDoA">TDoA: <strong style="font-size:11.5px; font-weight:800; color:#c084fc;">${tdoaFreqDisplay}</strong></span>
                    </div>
                </div>

                <!-- Linha 3: TG Sincronizado e Erro Real vs TWR em Destaque Visual -->
                <div style="font-size:11px; font-family:var(--font-mono); color:#94a3b8; margin: 3px 0; display:flex; flex-direction:column; gap:2.5px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(56,189,248,0.06); padding:2px 6px; border-radius:3px; border:1px solid rgba(56,189,248,0.15);">
                        <span style="color:#38bdf8; font-weight:700;" title="Tempo Global Sincronizado">TG:</span>
                        <span style="color:#f8fafc; font-weight:600; font-size:11px;">${tgDisplay}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(245,158,11,0.06); padding:2px 6px; border-radius:3px; border:1px solid rgba(245,158,11,0.15);">
                        <span style="color:#fbbf24; font-weight:700;" title="Erro Real Observado vs Referência Calibrada TWR">Erro Real:</span>
                        <span style="font-size:11px;">${errorDisplay}</span>
                    </div>
                </div>

                <!-- Linha 4: Micro-grelha com ToF, Deriva ppm, Sync k e UART -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; font-size:11px; font-family:var(--font-mono); color:#94a3b8;">
                    <div>ToF: <span style="color:#f8fafc; font-weight:700;">${tdoaDisplay}</span></div>
                    <div>Deriva: <span style="color:#f8fafc; font-weight:700;">${driftDisplay}</span></div>
                    <div>Sync: <span style="color:#c4b5fd; font-weight:700;">${kDisplay}</span></div>
                    <div title="Último pacote recebido">UART: <span style="color:#cbd5e1; font-weight:600;">${dtStr} (${n.packet_count || 0})</span></div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function formatConsoleTime(m) {
    const fmt = LiveState.consoleTimeFormat || 'both';
    let elapsedStr = '';
    if (m.elapsed_s !== undefined && m.elapsed_s !== null) {
        elapsedStr = `+${Number(m.elapsed_s).toFixed(1)}s`;
    } else if (LiveState.t0Epoch && m.epoch) {
        elapsedStr = `+${Math.max(0, (m.epoch - LiveState.t0Epoch) / 1000.0).toFixed(1)}s`;
    } else {
        elapsedStr = '+0.0s';
    }

    const clockStr = m.time || new Date().toLocaleTimeString();

    if (fmt === 'elapsed') {
        return `[${elapsedStr}] `;
    } else if (fmt === 'clock') {
        return `[${clockStr}] `;
    } else { // 'both'
        const cleanClock = clockStr.split('.')[0];
        return `[${elapsedStr} | ${cleanClock}] `;
    }
}

function changeLiveConsoleTimeFormat() {
    const sel = document.getElementById('live-console-time-format');
    if (!sel) return;
    LiveState.consoleTimeFormat = sel.value;
    filterLiveConsole();
}

function updateSyncPeriodBadges() {
    const k_s = (LiveState.syncPeriod_s !== undefined && LiveState.syncPeriod_s !== null) ? LiveState.syncPeriod_s : 0.5;
    const k_ms = (LiveState.syncPeriod_ms !== undefined && LiveState.syncPeriod_ms !== null) ? LiveState.syncPeriod_ms : Math.round(k_s * 1000);
    const f_twr = (LiveState.syncFreq_hz !== undefined && LiveState.syncFreq_hz !== null) ? LiveState.syncFreq_hz : (k_s > 0 ? (1.0 / k_s) : 0);
    
    let kText = '';
    if (k_s === 0) {
        kText = '0 Hz (Puro TWR)';
    } else {
        const fStr = f_twr >= 10 ? f_twr.toFixed(0) : (f_twr % 1 === 0 ? f_twr.toFixed(0) : f_twr.toFixed(1));
        kText = `${fStr} Hz (${k_ms < 1000 ? `${k_ms}ms` : `${k_s.toFixed(1)}s`})`;
    }

    const headerSyncText = document.getElementById('live-header-sync-text');
    if (headerSyncText) {
        headerSyncText.textContent = `Sync TWR: ${kText}`;
    }

    const consoleBadge = document.getElementById('live-console-sync-badge');
    if (consoleBadge) {
        consoleBadge.textContent = `Sync TWR: ${kText}`;
        consoleBadge.title = `Frequência de Sincronismo TWR (Comando 'k'): ${k_s === 0 ? 'Desativado' : `${f_twr.toFixed(2)} Hz (Período: ${k_s} s / ${k_ms} ms)`}`;
    }

    const chartBadge = document.getElementById('live-chart-sync-badge');
    if (chartBadge) {
        chartBadge.textContent = `Sync TWR: ${kText}`;
        chartBadge.title = `Frequência de Sincronismo DS-TWR Ativa: ${k_s === 0 ? 'Desativado' : `${f_twr.toFixed(2)} Hz (${k_ms} ms)`}`;
    }

    const tdoaBadge = document.getElementById('live-console-tdoa-target-badge');
    if (tdoaBadge) {
        const targetHz = LiveState.tdoaTargetFreqHz || 0;
        if (targetHz === 0) {
            tdoaBadge.textContent = 'f TDoA: MAX (~550Hz)';
            tdoaBadge.title = 'Frequência de Beacons TDoA: Taxa Máxima Física do Hardware (~550 Hz)';
        } else {
            const periodMs = (1000.0 / targetHz).toFixed(1);
            tdoaBadge.textContent = `f TDoA: ${targetHz} Hz (${periodMs}ms)`;
            tdoaBadge.title = `Frequência Configurada de Beacons TDoA: ${targetHz} Hz (Período: ${periodMs} ms)`;
        }
    }

    updateLiveChartStatsStrip();

    if (k_s === 0 && LiveState.unifiedChart) {
        const uc = LiveState.unifiedChart;
        if (uc.filters && uc.filters.directions && uc.filters.directions.size > 0) {
            const hasTwr = Array.from(uc.filters.directions).some(d => !d.includes(':tdoa'));
            if (!hasTwr) {
                uc.filters.directions.forEach(d => {
                    const base = d.replace(':tdoa', '');
                    uc.filters.directions.add(base + ':twr');
                    const parts = base.split('->');
                    if (parts.length === 2) {
                        uc.filters.directions.add(`${parts[1]}->${parts[0]}:twr`);
                    }
                });
                const uid = uc.canvasId;
                document.querySelectorAll(`.${uid}-cb-dir`).forEach(cb => {
                    if (uc.filters.directions.has(cb.value)) cb.checked = true;
                });
                uc.applyFiltersAndRebuild();
            }
        }
    }
}

function updateLiveFrequencyBadges() {
    const isSyncOff = (LiveState.syncPeriod_s === 0);
    let phyRate = (LiveState.radioPhyFreqHz && LiveState.radioPhyFreqHz > 0) ? LiveState.radioPhyFreqHz : (LiveState.tdoaFreqHz || 0);
    if (phyRate > 2500.0) phyRate = 2500.0;
    const tdoaHz = isSyncOff ? 0.0 : phyRate;
    const realTwrHz = (LiveState.twrFreqHz && LiveState.twrFreqHz > 0) ? LiveState.twrFreqHz : (LiveState.syncPeriod_s > 0 ? Math.min(150.0, 1.0 / LiveState.syncPeriod_s) : 0);
    const twrHz = isSyncOff ? (phyRate || 0) : realTwrHz;

    const tdoaStr = isSyncOff ? '0.0 Hz (Desativado)' : (tdoaHz > 0 ? `${tdoaHz.toFixed(1)} Hz` : (LiveState.isConnected ? 'Taxa Máx Hardware' : '-- Hz'));
    const twrStr = isSyncOff ? (twrHz > 0 ? `${twrHz.toFixed(1)} Hz (Puro TWR)` : 'Taxa Máx (Puro TWR)') : (twrHz > 0 ? `${twrHz.toFixed(1)} Hz` : '-- Hz');

    // Header Status Badges
    const hTdoa = document.getElementById('live-freq-tdoa-val');
    if (hTdoa) hTdoa.textContent = tdoaStr;

    const hTwr = document.getElementById('live-freq-twr-val');
    if (hTwr) hTwr.textContent = twrStr;

    // Live Chart Header Badges
    const cTdoa = document.getElementById('live-chart-freq-tdoa-badge');
    if (cTdoa) {
        cTdoa.textContent = isSyncOff ? `📡 TDoA: Desativado` : `📡 TDoA: ${tdoaStr}`;
        cTdoa.title = isSyncOff ? 'TDoA desativado em Modo 0 (Puro TWR)' : `Taxa de medição passiva TDoA na capacidade máxima dos módulos: ${tdoaStr}`;
    }

    const cTwr = document.getElementById('live-chart-freq-twr-badge');
    if (cTwr) {
        cTwr.textContent = `👑 TWR: ${twrStr}`;
        cTwr.title = isSyncOff ? `Ranging Contínuo Puro DS-TWR na Taxa Máxima dos Módulos: ${twrStr}` : `Frequência de Sincronismo DS-TWR: ${twrStr}`;
    }

    // Live Console Header Badges
    const conTdoa = document.getElementById('live-console-freq-tdoa-badge');
    if (conTdoa) {
        conTdoa.textContent = isSyncOff ? `📡 TDoA: Desativado` : `📡 TDoA: ${tdoaStr}`;
        conTdoa.title = `Taxa do protocolo TDoA sem limitação: ${tdoaStr}`;
    }

    const conTwr = document.getElementById('live-console-freq-twr-badge');
    if (conTwr) {
        conTwr.textContent = `👑 TWR: ${twrStr}`;
        conTwr.title = isSyncOff ? `Ranging Contínuo Puro DS-TWR na Taxa Máxima dos Módulos: ${twrStr}` : `Frequência do protocolo TWR: ${twrStr}`;
    }
}
window.updateLiveFrequencyBadges = updateLiveFrequencyBadges;

function formatConsoleNodeTag(m) {
    const port = m.port || '';
    if (port === 'SYS' || !port) {
        return '[SISTEMA] ';
    }
    const nid = m.node_id ? String(m.node_id).toUpperCase().padStart(4, '0') : '';
    const isMaster = (m.role && m.role.toLowerCase() === 'master') || nid === '0001' || port === 'COM6';
    const roleLabel = isMaster ? '👑 Master' : (m.role ? `📡 ${m.role}` : '📡 Slave');

    const cycleNum = (m.algo_cycle !== undefined && m.algo_cycle !== null) ? m.algo_cycle : ((m.seq !== undefined && m.seq !== null) ? m.seq : null);
    const rawNum = (m.seq_raw !== undefined && m.seq_raw !== null) ? m.seq_raw : ((m.parsed && m.parsed.seq !== undefined) ? m.parsed.seq : null);
    let cycleTag = '';
    if (cycleNum !== null) {
        if (rawNum !== null && rawNum !== cycleNum) {
            cycleTag = `[Ciclo #${cycleNum} | HW #${rawNum}] `;
        } else {
            cycleTag = `[Ciclo #${cycleNum}] `;
        }
    }

    if (nid) {
        return `${cycleTag}[${roleLabel} 0x${nid} | ${port}] `;
    }
    if (port === 'COM6') {
        return `${cycleTag}[👑 Master 0x0001 | COM6] `;
    }
    return `${cycleTag}[${port}] `;
}
window.formatConsoleNodeTag = formatConsoleNodeTag;

function appendLiveConsoleMessages(newMsgs) {
    const consoleEl = document.getElementById('live-console');
    const counterEl = document.getElementById('live-msg-counter');
    const autoScroll = document.getElementById('live-autoscroll') ? document.getElementById('live-autoscroll').checked : true;
    if (!consoleEl) return;

    LiveState.messages = LiveState.messages.concat(newMsgs);
    if (LiveState.messages.length > 2000) {
        LiveState.messages = LiveState.messages.slice(-2000);
    }

    if (counterEl) {
        counterEl.innerText = `${LiveState.messages.length} msgs`;
    }

    const fragment = document.createDocumentFragment();
    newMsgs.forEach(m => {
        if (m.provenance === 'hardware_uart_binary_7b' && (m.seq % 20 !== 0)) return; // Amostragem de consola a 1kHz
        if (!shouldShowConsoleMessage(m, LiveState.activeFilter, LiveState.activeNodeFilter)) return;

        const lineDiv = document.createElement('div');
        lineDiv.className = `terminal-line ${m.type ? m.type + '-line' : ''}`;
        lineDiv.dataset.type = m.type || 'raw';
        if (m.node_id) lineDiv.dataset.node = m.node_id;

        const timeTag = formatConsoleTime(m);
        const nodeTag = formatConsoleNodeTag(m);
        lineDiv.textContent = `${timeTag}${nodeTag}${m.text}`;
        fragment.appendChild(lineDiv);
    });

    consoleEl.appendChild(fragment);

    while (consoleEl.children.length > 1000) {
        consoleEl.removeChild(consoleEl.firstChild);
    }

    if (autoScroll) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function shouldShowConsoleMessage(m, typeFilter, nodeFilter) {
    // 1. Filtro por Nó / Papel
    const nF = nodeFilter || LiveState.activeNodeFilter || 'all';
    if (nF !== 'all') {
        if (m.port === 'SYS' && m.type === 'cmd') {
            // Permitir visibilidade de comandos de sistema
        } else {
            const nid = (m.node_id || '').toUpperCase();
            const isMaster = (m.role && m.role.toLowerCase() === 'master') || nid === '0001' || (m.port && m.port === 'COM6');
            if (nF === 'slaves' && isMaster) return false;
            if (nF === 'master' && !isMaster) return false;
            if (nF !== 'slaves' && nF !== 'master') {
                const targetNid = nF.toUpperCase().padStart(4, '0');
                let matches = (nid === targetNid);
                if (!matches && m.port) {
                    const matchedState = LiveState.nodes && LiveState.nodes[targetNid];
                    if (matchedState && matchedState.port === m.port) matches = true;
                    if (targetNid === '0001' && (m.port === 'COM6' || m.port === 'COM12')) matches = true;
                    if (targetNid === '0002' && m.port === 'COM5') matches = true;
                    if (targetNid === '0003' && (m.port === 'COM7' || m.port === 'COM11')) matches = true;
                    if (targetNid === '0004' && m.port === 'COM4') matches = true;
                    if (targetNid === '0005' && m.port === 'COM13') matches = true;
                    if (targetNid === '0006' && m.port === 'COM14') matches = true;
                }
                if (!matches) return false;
            }
        }
    }

    // 2. Filtro por Tipo / Protocolo
    const tF = typeFilter || LiveState.activeFilter || 'all';
    if (tF === 'all') return true;
    if (tF === 'tdoa_rx') {
        return (m.text && m.text.includes('[TDOA:RX')) || (m.parsed && m.parsed.type === 'tdoa' && m.parsed.dst && m.parsed.dst !== '*');
    }
    if (tF === 'tdoa') return m.type === 'tdoa' || (m.text && (m.text.includes('TDOA') || m.text.includes('Beacon')));
    if (tF === 'twr') return m.type === 'twr' || (m.text && (m.text.includes('DIST:') || m.text.includes('[TWR')));
    if (tF === 'sync') return m.type === 'sync' || (m.text && (m.text.includes('SYNC') || m.text.includes('Sincroniz')));
    if (tF === 'cmd') return m.type === 'cmd';
    return true;
}

function filterLiveConsole() {
    const select = document.getElementById('live-console-filter');
    if (select) LiveState.activeFilter = select.value;
    const nodeSelect = document.getElementById('live-console-node-filter');
    if (nodeSelect) LiveState.activeNodeFilter = nodeSelect.value;

    updateConsoleNodePillsUI();

    const consoleEl = document.getElementById('live-console');
    if (!consoleEl) return;
    consoleEl.innerHTML = '';

    const fragment = document.createDocumentFragment();
    LiveState.messages.forEach(m => {
        if (shouldShowConsoleMessage(m, LiveState.activeFilter, LiveState.activeNodeFilter)) {
            const lineDiv = document.createElement('div');
            lineDiv.className = `terminal-line ${m.type ? m.type + '-line' : ''}`;
            lineDiv.dataset.type = m.type || 'raw';
            if (m.node_id) lineDiv.dataset.node = m.node_id;
            const timeTag = formatConsoleTime(m);
            const nodeTag = formatConsoleNodeTag(m);
            lineDiv.textContent = `${timeTag}${nodeTag}${m.text}`;
            fragment.appendChild(lineDiv);
        }
    });
    consoleEl.appendChild(fragment);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function setConsoleNodeFilter(nodeFilter) {
    LiveState.activeNodeFilter = nodeFilter || 'all';
    const nodeSelect = document.getElementById('live-console-node-filter');
    if (nodeSelect) {
        nodeSelect.value = LiveState.activeNodeFilter;
    }
    // Ao clicar em 'Apenas Slaves (TDoA RX)', pre-selecionar também o filtro de tipo tdoa_rx se estava em 'all'
    if (nodeFilter === 'slaves') {
        const typeSelect = document.getElementById('live-console-filter');
        if (typeSelect && typeSelect.value === 'all') {
            typeSelect.value = 'tdoa_rx';
            LiveState.activeFilter = 'tdoa_rx';
        }
    }
    filterLiveConsole();
}
window.setConsoleNodeFilter = setConsoleNodeFilter;

function updateConsoleNodePillsUI() {
    const current = LiveState.activeNodeFilter || 'all';
    const pills = ['all', 'slaves', 'master', '0002', '0003', '0004', '0005', '0006'];
    pills.forEach(p => {
        const btn = document.getElementById(`pill-node-${p}`);
        if (btn) {
            if (p === current) {
                btn.classList.remove('btn-outline');
                btn.classList.add('btn-primary');
            } else {
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-outline');
            }
        }
    });
}
window.updateConsoleNodePillsUI = updateConsoleNodePillsUI;

function clearLiveConsole() {
    const consoleEl = document.getElementById('live-console');
    if (consoleEl) {
        consoleEl.innerHTML = '<div class="terminal-line system-line">[SISTEMA] Consola limpa.</div>';
    }
    LiveState.messages = [];
    const counterEl = document.getElementById('live-msg-counter');
    if (counterEl) counterEl.innerText = '0 msgs';
}

function copyLiveConsoleLogs() {
    if (!LiveState.messages || LiveState.messages.length === 0) {
        showToast('Nenhum log para copiar.');
        return;
    }
    const fullText = LiveState.messages.map(m => `${formatConsoleTime(m)}${formatConsoleNodeTag(m)}${m.text || ''}`).join('\n');
    navigator.clipboard.writeText(fullText).then(() => {
        showToast('Logs copiados para a área de transferência!');
    }).catch(e => {
        showToast('Erro ao copiar logs: ' + e);
    });
}

async function sendLiveCommand(cmd, target = 'all') {
    if (!cmd) return;
    try {
        const resp = await fetch('/api/live/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd, target: target })
        });
        const res = await resp.json();
        if (res.status === 'success') {
            if (res.sync_period_s !== undefined && res.sync_period_s !== null) {
                LiveState.syncPeriod_s = res.sync_period_s;
                LiveState.syncPeriod_ms = res.sync_period_ms || Math.round(res.sync_period_s * 1000);
            }
            if (res.sync_freq_hz !== undefined) {
                LiveState.syncFreq_hz = res.sync_freq_hz;
            }
            if (res.tdoa_target_freq_hz !== undefined) {
                LiveState.tdoaTargetFreqHz = res.tdoa_target_freq_hz;
            }
            updateSyncPeriodBadges();
            if (cmd.startsWith('t ')) {
                LiveState.t0Epoch = Date.now();
                clearLiveChartData();
            }
            showToast(`Comando '${cmd}' enviado para ${res.target || target}!`);
        } else {
            showToast(`Erro ao enviar comando: ${res.message || 'Falha'}`);
        }
    } catch (e) {
        showToast(`Erro de comunicação: ${e.message}`);
    }
}

function executeLiveCustomCommand() {
    const input = document.getElementById('live-cmd-input');
    const targetSelect = document.getElementById('live-cmd-target');
    if (!input) return;
    const cmd = input.value.trim();
    if (!cmd) return;
    const target = targetSelect ? targetSelect.value : 'all';
    sendLiveCommand(cmd, target);
    input.value = '';
}

function promptClockSyncPeriod() {
    const inputStr = prompt(
        'Configurar Frequência de Sincronismo TWR (em Hz):\n\n' +
        'Define a taxa das calibrações TWR entre Master e Escravos.\n' +
        'O período correspondente é calculado automaticamente (T = 1 / f).\n\n' +
        'Exemplos aceites:\n' +
        '• 2      : 2 Hz (calibração a cada 500 ms)\n' +
        '• 1      : 1 Hz (calibração a cada 1.000 ms)\n' +
        '• 0.5    : 0.5 Hz (calibração a cada 2.000 ms)\n' +
        '• 0.2    : 0.2 Hz (calibração a cada 5.000 ms)\n' +
        '• 0.1    : 0.1 Hz (calibração a cada 10.000 ms)\n' +
        '• 10     : 10 Hz (calibração a cada 100 ms)\n' +
        '• 0      : Desativado (Ranging contínuo puro DS-TWR na taxa máxima física)\n\n' +
        'Também suporta unidades explícitas: ex: 500ms, 10s.\n\n' +
        'Introduza a frequência em Hz (ex: 2, 1, 0.5, 0.1, 0):',
        '2'
    );
    if (inputStr !== null) {
        const clean = inputStr.trim();
        if (clean.length > 0) {
            sendLiveCommand(`k ${clean}`, 'all');
        } else {
            showToast('Entrada vazia.');
        }
    }
}

function promptTdoaRateHz() {
    const inputStr = prompt(
        'Configurar Frequência de Beacons TDoA (em Hz):\n\n' +
        'Controla a taxa de emissão de Beacons 1-way pelo Master.\n\n' +
        'Opções:\n' +
        '• max ou 0 : Máxima física do hardware (~550 Hz, período ~1.8 ms)\n' +
        '• 200      : 200 Hz (período de 5 ms)\n' +
        '• 100      : 100 Hz (período de 10 ms)\n' +
        '• 50       : 50 Hz (período de 20 ms)\n' +
        '• 20       : 20 Hz (período de 50 ms)\n' +
        '• 10       : 10 Hz (período de 100 ms)\n\n' +
        'Introduza a taxa desejada em Hz (ou "max"):',
        'max'
    );
    if (inputStr !== null) {
        const clean = inputStr.trim();
        if (clean.length > 0) {
            sendLiveCommand(`f ${clean}`, 'master');
        } else {
            showToast('Entrada vazia.');
        }
    }
}

function promptCustomTimedTrial() {
    const secStr = prompt('Introduza a duração do ensaio temporizado em segundos (ex: 5, 10, 30, 60):', '10');
    if (secStr !== null) {
        const sec = parseInt(secStr.trim());
        if (!isNaN(sec) && sec > 0) {
            sendLiveCommand(`t ${sec}`, 'master');
        } else {
            showToast('Duração inválida. Introduza um número inteiro em segundos.');
        }
    }
}

function confirmResetLiveNodes() {
    if (confirm('Atenção: Pretende reiniciar todos os microcontroladores por software (NVIC System Reset)?')) {
        sendLiveCommand('r', 'all');
    }
}

// Gestão de séries e filtros Live unificada através de UnifiedUwbChart
function renderLiveLinkChips() { /* Integrado no UnifiedUwbChart */ }

function exportLiveChartPng() {
    if (!LiveState.chart) return;
    const filename = swarmloc_live_.png;
    const a = document.createElement('a');
    a.download = filename;
    a.href = LiveState.chart.toBase64Image();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Gráfico ao vivo exportado como ${filename}`);
}

function initLiveChart() {
    const canvas = document.getElementById("live-chart");
    if (!canvas) return;
    if (window.UnifiedUwbChart && !LiveState.unifiedChart) {
        LiveState.unifiedChart = new window.UnifiedUwbChart({
            canvasId: "live-chart",
            mode: "live",
            controlsContainerId: "live-chart-controls-panel",
            statsContainerId: "live-chart-stats-strip",
            channelBuffers: LiveState.channelBuffers
        });
        LiveState.unifiedChart.init();
        LiveState.chart = LiveState.unifiedChart.chart;
    }
}

function rebuildLiveChartFromBuffer() {
    if (!LiveState.unifiedChart) {
        initLiveChart();
    }
    if (LiveState.unifiedChart) {
        LiveState.unifiedChart.ingestLiveBatch(LiveState.historyBuffer || [], LiveState.channelBuffers);
        LiveState.chart = LiveState.unifiedChart.chart;
    }
}

function updateLiveChartStatsStrip() {
    if (LiveState.unifiedChart) {
        LiveState.unifiedChart.updateStatsStrip();
    }
}

function updateLiveChartWithMessages(messages) {
    if (!LiveState.chart || !messages || messages.length === 0) return;

    // Se o gráfico estiver em pausa explícita, preserva 100% da visualização congelada.
    // Em navegação manual (zoom/pan), continua a ingerir em memória (com limite de RAM) sem alterar a escala atual.
    if (LiveState.unifiedChart && LiveState.unifiedChart.isPaused) {
        return;
    }

    const now = Date.now();
    let hasNewData = false;

    messages.forEach(m => {
        if (!m.parsed) return;
        if (m.is_valid === false) return;
        const p = m.parsed;
        if (p.is_valid_measurement === false) return;

        const isTwr = (m.type === 'twr' || p.type === 'twr' || (p.dist_m !== undefined && p.mode !== 'TDoA' && m.type !== 'tdoa'));
        const isTdoa = (m.type === 'tdoa' || p.type === 'tdoa' || p.mode === 'TDoA' || p.tdoa_diff !== undefined || (m.text && m.text.includes('[TDOA:')));
        if (!isTwr && !isTdoa) return;

        let src = '';
        let dst = '';
        let proto = isTdoa ? 'TDoA' : 'TWR';

        if (isTdoa && ((m.text && m.text.includes('[TDOA:RX')) || p.mode === 'TDoA' || m.type === 'tdoa')) {
            // Em TDoA Downlink, o Slave é o nó recetor/medidor e o Master é a referência
            const slaveId = (m.node_id || p.measurer || (p.dst && p.dst !== '*' ? p.dst : '') || '').toUpperCase().replace(/^0X/, '');
            const masterId = (p.beacon_src || (p.src && p.src !== slaveId ? p.src : '0001')).toUpperCase().replace(/^0X/, '');
            src = (slaveId && slaveId !== '0001') ? slaveId : (m.port === 'COM5' ? '0002' : (m.port === 'COM7' ? '0003' : (m.port === 'COM4' ? '0004' : '0002')));
            dst = masterId || '0001';
        } else {
            // TWR Bidirecional: respeita fielmente a direção do nó que calculou a distância (src) e o nó remoto (dst)
            src = (p.src || (m.port === 'COM6' ? '0001' : (m.port === 'COM5' ? '0002' : (m.port === 'COM7' ? '0003' : (m.port === 'COM4' ? '0004' : '0001'))))).toUpperCase().replace(/^0X/, '');
            dst = (p.dst || (src === '0001' ? '0002' : '0001')).toUpperCase().replace(/^0X/, '');
        }

        if (src.length < 4 && !isNaN(parseInt(src, 16))) src = src.padStart(4, '0');
        if (dst.length < 4 && !isNaN(parseInt(dst, 16))) dst = dst.padStart(4, '0');

        // Ignorar transmissões broadcast, nós não-inicializados (0000) e auto-medições fantasma (src === dst)
        if (!src || !dst || src === '0000' || dst === '0000' || dst === '*' || dst === 'FFFF' || src === dst) return;

        // Link key com discriminação de protocolo inequívoca (evita colisão TWR x TDoA)
        const linkKey = (proto === 'TDoA') ? `${src}->${dst}:tdoa` : `${src}->${dst}:twr`;

        // Calcular taxa instantânea (Hz) preservando o domínio temporal do hardware (t_local_us) quando presente
        const curSeq = (p.seq !== undefined && p.seq !== null) ? p.seq : (m.seq !== undefined ? m.seq : null);
        const curHwUs = (p.t_local_us !== undefined && p.t_local_us !== null) ? p.t_local_us : ((m.t_local_us !== undefined) ? m.t_local_us : null);
        const curEpochMs = (m.epoch !== undefined && m.epoch !== null) ? (m.epoch * 1000.0) : now;
        let rate_hz = null;
        const prevInfo = LiveState.lastPacketTimes[linkKey];
        if (prevInfo) {
            let dtSec = null;
            if (curHwUs !== null && prevInfo.hwUs !== null && curHwUs > prevInfo.hwUs) {
                dtSec = (curHwUs - prevInfo.hwUs) / 1e6;
            } else if (curEpochMs > prevInfo.epochMs) {
                dtSec = (curEpochMs - prevInfo.epochMs) / 1000.0;
            }
            if (dtSec !== null && dtSec > 0.0005 && dtSec < 10.0) {
                const dSeq = (curSeq !== null && prevInfo.seq !== null && curSeq > prevInfo.seq) ? (curSeq - prevInfo.seq) : 1;
                rate_hz = Math.round((dSeq / dtSec) * 10) / 10;
            }
        }
        LiveState.lastPacketTimes[linkKey] = { epochMs: curEpochMs, hwUs: curHwUs, seq: curSeq };

        if (!LiveState.t0Epoch) {
            LiveState.t0Epoch = curEpochMs;
        }

        // Registar novo link se necessário
        if (!LiveState.detectedLinks.has(linkKey)) {
            const label = `${src} → ${dst} [${proto}]`;
            LiveState.detectedLinks.set(linkKey, {
                key: linkKey,
                src: src,
                dst: dst,
                lastProto: proto,
                protocol: proto,
                label: label
            });
            LiveState.activeLinks.add(linkKey);
        } else {
            const l = LiveState.detectedLinks.get(linkKey);
            if (l) {
                l.lastProto = proto;
                l.protocol = proto;
            }
        }

        const elapsedSec = (m.elapsed_s !== undefined && m.elapsed_s !== null)
            ? Number(m.elapsed_s)
            : Math.max(0, (curEpochMs - LiveState.t0Epoch) / 1000.0);
        const timeStr = m.time ? m.time.split('.')[0] : new Date(curEpochMs).toLocaleTimeString();
        const pt = {
            id: m.id || ++LiveState.sampleCounter,
            sample_idx: LiveState.sampleCounter,
            epoch: curEpochMs,
            elapsed_s: elapsedSec,
            time_str: timeStr,
            time_full: m.time || timeStr,
            src: src,
            dst: dst,
            linkKey: linkKey,
            type: m.type,
            protocol: proto,
            lastProto: proto,
            packet_type: proto,
            seq: (m.seq !== undefined && m.seq !== null) ? m.seq : ((m.algo_cycle !== undefined && m.algo_cycle !== null) ? m.algo_cycle : (curSeq || LiveState.sampleCounter)),
            seq_raw: (m.seq_raw !== undefined && m.seq_raw !== null) ? m.seq_raw : curSeq,
            algo_cycle: (m.algo_cycle !== undefined && m.algo_cycle !== null) ? m.algo_cycle : m.seq,
            t_local_us: curHwUs,
            t_global_us: (p.t_global_us !== undefined && p.t_global_us !== null) ? p.t_global_us : ((m.t_global_us !== undefined) ? m.t_global_us : null),
            real_error_m: (p.real_error_m !== undefined && p.real_error_m !== null) ? p.real_error_m : ((m.real_error_m !== undefined) ? m.real_error_m : null),
            real_error_rate_mps: (p.real_error_rate_mps !== undefined && p.real_error_rate_mps !== null) ? p.real_error_rate_mps : ((m.real_error_rate_mps !== undefined) ? m.real_error_rate_mps : null),
            sync_elapsed_ms: (p.sync_elapsed_ms !== undefined && p.sync_elapsed_ms !== null) ? p.sync_elapsed_ms : ((m.sync_elapsed_ms !== undefined) ? m.sync_elapsed_ms : null),
            dist_m: (p.dist_m !== undefined && p.dist_m !== null) ? p.dist_m : ((m.dist_m !== undefined && m.dist_m !== null) ? m.dist_m : ((m.distance_m !== undefined && m.distance_m !== null) ? m.distance_m : null)),
            raw_dist_m: (p.raw_dist_m !== undefined && p.raw_dist_m !== null) ? p.raw_dist_m : ((m.raw_dist_m !== undefined && m.raw_dist_m !== null) ? m.raw_dist_m : ((p.dist_m !== undefined && p.dist_m !== null) ? p.dist_m : ((m.dist_m !== undefined && m.dist_m !== null) ? m.dist_m : m.distance_m))),
            dist_comp_m: (p.dist_comp_m !== undefined && p.dist_comp_m !== null) ? p.dist_comp_m : ((m.dist_comp_m !== undefined && m.dist_comp_m !== null) ? m.dist_comp_m : ((p.ref_dist_m !== undefined && p.ref_dist_m !== null) ? p.ref_dist_m : ((p.dist_m !== undefined && p.dist_m !== null) ? p.dist_m : m.dist_m))),
            ref_dist_m: (p.ref_dist_m !== undefined && p.ref_dist_m !== null) ? p.ref_dist_m : (m.ref_dist_m !== undefined ? m.ref_dist_m : null),
            clock_drift_ppm: (p.clock_drift_ppm !== undefined && p.clock_drift_ppm !== null) ? p.clock_drift_ppm : null,
            tdoa_diff: (p.tof_ns !== undefined && p.tof_ns !== null) ? p.tof_ns : ((p.tdoa_diff !== undefined) ? p.tdoa_diff : null),
            rate_hz: (p.rf_freq_hw !== undefined && p.rf_freq_hw !== null && p.rf_freq_hw > 0) ? p.rf_freq_hw : ((m.f_rf_event_hz !== undefined && m.f_rf_event_hz !== null) ? m.f_rf_event_hz : rate_hz),
            f_rf_event_hz: (p.rf_freq_hw !== undefined && p.rf_freq_hw !== null && p.rf_freq_hw > 0) ? p.rf_freq_hw : ((m.f_rf_event_hz !== undefined && m.f_rf_event_hz !== null) ? m.f_rf_event_hz : rate_hz),
            prx_dbm: p.prx_dbm !== undefined ? p.prx_dbm : null,
            fp_dbm: p.fp_dbm !== undefined ? p.fp_dbm : null,
            sync_period_s: (m.sync_period_s !== undefined && m.sync_period_s !== null) ? m.sync_period_s : ((LiveState.syncPeriod_s !== undefined && LiveState.syncPeriod_s !== null) ? LiveState.syncPeriod_s : 0.5),
            sync_period_ms: (m.sync_period_ms !== undefined && m.sync_period_ms !== null) ? m.sync_period_ms : ((LiveState.syncPeriod_ms !== undefined && LiveState.syncPeriod_ms !== null) ? LiveState.syncPeriod_ms : 500)
        };

        LiveState.historyBuffer.push(pt);

        // Buffer dedicado por canal: garante integridade de canais mais lentos (ex: TWR) sem sobreposição
        if (!LiveState.channelBuffers) LiveState.channelBuffers = new Map();
        if (!LiveState.channelBuffers.has(linkKey)) {
            LiveState.channelBuffers.set(linkKey, []);
        }
        const chBuf = LiveState.channelBuffers.get(linkKey);

        // Garantir monotonicidade estrita temporal (elimina recuos no tempo causados por jitter de portas)
        if (chBuf.length > 0) {
            const lastPt = chBuf[chBuf.length - 1];
            if (pt.t_global_us != null && lastPt.t_global_us != null && pt.t_global_us < lastPt.t_global_us) {
                // Se a diferença for pequena (< 50ms), compensa ligeiro atraso de chegada serial
                if ((lastPt.t_global_us - pt.t_global_us) < 50000) {
                    pt.t_global_us = lastPt.t_global_us + 1825;
                }
            }
        }

        chBuf.push(pt);
        if (chBuf.length > 45000) {
            LiveState.channelBuffers.set(linkKey, chBuf.slice(-35000));
        }

        hasNewData = true;
    });

    if (hasNewData) {
        if (LiveState.historyBuffer.length > 50000) {
            LiveState.historyBuffer = LiveState.historyBuffer.slice(-40000);
        }
        // Limite global de RAM entre canais (evita acumulação em canais inativos após múltiplas rotações de Master)
        if (LiveState.channelBuffers && LiveState.channelBuffers.size > 4) {
            let totalChPts = 0;
            LiveState.channelBuffers.forEach(arr => { totalChPts += arr.length; });
            if (totalChPts > 180000) {
                LiveState.channelBuffers.forEach((arr, key) => {
                    if (arr.length > 20000) {
                        LiveState.channelBuffers.set(key, arr.slice(-20000));
                    }
                });
            }
        }
        if (!LiveState.unifiedChart) {
            initLiveChart();
        }
        if (LiveState.unifiedChart) {
            LiveState.unifiedChart.ingestLiveBatch(LiveState.historyBuffer, LiveState.channelBuffers);
            LiveState.chart = LiveState.unifiedChart.chart;
        }
    }
}

async function clearLiveChartData() {
    try {
        await fetch('/api/live/clear', { method: 'POST' });
    } catch (e) {
        console.warn('Erro ao limpar telemetria no servidor:', e);
    }
    LiveState.lastId = 0;
    LiveState.lastMsgId = 0;
    LiveState.historyBuffer = [];
    if (LiveState.channelBuffers) {
        LiveState.channelBuffers.clear();
    } else {
        LiveState.channelBuffers = new Map();
    }
    LiveState.sampleCounter = 0;
    LiveState.t0Epoch = null;
    LiveState.lastPacketTimes = {};
    if (LiveState.unifiedChart) {
        LiveState.unifiedChart.clearData();
    } else if (LiveState.chart) {
        LiveState.chart.data.labels = [];
        LiveState.chart.data.datasets.forEach(ds => { ds.data = []; });
        LiveState.chart.update();
    }
    const statusEl = document.getElementById('live-chart-status');
    if (statusEl) statusEl.innerText = 'Gráfico limpo. A aguardar medições...';
    updateLiveChartStatsStrip();
    showToast('Gráfico e histórico de telemetria limpos com sucesso.');
}

// Exportações globais para a UI
window.initLiveTelemetryView = initLiveTelemetryView;
window.toggleLiveConnection = toggleLiveConnection;
window.sendLiveCommand = sendLiveCommand;
window.executeLiveCustomCommand = executeLiveCustomCommand;
window.promptClockSyncPeriod = promptClockSyncPeriod;
window.promptTdoaRateHz = promptTdoaRateHz;
window.promptCustomTimedTrial = promptCustomTimedTrial;
window.confirmResetLiveNodes = confirmResetLiveNodes;
window.filterLiveConsole = filterLiveConsole;
window.clearLiveConsole = clearLiveConsole;
window.copyLiveConsoleLogs = copyLiveConsoleLogs;
window.clearLiveChartData = clearLiveChartData;
function toggleLiveChartPause() {
    toggleGlobalPagePause();
}
window.toggleLiveChartPause = toggleLiveChartPause;

function toggleGlobalPagePause() {
    const uc = LiveState.unifiedChart;
    const nextPaused = uc ? !uc.isPaused : !LiveState.isPaused;
    LiveState.isPaused = nextPaused;
    if (uc) {
        uc.isPaused = nextPaused;
        uc.updatePauseUI();
        uc.updateLiveTrackingStatus();
        if (!nextPaused) {
            uc._displayMaxT = null;
            uc.latestHardwareX = null;
            uc._lastAnimFrameMs = null;
            uc.needsRebuild = true;
        }
    }
    updateGlobalPauseUI();
}
window.toggleGlobalPagePause = toggleGlobalPagePause;

function updateGlobalPauseUI() {
    const isPaused = Boolean(LiveState.isPaused || (LiveState.unifiedChart && LiveState.unifiedChart.isPaused));
    const btn = document.getElementById('btn-global-page-pause');
    const badge = document.getElementById('live-page-frozen-badge');
    if (btn) {
        if (isPaused) {
            btn.innerHTML = '<span style="font-size:12px;">▶</span><span>Retomar Página</span>';
            btn.style.color = '#fff';
            btn.style.background = 'var(--amber)';
            btn.style.borderColor = 'var(--amber)';
            btn.title = 'A página e todos os dados estão congelados no instante T. Clique para retomar o avanço em direto';
        } else {
            btn.innerHTML = '<span style="font-size:12px;">⏸</span><span>Pausar Página</span>';
            btn.style.color = 'var(--cyan)';
            btn.style.background = '';
            btn.style.borderColor = 'rgba(56,189,248,0.5)';
            btn.title = 'Congelar toda a página (gráficos, tabelas, nós, taxas) no mesmo instante para análise rigorosa';
        }
    }
    if (badge) {
        badge.style.display = isPaused ? 'inline-flex' : 'none';
    }
}
window.updateGlobalPauseUI = updateGlobalPauseUI;


window.exportLiveChartPng = exportLiveChartPng;
window.rebuildLiveChartFromBuffer = rebuildLiveChartFromBuffer;
window.changeLiveConsoleTimeFormat = changeLiveConsoleTimeFormat;
window.updateSyncPeriodBadges = updateSyncPeriodBadges;
window.setConsoleNodeFilter = setConsoleNodeFilter;
window.onLivePortSelectChange = onLivePortSelectChange;
window.formatConsoleNodeTag = formatConsoleNodeTag;
window.updateConsoleNodePillsUI = updateConsoleNodePillsUI;
window.getNormalizedLinkDisplay = getNormalizedLinkDisplay;

window.applyLinkPreset = applyLinkPreset;
window.buildStandardDatasetConfig = buildStandardDatasetConfig;
window.formatStatsStripHtml = formatStatsStripHtml;


function toggleDetailedCmdPanel() {
    const p = document.getElementById('live-detailed-cmd-panel');
    const b = document.getElementById('btn-toggle-cmd-panel');
    if (!p) return;
    const isHidden = (p.style.display === 'none' || !p.style.display);
    p.style.display = isHidden ? 'block' : 'none';
    if (b) b.textContent = isHidden ? '⚙️ Ações ▴' : '⚙️ Ações ▾';
}
window.toggleDetailedCmdPanel = toggleDetailedCmdPanel;

// Exportações adicionais para interação e depuração
window.AppState = AppState;
window.LiveState = LiveState;
window.switchView = switchView;
window.switchDetailTab = switchDetailTab;

// ------------------------------------------------------------------------------
// GRAVAÇÃO CONTÍNUA DE STREAM DE TELEMETRIA EM TEMPO REAL
// ------------------------------------------------------------------------------
let isStreamRecording = false;

function updateLiveRecordingUI(rec) {
    const btn = document.getElementById('btn-live-record-stream');
    const isRec = Boolean(rec && rec.is_recording);
    isStreamRecording = isRec;
    if (btn) {
        if (isRec) {
            const countStr = (rec.count || 0).toLocaleString();
            const durStr = (rec.duration_s || 0).toFixed(0);
            btn.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#fff; margin-right:4px; animation:pulse 1s infinite;"></span>⏹ Parar (${countStr} | ${durStr}s)`;
            btn.style.color = '#fff';
            btn.style.background = 'var(--rose)';
            btn.style.borderColor = 'var(--rose)';
            btn.title = `Gravação ativa no ficheiro ${rec.filename || ''}. Clique para parar.`;
        } else {
            btn.innerHTML = '⏺ Gravar Stream';
            btn.style.color = '#f87171';
            btn.style.background = '';
            btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            btn.title = 'Gravar fluxo contínuo de telemetria em tempo real para ficheiro JSONL';
        }
    }
}
window.updateLiveRecordingUI = updateLiveRecordingUI;

async function toggleLiveStreamRecording() {
    const btn = document.getElementById('btn-live-record-stream');
    if (btn) btn.disabled = true;

    if (!isStreamRecording) {
        try {
            const resp = await fetch('/api/live/record/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'session' })
            });
            const data = await resp.json();
            if (data.status === 'recording_started' || data.status === 'already_recording') {
                isStreamRecording = true;
                updateLiveRecordingUI({ is_recording: true, count: data.count || 0, duration_s: 0, filename: data.filename });
                showToast(`🔴 Gravação de Stream iniciada: ${data.filename || ''}`, 'success');
                if (typeof appendLiveConsoleMessages === 'function') {
                    appendLiveConsoleMessages([{
                        id: 0,
                        time: new Date().toLocaleTimeString(),
                        text: `[GRAVAÇÃO ATIVA] Sessão iniciada para: ${data.filename}`,
                        type: 'system'
                    }]);
                }
            } else {
                showToast(`Aviso: ${data.status || 'Não foi possível iniciar gravação'}`, 'warning');
            }
        } catch (e) {
            console.error('Falha ao iniciar gravação:', e);
            showToast(`Erro ao iniciar gravação: ${e.message}`, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    } else {
        try {
            const resp = await fetch('/api/live/record/stop', { method: 'POST' });
            const data = await resp.json();
            isStreamRecording = false;
            updateLiveRecordingUI({ is_recording: false });
            showToast(`⏹ Gravação terminada! ${data.count || 0} registos guardados em ${data.filename || ''}`, 'info');
            if (typeof appendLiveConsoleMessages === 'function') {
                appendLiveConsoleMessages([{
                    id: 0,
                    time: new Date().toLocaleTimeString(),
                    text: `[GRAVAÇÃO CONCLUÍDA] Guardados ${data.count} registos em ${data.duration_s}s no ficheiro ${data.filename}`,
                    type: 'system'
                }]);
            }
            if (typeof loadLiveRecordingsList === 'function') {
                loadLiveRecordingsList();
            }
            if (typeof loadCatalog === 'function') {
                loadCatalog();
            }
            if (typeof openLiveRecordingsModal === 'function') {
                openLiveRecordingsModal(`
                    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
                        <span>🎉 <strong>Gravação Concluída!</strong> Guardados <strong>${data.count}</strong> registos em <strong>${data.duration_s}s</strong> no ficheiro <code>${data.filename}</code>.</span>
                        <button class="btn btn-primary btn-xs" onclick="loadLiveRecordingIntoSciMetrics('${data.filename}')" style="margin-left:12px;">🔬 Abrir Agora no SciMetrics</button>
                    </div>
                `);
            }
        } catch (e) {
            console.error('Falha ao parar gravação:', e);
            showToast(`Erro ao parar gravação: ${e.message}`, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
}

window.toggleLiveStreamRecording = toggleLiveStreamRecording;

// ==============================================================================
// 13. FILTROS CIENTÍFICOS 1-CLIQUE, TABELA DE TELEMETRIA E INTEGRIDADE LIVE
// ==============================================================================
LiveState.entityFilter = { mode: 'all', value: null };

function matchesLiveEntityFilter(item) {
    const ef = LiveState.entityFilter || { mode: 'all', value: null };
    if (!ef.mode || ef.mode === 'all') return true;

    const p = item.parsed || item;
    const rawSrc = String(item.src || p.src || item.node_id || '').replace(/^0x/i, '').toUpperCase().padStart(4, '0');
    const rawDst = String(item.dst || p.dst || '').replace(/^0x/i, '').toUpperCase().padStart(4, '0');
    const srcHex = `0x${rawSrc}`;
    const dstHex = `0x${rawDst}`;

    if (ef.mode === 'module') {
        const target = String(ef.value || '').replace(/^0x/i, '').toUpperCase().padStart(4, '0');
        return rawSrc === target || rawDst === target;
    }
    if (ef.mode === 'pair') {
        const parts = String(ef.value || '').split('<->').map(s => s.trim().replace(/^0x/i, '').toUpperCase().padStart(4, '0'));
        if (parts.length === 2) {
            return (rawSrc === parts[0] && rawDst === parts[1]) || (rawSrc === parts[1] && rawDst === parts[0]);
        }
    }
    if (ef.mode === 'direction') {
        const parts = String(ef.value || '').split('->').map(s => s.trim().replace(/^0x/i, '').toUpperCase().padStart(4, '0'));
        if (parts.length === 2) {
            return rawSrc === parts[0] && rawDst === parts[1];
        }
    }
    return true;
}
window.matchesLiveEntityFilter = matchesLiveEntityFilter;

function setLiveEntityFilter(mode = 'all', value = null) {
    LiveState.entityFilter = { mode, value };

    // Atualizar botões pill 1-clique
    document.querySelectorAll('.live-filter-pill').forEach(btn => {
        btn.classList.remove('active', 'btn-primary');
        btn.classList.add('btn-outline');
    });

    if (mode === 'all') {
        const btnAll = document.getElementById('live-pill-all');
        if (btnAll) { btnAll.classList.add('active', 'btn-primary'); btnAll.classList.remove('btn-outline'); }
        LiveState.detectedLinks.forEach((_, key) => LiveState.activeLinks.add(key));
        LiveState.activeNodeFilter = 'all';
    } else if (mode === 'module') {
        const clean = String(value || '').replace(/^0x/i, '').padStart(4, '0');
        const btnMod = document.getElementById(`live-pill-mod-${clean}`);
        if (btnMod) { btnMod.classList.add('active', 'btn-primary'); btnMod.classList.remove('btn-outline'); }
        LiveState.activeLinks.clear();
        LiveState.detectedLinks.forEach((link, key) => {
            if (link.src === clean || link.dst === clean) LiveState.activeLinks.add(key);
        });
        LiveState.activeNodeFilter = (clean === '0001') ? 'master' : clean;
    } else if (mode === 'pair') {
        const parts = String(value || '').split('<->').map(s => s.trim().replace(/^0x/i, '').padStart(4, '0'));
        const pId = `live-pill-pair-${parts[0]}-${parts[1]}`;
        const btnPair = document.getElementById(pId);
        if (btnPair) { btnPair.classList.add('active', 'btn-primary'); btnPair.classList.remove('btn-outline'); }
        LiveState.activeLinks.clear();
        LiveState.detectedLinks.forEach((link, key) => {
            if ((link.src === parts[0] && link.dst === parts[1]) || (link.src === parts[1] && link.dst === parts[0])) {
                LiveState.activeLinks.add(key);
            }
        });
        LiveState.activeNodeFilter = parts.find(x => x !== '0001') || 'all';
    } else if (mode === 'direction') {
        const parts = String(value || '').split('->').map(s => s.trim().replace(/^0x/i, '').padStart(4, '0'));
        const dId = `live-pill-dir-${parts[0]}-${parts[1]}`;
        const btnDir = document.getElementById(dId);
        if (btnDir) { btnDir.classList.add('active', 'btn-primary'); btnDir.classList.remove('btn-outline'); }
        LiveState.activeLinks.clear();
        LiveState.detectedLinks.forEach((link, key) => {
            if (link.src === parts[0] && link.dst === parts[1]) {
                LiveState.activeLinks.add(key);
            }
        });
        LiveState.activeNodeFilter = parts.find(x => x !== '0001') || 'all';
    }

    // Atualizar chip de status e banner
    const textElem = document.getElementById('live-active-filter-text');
    const clearBtn = document.getElementById('live-filter-clear-btn');
    const banner = document.getElementById('live-active-filter-banner');

    if (mode === 'all') {
        if (textElem) textElem.innerHTML = '🌐 Todos os Módulos (Enxame Global)';
        if (clearBtn) clearBtn.style.display = 'none';
        if (banner) banner.innerHTML = '<strong>Filtro Ativo:</strong> Todos os módulos e links.';
    } else {
        const labelMap = {
            module: `Módulo ${value}`,
            pair: `Par ${String(value).replace('<->', '↔')}`,
            direction: `Sentido ${String(value).replace('->', '→')}`
        };
        const filterTitle = labelMap[mode] || value;
        if (textElem) textElem.innerHTML = `🎯 <strong>Isolado:</strong> <span style="color:var(--cyan);">${escapeHtml(filterTitle)}</span>`;
        if (clearBtn) clearBtn.style.display = 'inline-block';
        if (banner) banner.innerHTML = `<strong>Filtro Científico Ativo:</strong> ${escapeHtml(filterTitle)}`;
    }

    renderLiveNodeCards(LiveState.nodes);
    renderLiveLinkChips();
    
    // Sincronizar com o componente unificado de gráficos se instanciado
    if (LiveState.unifiedChart) {
        if (mode === 'all') {
            LiveState.unifiedChart.clearFilters();
        } else if (mode === 'module') {
            LiveState.unifiedChart.filters.hideAllLinks = false;
            LiveState.unifiedChart.filters.modules.clear();
            LiveState.unifiedChart.filters.pairs.clear();
            LiveState.unifiedChart.filters.directions.clear();
            const clean = String(value || '').replace(/^0x/i, '').padStart(4, '0');
            LiveState.unifiedChart.filters.modules.add(clean);
            document.querySelectorAll(`.live-chart-cb-mod`).forEach(cb => { cb.checked = (cb.value === clean); });
            document.querySelectorAll(`.live-chart-cb-pair, .live-chart-cb-dir`).forEach(cb => { cb.checked = false; });
            if (typeof LiveState.unifiedChart.renderQuickLinkChips === 'function') LiveState.unifiedChart.renderQuickLinkChips(true);
            LiveState.unifiedChart.applyFiltersAndRebuild();
        } else if (mode === 'pair') {
            LiveState.unifiedChart.filters.hideAllLinks = false;
            LiveState.unifiedChart.filters.modules.clear();
            LiveState.unifiedChart.filters.pairs.clear();
            LiveState.unifiedChart.filters.directions.clear();
            const parts = String(value || '').split('<->').map(s => s.trim().replace(/^0x/i, '').padStart(4, '0'));
            const pairKey = parts.sort().join('-');
            LiveState.unifiedChart.filters.pairs.add(pairKey);
            document.querySelectorAll(`.live-chart-cb-pair`).forEach(cb => { cb.checked = (cb.value === pairKey); });
            document.querySelectorAll(`.live-chart-cb-mod, .live-chart-cb-dir`).forEach(cb => { cb.checked = false; });
            if (typeof LiveState.unifiedChart.renderQuickLinkChips === 'function') LiveState.unifiedChart.renderQuickLinkChips(true);
            LiveState.unifiedChart.applyFiltersAndRebuild();
        } else if (mode === 'direction') {
            LiveState.unifiedChart.filters.hideAllLinks = false;
            LiveState.unifiedChart.filters.modules.clear();
            LiveState.unifiedChart.filters.pairs.clear();
            LiveState.unifiedChart.filters.directions.clear();
            const parts = String(value || '').split('->').map(s => s.trim().replace(/^0x/i, '').padStart(4, '0'));
            const dirKey = `${parts[0]}->${parts[1]}`;
            LiveState.unifiedChart.filters.directions.add(dirKey);
            document.querySelectorAll(`.live-chart-cb-dir`).forEach(cb => { cb.checked = (cb.value === dirKey); });
            document.querySelectorAll(`.live-chart-cb-mod, .live-chart-cb-pair`).forEach(cb => { cb.checked = false; });
            if (typeof LiveState.unifiedChart.renderQuickLinkChips === 'function') LiveState.unifiedChart.renderQuickLinkChips(true);
            LiveState.unifiedChart.applyFiltersAndRebuild();
        }
    }

    rebuildLiveChartFromBuffer();
    filterLiveConsole();
    renderLiveTelemetryTable();
}
window.setLiveEntityFilter = setLiveEntityFilter;

let _lastLiveTableRenderMs = 0;
function renderLiveTelemetryTable(force = true) {
    const nowTblMs = performance.now();
    if (!force && (nowTblMs - _lastLiveTableRenderMs) < 250) {
        return;
    }
    _lastLiveTableRenderMs = nowTblMs;

    const tbody = document.getElementById('live-telemetry-table-body');
    const countBadge = document.getElementById('live-table-count-badge');
    if (!tbody) return;

    const buf = LiveState.historyBuffer;
    const recent = [];
    for (let i = buf.length - 1; i >= 0; i--) {
        const pt = buf[i];
        if (matchesLiveEntityFilter(pt)) {
            recent.push(pt);
            if (recent.length >= 50) break;
        }
    }

    if (countBadge) {
        if (!LiveState.activeEntityFilter || LiveState.activeEntityFilter === 'all') {
            countBadge.textContent = `${buf.length} de ${buf.length} registos em memória`;
        } else {
            let matchCount = 0;
            for (let i = 0; i < buf.length; i++) {
                if (matchesLiveEntityFilter(buf[i])) matchCount++;
            }
            countBadge.textContent = `${matchCount} de ${buf.length} registos em memória`;
        }
    }

    if (recent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--text-muted); padding:14px;">Nenhuma mensagem corresponde ao filtro ativo ou a aguardar receção UART...</td></tr>`;
        return;
    }

    const msgMap = new Map();
    const msgsTail = LiveState.messages;
    const msgStart = Math.max(0, msgsTail.length - 400);
    for (let i = msgStart; i < msgsTail.length; i++) {
        msgMap.set(msgsTail[i].id, msgsTail[i]);
    }

    tbody.innerHTML = recent.map(pt => {
        const rawMsg = msgMap.get(pt.id) || {};
        const p = rawMsg.parsed || {};
        const isTdoa = (pt.type === 'tdoa' || p.mode === 'TDoA' || (pt.linkKey && pt.linkKey.includes(':tdoa')));
        const phyBadge = isTdoa
            ? `<span class="prov-badge prov-model" title="One-Way Ranging com Relógios Sincronizados">OWR Sync</span>`
            : `<span class="prov-badge prov-firmware" title="Double-Sided / Single-Sided Two-Way Ranging">DS-TWR</span>`;

        const distHtml = (pt.dist_m !== null && pt.dist_m !== undefined)
            ? `<strong style="color:var(--cyan);">${Number(pt.dist_m).toFixed(4)} m</strong>`
            : `<span style="color:var(--text-muted);">«Não fornecido»</span>`;

        const tofHtml = (pt.tdoa_diff !== null && pt.tdoa_diff !== undefined)
            ? `${Number(pt.tdoa_diff).toFixed(3)} ns`
            : `<span style="color:var(--text-muted);">--</span>`;

        const driftHtml = (pt.clock_drift_ppm !== null && pt.clock_drift_ppm !== undefined)
            ? `${Number(pt.clock_drift_ppm) >= 0 ? '+' : ''}${Number(pt.clock_drift_ppm).toFixed(3)} ppm`
            : `<span style="color:var(--text-muted);">--</span>`;

        const rssiStr = (pt.prx_dbm !== null && pt.prx_dbm !== undefined)
            ? `${Number(pt.prx_dbm).toFixed(1)} dBm`
            : (pt.fp_dbm !== null && pt.fp_dbm !== undefined ? `Fp: ${Number(pt.fp_dbm).toFixed(1)} dBm` : '<span style="color:var(--text-muted);">--</span>');

        const seqAnomaly = p.seq_anomaly || rawMsg.seq_anomaly || 'OK';
        const statusHtml = seqAnomaly === 'OK'
            ? `<span class="badge badge-emerald" style="font-size:9.5px;">VÁLIDO</span>`
            : `<span class="badge badge-amber" style="font-size:9.5px;" title="Anomalia de continuidade detetada no contador seq">${escapeHtml(seqAnomaly)}</span>`;

        // Discriminacao cristalina de Sequencia: Ciclo Normalizado vs Seq Bruta do Hardware
        const cycleNum = pt.algo_cycle || pt.seq || pt.id;
        const rawSeqNum = (pt.seq_raw !== undefined && pt.seq_raw !== null)
            ? pt.seq_raw
            : (rawMsg.seq_raw !== undefined && rawMsg.seq_raw !== null ? rawMsg.seq_raw : pt.seq);
        const rawSeqLabel = isTdoa ? `Beacon #${rawSeqNum}` : `Ronda #${rawSeqNum}`;

        const tlStr = pt.t_local_us !== null && pt.t_local_us !== undefined ? `${(Number(pt.t_local_us) / 1e6).toFixed(6)}s` : '--';
        const tgStr = pt.t_global_us !== null && pt.t_global_us !== undefined ? `${(Number(pt.t_global_us) / 1e6).toFixed(6)}s` : '--';

        return `
            <tr onclick="inspectLiveRecord(${pt.id})" style="cursor:pointer;" title="Clique para auditar proveniência e registo bruto (ID #${pt.id})">
                <td class="mono-cell">
                    <div style="font-weight:700; color:var(--cyan);" title="Processado pela Aplicação: Contador de Ciclo Normalizado no PC">Ciclo #${cycleNum}</div>
                    <div style="font-size:10px; color:#94a3b8; white-space:nowrap;" title="Telemetrado pelo Módulo: Contador de Hardware DW3000">HW: ${escapeHtml(rawSeqLabel)}</div>
                </td>
                <td class="mono-cell" title="Telemetrado pelo Módulo: Transmissor e Recetor">0x${escapeHtml(pt.src)} → 0x${escapeHtml(pt.dst)}</td>
                <td class="mono-cell" title="Processado pela Aplicação: Classificação de Modelo">${phyBadge}</td>
                <td class="mono-cell" style="font-size:10.5px;" title="Telemetrado pelo Módulo: TL (Local nRF52) e TG (Global sincronizado)">
                    <div>TL: <span style="color:#cbd5e1;">${tlStr}</span></div>
                    <div>TG: <span style="color:var(--cyan);">${tgStr}</span></div>
                </td>
                <td class="mono-cell" style="font-size:10.5px;" title="Processado pela Aplicação: Timestamp do relógio do Host PC na porta série">
                    <div>${escapeHtml(pt.time_str || '--')}</div>
                    <div style="color:var(--text-muted);">(+${Number(pt.elapsed_s || 0).toFixed(2)}s)</div>
                </td>
                <td class="mono-cell" title="Telemetrado pelo Módulo: Distância calculada pelo nó UWB">${distHtml}</td>
                <td class="mono-cell" title="Telemetrado pelo Módulo: ToF / Diferença de tempos medido no nó">${tofHtml}</td>
                <td class="mono-cell" title="Telemetrado pelo Módulo: Clock Frequency Offset">${driftHtml}</td>
                <td class="mono-cell" style="font-size:10.5px;" title="Telemetrado pelo Módulo: Potência de receção RF">${rssiStr}</td>
                <td title="Processado pela Aplicação: Auditoria SciMetrics">${statusHtml}</td>
                <td style="text-align:center;"><button type="button" class="btn btn-outline btn-xs" style="padding:2px 6px; font-size:10px;">🔍 Ver</button></td>
            </tr>
        `;
    }).join('');
}
window.renderLiveTelemetryTable = renderLiveTelemetryTable;

function updateLiveIntegrityAndRates(statusData) {
    if (!statusData) return;
    const setEl = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    };

    const fRf = statusData.radio_phy_freq_hz || statusData.tdoa_freq_hz || 0;
    const kSync = (statusData.sync_period_s !== undefined && statusData.sync_period_s !== null) ? statusData.sync_period_s : LiveState.syncPeriod_s;
    const fProto = kSync === 0 ? (statusData.twr_freq_hz || fRf) : (statusData.twr_freq_hz || (kSync > 0 ? 1.0 / kSync : 0));

    // Calcular f_uart_tx_hz e f_host_rx_hz a partir dos nós ativos
    let totalUartHz = 0;
    let totalHostHz = 0;
    if (statusData.nodes) {
        Object.values(statusData.nodes).forEach(n => {
            if (n.is_online) {
                totalUartHz += (n.f_rx_observed_hz || 0);
                totalHostHz += (n.f_pc_arrival_hz || 0);
            }
        });
    }

    setEl('live-5freq-rf', fRf > 0 ? `${fRf.toFixed(1)} Hz` : '-- Hz');
    setEl('live-5freq-proto', fProto > 0 ? `${fProto.toFixed(1)} Hz` : '-- Hz');
    setEl('live-5freq-uart', totalUartHz > 0 ? `${totalUartHz.toFixed(1)} Hz` : '-- Hz');
    setEl('live-5freq-host', totalHostHz > 0 ? `${totalHostHz.toFixed(1)} Hz` : '-- Hz');
    setEl('live-5freq-ui', '4.0 Hz (250 ms)');

    setEl('live-int-valid', String(statusData.valid_packets !== undefined ? statusData.valid_packets : LiveState.historyBuffer.length));
    setEl('live-int-lost', String(statusData.dropped_packets_rf || 0));
    setEl('live-int-dup', String(statusData.duplicate_packets || 0));
    setEl('live-int-ooo', String(statusData.out_of_order_packets || 0));
    setEl('live-int-invalid', String((statusData.invalid_packets || 0) + (statusData.parse_error_lines || 0)));
}
window.updateLiveIntegrityAndRates = updateLiveIntegrityAndRates;

function exportLiveFilteredCsv() {
    const filteredPts = LiveState.historyBuffer.filter(pt => matchesLiveEntityFilter(pt));
    if (filteredPts.length === 0) {
        showToast('Nenhum registo na sessão Live corresponde ao filtro ativo para exportar.', 'warning');
        return;
    }
    const headers = ['id', 'seq', 'src_addr', 'dst_addr', 'protocol', 't_local_us', 't_global_us', 'elapsed_s', 'host_time', 'dist_m', 'tof_ns', 'clock_drift_ppm', 'rate_hz'];
    const lines = [headers.join(',')];
    filteredPts.forEach(pt => {
        const proto = (pt.linkKey && pt.linkKey.includes(':tdoa')) ? 'OWR_TDoA' : 'DS_TWR';
        const row = [
            pt.id ?? '',
            pt.seq ?? '',
            `0x${pt.src || ''}`,
            `0x${pt.dst || ''}`,
            proto,
            pt.t_local_us ?? '',
            pt.t_global_us ?? '',
            pt.elapsed_s !== undefined ? Number(pt.elapsed_s).toFixed(6) : '',
            `"${pt.time_full || pt.time_str || ''}"`,
            pt.dist_m ?? '',
            pt.tdoa_diff ?? '',
            pt.clock_drift_ppm ?? '',
            pt.rate_hz ?? ''
        ];
        lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swarmloc_live_filtered_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exportados ${filteredPts.length} registos Live filtrados para CSV.`, 'success');
}
window.exportLiveFilteredCsv = exportLiveFilteredCsv;


// ============================================================================
// TABELA DINÂMICA DO ENXAME: ROTAÇÃO DO MASTER E DISTÂNCIAS POR MÓDULO (E8.45)
// ============================================================================
function renderSwarmDynamicTable(data) {
    const tbody = document.getElementById('live-swarm-dynamic-table-body');
    const slotBadge = document.getElementById('live-swarm-slot-badge');
    const masterBadge = document.getElementById('live-swarm-master-badge');
    if (!tbody) return;

    const rot = (data && data.master_rotation) || {};
    const activeMaster = rot.current_master_id || LiveState.currentMasterId || '0001';
    const nodes = (data && data.nodes) || {};

    if (masterBadge) {
        masterBadge.textContent = `Master Atual: 0x${activeMaster}`;
    }
    if (slotBadge) {
        const slotNum = parseInt(activeMaster, 16) || 1;
        slotBadge.textContent = `Slot ${slotNum} (M${slotNum}) | Ciclo 60s`;
    }

    // Geometria 1D colinear confirmada (E8.46): x1=0, x3=0.30m, x2=0.55m, x4=0.85m
    const refMap = {
        '0001-0002': { ref: 0.55, u: 0.015, origin: 'DIRETA' },
        '0002-0001': { ref: 0.55, u: 0.015, origin: 'DIRETA' },
        '0001-0003': { ref: 0.30, u: 0.015, origin: 'DIRETA' },
        '0003-0001': { ref: 0.30, u: 0.015, origin: 'DIRETA' },
        '0001-0004': { ref: 0.85, u: 0.015, origin: 'DIRETA' },
        '0004-0001': { ref: 0.85, u: 0.015, origin: 'DIRETA' },
        '0002-0003': { ref: 0.25, u: 0.030, origin: 'DERIVADA' },
        '0003-0002': { ref: 0.25, u: 0.030, origin: 'DERIVADA' },
        '0002-0004': { ref: 0.30, u: 0.030, origin: 'DERIVADA' },
        '0004-0002': { ref: 0.30, u: 0.030, origin: 'DERIVADA' },
        '0003-0004': { ref: 0.55, u: 0.030, origin: 'DERIVADA' },
        '0004-0003': { ref: 0.55, u: 0.030, origin: 'DERIVADA' }
    };

    const swarmNodeIds = ['0001', '0002', '0003', '0004', '0005', '0006'];
    let html = '';

    swarmNodeIds.forEach(nodeId => {
        const nState = nodes[nodeId] || {};
        const isSelfMaster = (nodeId === activeMaster);

        let distHtml = '';
        let tgHtml = '';
        let syncHtml = '';
        let validHtml = '';

        if (isSelfMaster) {
            distHtml = `<span style="color:var(--amber); font-weight:700;">👑 Nó Referência (Master)</span>`;
            tgHtml = nState.t_global_s ? `<span class="mono-cell">${Number(nState.t_global_s).toFixed(6)} s</span>` : `<span style="color:var(--text-muted); font-size:11px;">Origem de Tempo (0.000s)</span>`;
            syncHtml = `<span class="badge badge-emerald">Origem Relógio (Master)</span>`;
            validHtml = `<span class="prov-badge prov-module">Referência Ativa</span>`;
        } else {
            const pairKey = `${activeMaster}-${nodeId}`;
            const refEntry = refMap[pairKey];
            const measDist = nState.last_dist_m;

            if (measDist !== null && measDist !== undefined && nState.is_online) {
                const distNum = Number(measDist);
                if (refEntry !== undefined) {
                    const refDist = refEntry.ref;
                    const errMm = (distNum - refDist) * 1000.0;
                    const originTag = (refEntry.origin === 'DIRETA') ? 'Direta ±15mm' : 'Derivada ±30mm';
                    distHtml = `<strong>${distNum.toFixed(4)} m</strong> <span style="font-size:10px; color:var(--text-muted);">(Ref: ${refDist.toFixed(3)}m [${originTag}], Δ: ${errMm > 0 ? '+' : ''}${errMm.toFixed(1)}mm)</span>`;
                } else {
                    distHtml = `<strong>${distNum.toFixed(4)} m</strong> <span style="font-size:10px; color:var(--text-muted);">(Sem Referência)</span>`;
                }
            } else {
                distHtml = `<span style="color:var(--text-muted); font-style:italic;">Sem medição recente</span>`;
            }

            if (nState.t_global_s && nState.is_online) {
                tgHtml = `<span class="mono-cell">${Number(nState.t_global_s).toFixed(6)} s</span>`;
            } else {
                tgHtml = `<span style="color:var(--text-muted); font-size:11px;">Sem TG válido</span>`;
            }

            if (nState.is_online) {
                const rawPairs = Number(nState.calib_pairs);
                if (Number.isFinite(rawPairs) && rawPairs >= 0) {
                    syncHtml = `<span class="badge badge-emerald">Sincronizado (${rawPairs} pares)</span>`;
                } else {
                    syncHtml = `<span class="badge badge-gray">Sincronização Desconhecida</span>`;
                }
            } else {
                syncHtml = `<span class="badge badge-gray">Sincronização Inválida</span>`;
            }

            if (measDist !== null && measDist !== undefined && nState.is_online) {
                validHtml = `<span class="badge badge-emerald">Válida</span>`;
            } else if (!nState.is_online) {
                validHtml = `<span class="badge badge-gray">Nó Desconectado</span>`;
            } else {
                validHtml = `<span class="badge badge-rose">Medição Rejeitada</span>`;
            }
        }

        html += `<tr>
            <td style="text-align:center;"><strong style="color:var(--amber);">0x${activeMaster}</strong></td>
            <td style="text-align:center;"><strong style="color:var(--cyan);">0x${nodeId}</strong></td>
            <td style="text-align:right;">${distHtml}</td>
            <td style="text-align:right;">${tgHtml}</td>
            <td style="text-align:center;">${syncHtml}</td>
            <td style="text-align:center;">${validHtml}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
}
window.renderSwarmDynamicTable = renderSwarmDynamicTable;


// ============================================================================
// GESTÃO DA DOCUMENTAÇÃO INTERATIVA & ATUALIZAÇÃO VIA WEB (E8.50)
// ============================================================================

async function checkDocsStatus() {
    try {
        const resp = await fetch('/api/docs/status');
        if (resp.ok) {
            const data = await resp.json();
            const badge = document.getElementById('docs-update-status');
            if (badge) {
                if (data.exists) {
                    badge.textContent = `Atualizada: ${data.last_update}`;
                    badge.style.color = '#10B981';
                    badge.style.background = 'rgba(16, 185, 129, 0.15)';
                    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                } else {
                    badge.textContent = 'Não Gerada (Clique em Atualizar)';
                    badge.style.color = '#F59E0B';
                    badge.style.background = 'rgba(245, 158, 11, 0.15)';
                    badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                }
            }
        }
    } catch (e) {
        console.warn('Falha ao verificar estado da documentação:', e);
    }
}

async function updateDocumentation() {
    const btn = document.getElementById('btn-update-docs');
    const textSpan = document.getElementById('text-update-docs');
    const icon = document.getElementById('icon-update-docs');
    const badge = document.getElementById('docs-update-status');
    const frame = document.getElementById('docs-frame');

    if (btn) btn.disabled = true;
    if (textSpan) textSpan.textContent = 'A Atualizar (Doxygen + Graphviz)...';
    if (badge) {
        badge.textContent = 'A Compilar AST e Diagramas...';
        badge.style.color = '#38BDF8';
        badge.style.background = 'rgba(56, 189, 248, 0.15)';
    }

    try {
        const res = await fetch('/api/docs/update', { method: 'POST' });
        const data = await res.json();
        
        if (res.ok && data.status === 'ok') {
            if (badge) {
                badge.textContent = `Atualizada: ${data.last_update}`;
                badge.style.color = '#10B981';
                badge.style.background = 'rgba(16, 185, 129, 0.15)';
            }
            // Recarrega o iframe de documentacao com a versao fresca
            if (frame) {
                frame.src = '/docs/doxygen/html/index.html?t=' + Date.now();
            }
            alert('Documentação interativa e grafos AST atualizados com sucesso!');
        } else {
            throw new Error(data.message || 'Erro desconhecido');
        }
    } catch (err) {
        console.error('Erro ao atualizar documentação:', err);
        alert('Erro ao atualizar documentação: ' + err.message);
        if (badge) {
            badge.textContent = 'Erro ao Atualizar';
            badge.style.color = '#EF4444';
            badge.style.background = 'rgba(239, 68, 68, 0.15)';
        }
    } finally {
        if (btn) btn.disabled = false;
        if (textSpan) textSpan.textContent = 'Atualizar Documentação';
    }
}

window.checkDocsStatus = checkDocsStatus;
window.updateDocumentation = updateDocumentation;

// Inicializa verificação de estado quando a aba for aberta
document.addEventListener('DOMContentLoaded', () => {
    checkDocsStatus();
});


// ==============================================================================
// GESTÃO E ACESSO A GRAVAÇÕES DE TELEMETRIA EM TEMPO REAL (LIVE STREAM)
// ==============================================================================

async function openLiveRecordingsModal(notificationMsg = null) {
    const modal = document.getElementById('live-recordings-modal');
    if (!modal) return;
    modal.classList.add('active');

    const notifEl = document.getElementById('live-recordings-notification');
    const notifTxt = document.getElementById('live-recordings-notification-text');
    if (notifEl && notifTxt) {
        if (notificationMsg) {
            notifTxt.innerHTML = notificationMsg;
            notifEl.style.display = 'flex';
        } else {
            notifEl.style.display = 'none';
        }
    }

    await loadLiveRecordingsList();
}
window.openLiveRecordingsModal = openLiveRecordingsModal;

function closeLiveRecordingsModal() {
    const modal = document.getElementById('live-recordings-modal');
    if (modal) modal.classList.remove('active');
}
window.closeLiveRecordingsModal = closeLiveRecordingsModal;

async function loadLiveRecordingsList() {
    const container = document.getElementById('live-recordings-table-container');
    if (!container) return;

    try {
        const resp = await fetch('/api/live/recordings');
        const data = await resp.json();
        const recordings = data.recordings || [];

        const headerBadge = document.getElementById('header-recordings-count');
        if (headerBadge) {
            headerBadge.textContent = recordings.length;
        }
        const badge = document.getElementById('live-recordings-count-badge');
        if (badge) {
            if (recordings.length > 0) {
                badge.textContent = recordings.length;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        if (recordings.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted); background: var(--bg-surface); border-radius: var(--radius-md); border: 1px dashed var(--border-default);">
                    <div style="font-size: 28px; margin-bottom: 8px;">📂</div>
                    <div style="font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Nenhuma Gravação de Stream Encontrada</div>
                    <div style="font-size: 12px;">Para gravar uma sessão, clique em <strong>⏺ Gravar Stream</strong> no painel de controlo live durante a receção de pacotes.</div>
                </div>
            `;
            return;
        }

        let html = `
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="border-bottom: 1px solid var(--border-default); text-align: left; background: var(--bg-surface);">
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600;">Ficheiro da Sessão</th>
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600;">Data / Hora</th>
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600;">Registos</th>
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600;">Duração</th>
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600;">Tamanho</th>
                        <th style="padding: 10px 12px; color: var(--text-muted); font-weight: 600; text-align: right;">Ações</th>
                    </tr>
                </thead>
                <tbody>
        `;

        recordings.forEach(rec => {
            const safeFn = rec.filename.replace(/'/g, "\\'");
            html += `
                <tr style="border-bottom: 1px solid var(--border-default); transition: background 0.15s ease;" onmouseover="this.style.background='var(--bg-surface-hover)'" onmouseout="this.style.background=''">
                    <td style="padding: 10px 12px; font-family: var(--font-mono); font-weight: 600; color: var(--cyan);">
                        ${rec.filename}
                    </td>
                    <td style="padding: 10px 12px; color: var(--text-main);">
                        ${rec.created_at}
                    </td>
                    <td style="padding: 10px 12px; font-family: var(--font-mono); color: var(--emerald); font-weight: 700;">
                        ${rec.records_count.toLocaleString()}
                    </td>
                    <td style="padding: 10px 12px; color: var(--text-muted);">
                        ${rec.duration_s > 0 ? rec.duration_s + ' s' : '--'}
                    </td>
                    <td style="padding: 10px 12px; font-family: var(--font-mono); color: var(--text-muted);">
                        ${rec.size_formatted}
                    </td>
                    <td style="padding: 10px 12px; text-align: right;">
                        <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                            <button class="btn btn-primary btn-xs" onclick="loadLiveRecordingIntoSciMetrics('${safeFn}')" title="Carregar esta gravação diretamente para o motor SciMetrics" style="font-weight: 600; background: linear-gradient(135deg, #0284c7, #0369a1);">
                                🔬 SciMetrics
                            </button>
                            <a class="btn btn-secondary btn-xs" href="/api/live/recordings/download?file=${encodeURIComponent(rec.filename)}&format=jsonl" download="${rec.filename}" title="Descarregar ficheiro bruto JSONL" style="text-decoration:none;">
                                📥 JSONL
                            </a>
                            <a class="btn btn-secondary btn-xs" href="/api/live/recordings/download?file=${encodeURIComponent(rec.filename)}&format=csv" download="${rec.filename.replace('.jsonl', '.csv')}" title="Exportar e descarregar tabela em CSV" style="text-decoration:none; color:var(--emerald); border-color:rgba(16,185,129,0.3);">
                                📊 CSV
                            </a>
                            <button class="btn btn-outline btn-xs" onclick="deleteLiveRecording('${safeFn}')" title="Eliminar gravação definitivamente" style="color:var(--red); border-color:rgba(239, 68, 68, 0.3); padding: 2px 6px;">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    } catch (e) {
        console.error('Erro ao carregar gravações:', e);
        container.innerHTML = `<div style="color:var(--red); padding:20px; text-align:center;">Erro ao carregar lista de gravações: ${e.message}</div>`;
    }
}
window.loadLiveRecordingsList = loadLiveRecordingsList;

async function loadLiveRecordingIntoSciMetrics(filename) {
    showToast(`A processar e carregar sessão ${filename} no SciMetrics...`, 'info');
    try {
        const resp = await fetch('/api/live/recordings/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            closeLiveRecordingsModal();
            showToast(`Sucesso! ${data.records_count} registos carregados no SciMetrics.`, 'success');
            // Mudar para o separador de Análise / SciMetrics
            if (typeof switchView === 'function') {
                switchView('analysis');
            }
            if (typeof loadTrialDetail === 'function') {
                await loadTrialDetail(data.trial_id);
            }
            if (typeof loadCatalog === 'function') {
                loadCatalog();
            }
        } else {
            showToast(`Erro ao carregar gravação: ${data.message || 'Desconhecido'}`, 'error');
        }
    } catch (e) {
        showToast(`Falha de rede ao carregar gravação: ${e.message}`, 'error');
    }
}
window.loadLiveRecordingIntoSciMetrics = loadLiveRecordingIntoSciMetrics;

async function deleteLiveRecording(filename) {
    if (!confirm(`Tem a certeza que deseja eliminar a gravação "${filename}" permanentemente?`)) {
        return;
    }
    try {
        const resp = await fetch('/api/live/recordings/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            showToast(`Gravação ${filename} eliminada com sucesso.`, 'info');
            loadLiveRecordingsList();
        } else {
            showToast(`Erro ao eliminar: ${data.message}`, 'error');
        }
    } catch (e) {
        showToast(`Erro de rede ao eliminar gravação: ${e.message}`, 'error');
    }
}
window.deleteLiveRecording = deleteLiveRecording;

// Atualização da contagem de gravações ao arrancar
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/live/recordings')
        .then(r => r.json())
        .then(d => {
            const cnt = (d.recordings || []).length;
            const badge = document.getElementById('live-recordings-count-badge');
            if (badge && cnt > 0) {
                badge.textContent = cnt;
                badge.style.display = 'inline-block';
            }
        }).catch(() => {});
});
