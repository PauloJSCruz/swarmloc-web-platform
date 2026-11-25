# SwarmLoc Web Platform — Scientific Engineering Analysis & Live Swarm Telemetry

Plataforma de engenharia científica, telemetria em tempo real e metrologia para o sistema UWB **SwarmLoc** (módulos Decawave/Qorvo DW3000 + Nordic nRF52833).

Este repositório foi separado do firmware embedded ([SwarmLoc](https://github.com/PauloJSCruz/SwarmLoc.git)) para isolar a pilha de aplicação host (Python, Web, visualização interativa, multilateração 3D e validação estatística).

---

## 🌟 Funcionalidades Principais

- 📊 **Dashboard Web em Tempo Real (Porta 8080):**
  - Interface moderna com tema escuro industrial (python/web/index.html).
  - Gráficos de alta cadência com aceleração por hardware, zoom e pan temporal interativo (unified_chart.js).
  - Métricas científicas em tempo real: dispersão de distâncias, resíduos de multilateração 3D, valores de drift de relógio ($\alpha$ e $\beta$) e classificação de canal LOS/NLOS (sci_metrics.js).
- ⏱️ **Metrologia e Estatística Rigorosa (scientific_metrics.py):**
  - Indicadores formais: RMSE, Bias, Desvio Padrão Amostral (-1$), MAD, IQR, CEP50/CEP95.
  - Análise de variância de Allan ($\sigma_y^2(\tau)$) e limites teóricos de Cramér-Rao (CRLB).
  - Separação estrita entre taxa de amostragem observada e frequência de rádio física (RF).
- 🧭 **Solucionadores Avançados de Multilateração 3D (multilat.py):**
  - Solucionador analítico 3x3 por determinantes (Regra de Cramer).
  - Otimização não-linear por mínimos quadrados (Levenberg-Marquardt).
  - Reconstrução geométrica relativa por Multidimensional Scaling (MDS / Cayley-Menger).
- 📡 **Protocolo Binário e Descarregamento Multi-Nó (inary_protocol.py, download_raw.py):**
  - Descodificação de tramas de 54 bytes (SWLB) com validação de integridade por hash FNV-1a de 32 bits e marcador de fim ENDB.
  - Aquisição simultânea através de múltiplas portas COM virtuais SEGGER J-Link.
- 🎛️ **Monitor Série e Controlo de Enxame (serial_monitor.*):**
  - Envio de comandos de calibração, início/paragem de ensaios (	 10) e monitorização direta.

---

## 📂 Estrutura do Repositório

`
swarmloc-web-platform/
├── python/
│   ├── web/                     # Frontend Web (HTML5, CSS3, Chart.js, JS)
│   │   ├── index.html           # Dashboard principal
│   │   ├── app.js               # Lógica de comunicação e WebSocket/HTTP
│   │   ├── style.css            # Estilos da interface
│   │   ├── unified_chart.js     # Motor unificado de gráficos
│   │   └── sci_metrics.js       # Visualização de métricas metrológicas
│   ├── data_analysis.py         # Servidor Web e motor principal de análise
│   ├── scientific_metrics.py    # Métricas metrológicas canónicas
│   ├── binary_protocol.py       # Parser e codificador do protocolo 54B SWLB
│   ├── multilat.py              # Algoritmos de localização e multilateração 3D
│   ├── download_raw.py          # Utilitário de download de dados via porta série
│   └── raw_session_loader.py    # Carregador de sessões e ensaios experimentais
├── scripts/
│   ├── run.ps1 / run.bat / run.sh  # Scripts de inicialização unificada
│   ├── run_10s_trial.py         # Execução automatizada de ensaios de 10s
│   ├── generate_html_report.py  # Gerador de relatórios estáticos em HTML
│   └── serial_monitor.*         # Ferramenta de monitorização de portas série
├── tests/                       # Suite completa de testes automatizados (pytest)
│   ├── test_scientific_metrics.py
│   ├── test_euclidean_multilat.py
│   ├── test_live_uart_coherence.py
│   └── ...
├── tools/
│   └── collect_experimental_telemetry.py # Ferramenta de recolha de telemetria
├── docs/                        # Documentação técnica e arquitetural
│   └── 10_CAIXA_NEGRA_PROCESSAMENTO_HOST_PYTHON.md
├── trial_metadata.json          # Metadados e catálogo de ensaios experimentais
├── requirements.txt             # Dependências Python
└── README.md
`

---

## 🚀 Como Executar

### 1. Pré-requisitos
Certifique-se de que tem o **Python 3.9+** instalado.

Instale as dependências:
`ash
pip install -r requirements.txt
`

### 2. Iniciar a Plataforma Web
No PowerShell:
`powershell
.\scripts\run.ps1
`
Ou com porta personalizada:
`powershell
.\scripts\run.ps1 -Port 8090
`

No Linux / macOS:
`ash
chmod +x scripts/run.sh
./scripts/run.sh
`

Aceda ao dashboard no seu navegador: **http://localhost:8080**

### 3. Executar os Testes Automatizados
`ash
pytest tests/
`

---

## 🔗 Repositório Relacionado

- **Firmware Embedded:** [SwarmLoc](https://github.com/PauloJSCruz/SwarmLoc.git) (C, CMake, nRF52833 SDK, DW3000 Driver)