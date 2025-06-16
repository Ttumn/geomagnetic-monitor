// geomagnetic-monitor.js
// Monitor Geomagnético Avanzado - Sistema de Predicción Multi-índice
// Versión optimizada y modularizada

'use strict';

// Namespace principal de la aplicación
const geoMagApp = (function() {
    
    // ================== CONFIGURACIÓN ==================
    const CONFIG = {
        // Timeouts por fuente en milisegundos
        SOURCE_TIMEOUTS: {
            gfzApi: 20000,
            kpPager: 10000,
            kpNoaa: 30000,
            dst: 40000,
            ksa: 20000,
            intermagnetPIL: 10000,
            intermagnetVSS: 10000
        },
        
        // URLs de fuentes de datos
        DATA_SOURCES: {
            kpPager: "https://www.spacepager.eu/fileadmin/Products/WP3/kp_product_file_FORECAST_PAGER_SWIFT_LAST.json",
            kpNoaa: "https://services.swpc.noaa.gov/text/3-day-geomag-forecast.txt",
            intermagnetPIL: "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&ObservatoryIagaCode=PIL&samplesPerDay=Minute&dataStartDate=",
            intermagnetVSS: "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&ObservatoryIagaCode=VSS&samplesPerDay=Minute&dataStartDate=",
            dstKyoto: "https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/presentmonth/",
            ksaEmbraceBase: "https://embracedata.inpe.br/ksa/",
            corsProxy: "https://api.allorigins.win/raw?url="
        },
        
        // Información de fuentes con prioridad
        SOURCE_INFO: [
            { id: 'ksa', name: 'KSA EMBRACE', icon: '🇧🇷', priority: 1 },
            { id: 'kpNoaa', name: 'Kp NOAA/SWPC', icon: '🇺🇸', priority: 2 },
            { id: 'hp30', name: 'HP30 GFZ', icon: '⚡', priority: 3, index: 'Hp30' },
            { id: 'kpGFZ', name: 'Kp GFZ', icon: '🌍', priority: 4, index: 'Kp' },
            { id: 'apGFZ', name: 'ap GFZ', icon: '📊', priority: 5, index: 'ap' },
            { id: 'ap30', name: 'ap30 GFZ', icon: '⏱️', priority: 6, index: 'ap30' },
            { id: 'dst', name: 'DST Kyoto', icon: '🇯🇵', priority: 7 },
            { id: 'intermagnetPIL', name: 'INTERMAGNET PIL', icon: '🇦🇷', priority: 8 }
        ]
    };

    // ================== ESTADO GLOBAL ==================
    const state = {
        // Variables de control
        mainChart: null,
        comparisonChart: null,
        autoRefreshInterval: null,
        isAutoRefreshEnabled: false,
        currentDataSource: 'hybrid',
        currentChartView: 'main',
        
        // Resultados de validación
        validationResults: {},
        alertsHistory: [],
        
        // Datos del pronóstico
        forecastData: {
            timestamps: [],
            kpGFZ: [],
            kpNoaa: [],
            kpStatus: [],
            ap: [],
            apStatus: [],
            Ap: [],
            hp30: [],
            ap30: [],
            ap30History: [],
            C9: [],
            SN: [],
            dstCurrent: null,
            pilData: null,
            vssData: null,
            ksaIndex: null,
            ksaData: null,
            lastUpdate: {},
            dataQuality: {},
            samaFactor: 1.3,
            samaRisk: 'BAJO'
        }
    };

    // ================== CLASE GFZ DATA LOADER ==================
    class GFZDataLoader {
        constructor() {
            this.baseUrl = 'https://kp.gfz-potsdam.de/app/json/';
            this.corsProxy = CONFIG.DATA_SOURCES.corsProxy;
            
            this.availableIndices = {
                withStatus: ['Kp', 'ap', 'Ap', 'Cp', 'C9', 'SN'],
                withoutStatus: ['Hp30', 'Hp60', 'ap30', 'ap60', 'Fobs', 'Fadj']
            };
            
            this.cache = new Map();
            this.cacheDuration = {
                Kp: 60 * 60 * 1000,
                ap: 60 * 60 * 1000,
                Hp30: 30 * 60 * 1000,
                ap30: 30 * 60 * 1000,
                default: 60 * 60 * 1000
            };
        }

        validateIndex(index) {
            const allIndices = [...this.availableIndices.withStatus, ...this.availableIndices.withoutStatus];
            if (!allIndices.includes(index)) {
                throw new Error(`Índice inválido: ${index}. Índices válidos: ${allIndices.join(', ')}`);
            }
            return true;
        }

        formatDateTime(dateStr) {
            if (dateStr.length === 10) {
                return dateStr + 'T00:00:00Z';
            }
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)) {
                return dateStr;
            }
            throw new Error(`Formato de fecha inválido: ${dateStr}. Use yyyy-mm-dd o yyyy-mm-ddTHH:MM:SSZ`);
        }

        buildUrl(startTime, endTime, index, options = {}) {
            const params = new URLSearchParams({
                start: this.formatDateTime(startTime),
                end: this.formatDateTime(endTime),
                index: index
            });
            
            if (this.availableIndices.withStatus.includes(index) && options.status === 'def') {
                params.append('status', 'def');
            }
            
            return `${this.baseUrl}?${params.toString()}`;
        }

        getCacheKey(startTime, endTime, index, options) {
            return `${index}_${startTime}_${endTime}_${options.status || 'all'}`;
        }

        getFromCache(key, index) {
            const cached = this.cache.get(key);
            if (!cached) return null;
            
            const age = Date.now() - cached.timestamp;
            const maxAge = this.cacheDuration[index] || this.cacheDuration.default;
            
            if (age > maxAge) {
                this.cache.delete(key);
                return null;
            }
            
            return { ...cached.data, fromCache: true, cacheAge: age };
        }

        setCache(key, data) {
            this.cache.set(key, {
                data: data,
                timestamp: Date.now()
            });
        }

        async getData(startTime, endTime, index, options = {}) {
            try {
                this.validateIndex(index);
                
                const start = new Date(this.formatDateTime(startTime));
                const end = new Date(this.formatDateTime(endTime));
                
                if (start > end) {
                    throw new Error('La fecha de inicio debe ser anterior o igual a la fecha de fin');
                }
                
                const cacheKey = this.getCacheKey(startTime, endTime, index, options);
                const cached = this.getFromCache(cacheKey, index);
                if (cached) {
                    console.log(`Datos de ${index} obtenidos del cache`);
                    return cached;
                }
                
                const url = this.buildUrl(startTime, endTime, index, options);
                console.log('Solicitando GFZ:', url);
                
                let response;
                try {
                    response = await fetch(url, { 
                        signal: options.signal,
                        mode: 'cors',
                        headers: {
                            'Accept': 'application/json, text/plain, */*'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                } catch (error) {
                    console.log('Error directo, usando proxy CORS para GFZ...');
                    const proxyUrl = this.corsProxy + encodeURIComponent(url);
                    response = await fetch(proxyUrl, { signal: options.signal });
                    
                    if (!response.ok) {
                        throw new Error(`Error HTTP con proxy: ${response.status}`);
                    }
                }
                
                const data = await response.json();
                console.log(`Datos ${index} recibidos:`, data.datetime ? data.datetime.length : 0, 'puntos');
                
                const result = {
                    datetime: data.datetime || [],
                    values: data[index] || [],
                    status: this.availableIndices.withStatus.includes(index) ? (data.status || []) : null,
                    metadata: {
                        index: index,
                        startTime: this.formatDateTime(startTime),
                        endTime: this.formatDateTime(endTime),
                        count: data.datetime ? data.datetime.length : 0,
                        hasStatus: this.availableIndices.withStatus.includes(index),
                        requestedStatusFilter: options.status || 'all'
                    }
                };
                
                if (result.status) {
                    result.metadata.statusCounts = this.analyzeStatus(result.status);
                    result.metadata.quality = this.calculateQuality(result.metadata.statusCounts, result.values.length);
                }
                
                this.setCache(cacheKey, result);
                
                return result;
                
            } catch (error) {
                console.error('Error obteniendo datos GFZ:', error);
                throw error;
            }
        }

        analyzeStatus(statusArray) {
            const counts = {
                def: 0,
                prov: 0,
                nowcast: 0,
                unknown: 0
            };
            
            statusArray.forEach(status => {
                if (status === 'def' || status === 'definitive') counts.def++;
                else if (status === 'prov' || status === 'provisional') counts.prov++;
                else if (status === 'nowcast') counts.nowcast++;
                else counts.unknown++;
            });
            
            return counts;
        }

        calculateQuality(statusCounts, total) {
            if (!statusCounts || total === 0) return 90;
            
            const weights = {
                def: 1.0,
                prov: 0.7,
                nowcast: 0.5,
                unknown: 0.3
            };
            
            let score = 0;
            for (const [status, count] of Object.entries(statusCounts)) {
                score += (count / total) * weights[status] * 100;
            }
            
            return Math.round(score);
        }

        async getLast72Hours(index, options = {}) {
            const now = new Date();
            const start = new Date(now.getTime() - 72 * 60 * 60 * 1000);
            
            return this.getData(
                start.toISOString().slice(0, 19) + 'Z',
                now.toISOString().slice(0, 19) + 'Z',
                index,
                options
            );
        }

        async getForecast(index, options = {}) {
            const now = new Date();
            const future = new Date(now.getTime() + 72 * 60 * 60 * 1000);
            
            return this.getData(
                now.toISOString().slice(0, 19) + 'Z',
                future.toISOString().slice(0, 19) + 'Z',
                index,
                options
            );
        }

        async getMultipleIndices(indices, timeRange = 'last72h', options = {}) {
            const promises = indices.map(index => {
                if (timeRange === 'last72h') {
                    return this.getLast72Hours(index, options);
                } else if (timeRange === 'forecast') {
                    return this.getForecast(index, options);
                }
            });
            
            const results = await Promise.allSettled(promises);
            const data = {};
            
            results.forEach((result, i) => {
                if (result.status === 'fulfilled') {
                    data[indices[i]] = result.value;
                } else {
                    console.error(`Error cargando ${indices[i]}:`, result.reason);
                    data[indices[i]] = null;
                }
            });
            
            return data;
        }
    }

    // ================== CLASE SAMA ANALYZER ==================
    class SAMAAnalyzer {
        constructor() {
            this.amplificationFactors = {
                Kp: 1.3,
                ap: 1.4,
                Hp30: 1.35,
                ap30: 1.45
            };
            
            this.samaThresholds = {
                safe: { Kp: 3, ap: 18 },
                caution: { Kp: 4, ap: 27 },
                danger: { Kp: 5, ap: 48 }
            };
        }

        calculateDynamicFactor(indices) {
            if (!indices || Object.keys(indices).length === 0) {
                return 1.3;
            }
            
            let factor = 1.0;
            let weightSum = 0;
            
            if (indices.Kp !== undefined && indices.Kp !== null) {
                factor += this.amplificationFactors.Kp * 0.3;
                weightSum += 0.3;
            }
            
            if (indices.ap !== undefined && indices.ap !== null) {
                const apFactor = Math.min(indices.ap / 50, 1) * 0.2;
                factor += (this.amplificationFactors.ap + apFactor) * 0.4;
                weightSum += 0.4;
            }
            
            if (indices.Hp30 !== undefined && indices.Hp30 !== null) {
                factor += this.amplificationFactors.Hp30 * 0.15;
                weightSum += 0.15;
            }
            
            if (indices.ap30 !== undefined && indices.ap30 !== null) {
                const ap30Factor = Math.min(indices.ap30 / 50, 1) * 0.3;
                factor += (this.amplificationFactors.ap30 + ap30Factor) * 0.15;
                weightSum += 0.15;
            }
            
            if (weightSum > 0) {
                factor = factor / weightSum;
            }
            
            return Math.max(1.0, Math.min(2.0, factor));
        }

        evaluateRisk(indices, factor) {
            const risks = {
                level: 'BAJO',
                score: 0,
                factors: []
            };
            
            if (indices.Kp !== undefined) {
                const kpEffective = indices.Kp * factor;
                if (kpEffective >= this.samaThresholds.danger.Kp * factor) {
                    risks.factors.push('Kp efectivo crítico');
                    risks.score += 40;
                } else if (kpEffective >= this.samaThresholds.caution.Kp * factor) {
                    risks.factors.push('Kp efectivo elevado');
                    risks.score += 20;
                }
            }
            
            if (indices.ap !== undefined) {
                const apEffective = indices.ap * factor;
                if (apEffective >= this.samaThresholds.danger.ap * factor) {
                    risks.factors.push('Amplitud crítica');
                    risks.score += 30;
                } else if (apEffective >= this.samaThresholds.caution.ap * factor) {
                    risks.factors.push('Amplitud elevada');
                    risks.score += 15;
                }
            }
            
            if (indices.ap30 !== undefined && indices.ap30History) {
                const recentChanges = this.analyzeRecentChanges(indices.ap30History);
                if (recentChanges.rapidIncrease) {
                    risks.factors.push('Incremento rápido detectado');
                    risks.score += 25;
                }
            }
            
            if (risks.score >= 60) {
                risks.level = 'CRÍTICO';
            } else if (risks.score >= 40) {
                risks.level = 'ALTO';
            } else if (risks.score >= 20) {
                risks.level = 'MEDIO';
            }
            
            return risks;
        }

        analyzeRecentChanges(history) {
            if (!history || history.length < 3) {
                return { rapidIncrease: false, trend: 'stable' };
            }
            
            const recent = history.slice(-3);
            const avgChange = (recent[2] - recent[0]) / 2;
            
            return {
                rapidIncrease: avgChange > 10,
                trend: avgChange > 5 ? 'increasing' : avgChange < -5 ? 'decreasing' : 'stable',
                rate: avgChange
            };
        }

        predictShortTerm(indices, hours = 3) {
            if (!indices.ap30History || indices.ap30History.length < 4) {
                return { prediction: 'Datos insuficientes', confidence: 0 };
            }
            
            const trend = this.analyzeRecentChanges(indices.ap30History);
            const currentAp = indices.ap || indices.ap30 || 0;
            const predictedAp = currentAp + (trend.rate * hours);
            
            const predictedKp = this.apToKp(predictedAp);
            
            return {
                prediction: `Kp ${predictedKp.toFixed(1)} (ap ${predictedAp.toFixed(0)} nT)`,
                confidence: Math.max(0, 100 - Math.abs(trend.rate) * 5),
                trend: trend.trend
            };
        }

        apToKp(ap) {
            const conversions = [
                { ap: 0, kp: 0 },
                { ap: 3, kp: 0.33 },
                { ap: 7, kp: 1 },
                { ap: 15, kp: 2 },
                { ap: 27, kp: 3 },
                { ap: 48, kp: 4 },
                { ap: 80, kp: 5 },
                { ap: 132, kp: 6 },
                { ap: 207, kp: 7 },
                { ap: 400, kp: 8 },
                { ap: 1000, kp: 9 }
            ];
            
            for (let i = 1; i < conversions.length; i++) {
                if (ap <= conversions[i].ap) {
                    const ratio = (ap - conversions[i-1].ap) / (conversions[i].ap - conversions[i-1].ap);
                    return conversions[i-1].kp + ratio * (conversions[i].kp - conversions[i-1].kp);
                }
            }
            
            return 9;
        }
    }

    // ================== INSTANCIAS GLOBALES ==================
    const gfzLoader = new GFZDataLoader();
    const samaAnalyzer = new SAMAAnalyzer();

    // ================== FUNCIONES DE CARGA DE DATOS ==================
    
    async function fetchWithCORS(url, options = {}) {
        try {
            const controller = new AbortController();
            const timeout = options.timeout || 30000;
            
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const fetchOptions = {
                ...options,
                mode: 'cors',
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                },
                signal: controller.signal
            };
            
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Timeout en la solicitud');
            }
            
            console.log('Using CORS proxy for:', url);
            const proxyUrl = CONFIG.DATA_SOURCES.corsProxy + encodeURIComponent(url);
            
            const controller = new AbortController();
            const timeout = options.timeout || 30000;
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            try {
                const response = await fetch(proxyUrl, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return response;
            } catch (proxyError) {
                if (proxyError.name === 'AbortError') {
                    throw new Error('Timeout en la solicitud');
                }
                throw proxyError;
            }
        }
    }

    async function loadGFZMultiIndices() {
        const startTime = Date.now();
        const indices = ['Hp30', 'Kp', 'ap', 'ap30'];
        let successCount = 0;
        
        try {
            indices.forEach(index => {
                const sourceId = index === 'Kp' ? 'kpGFZ' : 
                               index === 'ap' ? 'apGFZ' :
                               index === 'Hp30' ? 'hp30' : 'ap30';
                updateSourceStatus(sourceId, 'loading');
            });
            
            const data = await gfzLoader.getMultipleIndices(indices, 'last72h');
            
            // Procesar cada índice
            if (data.Hp30 && data.Hp30.values.length > 0) {
                const aggregated = [];
                for (let i = 0; i < data.Hp30.values.length; i += 6) {
                    const slice = data.Hp30.values.slice(i, i + 6);
                    if (slice.length > 0) {
                        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                        aggregated.push(avg);
                    }
                }
                state.forecastData.hp30 = aggregated.slice(0, 24);
                state.forecastData.dataQuality.Hp30 = 92;
                
                state.validationResults.hp30 = {
                    status: 'valid',
                    confidence: 92,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: state.forecastData.hp30.length
                };
                updateSourceStatus('hp30', 'valid');
                successCount++;
            } else {
                updateSourceStatus('hp30', 'error');
            }
            
            if (data.Kp && data.Kp.values.length > 0) {
                state.forecastData.timestamps = data.Kp.datetime.map(dt => formatLocalLabel(new Date(dt)));
                state.forecastData.kpGFZ = data.Kp.values.slice(0, 24);
                state.forecastData.kpStatus = data.Kp.status ? data.Kp.status.slice(0, 24) : [];
                state.forecastData.dataQuality.Kp = data.Kp.metadata?.quality || 85;
                
                state.validationResults.kpGFZ = {
                    status: state.forecastData.dataQuality.Kp > 85 ? 'valid' : 'warning',
                    confidence: state.forecastData.dataQuality.Kp,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: state.forecastData.kpGFZ.length,
                    statusBreakdown: data.Kp.metadata?.statusCounts
                };
                updateSourceStatus('kpGFZ', state.forecastData.dataQuality.Kp > 85 ? 'valid' : 'warning');
                successCount++;
            } else {
                updateSourceStatus('kpGFZ', 'error');
            }
            
            if (data.ap && data.ap.values.length > 0) {
                state.forecastData.ap = data.ap.values.slice(0, 24);
                state.forecastData.apStatus = data.ap.status ? data.ap.status.slice(0, 24) : [];
                state.forecastData.dataQuality.ap = data.ap.metadata?.quality || 85;
                
                state.validationResults.apGFZ = {
                    status: 'valid',
                    confidence: state.forecastData.dataQuality.ap,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: state.forecastData.ap.length
                };
                updateSourceStatus('apGFZ', 'valid');
                successCount++;
            } else {
                updateSourceStatus('apGFZ', 'error');
            }
            
            if (data.ap30 && data.ap30.values.length > 0) {
                state.forecastData.ap30History = data.ap30.values.slice(-48);
                
                const aggregated = [];
                for (let i = 0; i < data.ap30.values.length; i += 6) {
                    const slice = data.ap30.values.slice(i, i + 6);
                    if (slice.length > 0) {
                        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                        aggregated.push(avg);
                    }
                }
                state.forecastData.ap30 = aggregated.slice(0, 24);
                state.forecastData.dataQuality.ap30 = 90;
                
                state.validationResults.ap30 = {
                    status: 'valid',
                    confidence: 90,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: state.forecastData.ap30.length
                };
                updateSourceStatus('ap30', 'valid');
                successCount++;
            } else {
                updateSourceStatus('ap30', 'error');
            }
            
            return successCount > 0;
            
        } catch (error) {
            console.error('Error cargando índices GFZ:', error);
            
            indices.forEach(index => {
                const sourceId = index === 'Kp' ? 'kpGFZ' : 
                               index === 'ap' ? 'apGFZ' :
                               index === 'Hp30' ? 'hp30' : 'ap30';
                updateSourceStatus(sourceId, 'error');
                state.validationResults[sourceId] = {
                    status: 'error',
                    confidence: 0,
                    error: error.message,
                    latency: Date.now() - startTime
                };
            });
            
            return false;
        }
    }

    async function loadNoaaKp() {
        const source = 'kpNoaa';
        const startTime = Date.now();
        
        updateSourceStatus(source, 'loading');
        
        try {
            const response = await fetchWithCORS(CONFIG.DATA_SOURCES.kpNoaa, {
                source: source,
                timeout: CONFIG.SOURCE_TIMEOUTS.kpNoaa
            });
            
            const text = await response.text();
            const lines = text.split('\n');
            const kpValues = [];
            let dataStartIndex = -1;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('00-03UT')) {
                    dataStartIndex = i;
                    break;
                }
            }
            
            if (dataStartIndex === -1) {
                throw new Error('Formato de datos no reconocido');
            }
            
            for (let day = 0; day < 3; day++) {
                for (let period = 0; period < 8; period++) {
                    const lineIndex = dataStartIndex + period;
                    if (lineIndex < lines.length) {
                        const line = lines[lineIndex];
                        const values = line.trim().split(/\s+/);
                        if (values.length > day + 1) {
                            const kpValue = parseFloat(values[day + 1]);
                            if (!isNaN(kpValue)) {
                                kpValues.push(kpValue);
                            }
                        }
                    }
                }
            }
            
            const latency = Date.now() - startTime;
            state.validationResults[source] = {
                status: 'valid',
                confidence: 85,
                latency: latency,
                lastUpdate: new Date(),
                dataPoints: kpValues.length
            };
            
            updateSourceStatus(source, 'valid');
            return kpValues;
            
        } catch (error) {
            console.error('Error loading NOAA Kp:', error);
            state.validationResults[source] = {
                status: error.message.includes('Timeout') ? 'timeout' : 'error',
                confidence: 0,
                error: error.message,
                latency: Date.now() - startTime
            };
            updateSourceStatus(source, error.message.includes('Timeout') ? 'timeout' : 'error');
            return null;
        }
    }

    async function loadCurrentDst() {
        const source = 'dst';
        const startTime = Date.now();
        
        updateSourceStatus(source, 'loading');
        
        try {
            const now = new Date();
            const yearShort = now.getFullYear().toString().slice(-2);
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const url = `${CONFIG.DATA_SOURCES.dstKyoto}dst${yearShort}${month}.for.request`;
            
            const response = await fetchWithCORS(url, {
                source: source,
                timeout: CONFIG.SOURCE_TIMEOUTS.dst
            });
            
            const text = await response.text();
            const lines = text.split('\n');
            let latestDst = null;
            
            for (const line of lines) {
                if (line.startsWith('DST')) {
                    const nums = line.match(/[+-]?\d+/g);
                    if (!nums || nums.length < 4) continue;
                    const day = parseInt(nums[1]);
                    if (day === now.getUTCDate()) {
                        const values = nums.slice(3, 27).map(v => parseInt(v));
                        const hour = now.getUTCHours();
                        if (hour < values.length) {
                            const val = values[hour];
                            if (!isNaN(val) && val !== 9999) {
                                latestDst = val;
                            }
                        }
                    }
                }
            }
            
            const latency = Date.now() - startTime;
            state.validationResults[source] = {
                status: latestDst !== null ? 'valid' : 'no-data',
                confidence: latestDst !== null ? 85 : 0,
                latency: latency,
                lastUpdate: new Date()
            };
            
            updateSourceStatus(source, latestDst !== null ? 'valid' : 'error');
            return latestDst;
            
        } catch (error) {
            console.error('Error loading DST:', error);
            state.validationResults[source] = {
                status: error.message.includes('Timeout') ? 'timeout' : 'error',
                confidence: 0,
                error: error.message,
                latency: Date.now() - startTime
            };
            updateSourceStatus(source, error.message.includes('Timeout') ? 'timeout' : 'error');
            return null;
        }
    }

    async function loadKsaIndex() {
        const source = 'ksa';
        const startTime = Date.now();
        
        updateSourceStatus(source, 'loading');
        
        try {
            const today = new Date();
            const year = today.getFullYear();
            const dateString = today.toISOString().split('T')[0];
            let url = `${CONFIG.DATA_SOURCES.ksaEmbraceBase}${year}/${dateString}.txt`;
            
            const response = await fetchWithCORS(url, {
                source: source,
                timeout: CONFIG.SOURCE_TIMEOUTS.ksa
            });
            
            const text = await response.text();
            const lines = text.trim().split('\n').filter(line => line.trim());
            const timestamps = [];
            const values = [];
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[0].match(/^\d{4}-\d{2}-\d{2}/)) {
                    try {
                        const time = new Date(parts[0]);
                        const hour = time.getUTCHours();
                        timestamps.push(`${hour}h`);
                        const val = parseFloat(parts[1].replace(/[+-]/g, ''));
                        if (!isNaN(val)) {
                            values.push(val);
                        }
                    } catch (e) {
                        console.warn('KSA: Línea con formato inválido:', line);
                    }
                }
            }
            
            const latency = Date.now() - startTime;
            if (values.length > 0) {
                console.log(`KSA cargado exitosamente: ${values.length} valores en ${latency}ms`);
                state.validationResults[source] = {
                    status: 'valid',
                    confidence: 95,
                    latency: latency,
                    lastUpdate: new Date(),
                    dataPoints: values.length
                };
                updateSourceStatus(source, 'valid');
                return { timestamps, values };
            }
            
            throw new Error('No hay datos disponibles');
            
        } catch (error) {
            console.error('Error loading KSA:', error);
            state.validationResults[source] = {
                status: error.message.includes('Timeout') ? 'timeout' : 'error',
                confidence: 0,
                error: error.message,
                latency: Date.now() - startTime
            };
            updateSourceStatus(source, error.message.includes('Timeout') ? 'timeout' : 'error');
            return null;
        }
    }

    async function loadIntermagnetData(observatory = 'PIL') {
        const source = `intermagnet${observatory}`;
        const startTime = Date.now();
        
        updateSourceStatus(source, 'loading');
        
        try {
            const today = new Date().toISOString().split('T')[0];
            const baseUrl = observatory === 'PIL' ? CONFIG.DATA_SOURCES.intermagnetPIL : CONFIG.DATA_SOURCES.intermagnetVSS;
            const url = `${baseUrl}${today}&dataDuration=1&publicationState=best-avail&format=json`;
            
            const response = await fetchWithCORS(url, {
                source: source,
                timeout: CONFIG.SOURCE_TIMEOUTS[source] || 5000
            });
            
            const data = await response.json();
            
            if (data && data.data && data.data.length > 0) {
                const latest = data.data[data.data.length - 1];
                const result = {
                    timestamp: latest.timestamp,
                    x: latest.x,
                    y: latest.y,
                    z: latest.z,
                    f: Math.sqrt(latest.x * latest.x + latest.y * latest.y + latest.z * latest.z),
                    observatory: observatory
                };
                
                state.validationResults[source] = {
                    status: 'valid',
                    confidence: 92,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date()
                };
                
                updateSourceStatus(source, 'valid');
                return result;
            }
            
            throw new Error('No hay datos disponibles');
            
        } catch (error) {
            console.error(`Error loading ${observatory} data:`, error);
            state.validationResults[source] = {
                status: error.message.includes('Timeout') ? 'timeout' : 'error',
                confidence: 0,
                error: error.message,
                latency: Date.now() - startTime
            };
            updateSourceStatus(source, error.message.includes('Timeout') ? 'timeout' : 'error');
            return null;
        }
    }

    async function loadLegacyData() {
        console.log('Iniciando carga de datos legacy...');
        try {
            const promises = [
                loadKsaIndex(),
                loadNoaaKp(),
                loadCurrentDst(),
                loadIntermagnetData('PIL')
            ];
            
            const results = await Promise.allSettled(promises);
            
            let successCount = 0;
            
            if (results[0].status === 'fulfilled' && results[0].value) {
                state.forecastData.ksaData = results[0].value;
                state.forecastData.ksaIndex = results[0].value.values[results[0].value.values.length - 1];
                console.log('KSA cargado:', state.forecastData.ksaData.values.length, 'valores, último:', state.forecastData.ksaIndex);
                successCount++;
            } else {
                console.error('Error cargando KSA:', results[0].reason);
            }
            
            if (results[1].status === 'fulfilled' && results[1].value) {
                const noaaKp = results[1].value;
                console.log('NOAA Kp cargado:', noaaKp.length, 'valores');
                state.forecastData.kpNoaa = interpolateNoaaData(noaaKp, 24);
                successCount++;
            } else {
                console.error('Error cargando NOAA Kp:', results[1].reason);
            }
            
            if (results[2].status === 'fulfilled' && results[2].value !== null) {
                state.forecastData.dstCurrent = results[2].value;
                console.log('DST actual:', state.forecastData.dstCurrent);
                successCount++;
            } else {
                console.error('Error cargando DST:', results[2].reason);
            }
            
            if (results[3].status === 'fulfilled' && results[3].value) {
                state.forecastData.pilData = results[3].value;
                console.log('PIL cargado:', state.forecastData.pilData.f, 'nT');
                successCount++;
            } else {
                console.error('Error cargando PIL:', results[3].reason);
            }
            
            if (state.forecastData.timestamps.length === 0) {
                state.forecastData.timestamps = createTimeLabels(24);
            }
            
            if (state.forecastData.kpGFZ.length === 0) {
                if (state.forecastData.ksaData && state.forecastData.ksaData.values.length > 0) {
                    state.forecastData.kpGFZ = new Array(24).fill(null);
                    for (let i = 0; i < Math.min(state.forecastData.ksaData.values.length, 24); i++) {
                        state.forecastData.kpGFZ[i] = state.forecastData.ksaData.values[i];
                    }
                    console.log('Usando KSA como fuente principal de Kp');
                } else if (state.forecastData.kpNoaa.length > 0) {
                    state.forecastData.kpGFZ = [...state.forecastData.kpNoaa];
                    console.log('Usando NOAA Kp como fuente principal');
                }
            }
            
            console.log('Carga legacy completada:', successCount, 'de 4 fuentes exitosas');
            return successCount > 0;
            
        } catch (error) {
            console.error('Error cargando datos legacy:', error);
            return false;
        }
    }

    async function loadDataHybrid() {
        const results = {
            gfz: false,
            legacy: false
        };
        
        console.log('=== INICIANDO CARGA DE DATOS ===');
        console.log('Modo de fuente actual:', state.currentDataSource);
        
        results.legacy = await loadLegacyData();
        
        if (state.currentDataSource === 'gfz' || state.currentDataSource === 'hybrid') {
            try {
                console.log('Intentando cargar datos GFZ (HP30 y Kp)...');
                results.gfz = await loadGFZMultiIndices();
                console.log('Resultado GFZ:', results.gfz ? 'Exitoso' : 'Falló');
                
                if (state.forecastData.hp30.length > 0 && 
                    !state.forecastData.ksaIndex && 
                    state.forecastData.kpNoaa.length === 0 && 
                    state.forecastData.kpGFZ.length === 0) {
                    console.log('Usando HP30 como fuente principal (prioridad 3)');
                    state.forecastData.kpGFZ = [...state.forecastData.hp30];
                }
            } catch (error) {
                console.log('GFZ no disponible:', error.message);
            }
        }
        
        console.log('=== RESUMEN DE CARGA ===');
        console.log('Legacy:', results.legacy ? 'OK' : 'Error');
        console.log('GFZ:', results.gfz ? 'OK' : 'Error');
        console.log('Datos disponibles:', {
            ksaIndex: state.forecastData.ksaIndex,
            kpNoaa: state.forecastData.kpNoaa.length,
            hp30: state.forecastData.hp30.length,
            kpGFZ: state.forecastData.kpGFZ.length,
            timestamps: state.forecastData.timestamps.length
        });
        
        return results.gfz || results.legacy;
    }

    // ================== FUNCIONES DE ACTUALIZACIÓN UI ==================
    
    function updateSourceStatus(sourceId, status) {
        const element = document.querySelector(`[data-source="${sourceId}"]`);
        if (!element) {
            console.warn('No se encontró elemento para la fuente:', sourceId);
            return;
        }
        
        element.classList.remove('valid', 'warning', 'error', 'loading', 'pending', 'cached', 'timeout');
        element.classList.add(status);
        
        console.log(`Estado de ${sourceId}: ${status}`);
    }

    function updateSAMAPanel() {
        const currentIndices = {
            Kp: state.forecastData.ksaIndex || state.forecastData.kpNoaa[0] || 
                state.forecastData.hp30[0] || state.forecastData.kpGFZ[0],
            ap: state.forecastData.ap[0],
            Hp30: state.forecastData.hp30[0],
            ap30: state.forecastData.ap30[0],
            ap30History: state.forecastData.ap30History
        };
        
        const dynamicFactor = samaAnalyzer.calculateDynamicFactor(currentIndices);
        state.forecastData.samaFactor = dynamicFactor;
        
        const riskAssessment = samaAnalyzer.evaluateRisk(currentIndices, dynamicFactor);
        state.forecastData.samaRisk = riskAssessment.level;
        
        const prediction = samaAnalyzer.predictShortTerm(currentIndices);
        
        document.getElementById('samaFactorValue').textContent = `×${dynamicFactor.toFixed(2)}`;
        
        const kpEffective = currentIndices.Kp ? (currentIndices.Kp * dynamicFactor).toFixed(2) : '--';
        document.getElementById('kpEffective').textContent = kpEffective;
        
        const apSama = currentIndices.ap ? (currentIndices.ap * dynamicFactor).toFixed(0) : '--';
        document.getElementById('apSama').textContent = apSama + (apSama !== '--' ? ' nT' : '');
        
        const riskElement = document.getElementById('samaRisk');
        riskElement.textContent = riskAssessment.level;
        riskElement.style.color = riskAssessment.level === 'CRÍTICO' ? '#ef4444' :
                                 riskAssessment.level === 'ALTO' ? '#f59e0b' :
                                 riskAssessment.level === 'MEDIO' ? '#fbbf24' : '#10b981';
        
        document.getElementById('samaPrediction').textContent = prediction.prediction;
    }

    function updateChart() {
        const ctx = document.getElementById('mainChart').getContext('2d');
        
        const datasets = [];
        
        if (state.forecastData.ksaData && state.forecastData.ksaData.values.length > 0) {
            const ksaArray = new Array(state.forecastData.timestamps.length).fill(null);
            for (let i = 0; i < state.forecastData.ksaData.values.length && i < ksaArray.length; i++) {
                ksaArray[i] = state.forecastData.ksaData.values[i];
            }
            datasets.push({
                label: 'KSA EMBRACE (Prioridad 1)',
                data: ksaArray,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 4,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#10b981',
                yAxisID: 'y-kp',
                order: 1
            });
        }
        
        if (state.forecastData.kpNoaa.length > 0 && (!state.forecastData.ksaData || state.currentDataSource === 'legacy')) {
            datasets.push({
                label: 'Kp NOAA (Prioridad 2)',
                data: state.forecastData.kpNoaa,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#f59e0b',
                yAxisID: 'y-kp',
                order: 2
            });
        }
        
        if (state.forecastData.hp30.length > 0 && state.currentDataSource !== 'legacy') {
            datasets.push({
                label: 'HP30 GFZ (Prioridad 3)',
                data: state.forecastData.hp30,
                borderColor: '#3b82f6',
                borderWidth: 2,
                borderDash: [5, 5],
                tension: 0.4,
                pointRadius: 2,
                yAxisID: 'y-kp',
                order: 3
            });
        }
        
        if (state.forecastData.kpGFZ.length > 0 && state.currentDataSource !== 'legacy' && 
            !state.forecastData.ksaData && state.forecastData.kpNoaa.length === 0) {
            datasets.push({
                label: 'Kp GFZ (Prioridad 4)',
                data: state.forecastData.kpGFZ,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 2,
                borderDash: [8, 4],
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#8b5cf6',
                yAxisID: 'y-kp',
                order: 4
            });
        }
        
        if (state.forecastData.ap30.length > 0 && state.currentDataSource !== 'legacy') {
            const maxAp30 = Math.max(...state.forecastData.ap30);
            if (maxAp30 > 10) {
                datasets.push({
                    label: 'ap30 (nT)',
                    data: state.forecastData.ap30,
                    borderColor: '#64748b',
                    borderWidth: 2,
                    borderDash: [4, 2],
                    tension: 0.4,
                    pointRadius: 2,
                    yAxisID: 'y-ap',
                    hidden: true
                });
            }
        }
        
        const kpBase = state.forecastData.ksaData?.values || state.forecastData.kpNoaa || 
                      state.forecastData.hp30 || state.forecastData.kpGFZ;
        if (kpBase && kpBase.length > 0) {
            const kpSAMA = kpBase.map(kp => kp ? kp * state.forecastData.samaFactor : null);
            datasets.push({
                label: 'Kp Efectivo SAMA',
                data: kpSAMA,
                borderColor: '#ef4444',
                borderWidth: 3,
                borderDash: [10, 5],
                tension: 0.4,
                pointRadius: 3,
                yAxisID: 'y-kp',
                order: 0
            });
        }
        
        if (state.mainChart) {
            state.mainChart.data.labels = state.forecastData.timestamps;
            state.mainChart.data.datasets = datasets;
            state.mainChart.update();
            return;
        }
        
        state.mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: state.forecastData.timestamps,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(148, 163, 184, 0.3)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                
                                if (context.dataset.yAxisID === 'y-ap') {
                                    label += context.parsed.y.toFixed(0) + ' nT';
                                } else {
                                    label += context.parsed.y.toFixed(2);
                                }
                                
                                if (context.datasetIndex === 0 && state.forecastData.kpStatus[context.dataIndex]) {
                                    label += ` (${state.forecastData.kpStatus[context.dataIndex]})`;
                                }
                                
                                return label;
                            }
                        }
                    },
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                yMin: 5,
                                yMax: 5,
                                yScaleID: 'y-kp',
                                borderColor: 'rgba(239, 68, 68, 0.5)',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: 'Umbral de riesgo',
                                    enabled: true,
                                    position: 'start',
                                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                                    color: 'white',
                                    padding: 4,
                                    font: {
                                        size: 11
                                    }
                                }
                            },
                            line2: {
                                type: 'line',
                                yMin: 3.85,
                                yMax: 3.85,
                                yScaleID: 'y-kp',
                                borderColor: 'rgba(139, 92, 246, 0.5)',
                                borderWidth: 2,
                                borderDash: [10, 5],
                                label: {
                                    content: 'Umbral SAMA (Kp 5 / 1.3)',
                                    enabled: true,
                                    position: 'start',
                                    backgroundColor: 'rgba(139, 92, 246, 0.8)',
                                    color: 'white',
                                    padding: 4,
                                    font: {
                                        size: 11
                                    }
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(148, 163, 184, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            maxRotation: 45,
                            minRotation: 0,
                            font: {
                                size: 11
                            }
                        }
                    },
                    'y-kp': {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        max: 9,
                        title: {
                            display: true,
                            text: 'Índice Kp',
                            color: '#94a3b8'
                        },
                        grid: {
                            color: 'rgba(148, 163, 184, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            stepSize: 1
                        }
                    },
                    'y-ap': {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Amplitud ap (nT)',
                            color: '#94a3b8'
                        },
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: '#94a3b8'
                        }
                    }
                }
            }
        });
    }

    function updateValidationPanel() {
        const grid = document.getElementById('validationGrid');
        
        grid.innerHTML = CONFIG.SOURCE_INFO.map(source => {
            const validation = state.validationResults[source.id] || { status: 'pending', confidence: 0 };
            const statusClass = validation.status || 'pending';
            
            let statusIcon = '⏳';
            let statusText = 'Pendiente';
            
            switch(validation.status) {
                case 'valid':
                    statusIcon = '✅';
                    statusText = 'Válido';
                    break;
                case 'warning':
                    statusIcon = '⚠️';
                    statusText = 'Advertencia';
                    break;
                case 'error':
                    statusIcon = '❌';
                    statusText = 'Error';
                    break;
                case 'timeout':
                    statusIcon = '⏱️';
                    statusText = 'Timeout';
                    break;
                case 'loading':
                    statusIcon = '🔄';
                    statusText = 'Cargando...';
                    break;
                case 'cached':
                    statusIcon = '💾';
                    statusText = 'Cache';
                    break;
            }
            
            let additionalInfo = '';
            if (validation.statusBreakdown) {
                const total = Object.values(validation.statusBreakdown).reduce((a, b) => a + b, 0);
                const defPercent = ((validation.statusBreakdown.def / total) * 100).toFixed(0);
                additionalInfo = `<div class="metric-row"><span class="metric-label">Definitivos:</span><span class="metric-value">${defPercent}%</span></div>`;
            }
            
            return `
                <div class="validation-item ${statusClass}" data-source="${source.id}">
                    <div class="validation-source">
                        <div class="source-name">
                            <span>${source.icon}</span>
                            <span>${source.name}</span>
                        </div>
                        <button class="retry-button" onclick="geoMagApp.retrySource('${source.id}')">
                            🔄 Reintentar
                        </button>
                    </div>
                    <div class="validation-metrics">
                        <div class="metric-row">
                            <span class="metric-label">Estado:</span>
                            <span class="metric-value">${statusIcon} ${statusText}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Latencia:</span>
                            <span class="metric-value">${validation.latency ? validation.latency + ' ms' : '--'}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Actualización:</span>
                            <span class="metric-value">${
                                validation.lastUpdate ? 
                                new Date(validation.lastUpdate).toLocaleTimeString('es-AR') : 
                                '--:--'
                            }</span>
                        </div>
                        ${additionalInfo}
                        ${validation.fromCache ? '<div class="metric-row"><span class="metric-label">Fuente:</span><span class="metric-value">💾 Cache</span></div>' : ''}
                    </div>
                    <div class="confidence-bar">
                        <div class="confidence-fill" style="width: ${validation.confidence}%; background: ${
                            validation.confidence >= 80 ? '#10b981' :
                            validation.confidence >= 60 ? '#f59e0b' : '#ef4444'
                        }"></div>
                        <div class="loading-progress"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateDroneStatus() {
        const samaFactor = state.forecastData.samaFactor;
        const currentKp = state.forecastData.ksaIndex || state.forecastData.kpNoaa[0] || 
                         state.forecastData.hp30[0] || state.forecastData.kpGFZ[0] || 0;
        const currentAp = state.forecastData.ap[0] || 0;
        const effectiveKp = currentKp * samaFactor;
        const effectiveAp = currentAp * samaFactor;
        
        const statusElement = document.getElementById('droneStatus');
        const statusText = document.getElementById('statusText');
        const statusRecommendation = document.getElementById('statusRecommendation');
        const droneIcon = statusElement.querySelector('.drone-icon');
        
        if (effectiveKp >= 7 || effectiveAp >= 180) {
            statusText.textContent = 'NO VOLAR';
            statusText.className = 'drone-status-text drone-status-danger';
            statusRecommendation.textContent = 'Tormenta geomagnética severa. Prohibido volar. Riesgo crítico en región SAMA.';
            droneIcon.textContent = '⛔';
        } else if (effectiveKp >= 5 || effectiveAp >= 80) {
            statusText.textContent = 'PRECAUCIÓN EXTREMA';
            statusText.className = 'drone-status-text drone-status-danger';
            statusRecommendation.textContent = 'Actividad geomagnética muy alta. Solo vuelos esenciales con precauciones extras.';
            droneIcon.textContent = '🚫';
        } else if (effectiveKp >= 4 || effectiveAp >= 48) {
            statusText.textContent = 'VUELO LIMITADO';
            statusText.className = 'drone-status-text drone-status-caution';
            statusRecommendation.textContent = 'Actividad moderada amplificada por SAMA. Reducir distancia y altura de operación.';
            droneIcon.textContent = '⚠️';
        } else if (effectiveKp >= 3 || effectiveAp >= 27) {
            statusText.textContent = 'PRECAUCIÓN';
            statusText.className = 'drone-status-text drone-status-caution';
            statusRecommendation.textContent = 'Actividad menor pero amplificada en SAMA. Monitorear constantemente.';
            droneIcon.textContent = '🔶';
        } else {
            statusText.textContent = 'VUELO SEGURO';
            statusText.className = 'drone-status-text drone-status-safe';
            statusRecommendation.textContent = 'Condiciones óptimas para operaciones de agricultura de precisión.';
            droneIcon.textContent = '✅';
        }
    }

    function updateRiskFactors() {
        const samaFactor = state.forecastData.samaFactor;
        const currentKp = (state.forecastData.ksaIndex || state.forecastData.kpNoaa[0] || 
                          state.forecastData.hp30[0] || state.forecastData.kpGFZ[0] || 0) * samaFactor;
        
        const gpsRisk = document.getElementById('gpsRisk');
        const gpsRiskText = document.getElementById('gpsRiskText');
        if (currentKp >= 7) {
            gpsRisk.className = 'risk-indicator risk-high';
            gpsRiskText.textContent = 'Degradación severa (±10-30m)';
            document.getElementById('gpsAccuracy').textContent = '±10-30m';
        } else if (currentKp >= 5) {
            gpsRisk.className = 'risk-indicator risk-medium';
            gpsRiskText.textContent = 'Precisión reducida (±5-10m)';
            document.getElementById('gpsAccuracy').textContent = '±5-10m';
        } else if (currentKp >= 4) {
            gpsRisk.className = 'risk-indicator risk-medium';
            gpsRiskText.textContent = 'Variaciones menores (±2-5m)';
            document.getElementById('gpsAccuracy').textContent = '±2-5m';
        } else {
            gpsRisk.className = 'risk-indicator risk-low';
            gpsRiskText.textContent = 'Precisión normal (±1m)';
            document.getElementById('gpsAccuracy').textContent = '±1m';
        }
        
        const magRisk = document.getElementById('magRisk');
        const magRiskText = document.getElementById('magRiskText');
        if (currentKp >= 6) {
            magRisk.className = 'risk-indicator risk-high';
            magRiskText.textContent = 'Interferencia severa';
        } else if (currentKp >= 4) {
            magRisk.className = 'risk-indicator risk-medium';
            magRiskText.textContent = 'Interferencia moderada';
        } else {
            magRisk.className = 'risk-indicator risk-low';
            magRiskText.textContent = 'Sin interferencias';
        }
        
        const commRisk = document.getElementById('commRisk');
        const commRiskText = document.getElementById('commRiskText');
        if (currentKp >= 7) {
            commRisk.className = 'risk-indicator risk-medium';
            commRiskText.textContent = 'Posibles interrupciones';
        } else {
            commRisk.className = 'risk-indicator risk-low';
            commRiskText.textContent = 'Señal estable';
        }
        
        const samaRiskElement = document.getElementById('samaRisk');
        const samaRiskText = document.getElementById('samaRiskText');
        const samaRiskLevel = state.forecastData.samaRisk;
        if (samaRiskLevel === 'CRÍTICO' || samaRiskLevel === 'ALTO') {
            samaRiskElement.className = 'risk-indicator risk-high';
            samaRiskText.textContent = `${samaRiskLevel} (×${state.forecastData.samaFactor.toFixed(2)})`;
        } else if (samaRiskLevel === 'MEDIO') {
            samaRiskElement.className = 'risk-indicator risk-medium';
            samaRiskText.textContent = `Efecto moderado (×${state.forecastData.samaFactor.toFixed(2)})`;
        } else {
            samaRiskElement.className = 'risk-indicator risk-low';
            samaRiskText.textContent = 'Efecto mínimo';
        }
        
        // Riesgo de validación
        const validationRisk = document.getElementById('validationRisk');
        const validationRiskText = document.getElementById('validationRiskText');
        const totalSources = CONFIG.SOURCE_INFO.length;
        const validSources = Object.values(state.validationResults).filter(v => v.status === 'valid').length;
        const validationPercent = (validSources / totalSources) * 100;
        
        if (validationPercent >= 75) {
            validationRisk.className = 'risk-indicator risk-low';
            validationRiskText.textContent = `Datos confiables (${validSources}/${totalSources})`;
        } else if (validationPercent >= 50) {
            validationRisk.className = 'risk-indicator risk-medium';
            validationRiskText.textContent = `Datos parciales (${validSources}/${totalSources})`;
        } else {
            validationRisk.className = 'risk-indicator risk-high';
            validationRiskText.textContent = `Datos limitados (${validSources}/${totalSources})`;
        }
    }

    function updateStatistics() {
        if (!state.forecastData.kpGFZ || state.forecastData.kpGFZ.length === 0) {
            console.warn('No hay datos Kp para estadísticas');
            return;
        }
        
        const validKpValues = state.forecastData.kpGFZ.filter(v => v !== null && !isNaN(v));
        if (validKpValues.length === 0) {
            console.warn('No hay valores Kp válidos');
            return;
        }
        
        const maxKp = Math.max(...validKpValues);
        const maxKpIndex = state.forecastData.kpGFZ.indexOf(maxKp);
        document.getElementById('maxKp').textContent = maxKp.toFixed(1);
        document.getElementById('maxKpTime').textContent = state.forecastData.timestamps[maxKpIndex] || '--';
        
        if (state.forecastData.ap.length > 0) {
            const validApValues = state.forecastData.ap.filter(v => v !== null && !isNaN(v));
            if (validApValues.length > 0) {
                const maxAp = Math.max(...validApValues);
                const maxApIndex = state.forecastData.ap.indexOf(maxAp);
                document.getElementById('maxAp').textContent = maxAp.toFixed(0);
                document.getElementById('maxApTime').textContent = state.forecastData.timestamps[maxApIndex] || '--';
            }
        }
        
        const stormProb = calculateStormProbability();
        document.getElementById('stormProb').textContent = `${stormProb.toFixed(0)}%`;
        
        const optimalHours = validKpValues.filter(kp => kp * state.forecastData.samaFactor < 4).length;
        document.getElementById('optimalWindow').textContent = `${optimalHours}h`;
        document.getElementById('optimalHours').textContent = `de ${state.forecastData.timestamps.length}h totales`;
    }

    function updateRegionalData() {
        if (state.forecastData.dstCurrent !== null) {
            const dstValue = state.forecastData.dstCurrent;
            let dstStatus = 'Normal';
            let dstColor = '#10b981';
            
            if (dstValue <= -200) {
                dstStatus = 'Tormenta severa';
                dstColor = '#ef4444';
            } else if (dstValue <= -100) {
                dstStatus = 'Tormenta intensa';
                dstColor = '#f59e0b';
            } else if (dstValue <= -50) {
                dstStatus = 'Tormenta moderada';
                dstColor = '#fbbf24';
            } else if (dstValue <= -30) {
                dstStatus = 'Tormenta débil';
                dstColor = '#84cc16';
            }
            
            const dstElement = document.getElementById('dstValue');
            if (dstElement) {
                dstElement.textContent = `${dstValue} nT`;
                dstElement.style.color = dstColor;
                const dstStatusElement = document.getElementById('dstStatus');
                if (dstStatusElement) {
                    dstStatusElement.textContent = dstStatus;
                }
            }
        }
        
        if (state.forecastData.ksaData && state.forecastData.ksaData.values.length > 0) {
            const latestKsa = state.forecastData.ksaData.values[state.forecastData.ksaData.values.length - 1];
            const ksaElement = document.getElementById('ksaValue');
            if (ksaElement) {
                ksaElement.textContent = latestKsa.toFixed(2);
                let ksaColor = '#10b981';
                if (latestKsa >= 7) ksaColor = '#ef4444';
                else if (latestKsa >= 5) ksaColor = '#f59e0b';
                else if (latestKsa >= 4) ksaColor = '#fbbf24';
                ksaElement.style.color = ksaColor;
            }
        }
        
        if (state.forecastData.pilData && state.forecastData.pilData.f) {
            const pilElement = document.getElementById('pilField');
            if (pilElement) {
                pilElement.textContent = `${state.forecastData.pilData.f.toFixed(0)} nT`;
            }
            const pilStatus = document.getElementById('pilStatus');
            if (pilStatus) {
                pilStatus.textContent = 'INTERMAGNET PIL';
            }
        }
    }

    function updateMultiIndexPanel() {
        console.log('Actualizando panel multi-índice con datos disponibles');
        
        // Actualizar contadores de índices disponibles
        const indices = {
            kp: (state.forecastData.kpGFZ.length > 0 ? 1 : 0) + 
                (state.forecastData.kpNoaa.length > 0 ? 1 : 0) + 
                (state.forecastData.ksaData ? 1 : 0),
            ap: (state.forecastData.ap.length > 0 ? 1 : 0) + 
                (state.forecastData.ap30.length > 0 ? 1 : 0),
            hp: state.forecastData.hp30.length > 0 ? 1 : 0,
            regional: (state.forecastData.dstCurrent !== null ? 1 : 0) + 
                     (state.forecastData.pilData ? 1 : 0) + 
                     (state.forecastData.ksaData ? 1 : 0)
        };
        
        console.log('Índices disponibles:', indices);
    }

    // ================== FUNCIONES AUXILIARES ==================
    
    function interpolateNoaaData(noaaData, targetLength) {
        if (!noaaData || noaaData.length === 0) return [];
        
        const result = [];
        const factor = noaaData.length / targetLength;
        
        for (let i = 0; i < targetLength; i++) {
            const sourceIndex = Math.floor(i * factor);
            result.push(noaaData[Math.min(sourceIndex, noaaData.length - 1)]);
        }
        
        return result;
    }
    
    function createTimeLabels(count) {
        const labels = [];
        const now = new Date();
        
        for (let i = 0; i < count; i++) {
            const time = new Date(now.getTime() + i * 3 * 60 * 60 * 1000);
            labels.push(formatLocalLabel(time));
        }
        
        return labels;
    }
    
    function formatLocalLabel(date) {
        const local = new Date(date.getTime());
        const day = String(local.getDate()).padStart(2, '0');
        const month = String(local.getMonth() + 1).padStart(2, '0');
        const hour = String(local.getHours()).padStart(2, '0');
        return `${day}/${month} ${hour}h`;
    }
    
    function calculateStormProbability() {
        let probability = 0;
        let factors = 0;
        
        if (state.forecastData.kpGFZ.length > 0) {
            const kpHigh = state.forecastData.kpGFZ.filter(kp => kp !== null && kp >= 5).length;
            probability += (kpHigh / state.forecastData.kpGFZ.length) * 100 * 0.4;
            factors += 0.4;
        }
        
        if (state.forecastData.ap.length > 0) {
            const apHigh = state.forecastData.ap.filter(ap => ap !== null && ap >= 48).length;
            probability += (apHigh / state.forecastData.ap.length) * 100 * 0.3;
            factors += 0.3;
        }
        
        if (state.forecastData.hp30.length > 0) {
            const hp30High = state.forecastData.hp30.filter(hp => hp !== null && hp >= 5).length;
            probability += (hp30High / state.forecastData.hp30.length) * 100 * 0.3;
            factors += 0.3;
        }
        
        if (factors > 0) {
            probability = (probability / factors) * state.forecastData.samaFactor;
        }
        
        return Math.min(100, probability);
    }

    // ================== FUNCIONES PÚBLICAS ==================
    
    async function refreshData() {
        document.getElementById('chartLoading').style.display = 'flex';
        document.getElementById('systemStatus').textContent = 'Actualizando...';
        
        try {
            const success = await loadDataHybrid();
            
            if (!success) {
                throw new Error('No se pudieron cargar los datos');
            }
            
            const currentKp = state.forecastData.kpCurrent || state.forecastData.kpGFZ[0] || 
                            state.forecastData.kpNoaa[0] || 0;
            document.getElementById('currentKp').textContent = currentKp.toFixed(2);
            
            updateMultiIndexPanel();
            updateSAMAPanel();
            updateChart();
            updateDroneStatus();
            updateValidationPanel();
            updateRiskFactors();
            updateStatistics();
            updateRegionalData();
            
            document.getElementById('systemStatus').textContent = 'En línea';
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('es-AR');
            
        } catch (error) {
            console.error('Error actualizando datos:', error);
            document.getElementById('systemStatus').textContent = 'Error de conexión';
        } finally {
            document.getElementById('chartLoading').style.display = 'none';
        }
    }
    
    function toggleAutoRefresh() {
        state.isAutoRefreshEnabled = !state.isAutoRefreshEnabled;
        const statusSpan = document.getElementById('autoRefreshStatus');
        
        if (state.isAutoRefreshEnabled) {
            statusSpan.textContent = 'ON';
            state.autoRefreshInterval = setInterval(refreshData, 10 * 60 * 1000); // 10 minutos
        } else {
            statusSpan.textContent = 'OFF';
            if (state.autoRefreshInterval) {
                clearInterval(state.autoRefreshInterval);
                state.autoRefreshInterval = null;
            }
        }
    }
    
    function toggleDataSource() {
        const sources = ['hybrid', 'gfz', 'legacy'];
        const currentIndex = sources.indexOf(state.currentDataSource);
        state.currentDataSource = sources[(currentIndex + 1) % sources.length];
        
        const statusText = {
            'hybrid': 'Híbrida',
            'gfz': 'GFZ API',
            'legacy': 'Legacy'
        };
        
        document.getElementById('dataSourceStatus').textContent = statusText[state.currentDataSource];
        
        refreshData();
    }
    
    async function retrySource(sourceId) {
        console.log('Reintentando carga de fuente:', sourceId);
        updateSourceStatus(sourceId, 'loading');
        
        try {
            switch(sourceId) {
                case 'ksa':
                    await loadKsaIndex();
                    break;
                case 'kpNoaa':
                    await loadNoaaKp();
                    break;
                case 'hp30':
                case 'kpGFZ':
                case 'apGFZ':
                case 'ap30':
                    await loadGFZMultiIndices();
                    break;
                case 'dst':
                    await loadCurrentDst();
                    break;
                case 'intermagnetPIL':
                    await loadIntermagnetData('PIL');
                    break;
            }
            
            updateChart();
            updateValidationPanel();
        } catch (error) {
            console.error(`Error reintentando ${sourceId}:`, error);
        }
    }

    // Función simple para cargar HP30 y Kp (24h)
    async function loadSimpleGFZ() {
        const outputElement = document.getElementById('gfzOutput');
        outputElement.textContent = 'Cargando datos GFZ...';
        
        try {
            const end = new Date();
            const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
            const startStr = start.toISOString().slice(0, 19) + 'Z';
            const endStr = end.toISOString().slice(0, 19) + 'Z';
            
            const hp30 = await gfzLoader.getData(startStr, endStr, 'Hp30');
            const kp = await gfzLoader.getData(startStr, endStr, 'Kp');
            
            let output = 'HP30 (Índice de alta resolución - 30 minutos):\n';
            output += '==========================================\n';
            hp30.datetime.forEach((t, i) => {
                const date = new Date(t);
                const formattedDate = date.toLocaleString('es-AR');
                output += `${formattedDate} -> ${hp30.values[i]?.toFixed(2) || 'N/A'}\n`;
            });
            
            output += '\n\nKp (Índice planetario - 3 horas):\n';
            output += '==================================\n';
            kp.datetime.forEach((t, i) => {
                const date = new Date(t);
                const formattedDate = date.toLocaleString('es-AR');
                const status = kp.status && kp.status[i] ? ` [${kp.status[i]}]` : '';
                output += `${formattedDate} -> ${kp.values[i]?.toFixed(2) || 'N/A'}${status}\n`;
            });
            
            outputElement.textContent = output;
        } catch (error) {
            outputElement.textContent = `Error cargando datos GFZ: ${error.message}`;
        }
    }

    // ================== INICIALIZACIÓN ==================
    
    function init() {
        console.log('Monitor Geomagnético iniciando...');
        console.log('Configuración: Multi-índices GFZ con análisis SAMA mejorado');
        
        // Inicializar panel de validación
        updateValidationPanel();
        
        // Configurar botón de consola GFZ
        const gfzButton = document.getElementById('loadGFZButton');
        if (gfzButton) {
            gfzButton.addEventListener('click', loadSimpleGFZ);
        }
        
        // Cargar datos iniciales
        refreshData();
    }

    // ================== API PÚBLICA ==================
    
    return {
        init: init,
        refreshData: refreshData,
        toggleAutoRefresh: toggleAutoRefresh,
        toggleDataSource: toggleDataSource,
        retrySource: retrySource,
        getState: () => state,
        getConfig: () => CONFIG
    };
    
})();

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    geoMagApp.init();
});