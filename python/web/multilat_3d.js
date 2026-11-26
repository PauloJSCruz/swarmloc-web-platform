/**
 * ==============================================================================
 * SwarmLoc UWB - Interactive 3D Trajectory & Multilateration Visualizer
 * ==============================================================================
 * Pure HTML5 Canvas 3D Projection Engine (100% Vanilla JS, Zero External CDNs,
 * Strictly Offline Operation).
 *
 * Features:
 * - Interactive 3D rotation (left-click drag), zoom (mouse wheel), pan (right-click / Shift+drag).
 * - Cartesian axes X (Red), Y (Green), Z (Blue) with Z=0 ground plane grid.
 * - Stylized 3D anchor cubes with node badges (0x0001 .. 0x0006).
 * - 3D trajectory polyline with temporal points, ground shadow & vertical drop lines.
 * - Quick camera preset controls: Isometric, Top (XY), Front (XZ), Side (YZ), Reset, Auto-Rotação.
 * - Spatial metrics HUD: Current Position (X, Y, Z), Dispersion (σx, σy, σz),
 *   Mean RMS Residual, CEP 50%, CEP 95%.
 * - Collapsible anchor coordinate editor table with instant recalculation via /api/anchors.
 * ==============================================================================
 */

(function () {
    'use strict';

    const DEFAULT_ANCHORS_JS = {
        '0x0001': [0.0, 0.0, 1.5],
        '0x0002': [5.0, 0.0, 1.5],
        '0x0003': [0.0, 5.0, 1.5],
        '0x0004': [5.0, 5.0, 2.5],
        '0x0005': [2.5, 0.0, 1.5],
        '0x0006': [2.5, 5.0, 2.5]
    };

    const ANCHOR_COLORS = {
        '0x0001': '#00e5ff',
        '0x0002': '#00f59b',
        '0x0003': '#ffb703',
        '0x0004': '#f72585',
        '0x0005': '#14b8a6',
        '0x0006': '#fb7185'
    };

    class SwarmLoc3DVisualizer {
        constructor(options = {}) {
            this.containerId = options.containerId || 'multilat-3d-root';
            this.mode = options.mode || 'trial'; // 'trial' | 'live'
            this.trialId = options.trialId || null;

            this.anchors = JSON.parse(JSON.stringify(DEFAULT_ANCHORS_JS));
            this.trajectory = [];
            this.currentPosition = null;
            this.stats = {
                count: 0,
                mean_pos: [0.0, 0.0, 0.0],
                std_pos: [0.0, 0.0, 0.0],
                mean_residual_rms: 0.0,
                cep50_m: 0.0,
                cep95_m: 0.0
            };
            this.solverStatus = 'IDLE';
            this.distinctAnchorsCount = 0;

            // Camera state (spherical orbit + pan offset)
            this.camera = {
                yaw: -Math.PI * 0.25,     // Azimuth angle (rad)
                pitch: Math.PI * 0.20,    // Elevation angle (rad)
                zoom: 52.0,               // Pixels per meter base scale
                panX: 0,
                panY: 0,
                targetX: 2.5,
                targetY: 2.5,
                targetZ: 1.0,
                viewPreset: 'Isometric',
                autoRotate: false
            };

            this.interaction = {
                isDragging: false,
                dragMode: 'rotate', // 'rotate' | 'pan'
                lastX: 0,
                lastY: 0,
                hoveredPoint: null
            };

            this.anchorsEditorCollapsed = true;
            this.canvas = null;
            this.ctx = null;
            this.animFrameId = null;
            this.liveTimerId = null;
            this._mounted = false;
        }

        mount(containerId) {
            if (containerId) this.containerId = containerId;
            const root = document.getElementById(this.containerId);
            if (!root) return false;

            if (!this._mounted || !root.querySelector('.multilat-3d-shell')) {
                this._buildDom(root);
                this._mounted = true;
            }
            this._resizeCanvas();
            this._startRenderLoop();
            return true;
        }

        _buildDom(root) {
            const prefix = this.containerId;
            root.innerHTML = `
                <div class="multilat-3d-shell" style="display:flex; flex-direction:column; gap:12px;">
                    <!-- Toolbar Superior: Controles de Vista Rápida & Modo -->
                    <div class="card" style="padding:10px 14px; border:1px solid rgba(56,189,248,0.3); background:rgba(15,23,42,0.85);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span style="font-size:12.5px; font-weight:800; color:var(--cyan); text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:6px;">
                                    <span>🌐</span> Posicionamento &amp; Trajetória 3D (Multilateração Euclidiana)
                                </span>
                                <span id="${prefix}-status-badge" class="badge badge-cyan" style="font-family:var(--font-mono); font-size:10.5px;">A aguardar dados</span>
                            </div>

                            <!-- Botões de Vista Rápida (Camera Presets) -->
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                <span style="font-size:10.5px; color:var(--text-muted); font-weight:600; text-transform:uppercase; margin-right:2px;">Vista:</span>
                                <button type="button" class="btn btn-outline btn-xs ${prefix}-preset-btn active" data-preset="Isometric" title="Projeção Isométrica 3D">Isometric</button>
                                <button type="button" class="btn btn-outline btn-xs ${prefix}-preset-btn" data-preset="Top" title="Vista Superior — Plano Horizontal XY">Top (XY)</button>
                                <button type="button" class="btn btn-outline btn-xs ${prefix}-preset-btn" data-preset="Front" title="Vista Frontal — Plano Vertical XZ">Front (XZ)</button>
                                <button type="button" class="btn btn-outline btn-xs ${prefix}-preset-btn" data-preset="Side" title="Vista Lateral — Plano Vertical YZ">Side (YZ)</button>
                                <button type="button" class="btn btn-outline btn-xs" id="${prefix}-btn-reset" title="Repor câmara e enquadramento 3D">Reset</button>
                                <button type="button" class="btn btn-outline btn-xs" id="${prefix}-btn-autorotate" title="Alternar rotação orbital contínua">⟳ Auto-Rotação</button>
                                <button type="button" class="btn btn-secondary btn-xs" id="${prefix}-btn-toggle-anchors" style="border-color:rgba(16,185,129,0.45); color:var(--emerald); font-weight:600;">
                                    📐 Editar Âncoras (X,Y,Z)
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Mini-Tabela Colapsável para Edição de Coordenadas (X, Y, Z) das Âncoras -->
                    <div id="${prefix}-anchors-drawer" class="card" style="display:none; padding:12px 16px; border:1px solid rgba(16,185,129,0.4); background:rgba(15,23,42,0.92);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
                            <div>
                                <div style="font-size:12.5px; font-weight:700; color:var(--emerald);">📐 Configuração Espacial das Âncoras UWB (Metros)</div>
                                <div style="font-size:11px; color:var(--text-muted);">Edite as coordenadas cartesianas (X, Y, Z) de cada módulo e clique em <strong>Guardar &amp; Recalcular 3D</strong>. Nota: As 4 âncoras ativas não devem ser coplanares (evitar todas com o mesmo Z).</div>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <button type="button" class="btn btn-outline btn-xs" id="${prefix}-btn-anchors-default" title="Restaurar coordenadas padrão de fábrica">Repor Padrão</button>
                                <button type="button" class="btn btn-emerald btn-xs" id="${prefix}-btn-anchors-save" style="font-weight:700;">💾 Guardar &amp; Recalcular 3D</button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="scientific-table" style="font-size:11.5px;">
                                <thead>
                                    <tr>
                                        <th>Módulo (Node ID)</th>
                                        <th>X (m) — Leste/Largura</th>
                                        <th>Y (m) — Norte/Comprimento</th>
                                        <th>Z (m) — Cota/Altura</th>
                                        <th>Estado no Volume</th>
                                    </tr>
                                </thead>
                                <tbody id="${prefix}-anchors-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Área Principal: Viewport 3D Canvas + Painel Lateral HUD de Métricas Espaciais -->
                    <div style="display:grid; grid-template-columns: minmax(0, 1fr) 310px; gap:12px; align-items:stretch;" class="multilat-3d-main-grid">
                        <!-- Viewport 3D HTML5 Canvas (Injetado Dinamicamente via JS) -->
                        <div class="card" style="padding:0; position:relative; overflow:hidden; min-height:460px; border:1px solid rgba(56,189,248,0.28); background:#070b14; display:flex; flex-direction:column;">
                            <div id="${prefix}-canvas-host" style="width:100%; height:460px; position:relative; cursor:grab;"></div>
                            <!-- Legenda Inferior Sobposta no Canvas -->
                            <div style="padding:6px 12px; background:rgba(15,23,42,0.9); border-top:1px solid rgba(255,255,255,0.07); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:10.5px; font-family:var(--font-mono); color:#94a3b8;">
                                <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                                    <span><strong style="color:#ef4444;">━━ Eixo X</strong> (m)</span>
                                    <span><strong style="color:#22c55e;">━━ Eixo Y</strong> (m)</span>
                                    <span><strong style="color:#3b82f6;">━━ Eixo Z</strong> (m)</span>
                                    <span><strong style="color:#38bdf8;">●──● Trajetória 3D</strong></span>
                                    <span><strong style="color:#facc15;">◉ Posição Atual</strong></span>
                                </div>
                                <div>Arrastar Esq: Rodar 3D | Scroll: Zoom | Shift+Arrastar / Dir: Pan</div>
                            </div>
                        </div>

                        <!-- Painel Lateral / HUD de Métricas Espaciais -->
                        <div class="card" style="padding:14px; border:1px solid rgba(56,189,248,0.28); background:rgba(15,23,42,0.88); display:flex; flex-direction:column; gap:12px; justify-content:space-between;">
                            <div>
                                <div style="font-size:12px; font-weight:800; color:var(--cyan); text-transform:uppercase; letter-spacing:0.5px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                                    <span>📊 HUD Métricas Espaciais</span>
                                    <span class="prov-badge prov-app" style="font-size:9px;">Cramer 3×3</span>
                                </div>

                                <!-- Posição Atual (X, Y, Z) -->
                                <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(56,189,248,0.25); border-radius:6px; padding:10px; margin-bottom:10px;">
                                    <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Posição 3D Estimada (X, Y, Z)</div>
                                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; font-family:var(--font-mono); text-align:center;">
                                        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:4px; padding:6px 4px;">
                                            <div style="font-size:9.5px; color:#f87171; font-weight:700;">X (m)</div>
                                            <div id="${prefix}-hud-x" style="font-size:13.5px; font-weight:800; color:#f8fafc;">--</div>
                                        </div>
                                        <div style="background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:4px; padding:6px 4px;">
                                            <div style="font-size:9.5px; color:#4ade80; font-weight:700;">Y (m)</div>
                                            <div id="${prefix}-hud-y" style="font-size:13.5px; font-weight:800; color:#f8fafc;">--</div>
                                        </div>
                                        <div style="background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:4px; padding:6px 4px;">
                                            <div style="font-size:9.5px; color:#60a5fa; font-weight:700;">Z (m)</div>
                                            <div id="${prefix}-hud-z" style="font-size:13.5px; font-weight:800; color:#f8fafc;">--</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Dispersão Espacial (σx, σy, σz) -->
                                <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:10px; margin-bottom:10px;">
                                    <div style="font-size:10.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:6px;">Dispersão Espacial (σx, σy, σz)</div>
                                    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; font-family:var(--font-mono); text-align:center;">
                                        <div style="padding:4px; background:rgba(255,255,255,0.03); border-radius:4px;">
                                            <div style="font-size:9.5px; color:#94a3b8;">σ_x</div>
                                            <div id="${prefix}-hud-std-x" style="font-size:12px; font-weight:700; color:var(--amber);">--</div>
                                        </div>
                                        <div style="padding:4px; background:rgba(255,255,255,0.03); border-radius:4px;">
                                            <div style="font-size:9.5px; color:#94a3b8;">σ_y</div>
                                            <div id="${prefix}-hud-std-y" style="font-size:12px; font-weight:700; color:var(--amber);">--</div>
                                        </div>
                                        <div style="padding:4px; background:rgba(255,255,255,0.03); border-radius:4px;">
                                            <div style="font-size:9.5px; color:#94a3b8;">σ_z</div>
                                            <div id="${prefix}-hud-std-z" style="font-size:12px; font-weight:700; color:var(--amber);">--</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Métricas de Precisão: Resíduo RMS, CEP 50%, CEP 95%, Amostras -->
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-family:var(--font-mono);">
                                    <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px;">
                                        <div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Resíduo RMS Médio</div>
                                        <div id="${prefix}-hud-rms" style="font-size:13px; font-weight:800; color:var(--emerald); margin-top:2px;">-- m</div>
                                    </div>
                                    <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px;">
                                        <div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Pontos 3D Válidos</div>
                                        <div id="${prefix}-hud-count" style="font-size:13px; font-weight:800; color:var(--cyan); margin-top:2px;">0 pts</div>
                                    </div>
                                    <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px;">
                                        <div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">CEP 50% (Horiz)</div>
                                        <div id="${prefix}-hud-cep50" style="font-size:13px; font-weight:800; color:#38bdf8; margin-top:2px;">-- m</div>
                                    </div>
                                    <div style="background:rgba(2,6,23,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px;">
                                        <div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">CEP 95% (Horiz)</div>
                                        <div id="${prefix}-hud-cep95" style="font-size:13px; font-weight:800; color:#a855f7; margin-top:2px;">-- m</div>
                                    </div>
                                </div>

                                <!-- Âncoras Utilizadas no Último Ponto -->
                                <div style="margin-top:10px; background:rgba(2,6,23,0.55); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px;">
                                    <div style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Âncoras Ativas no Cálculo (4 Módulos)</div>
                                    <div id="${prefix}-hud-anchors-list" style="font-family:var(--font-mono); font-size:11px; color:#cbd5e1; line-height:1.45;">
                                        A aguardar 4 módulos distintos...
                                    </div>
                                </div>
                            </div>

                            <div style="display:flex; gap:6px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06);">
                                <button type="button" class="btn btn-cyan btn-xs" id="${prefix}-btn-refresh" style="flex:1; justify-content:center; font-weight:700;">
                                    🔄 Recalcular Trajetória 3D
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Dynamically create the <canvas> inside #-canvas-host so static index.html only has 2 <canvas> elements
            const host = document.getElementById(`${prefix}-canvas-host`);
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'multilat-3d-viewport-canvas';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.display = 'block';
            host.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');

            this._bindEvents(root, prefix);
            this._renderAnchorsTable(prefix);
        }

        _bindEvents(root, prefix) {
            // Preset buttons
            root.querySelectorAll(`.${prefix}-preset-btn`).forEach(btn => {
                btn.addEventListener('click', () => {
                    const preset = btn.getAttribute('data-preset');
                    this.setCameraPreset(preset);
                    root.querySelectorAll(`.${prefix}-preset-btn`).forEach(b => b.classList.toggle('active', b === btn));
                });
            });

            const btnReset = document.getElementById(`${prefix}-btn-reset`);
            if (btnReset) {
                btnReset.addEventListener('click', () => {
                    this.setCameraPreset('Isometric');
                    root.querySelectorAll(`.${prefix}-preset-btn`).forEach(b => {
                        b.classList.toggle('active', b.getAttribute('data-preset') === 'Isometric');
                    });
                });
            }

            const btnAuto = document.getElementById(`${prefix}-btn-autorotate`);
            if (btnAuto) {
                btnAuto.addEventListener('click', () => {
                    this.camera.autoRotate = !this.camera.autoRotate;
                    btnAuto.classList.toggle('active', this.camera.autoRotate);
                    btnAuto.style.borderColor = this.camera.autoRotate ? 'var(--cyan)' : '';
                    btnAuto.style.color = this.camera.autoRotate ? 'var(--cyan)' : '';
                });
            }

            const btnToggleAnchors = document.getElementById(`${prefix}-btn-toggle-anchors`);
            const drawer = document.getElementById(`${prefix}-anchors-drawer`);
            if (btnToggleAnchors && drawer) {
                btnToggleAnchors.addEventListener('click', () => {
                    this.anchorsEditorCollapsed = !this.anchorsEditorCollapsed;
                    drawer.style.display = this.anchorsEditorCollapsed ? 'none' : 'block';
                    if (!this.anchorsEditorCollapsed) {
                        this._renderAnchorsTable(prefix);
                    }
                });
            }

            const btnSaveAnchors = document.getElementById(`${prefix}-btn-anchors-save`);
            if (btnSaveAnchors) {
                btnSaveAnchors.addEventListener('click', () => this.saveAnchorsFromTable(prefix));
            }

            const btnDefaultAnchors = document.getElementById(`${prefix}-btn-anchors-default`);
            if (btnDefaultAnchors) {
                btnDefaultAnchors.addEventListener('click', () => this.resetAnchorsToDefault(prefix));
            }

            const btnRefresh = document.getElementById(`${prefix}-btn-refresh`);
            if (btnRefresh) {
                btnRefresh.addEventListener('click', () => this.refreshData());
            }

            // Mouse interactions on Canvas
            if (this.canvas) {
                this.canvas.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.interaction.isDragging = true;
                    this.interaction.lastX = e.clientX;
                    this.interaction.lastY = e.clientY;
                    this.interaction.dragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rotate';
                    this.canvas.parentElement.style.cursor = 'grabbing';
                });

                this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

                window.addEventListener('mousemove', (e) => {
                    if (!this.interaction.isDragging) return;
                    const dx = e.clientX - this.interaction.lastX;
                    const dy = e.clientY - this.interaction.lastY;
                    this.interaction.lastX = e.clientX;
                    this.interaction.lastY = e.clientY;

                    if (this.interaction.dragMode === 'pan') {
                        this.camera.panX += dx;
                        this.camera.panY += dy;
                    } else {
                        this.camera.yaw += dx * 0.008;
                        this.camera.pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, this.camera.pitch + dy * 0.008));
                    }
                    this.renderFrame();
                });

                window.addEventListener('mouseup', () => {
                    if (this.interaction.isDragging) {
                        this.interaction.isDragging = false;
                        if (this.canvas && this.canvas.parentElement) {
                            this.canvas.parentElement.style.cursor = 'grab';
                        }
                    }
                });

                this.canvas.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const factor = e.deltaY < 0 ? 1.12 : 0.89;
                    this.camera.zoom = Math.max(12.0, Math.min(240.0, this.camera.zoom * factor));
                    this.renderFrame();
                }, { passive: false });
            }

            window.addEventListener('resize', () => this._resizeCanvas());
        }

        setCameraPreset(preset) {
            this.camera.viewPreset = preset;
            this.camera.panX = 0;
            this.camera.panY = 0;
            if (preset === 'Isometric') {
                this.camera.yaw = -Math.PI * 0.25;
                this.camera.pitch = Math.PI * 0.20;
            } else if (preset === 'Top') {
                this.camera.yaw = 0;
                this.camera.pitch = Math.PI * 0.499;
            } else if (preset === 'Front') {
                this.camera.yaw = 0;
                this.camera.pitch = 0;
            } else if (preset === 'Side') {
                this.camera.yaw = Math.PI * 0.5;
                this.camera.pitch = 0;
            }
            this.renderFrame();
        }

        _resizeCanvas() {
            if (!this.canvas || !this.canvas.parentElement) return;
            const rect = this.canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(320, Math.floor(rect.width));
            const h = Math.max(320, Math.floor(rect.height || 460));
            if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
                this.canvas.width = w * dpr;
                this.canvas.height = h * dpr;
            }
            this.renderFrame();
        }

        _renderAnchorsTable(prefix) {
            const tbody = document.getElementById(`${prefix}-anchors-tbody`);
            if (!tbody) return;
            const entries = Object.entries(this.anchors).sort((a, b) => a[0].localeCompare(b[0]));
            tbody.innerHTML = entries.map(([nid, coords]) => {
                const col = ANCHOR_COLORS[nid] || '#38bdf8';
                const x = Number(coords[0] || 0).toFixed(2);
                const y = Number(coords[1] || 0).toFixed(2);
                const z = Number(coords[2] || 0).toFixed(2);
                return `
                    <tr>
                        <td>
                            <span class="node-pill" style="border-color:${col}; color:${col}; background:rgba(255,255,255,0.04); font-family:var(--font-mono); font-weight:700;">
                                ${nid}
                            </span>
                        </td>
                        <td><input type="number" step="0.05" class="input-text anchor-coord-input" data-node="${nid}" data-axis="0" value="${x}" style="width:95px; padding:3px 6px; font-family:var(--font-mono);"></td>
                        <td><input type="number" step="0.05" class="input-text anchor-coord-input" data-node="${nid}" data-axis="1" value="${y}" style="width:95px; padding:3px 6px; font-family:var(--font-mono);"></td>
                        <td><input type="number" step="0.05" class="input-text anchor-coord-input" data-node="${nid}" data-axis="2" value="${z}" style="width:95px; padding:3px 6px; font-family:var(--font-mono);"></td>
                        <td><span class="badge badge-emerald" style="font-size:10px;">Âncora 3D Ativa</span></td>
                    </tr>
                `;
            }).join('');
        }

        async fetchAnchors() {
            try {
                const resp = await fetch('/api/anchors');
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.anchors) {
                    this.anchors = data.anchors;
                    this._updateSceneCenter();
                    this._renderAnchorsTable(this.containerId);
                    this.renderFrame();
                }
            } catch (e) {
                console.warn('[3D] Falha ao obter âncoras:', e);
            }
        }

        async saveAnchorsFromTable(prefix) {
            const root = document.getElementById(this.containerId);
            if (!root) return;
            const inputs = root.querySelectorAll('.anchor-coord-input');
            const updated = JSON.parse(JSON.stringify(this.anchors));
            inputs.forEach(inp => {
                const nid = inp.getAttribute('data-node');
                const axis = parseInt(inp.getAttribute('data-axis'), 10);
                const val = parseFloat(inp.value);
                if (nid && !isNaN(axis) && !isNaN(val)) {
                    if (!updated[nid]) updated[nid] = [0, 0, 0];
                    updated[nid][axis] = val;
                }
            });

            try {
                const resp = await fetch('/api/anchors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ anchors: updated })
                });
                const data = await resp.json();
                if (data.status === 'success' && data.anchors) {
                    this.anchors = data.anchors;
                    this._updateSceneCenter();
                    this._renderAnchorsTable(prefix);
                    await this.refreshData();
                    if (typeof window.showToast === 'function') {
                        window.showToast('Coordenadas 3D das âncoras atualizadas e trajetória recalculada!', 'success');
                    }
                }
            } catch (e) {
                console.error('[3D] Erro ao guardar âncoras:', e);
            }
        }

        async resetAnchorsToDefault(prefix) {
            try {
                const resp = await fetch('/api/anchors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reset: true })
                });
                const data = await resp.json();
                if (data.status === 'success' && data.anchors) {
                    this.anchors = data.anchors;
                    this._updateSceneCenter();
                    this._renderAnchorsTable(prefix);
                    await this.refreshData();
                    if (typeof window.showToast === 'function') {
                        window.showToast('Coordenadas das âncoras repostas para os valores padrão', 'info');
                    }
                }
            } catch (e) {
                console.error('[3D] Erro ao repor âncoras:', e);
            }
        }

        _updateSceneCenter() {
            const pts = Object.values(this.anchors);
            if (!pts.length) return;
            let sx = 0, sy = 0, sz = 0;
            pts.forEach(p => {
                sx += Number(p[0] || 0);
                sy += Number(p[1] || 0);
                sz += Number(p[2] || 0);
            });
            this.camera.targetX = sx / pts.length;
            this.camera.targetY = sy / pts.length;
            this.camera.targetZ = (sz / pts.length) * 0.5;
        }

        async loadTrial3D(trialId) {
            this.mode = 'trial';
            this.trialId = trialId || (window.AppState && window.AppState.currentTrialId);
            if (!this.trialId) return;
            this.mount();
            try {
                const resp = await fetch(`/api/trial/${encodeURIComponent(this.trialId)}/3d`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                if (data.anchors) this.anchors = data.anchors;
                this.trajectory = data.trajectory || [];
                this.stats = data.stats || this.stats;
                this.currentPosition = this.trajectory.length > 0 ? this.trajectory[this.trajectory.length - 1] : null;
                this.solverStatus = this.trajectory.length > 0 ? 'OK' : 'INSUFFICIENT_4_NODES';
                this._updateSceneCenter();
                this._renderAnchorsTable(this.containerId);
                this._updateHud();
                this._resizeCanvas();
            } catch (e) {
                console.warn('[3D] Erro ao carregar trajetória 3D do ensaio:', e);
            }
        }

        async pollLive3D() {
            this.mode = 'live';
            this.mount();
            try {
                const resp = await fetch('/api/live/3d');
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.anchors) this.anchors = data.anchors;
                this.trajectory = data.trajectory || [];
                this.currentPosition = data.position || (this.trajectory.length > 0 ? this.trajectory[this.trajectory.length - 1] : null);
                this.stats = data.stats || this.stats;
                this.solverStatus = data.solver_status || 'WAITING_4_ANCHORS';
                this.distinctAnchorsCount = data.distinct_anchors_count || 0;
                this._updateHud();
                this.renderFrame();
            } catch (e) {
                console.warn('[3D] Erro ao atualizar posição 3D live:', e);
            }
        }

        async refreshData() {
            if (this.mode === 'live') {
                await this.pollLive3D();
            } else {
                await this.loadTrial3D(this.trialId || (window.AppState && window.AppState.currentTrialId));
            }
        }

        _updateHud() {
            const prefix = this.containerId;
            const pos = this.currentPosition || (this.stats.count > 0 ? {
                x: this.stats.mean_pos[0],
                y: this.stats.mean_pos[1],
                z: this.stats.mean_pos[2],
                residual_rms: this.stats.mean_residual_rms
            } : null);

            const setTxt = (id, txt) => {
                const el = document.getElementById(`${prefix}-${id}`);
                if (el) el.textContent = txt;
            };

            if (pos) {
                setTxt('hud-x', Number(pos.x).toFixed(3));
                setTxt('hud-y', Number(pos.y).toFixed(3));
                setTxt('hud-z', Number(pos.z).toFixed(3));
            } else {
                setTxt('hud-x', '--');
                setTxt('hud-y', '--');
                setTxt('hud-z', '--');
            }

            if (this.stats && this.stats.count > 0) {
                const std = this.stats.std_pos || [0, 0, 0];
                setTxt('hud-std-x', `±${Number(std[0]).toFixed(3)} m`);
                setTxt('hud-std-y', `±${Number(std[1]).toFixed(3)} m`);
                setTxt('hud-std-z', `±${Number(std[2]).toFixed(3)} m`);
                setTxt('hud-rms', `${Number(this.stats.mean_residual_rms || 0).toFixed(4)} m`);
                setTxt('hud-count', `${this.stats.count} pts`);
                setTxt('hud-cep50', `${Number(this.stats.cep50_m || 0).toFixed(3)} m`);
                setTxt('hud-cep95', `${Number(this.stats.cep95_m || 0).toFixed(3)} m`);
            } else {
                setTxt('hud-std-x', '--');
                setTxt('hud-std-y', '--');
                setTxt('hud-std-z', '--');
                setTxt('hud-rms', '-- m');
                setTxt('hud-count', '0 pts');
                setTxt('hud-cep50', '-- m');
                setTxt('hud-cep95', '-- m');
            }

            const statusBadge = document.getElementById(`${prefix}-status-badge`);
            if (statusBadge) {
                if (this.trajectory.length > 0 || this.currentPosition) {
                    statusBadge.className = 'badge badge-emerald';
                    statusBadge.textContent = `SOLVER 3D ATIVO (${this.trajectory.length} épocas | Vista: ${this.camera.viewPreset})`;
                } else if (this.mode === 'live') {
                    statusBadge.className = 'badge badge-amber';
                    statusBadge.textContent = `A aguardar 4 módulos distintos (${this.distinctAnchorsCount}/4 ativos)`;
                } else {
                    statusBadge.className = 'badge badge-gray';
                    statusBadge.textContent = `Ensaio com < 4 módulos simultâneos para multilateração 3D`;
                }
            }

            const anchorsListEl = document.getElementById(`${prefix}-hud-anchors-list`);
            if (anchorsListEl) {
                if (pos && pos.node_ids && pos.node_ids.length) {
                    anchorsListEl.innerHTML = pos.node_ids.map((nid, idx) => {
                        const d = pos.distances_m && pos.distances_m[idx] !== undefined ? `${Number(pos.distances_m[idx]).toFixed(3)} m` : '';
                        const col = ANCHOR_COLORS[nid] || '#38bdf8';
                        return `<span style="display:inline-block; margin-right:8px;"><strong style="color:${col};">${nid}</strong>: ${d}</span>`;
                    }).join(' ');
                } else {
                    anchorsListEl.textContent = 'Necessárias medições válidas de 4 módulos distintos na janela de frescura.';
                }
            }
        }

        /**
         * Projects a 3D point (x, y, z) into 2D canvas coordinates (sx, sy, depth)
         * World coordinates: X right/east, Y depth/north, Z up/height
         */
        project3D(x, y, z, width, height) {
            const dx = x - this.camera.targetX;
            const dy = y - this.camera.targetY;
            const dz = z - this.camera.targetZ;

            const cosYaw = Math.cos(this.camera.yaw);
            const sinYaw = Math.sin(this.camera.yaw);
            const cosPitch = Math.cos(this.camera.pitch);
            const sinPitch = Math.sin(this.camera.pitch);

            // Rotate around Z axis (yaw)
            const x1 = dx * cosYaw - dy * sinYaw;
            const y1 = dx * sinYaw + dy * cosYaw;
            const z1 = dz;

            // Rotate around X axis (pitch) so Z is vertical on screen
            const xCam = x1;
            const yCam = z1 * cosPitch - y1 * sinPitch;
            const zDepth = y1 * cosPitch + z1 * sinPitch;

            // Perspective foreshortening
            const fovDist = 22.0;
            const persp = fovDist / Math.max(4.0, fovDist + zDepth * 0.35);
            const scale = this.camera.zoom * persp;

            const sx = (width * 0.5) + this.camera.panX + xCam * scale;
            const sy = (height * 0.56) + this.camera.panY - yCam * scale;

            return { x: sx, y: sy, depth: zDepth, scale: scale };
        }

        _startRenderLoop() {
            if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
            const step = () => {
                if (this.camera.autoRotate && !this.interaction.isDragging) {
                    this.camera.yaw += 0.0045;
                    this.renderFrame();
                }
                this.animFrameId = requestAnimationFrame(step);
            };
            this.animFrameId = requestAnimationFrame(step);
        }

        renderFrame() {
            if (!this.canvas || !this.ctx) return;
            const dpr = window.devicePixelRatio || 1;
            const w = this.canvas.width / dpr;
            const h = this.canvas.height / dpr;
            const ctx = this.ctx;

            ctx.save();
            ctx.scale(dpr, dpr);

            // 1. Dark scientific background gradient
            const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
            bgGrad.addColorStop(0, '#0f172a');
            bgGrad.addColorStop(1, '#050811');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, w, h);

            // 2. Ground Grid at Z = 0
            this._drawGroundGrid(ctx, w, h);

            // 3. Cartesian Axes X (Red), Y (Green), Z (Blue)
            this._drawAxes(ctx, w, h);

            // 4. Configured Anchors (3D Cubes + Vertical Pillars + Node Labels)
            this._drawAnchors(ctx, w, h);

            // 5. 3D Trajectory, Ground Shadow & Active Tag Position
            this._drawTrajectory(ctx, w, h);

            // 6. Top-left Viewport Overlay Info
            this._drawViewportOverlay(ctx, w, h);

            ctx.restore();
        }

        _drawGroundGrid(ctx, w, h) {
            const gridMin = -1;
            const gridMax = 7;
            ctx.lineWidth = 1;

            for (let i = gridMin; i <= gridMax; i++) {
                const isMajor = (i === 0 || i === 5);
                ctx.strokeStyle = isMajor ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.09)';

                // Line along X
                const p1 = this.project3D(gridMin, i, 0, w, h);
                const p2 = this.project3D(gridMax, i, 0, w, h);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();

                // Line along Y
                const q1 = this.project3D(i, gridMin, 0, w, h);
                const q2 = this.project3D(i, gridMax, 0, w, h);
                ctx.beginPath();
                ctx.moveTo(q1.x, q1.y);
                ctx.lineTo(q2.x, q2.y);
                ctx.stroke();
            }
        }

        _drawAxes(ctx, w, h) {
            const origin = this.project3D(0, 0, 0, w, h);
            const axisLen = 6.0;

            const axes = [
                { end: [axisLen, 0, 0], color: '#ef4444', label: 'X (m)' },
                { end: [0, axisLen, 0], color: '#22c55e', label: 'Y (m)' },
                { end: [0, 0, 3.5], color: '#3b82f6', label: 'Z (m)' }
            ];

            axes.forEach(ax => {
                const pEnd = this.project3D(ax.end[0], ax.end[1], ax.end[2], w, h);
                ctx.strokeStyle = ax.color;
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(origin.x, origin.y);
                ctx.lineTo(pEnd.x, pEnd.y);
                ctx.stroke();

                // Axis tip circle & label
                ctx.fillStyle = ax.color;
                ctx.beginPath();
                ctx.arc(pEnd.x, pEnd.y, 3.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = 'bold 11px monospace';
                ctx.fillText(ax.label, pEnd.x + 6, pEnd.y + 4);
            });
        }

        _drawCubeWireframe(ctx, cx, cy, cz, halfSize, color, w, h) {
            const v = [
                [cx - halfSize, cy - halfSize, cz - halfSize],
                [cx + halfSize, cy - halfSize, cz - halfSize],
                [cx + halfSize, cy + halfSize, cz - halfSize],
                [cx - halfSize, cy + halfSize, cz - halfSize],
                [cx - halfSize, cy - halfSize, cz + halfSize],
                [cx + halfSize, cy - halfSize, cz + halfSize],
                [cx + halfSize, cy + halfSize, cz + halfSize],
                [cx - halfSize, cy + halfSize, cz + halfSize]
            ].map(pt => this.project3D(pt[0], pt[1], pt[2], w, h));

            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7]
            ];

            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            edges.forEach(([a, b]) => {
                ctx.moveTo(v[a].x, v[a].y);
                ctx.lineTo(v[b].x, v[b].y);
            });
            ctx.stroke();
        }

        _drawAnchors(ctx, w, h) {
            const entries = Object.entries(this.anchors);
            entries.forEach(([nid, coords]) => {
                const ax = Number(coords[0] || 0);
                const ay = Number(coords[1] || 0);
                const az = Number(coords[2] || 0);
                const col = ANCHOR_COLORS[nid] || '#38bdf8';

                const pTop = this.project3D(ax, ay, az, w, h);
                const pGround = this.project3D(ax, ay, 0, w, h);

                // Vertical drop line to ground Z=0
                ctx.save();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(pGround.x, pGround.y);
                ctx.lineTo(pTop.x, pTop.y);
                ctx.stroke();
                ctx.restore();

                // Ground shadow cross
                ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
                ctx.beginPath();
                ctx.arc(pGround.x, pGround.y, 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Stylized 3D anchor cube
                this._drawCubeWireframe(ctx, ax, ay, az, 0.14, col, w, h);

                // Center core dot
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(pTop.x, pTop.y, 4, 0, Math.PI * 2);
                ctx.fill();

                // Anchor Label Pill
                const label = `${nid} (${ax.toFixed(1)},${ay.toFixed(1)},${az.toFixed(1)})`;
                ctx.font = 'bold 10.5px monospace';
                const tw = ctx.measureText(label).width;
                const lx = pTop.x + 8;
                const ly = pTop.y - 8;

                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.strokeStyle = col;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect ? ctx.roundRect(lx - 4, ly - 11, tw + 8, 15, 3) : ctx.rect(lx - 4, ly - 11, tw + 8, 15);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#f8fafc';
                ctx.fillText(label, lx, ly);
            });
        }

        _drawTrajectory(ctx, w, h) {
            const pts = this.trajectory || [];
            if (pts.length === 0 && !this.currentPosition) return;

            // 1. Ground shadow polyline (Z = 0)
            if (pts.length > 1) {
                ctx.save();
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                pts.forEach((p, idx) => {
                    const g = this.project3D(p.x, p.y, 0, w, h);
                    if (idx === 0) ctx.moveTo(g.x, g.y);
                    else ctx.lineTo(g.x, g.y);
                });
                ctx.stroke();
                ctx.restore();
            }

            // 2. Vertical projection lines & 3D trajectory polyline
            if (pts.length > 1) {
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                pts.forEach((p, idx) => {
                    const pr = this.project3D(p.x, p.y, p.z, w, h);
                    if (idx === 0) ctx.moveTo(pr.x, pr.y);
                    else ctx.lineTo(pr.x, pr.y);
                });
                ctx.stroke();
            }

            // 3. Individual temporal trajectory points and vertical drop lines
            const stride = Math.max(1, Math.floor(pts.length / 40));
            pts.forEach((p, idx) => {
                const pr = this.project3D(p.x, p.y, p.z, w, h);
                if (idx % stride === 0 || idx === pts.length - 1) {
                    const g = this.project3D(p.x, p.y, 0, w, h);
                    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(g.x, g.y);
                    ctx.lineTo(pr.x, pr.y);
                    ctx.stroke();
                }

                const alpha = 0.35 + 0.65 * (idx / Math.max(1, pts.length - 1));
                ctx.fillStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(pr.x, pr.y, idx === pts.length - 1 ? 5.5 : 3.0, 0, Math.PI * 2);
                ctx.fill();
            });

            // 4. Highlight latest/current 3D position with pulsing halo & distance rays
            const active = this.currentPosition || pts[pts.length - 1];
            if (active) {
                const pNow = this.project3D(active.x, active.y, active.z, w, h);
                const pGround = this.project3D(active.x, active.y, 0, w, h);

                // Dashed rays to the 4 anchors used
                if (active.node_ids) {
                    ctx.save();
                    ctx.setLineDash([3, 4]);
                    ctx.lineWidth = 1;
                    active.node_ids.forEach(nid => {
                        const aCoords = this.anchors[nid];
                        if (aCoords) {
                            const pAnc = this.project3D(aCoords[0], aCoords[1], aCoords[2], w, h);
                            ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
                            ctx.beginPath();
                            ctx.moveTo(pNow.x, pNow.y);
                            ctx.lineTo(pAnc.x, pAnc.y);
                            ctx.stroke();
                        }
                    });
                    ctx.restore();
                }

                // Drop line to ground
                ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(pGround.x, pGround.y);
                ctx.lineTo(pNow.x, pNow.y);
                ctx.stroke();

                // Outer glow halo
                ctx.fillStyle = 'rgba(250, 204, 21, 0.25)';
                ctx.beginPath();
                ctx.arc(pNow.x, pNow.y, 11, 0, Math.PI * 2);
                ctx.fill();

                // Inner gold target marker
                ctx.fillStyle = '#facc15';
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.arc(pNow.x, pNow.y, 5.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Coordinate tag
                const posLabel = `TAG (${Number(active.x).toFixed(2)}, ${Number(active.y).toFixed(2)}, ${Number(active.z).toFixed(2)}) m`;
                ctx.font = 'bold 11px monospace';
                ctx.fillStyle = '#facc15';
                ctx.fillText(posLabel, pNow.x + 12, pNow.y + 4);
            }
        }

        _drawViewportOverlay(ctx, w, h) {
            ctx.font = '11px monospace';
            ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
            const yawDeg = ((this.camera.yaw * 180) / Math.PI).toFixed(0);
            const pitchDeg = ((this.camera.pitch * 180) / Math.PI).toFixed(0);
            ctx.fillText(`Câmara: ${this.camera.viewPreset} | Azimute: ${yawDeg}° | Elevação: ${pitchDeg}° | Escala: ${this.camera.zoom.toFixed(0)} px/m`, 12, 20);
        }
    }

    // Instâncias globais para Análise de Ensaio e Telemetria Live
    window.SwarmLoc3DVisualizer = SwarmLoc3DVisualizer;
    window.TrialMultilat3D = new SwarmLoc3DVisualizer({ containerId: 'trial-multilat-3d-root', mode: 'trial' });
    window.LiveMultilat3D = new SwarmLoc3DVisualizer({ containerId: 'live-multilat-3d-root', mode: 'live' });

    window.renderTabMultilat3D = function () {
        const trialId = window.AppState && window.AppState.currentTrialId;
        window.TrialMultilat3D.mount('trial-multilat-3d-root');
        if (trialId) {
            window.TrialMultilat3D.loadTrial3D(trialId);
        } else {
            window.TrialMultilat3D.fetchAnchors();
        }
    };

    window.toggleLiveMultilat3DPanel = function () {
        const body = document.getElementById('live-multilat-3d-collapsible');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            window.LiveMultilat3D.mount('live-multilat-3d-root');
            window.LiveMultilat3D.pollLive3D();
        }
    };
})();
