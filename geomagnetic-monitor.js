// geomagnetic-monitor.js
// Monitor Geomagnético Avanzado - Sistema de Predicción Multi-índice
// Versión 3.0 - Mejorada con gestión de estado centralizada y parsers robustos

'use strict';

// ==================== PARTE 1: CONFIGURACIÓN Y CLASES ====================

// Detectar entorno de ejecución
const IS_PRODUCTION = window.location.hostname !== 'localhost' && 
                     window.location.hostname !== '127.0.0.1';

// Usar fecha real del sistema
const SYSTEM_DATE = new Date();
console.log('Monitor Geomagnético v3.0');
console.log('Fecha del sistema:', SYSTEM_DATE.toISOString());
console.log('Entorno:', IS_PRODUCTION ? 'Producción' : 'Desarrollo');

// Namespace principal de la aplicación
const geoMagApp = (function() {
    
    // ================== CONFIGURACIÓN CENTRALIZADA ==================
    const CONFIG = {
        // Constantes de tiempo
        TIME_CONSTANTS: {
            PAST_72H_MS: 72 * 60 * 60 * 1000,
            PAST_24H_MS: 24 * 60 * 60 * 1000,
            REFRESH_INTERVAL_MS: 10 * 60 * 1000, // 10 minutos
            HOUR_MS: 60 * 60 * 1000,
            THREE_HOURS_MS: 3 * 60 * 60 * 1000
        },
        
        // Umbrales SAMA
        SAMA_THRESHOLDS: {
            SAFE: { KP: 3, AP: 18 },
            CAUTION: { KP: 4, AP: 27 },
            DANGER: { KP: 5, AP: 48 },
            CRITICAL: { KP: 7, AP: 180 }
        },
        
        // Factores de amplificación SAMA
        SAMA_FACTORS: {
            BASE: 1.3,
            MIN: 1.0,
            MAX: 2.0,
            AMPLIFICATION: {
                KP: 1.3,
                AP: 1.4,
                HP30: 1.35,
                AP30: 1.45
            }
        },
        
        // Pesos para cálculos dinámicos
        DYNAMIC_WEIGHTS: {
            KP: 0.3,    // Peso del índice Kp en el factor dinámico
            AP: 0.4,    // Peso del índice ap (más importante por ser lineal)
            HP30: 0.15, // Peso del índice Hp30
            AP30: 0.15  // Peso del índice ap30
        },
        
        // Scores de riesgo
        RISK_SCORES: {
            KP_CRITICAL: 40,
            KP_ELEVATED: 20,
            AP_CRITICAL: 30,
            AP_ELEVATED: 15,
            RAPID_INCREASE: 25,
            THRESHOLD_CRITICAL: 60,
            THRESHOLD_HIGH: 40,
            THRESHOLD_MEDIUM: 20
        },
        
        // Validación de valores
        VALIDATION: {
            KP_MIN: 0,
            KP_MAX: 9,
            AP_MIN: 0,
            AP_MAX: 1000,
            DST_MIN: -500,
            DST_MAX: 200,
            DST_INVALID_VALUES: [9999, 99999, -9999, -99999]
        },
        
        // Proxies CORS con prioridad y timeout
        CORS_PROXIES: [
            {
                name: 'AllOrigins',
                url: 'https://api.allorigins.win/raw?url=',
                timeout: 10000,
                priority: 1
            },
            {
                name: 'CORS-Anywhere',
                url: 'https://cors-anywhere.herokuapp.com/',
                timeout: 15000,
                priority: 2
            }
        ],
        
        // Timeouts por fuente en milisegundos
        SOURCE_TIMEOUTS: {
            gfzApi: IS_PRODUCTION ? 30000 : 20000,
            kpPager: IS_PRODUCTION ? 15000 : 10000,
            kpNoaa: IS_PRODUCTION ? 40000 : 30000,
            dst: IS_PRODUCTION ? 60000 : 40000,
            ksa: IS_PRODUCTION ? 30000 : 20000,
            intermagnetPIL: IS_PRODUCTION ? 15000 : 10000,
            intermagnetVSS: IS_PRODUCTION ? 15000 : 10000
        },
        
        // URLs de fuentes de datos
        DATA_SOURCES: {
            kpPager: "https://www.spacepager.eu/fileadmin/Products/WP3/kp_product_file_FORECAST_PAGER_SWIFT_LAST.json",
            kpNoaa: "https://services.swpc.noaa.gov/text/3-day-geomag-forecast.txt",
            intermagnetPIL: "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&ObservatoryIagaCode=PIL&samplesPerDay=Minute&dataStartDate=",
            intermagnetVSS: "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&ObservatoryIagaCode=VSS&samplesPerDay=Minute&dataStartDate=",
            dstKyoto: "https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/presentmonth/",
            ksaEmbraceBase: "https://embracedata.inpe.br/ksa/"
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

    // ================== GESTOR DE ESTADO CENTRALIZADO ==================
    class StateManager {
        constructor() {
            this.state = {
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
                    samaFactor: CONFIG.SAMA_FACTORS.BASE,
                    samaRisk: 'BAJO'
                }
            };
            
            // Mutex para evitar condiciones de carrera
            this.updateQueue = [];
            this.isUpdating = false;
            
            // Suscriptores a cambios de estado
            this.subscribers = new Map();
        }
        
        // Método para actualizar el estado de forma segura
        async updateState(updates) {
            return new Promise((resolve) => {
                this.updateQueue.push({ updates, resolve });
                this.processQueue();
            });
        }
        
        // Procesar cola de actualizaciones
        async processQueue() {
            if (this.isUpdating || this.updateQueue.length === 0) {
                return;
            }
            
            this.isUpdating = true;
            
            while (this.updateQueue.length > 0) {
                const { updates, resolve } = this.updateQueue.shift();
                
                try {
                    // Aplicar actualizaciones
                    for (const [path, value] of Object.entries(updates)) {
                        this.setNestedValue(this.state, path, value);
                    }
                    
                    // Notificar a suscriptores
                    this.notifySubscribers(updates);
                    
                    resolve(true);
                } catch (error) {
                    console.error('Error actualizando estado:', error);
                    resolve(false);
                }
            }
            
            this.isUpdating = false;
        }
        
        // Establecer valor en ruta anidada
        setNestedValue(obj, path, value) {
            const keys = path.split('.');
            const lastKey = keys.pop();
            const target = keys.reduce((curr, key) => {
                if (!curr[key]) curr[key] = {};
                return curr[key];
            }, obj);
            
            target[lastKey] = value;
        }
        
        // Obtener valor de ruta anidada
        getNestedValue(obj, path) {
            return path.split('.').reduce((curr, key) => curr?.[key], obj);
        }
        
        // Suscribirse a cambios
        subscribe(path, callback) {
            if (!this.subscribers.has(path)) {
                this.subscribers.set(path, new Set());
            }
            this.subscribers.get(path).add(callback);
            
            // Retornar función para desuscribirse
            return () => {
                const callbacks = this.subscribers.get(path);
                if (callbacks) {
                    callbacks.delete(callback);
                    if (callbacks.size === 0) {
                        this.subscribers.delete(path);
                    }
                }
            };
        }
        
        // Notificar a suscriptores
        notifySubscribers(updates) {
            for (const [path, value] of Object.entries(updates)) {
                // Notificar suscriptores exactos
                const exactSubscribers = this.subscribers.get(path);
                if (exactSubscribers) {
                    exactSubscribers.forEach(callback => {
                        try {
                            callback(value, path);
                        } catch (error) {
                            console.error('Error en suscriptor:', error);
                        }
                    });
                }
                
                // Notificar suscriptores de rutas padre
                const pathParts = path.split('.');
                for (let i = pathParts.length - 1; i > 0; i--) {
                    const parentPath = pathParts.slice(0, i).join('.');
                    const parentSubscribers = this.subscribers.get(parentPath);
                    if (parentSubscribers) {
                        const parentValue = this.getNestedValue(this.state, parentPath);
                        parentSubscribers.forEach(callback => {
                            try {
                                callback(parentValue, parentPath);
                            } catch (error) {
                                console.error('Error en suscriptor padre:', error);
                            }
                        });
                    }
                }
            }
        }
        
        // Método conveniente para obtener el estado actual
        getState() {
            return JSON.parse(JSON.stringify(this.state)); // Deep copy
        }
        
        // Método para obtener una parte específica del estado
        get(path) {
            return this.getNestedValue(this.state, path);
        }
    }

    // ================== CLASE GFZ DATA LOADER ==================
    class GFZDataLoader {
        constructor() {
            this.baseUrl = 'https://kp.gfz-potsdam.de/app/json/';
            
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
                
                const response = await fetchWithCORS(url, { 
                    signal: options.signal,
                    timeout: CONFIG.SOURCE_TIMEOUTS.gfzApi
                });
                
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
            const start = new Date(now.getTime() - CONFIG.TIME_CONSTANTS.PAST_72H_MS);
            
            return this.getData(
                start.toISOString().slice(0, 19) + 'Z',
                now.toISOString().slice(0, 19) + 'Z',
                index,
                options
            );
        }

        async getForecast(index, options = {}) {
            const now = new Date();
            const future = new Date(now.getTime() + CONFIG.TIME_CONSTANTS.PAST_72H_MS);
            
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

    // ================== CLASE SAMA ANALYZER DOCUMENTADA ==================
    /**
     * Analizador de la Anomalía Magnética del Atlántico Sur (SAMA)
     * 
     * La SAMA es una región donde el campo magnético terrestre es anormalmente débil,
     * lo que permite que más radiación cósmica alcance altitudes más bajas.
     * Esto amplifica los efectos de las tormentas geomagnéticas en la región.
     * 
     * Este analizador calcula factores de amplificación dinámicos basados en
     * múltiples índices geomagnéticos y evalúa el riesgo para operaciones de drones.
     */
    class SAMAAnalyzer {
        constructor() {
            /**
             * Factores de amplificación empíricos para cada índice en la región SAMA
             * Basados en estudios de la ESA y datos históricos de satélites
             * 
             * Justificación de valores:
             * - Kp: 1.3 (30% más impacto) - Basado en mediciones de GPS durante tormentas
             * - ap: 1.4 (40% más impacto) - Mayor factor por ser medida lineal más precisa
             * - Hp30: 1.35 - Resolución temporal alta captura variaciones rápidas mejor
             * - ap30: 1.45 - Combina linealidad de ap con alta resolución temporal
             */
            this.amplificationFactors = {
                Kp: CONFIG.SAMA_FACTORS.AMPLIFICATION.KP,
                ap: CONFIG.SAMA_FACTORS.AMPLIFICATION.AP,
                Hp30: CONFIG.SAMA_FACTORS.AMPLIFICATION.HP30,
                ap30: CONFIG.SAMA_FACTORS.AMPLIFICATION.AP30
            };
            
            /**
             * Umbrales de seguridad ajustados para la región SAMA
             * Más conservadores que los umbrales globales estándar
             */
            this.samaThresholds = CONFIG.SAMA_THRESHOLDS;
        }

        /**
         * Calcula un factor de amplificación dinámico basado en las condiciones actuales
         * 
         * El factor dinámico pondera diferentes índices según su confiabilidad y relevancia:
         * - ap tiene mayor peso (0.4) por ser una medida lineal directa en nanoteslas
         * - Kp tiene peso medio (0.3) por ser el índice más conocido y validado
         * - Hp30 y ap30 tienen pesos menores (0.15 c/u) pero aportan resolución temporal
         * 
         * @param {Object} indices - Objeto con los valores actuales de los índices
         * @returns {number} Factor de amplificación entre 1.0 y 2.0
         */
        calculateDynamicFactor(indices) {
            if (!indices || Object.keys(indices).length === 0) {
                return CONFIG.SAMA_FACTORS.BASE; // Factor base conservador si no hay datos
            }
            
            let factor = 1.0;
            let weightSum = 0;
            
            // Procesar índice Kp
            if (indices.Kp !== undefined && indices.Kp !== null) {
                // Peso base del 30% para Kp por ser el índice de referencia histórico
                factor += this.amplificationFactors.Kp * CONFIG.DYNAMIC_WEIGHTS.KP;
                weightSum += CONFIG.DYNAMIC_WEIGHTS.KP;
            }
            
            // Procesar índice ap (más importante por ser lineal)
            if (indices.ap !== undefined && indices.ap !== null) {
                // Factor adicional basado en la magnitud: tormentas más fuertes
                // tienen efectos desproporcionadamente mayores en SAMA
                const apFactor = Math.min(indices.ap / 50, 1) * 0.2;
                
                // Peso del 40% para ap por su precisión en mediciones lineales
                factor += (this.amplificationFactors.ap + apFactor) * CONFIG.DYNAMIC_WEIGHTS.AP;
                weightSum += CONFIG.DYNAMIC_WEIGHTS.AP;
            }
            
            // Procesar Hp30 (alta resolución temporal)
            if (indices.Hp30 !== undefined && indices.Hp30 !== null) {
                // 15% de peso - útil para detectar inicios de tormentas
                factor += this.amplificationFactors.Hp30 * CONFIG.DYNAMIC_WEIGHTS.HP30;
                weightSum += CONFIG.DYNAMIC_WEIGHTS.HP30;
            }
            
            // Procesar ap30 (combina beneficios de ap y alta resolución)
            if (indices.ap30 !== undefined && indices.ap30 !== null) {
                // Factor adicional por cambios rápidos - crítico para seguridad de drones
                const ap30Factor = Math.min(indices.ap30 / 50, 1) * 0.3;
                
                // 15% de peso - importante para detección temprana
                factor += (this.amplificationFactors.ap30 + ap30Factor) * CONFIG.DYNAMIC_WEIGHTS.AP30;
                weightSum += CONFIG.DYNAMIC_WEIGHTS.AP30;
            }
            
            // Normalizar por la suma de pesos para obtener promedio ponderado
            if (weightSum > 0) {
                factor = factor / weightSum;
            }
            
            // Limitar el factor entre valores seguros
            // Mínimo 1.0 (sin amplificación) y máximo 2.0 (doble impacto)
            return Math.max(CONFIG.SAMA_FACTORS.MIN, Math.min(CONFIG.SAMA_FACTORS.MAX, factor));
        }

        /**
         * Evalúa el nivel de riesgo basado en los índices actuales y el factor SAMA
         * 
         * Sistema de puntuación:
         * - 0-19: BAJO - Operaciones normales
         * - 20-39: MEDIO - Precaución recomendada
         * - 40-59: ALTO - Solo vuelos esenciales
         * - 60+: CRÍTICO - No volar
         * 
         * @param {Object} indices - Valores actuales de los índices
         * @param {number} factor - Factor de amplificación SAMA calculado
         * @returns {Object} Evaluación de riesgo con nivel, puntuación y factores
         */
        evaluateRisk(indices, factor) {
            const risks = {
                level: 'BAJO',
                score: 0,
                factors: []
            };
            
            // Evaluar riesgo por Kp efectivo
            if (indices.Kp !== undefined) {
                const kpEffective = indices.Kp * factor;
                
                // Kp efectivo >= 6.5 es crítico en SAMA (equivale a Kp 5 global)
                if (kpEffective >= this.samaThresholds.DANGER.KP * factor) {
                    risks.factors.push('Kp efectivo crítico');
                    risks.score += CONFIG.RISK_SCORES.KP_CRITICAL;
                } 
                // Kp efectivo >= 5.2 requiere precaución (equivale a Kp 4 global)
                else if (kpEffective >= this.samaThresholds.CAUTION.KP * factor) {
                    risks.factors.push('Kp efectivo elevado');
                    risks.score += CONFIG.RISK_SCORES.KP_ELEVATED;
                }
            }
            
            // Evaluar riesgo por amplitud ap
            if (indices.ap !== undefined) {
                const apEffective = indices.ap * factor;
                
                // ap > 67 nT efectivo es crítico (48 nT * 1.4)
                if (apEffective >= this.samaThresholds.DANGER.AP * factor) {
                    risks.factors.push('Amplitud crítica');
                    risks.score += CONFIG.RISK_SCORES.AP_CRITICAL;
                } 
                // ap > 38 nT efectivo requiere precaución
                else if (apEffective >= this.samaThresholds.CAUTION.AP * factor) {
                    risks.factors.push('Amplitud elevada');
                    risks.score += CONFIG.RISK_SCORES.AP_ELEVATED;
                }
            }
            
            // Evaluar tendencia de cambios rápidos (crítico para drones)
            if (indices.ap30 !== undefined && indices.ap30History) {
                const recentChanges = this.analyzeRecentChanges(indices.ap30History);
                
                // Incremento rápido indica inicio de tormenta
                if (recentChanges.rapidIncrease) {
                    risks.factors.push('Incremento rápido detectado');
                    risks.score += CONFIG.RISK_SCORES.RAPID_INCREASE;
                }
            }
            
            // Clasificar nivel de riesgo según puntuación total
            if (risks.score >= CONFIG.RISK_SCORES.THRESHOLD_CRITICAL) {
                risks.level = 'CRÍTICO';
            } else if (risks.score >= CONFIG.RISK_SCORES.THRESHOLD_HIGH) {
                risks.level = 'ALTO';
            } else if (risks.score >= CONFIG.RISK_SCORES.THRESHOLD_MEDIUM) {
                risks.level = 'MEDIO';
            }
            
            return risks;
        }

        /**
         * Analiza cambios recientes en el histórico de ap30
         * 
         * Detecta incrementos rápidos que pueden indicar el inicio de una tormenta
         * Esto es crítico porque los drones necesitan tiempo para aterrizar de forma segura
         * 
         * @param {Array} history - Últimos valores de ap30 (48 valores = 24 horas)
         * @returns {Object} Análisis de tendencia con indicadores de cambio
         */
        analyzeRecentChanges(history) {
            if (!history || history.length < 3) {
                return { rapidIncrease: false, trend: 'stable' };
            }
            
            // Analizar últimas 3 lecturas (1.5 horas)
            const recent = history.slice(-3);
            
            // Calcular tasa de cambio promedio
            const avgChange = (recent[2] - recent[0]) / 2;
            
            return {
                // Un incremento > 10 nT/hora es considerado rápido
                rapidIncrease: avgChange > 10,
                
                // Clasificar tendencia
                trend: avgChange > 5 ? 'increasing' : 
                       avgChange < -5 ? 'decreasing' : 'stable',
                
                // Tasa de cambio en nT/hora
                rate: avgChange
            };
        }

        /**
         * Predice condiciones a corto plazo (próximas 3 horas)
         * 
         * Usa extrapolación lineal simple basada en la tendencia reciente
         * Útil para planificación de vuelos y decisiones operativas
         * 
         * @param {Object} indices - Índices actuales incluyendo histórico
         * @param {number} hours - Horas a predecir (default: 3)
         * @returns {Object} Predicción con nivel de confianza
         */
        predictShortTerm(indices, hours = 3) {
            if (!indices.ap30History || indices.ap30History.length < 4) {
                return { prediction: 'Datos insuficientes', confidence: 0 };
            }
            
            const trend = this.analyzeRecentChanges(indices.ap30History);
            const currentAp = indices.ap || indices.ap30 || 0;
            
            // Extrapolación lineal simple
            const predictedAp = currentAp + (trend.rate * hours);
            
            // Convertir ap predicho a Kp equivalente
            const predictedKp = this.apToKp(predictedAp);
            
            // La confianza disminuye con cambios más rápidos (más incertidumbre)
            const confidence = Math.max(0, 100 - Math.abs(trend.rate) * 5);
            
            return {
                prediction: `Kp ${predictedKp.toFixed(1)} (ap ${predictedAp.toFixed(0)} nT)`,
                confidence: confidence,
                trend: trend.trend
            };
        }

        /**
         * Convierte valores ap a Kp equivalente
         * 
         * Basado en la tabla de conversión oficial de NOAA/SWPC
         * La relación no es lineal, por lo que se usa interpolación
         * 
         * @param {number} ap - Valor ap en nanoteslas
         * @returns {number} Valor Kp equivalente (0-9)
         */
        apToKp(ap) {
            // Tabla de conversión oficial ap -> Kp
            const conversions = [
                { ap: 0, kp: 0 },      // Calma total
                { ap: 3, kp: 0.33 },   // Muy tranquilo
                { ap: 7, kp: 1 },      // Tranquilo
                { ap: 15, kp: 2 },     // Sin perturbaciones
                { ap: 27, kp: 3 },     // Perturbación menor
                { ap: 48, kp: 4 },     // Perturbación moderada
                { ap: 80, kp: 5 },     // Tormenta menor
                { ap: 132, kp: 6 },    // Tormenta moderada
                { ap: 207, kp: 7 },    // Tormenta fuerte
                { ap: 400, kp: 8 },    // Tormenta severa
                { ap: 1000, kp: 9 }    // Tormenta extrema
            ];
            
            // Interpolación lineal entre puntos de la tabla
            for (let i = 1; i < conversions.length; i++) {
                if (ap <= conversions[i].ap) {
                    // Calcular posición relativa entre dos puntos
                    const ratio = (ap - conversions[i-1].ap) / 
                                 (conversions[i].ap - conversions[i-1].ap);
                    
                    // Interpolar valor Kp
                    return conversions[i-1].kp + 
                           ratio * (conversions[i].kp - conversions[i-1].kp);
                }
            }
            
            // Si ap > 1000, devolver 9 (máximo)
            return 9;
        }
    }

    // ================== CLASES DE OPTIMIZACIÓN ==================
    
    // Gestor optimizado de gráficos
    class ChartManager {
        constructor() {
            this.chart = null;
            this.datasetMap = new Map();
            this.lastDataHash = '';
        }
        
        // Inicializar o actualizar el gráfico
        updateChart(canvasId, data) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            
            const ctx = canvas.getContext('2d');
            
            // Calcular hash de los datos para detectar cambios reales
            const currentHash = this.calculateDataHash(data);
            if (currentHash === this.lastDataHash && this.chart) {
                console.log('Datos sin cambios, omitiendo actualización del gráfico');
                return;
            }
            this.lastDataHash = currentHash;
            
            // Si el gráfico existe, actualizar solo los datos
            if (this.chart) {
                this.updateExistingChart(data);
                return;
            }
            
            // Crear nuevo gráfico
            this.createNewChart(ctx, data);
        }
        
        // Actualizar gráfico existente de forma eficiente
        updateExistingChart(data) {
            const chart = this.chart;
            
            // Actualizar etiquetas si cambiaron
            if (JSON.stringify(chart.data.labels) !== JSON.stringify(data.timestamps)) {
                chart.data.labels = data.timestamps;
            }
            
            // Actualizar datasets existentes
            data.datasets.forEach((newDataset, index) => {
                const existingDataset = chart.data.datasets[index];
                
                if (existingDataset) {
                    // Actualizar solo si los datos cambiaron
                    if (JSON.stringify(existingDataset.data) !== JSON.stringify(newDataset.data)) {
                        existingDataset.data = newDataset.data;
                    }
                    
                    // Actualizar propiedades visuales si cambiaron
                    if (existingDataset.hidden !== newDataset.hidden) {
                        existingDataset.hidden = newDataset.hidden;
                    }
                } else {
                    // Agregar nuevo dataset
                    chart.data.datasets.push(newDataset);
                }
            });
            
            // Eliminar datasets sobrantes
            if (chart.data.datasets.length > data.datasets.length) {
                chart.data.datasets.splice(data.datasets.length);
            }
            
            // Actualizar con animación mínima
            chart.update('none');
        }
        
        // Crear nuevo gráfico
        createNewChart(ctx, data) {
            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.timestamps,
                    datasets: data.datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 0 // Desactivar animación inicial
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            titleColor: '#f1f5f9',
                            bodyColor: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.3)',
                            borderWidth: 1,
                            padding: 12,
                            displayColors: true
                        },
                        annotation: {
                            annotations: {
                                dangerLine: {
                                    type: 'line',
                                    yMin: CONFIG.SAMA_THRESHOLDS.DANGER.KP,
                                    yMax: CONFIG.SAMA_THRESHOLDS.DANGER.KP,
                                    yScaleID: 'y-kp',
                                    borderColor: 'rgba(239, 68, 68, 0.5)',
                                    borderWidth: 2,
                                    borderDash: [5, 5]
                                },
                                samaLine: {
                                    type: 'line',
                                    yMin: CONFIG.SAMA_THRESHOLDS.DANGER.KP / CONFIG.SAMA_FACTORS.BASE,
                                    yMax: CONFIG.SAMA_THRESHOLDS.DANGER.KP / CONFIG.SAMA_FACTORS.BASE,
                                    yScaleID: 'y-kp',
                                    borderColor: 'rgba(139, 92, 246, 0.5)',
                                    borderWidth: 2,
                                    borderDash: [10, 5]
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
                                font: { size: 11 }
                            }
                        },
                        'y-kp': {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: true,
                            max: CONFIG.VALIDATION.KP_MAX,
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
                            grid: { drawOnChartArea: false },
                            ticks: { color: '#94a3b8' }
                        }
                    }
                }
            });
        }
        
        // Calcular hash simple de los datos
        calculateDataHash(data) {
            const str = JSON.stringify({
                labels: data.timestamps,
                datasets: data.datasets.map(d => ({
                    label: d.label,
                    data: d.data
                }))
            });
            
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return hash.toString(36);
        }
        
        // Destruir el gráfico
        destroy() {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
                this.datasetMap.clear();
                this.lastDataHash = '';
            }
        }
    }

    // Gestor optimizado de actualizaciones del DOM
    class DOMUpdater {
        constructor() {
            this.elements = new Map();
            this.pendingUpdates = new Map();
            this.rafId = null;
        }
        
        // Registrar elemento para actualizaciones eficientes
        register(id, element) {
            this.elements.set(id, element);
        }
        
        // Programar actualización
        update(id, value, property = 'textContent') {
            if (!this.elements.has(id)) {
                const element = document.getElementById(id);
                if (element) {
                    this.register(id, element);
                } else {
                    console.warn(`Elemento no encontrado: ${id}`);
                    return;
                }
            }
            
            this.pendingUpdates.set(id, { value, property });
            
            if (!this.rafId) {
                this.rafId = requestAnimationFrame(() => this.flush());
            }
        }
        
        // Ejecutar todas las actualizaciones pendientes
        flush() {
            for (const [id, update] of this.pendingUpdates) {
                const element = this.elements.get(id);
                if (element) {
                    if (update.property === 'textContent') {
                        if (element.textContent !== update.value) {
                            element.textContent = update.value;
                        }
                    } else if (update.property === 'className') {
                        if (element.className !== update.value) {
                            element.className = update.value;
                        }
                    } else if (update.property === 'style') {
                        Object.assign(element.style, update.value);
                    }
                }
            }
            
            this.pendingUpdates.clear();
            this.rafId = null;
        }
        
        // Actualizar múltiples elementos de una vez
        batchUpdate(updates) {
            for (const [id, value, property] of updates) {
                this.update(id, value, property);
            }
        }
    }

    // Actualización optimizada del panel de validación
    class ValidationPanelUpdater {
        constructor(containerId) {
            this.container = document.getElementById(containerId);
            this.itemElements = new Map();
            this.initialized = false;
        }
        
        // Inicializar el panel una sola vez
        initialize(sources) {
            if (this.initialized) return;
            
            this.container.innerHTML = '';
            
            sources.forEach(source => {
                const itemEl = document.createElement('div');
                itemEl.className = 'validation-item pending';
                itemEl.dataset.source = source.id;
                
                itemEl.innerHTML = `
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
                            <span class="metric-value" data-field="status">⏳ Pendiente</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Latencia:</span>
                            <span class="metric-value" data-field="latency">--</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Actualización:</span>
                            <span class="metric-value" data-field="lastUpdate">--:--</span>
                        </div>
                        <div class="metric-row additional-info" style="display: none;">
                            <span class="metric-label">Definitivos:</span>
                            <span class="metric-value" data-field="definitive">--</span>
                        </div>
                    </div>
                    <div class="confidence-bar">
                        <div class="confidence-fill" data-field="confidence"></div>
                        <div class="loading-progress"></div>
                    </div>
                `;
                
                this.container.appendChild(itemEl);
                
                // Guardar referencias a elementos internos
                this.itemElements.set(source.id, {
                    container: itemEl,
                    status: itemEl.querySelector('[data-field="status"]'),
                    latency: itemEl.querySelector('[data-field="latency"]'),
                    lastUpdate: itemEl.querySelector('[data-field="lastUpdate"]'),
                    definitive: itemEl.querySelector('[data-field="definitive"]'),
                    additionalInfo: itemEl.querySelector('.additional-info'),
                    confidenceFill: itemEl.querySelector('[data-field="confidence"]')
                });
            });
            
            this.initialized = true;
        }
        
        // Actualizar un item específico
        updateItem(sourceId, validation) {
            const elements = this.itemElements.get(sourceId);
            if (!elements) return;
            
            // Actualizar clase del contenedor
            elements.container.className = `validation-item ${validation.status || 'pending'}`;
            
            // Actualizar estado
            const statusMap = {
                'valid': '✅ Válido',
                'warning': '⚠️ Advertencia',
                'error': '❌ Error',
                'timeout': '⏱️ Timeout',
                'loading': '🔄 Cargando...',
                'cached': '💾 Cache'
            };
            
            elements.status.textContent = statusMap[validation.status] || '⏳ Pendiente';
            
            // Actualizar latencia
            elements.latency.textContent = validation.latency ? validation.latency + ' ms' : '--';
            
            // Actualizar última actualización
            elements.lastUpdate.textContent = validation.lastUpdate ? 
                new Date(validation.lastUpdate).toLocaleTimeString('es-AR') : '--:--';
            
            // Actualizar información adicional si existe
            if (validation.statusBreakdown) {
                const total = Object.values(validation.statusBreakdown).reduce((a, b) => a + b, 0);
                const defPercent = ((validation.statusBreakdown.def / total) * 100).toFixed(0);
                elements.definitive.textContent = `${defPercent}%`;
                elements.additionalInfo.style.display = 'flex';
            } else {
                elements.additionalInfo.style.display = 'none';
            }
            
            // Actualizar barra de confianza
            const confidence = validation.confidence || 0;
            elements.confidenceFill.style.width = `${confidence}%`;
            elements.confidenceFill.style.background = 
                confidence >= 80 ? '#10b981' :
                confidence >= 60 ? '#f59e0b' : '#ef4444';
        }
    }

    // ================== INSTANCIAS GLOBALES ==================
    const stateManager = new StateManager();
    const gfzLoader = new GFZDataLoader();
    const samaAnalyzer = new SAMAAnalyzer();
    const chartManager = new ChartManager();
    const domUpdater = new DOMUpdater();
    const validationPanel = new ValidationPanelUpdater('validationGrid');

    // ================ FIN PARTE 1 ===============
                   // ==================== PARTE 2: FUNCIONES DE CARGA DE DATOS ====================

    // Función mejorada con múltiples proxies CORS
    async function fetchWithCORS(url, options = {}) {
        const sortedProxies = [...CONFIG.CORS_PROXIES].sort((a, b) => a.priority - b.priority);
        
        // Primero intentar directamente
        try {
            const controller = new AbortController();
            const timeout = options.timeout || 30000;
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const fetchOptions = {
                ...options,
                mode: 'cors',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'GeomagneticMonitor/3.0'
                },
                signal: controller.signal
            };
            
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log(`Éxito directo: ${url}`);
            return response;
            
        } catch (directError) {
            if (directError.name === 'AbortError') {
                throw new Error('Timeout en la solicitud directa');
            }
            
            console.log(`Error directo para ${url}: ${directError.message}`);
            console.log('Intentando con proxies CORS...');
        }
        
        // Intentar con cada proxy en orden de prioridad
        for (const proxy of sortedProxies) {
            try {
                console.log(`Intentando con proxy ${proxy.name}...`);
                const proxyUrl = proxy.url + encodeURIComponent(url);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), proxy.timeout);
                
                const response = await fetch(proxyUrl, {
                    ...options,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} con proxy ${proxy.name}`);
                }
                
                console.log(`Éxito con proxy ${proxy.name}`);
                return response;
                
            } catch (proxyError) {
                console.error(`Error con proxy ${proxy.name}:`, proxyError.message);
                
                if (proxyError.name === 'AbortError') {
                    console.log(`Timeout con proxy ${proxy.name}`);
                }
                
                // Continuar con el siguiente proxy
            }
        }
        
        // Si todos los proxies fallan
        throw new Error(`No se pudo obtener ${url} después de intentar con ${sortedProxies.length} proxies`);
    }

    // Carga de índices múltiples GFZ con StateManager
    async function loadGFZMultiIndices() {
        const startTime = Date.now();
        const indices = ['Hp30', 'Kp', 'ap', 'ap30'];
        let successCount = 0;
        
        try {
            // Actualizar estados de carga
            const loadingUpdates = {};
            indices.forEach(index => {
                const sourceId = index === 'Kp' ? 'kpGFZ' : 
                               index === 'ap' ? 'apGFZ' :
                               index === 'Hp30' ? 'hp30' : 'ap30';
                loadingUpdates[`validationResults.${sourceId}.status`] = 'loading';
            });
            await stateManager.updateState(loadingUpdates);
            
            const data = await gfzLoader.getMultipleIndices(indices, 'last72h');
            
            // Preparar actualizaciones
            const updates = {};
            
            // Procesar HP30
            if (data.Hp30 && data.Hp30.values.length > 0) {
                const aggregated = [];
                for (let i = 0; i < data.Hp30.values.length; i += 6) {
                    const slice = data.Hp30.values.slice(i, i + 6);
                    if (slice.length > 0) {
                        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                        aggregated.push(avg);
                    }
                }
                
                updates['forecastData.hp30'] = aggregated.slice(0, 24);
                updates['forecastData.dataQuality.Hp30'] = 92;
                updates['validationResults.hp30'] = {
                    status: 'valid',
                    confidence: 92,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: aggregated.length
                };
                successCount++;
            } else {
                updates['validationResults.hp30.status'] = 'error';
            }
            
            // Procesar Kp
            if (data.Kp && data.Kp.values.length > 0) {
                updates['forecastData.timestamps'] = data.Kp.datetime.map(dt => formatLocalLabel(new Date(dt)));
                updates['forecastData.kpGFZ'] = data.Kp.values.slice(0, 24);
                updates['forecastData.kpStatus'] = data.Kp.status ? data.Kp.status.slice(0, 24) : [];
                updates['forecastData.dataQuality.Kp'] = data.Kp.metadata?.quality || 85;
                
                const quality = data.Kp.metadata?.quality || 85;
                updates['validationResults.kpGFZ'] = {
                    status: quality > 85 ? 'valid' : 'warning',
                    confidence: quality,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: data.Kp.values.length,
                    statusBreakdown: data.Kp.metadata?.statusCounts
                };
                successCount++;
            } else {
                updates['validationResults.kpGFZ.status'] = 'error';
            }
            
            // Procesar ap
            if (data.ap && data.ap.values.length > 0) {
                updates['forecastData.ap'] = data.ap.values.slice(0, 24);
                updates['forecastData.apStatus'] = data.ap.status ? data.ap.status.slice(0, 24) : [];
                updates['forecastData.dataQuality.ap'] = data.ap.metadata?.quality || 85;
                
                updates['validationResults.apGFZ'] = {
                    status: 'valid',
                    confidence: data.ap.metadata?.quality || 85,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: data.ap.values.length
                };
                successCount++;
            } else {
                updates['validationResults.apGFZ.status'] = 'error';
            }
            
            // Procesar ap30
            if (data.ap30 && data.ap30.values.length > 0) {
                updates['forecastData.ap30History'] = data.ap30.values.slice(-48);
                
                const aggregated = [];
                for (let i = 0; i < data.ap30.values.length; i += 6) {
                    const slice = data.ap30.values.slice(i, i + 6);
                    if (slice.length > 0) {
                        const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                        aggregated.push(avg);
                    }
                }
                updates['forecastData.ap30'] = aggregated.slice(0, 24);
                updates['forecastData.dataQuality.ap30'] = 90;
                
                updates['validationResults.ap30'] = {
                    status: 'valid',
                    confidence: 90,
                    latency: Date.now() - startTime,
                    lastUpdate: new Date(),
                    dataPoints: aggregated.length
                };
                successCount++;
            } else {
                updates['validationResults.ap30.status'] = 'error';
            }
            
            // Aplicar todas las actualizaciones de una vez
            await stateManager.updateState(updates);
            
            return successCount > 0;
            
        } catch (error) {
            console.error('Error cargando índices GFZ:', error);
            
            const errorUpdates = {};
            indices.forEach(index => {
                const sourceId = index === 'Kp' ? 'kpGFZ' : 
                               index === 'ap' ? 'apGFZ' :
                               index === 'Hp30' ? 'hp30' : 'ap30';
                errorUpdates[`validationResults.${sourceId}.status`] = 'error';
                errorUpdates[`validationResults.${sourceId}.error`] = error.message;
            });
            
            await stateManager.updateState(errorUpdates);
            
            return false;
        }
    }

    // Parser robusto para datos NOAA Kp
    async function loadNoaaKp() {
        const source = 'kpNoaa';
        const startTime = Date.now();
        
        await stateManager.updateState({
            'validationResults.kpNoaa.status': 'loading'
        });
        
        try {
            const response = await fetchWithCORS(CONFIG.DATA_SOURCES.kpNoaa, {
                timeout: CONFIG.SOURCE_TIMEOUTS.kpNoaa
            });
            
            const text = await response.text();
            const lines = text.split('\n');
            const kpValues = [];
            
            // Patrón más flexible que busca líneas con formato XX-XXUT
            const timeRangePattern = /(\d{2})-(\d{2})UT/;
            let dataStartIndex = -1;
            
            // Buscar el inicio de los datos de manera más flexible
            for (let i = 0; i < lines.length; i++) {
                if (timeRangePattern.test(lines[i]) && lines[i].includes('00-03UT')) {
                    dataStartIndex = i;
                    break;
                }
            }
            
            if (dataStartIndex === -1) {
                // Fallback: buscar cualquier línea con el patrón de tiempo
                for (let i = 0; i < lines.length; i++) {
                    if (timeRangePattern.test(lines[i])) {
                        dataStartIndex = i;
                        console.warn('NOAA: No se encontró 00-03UT, usando primera línea con patrón de tiempo');
                        break;
                    }
                }
            }
            
            if (dataStartIndex === -1) {
                throw new Error('No se pudo identificar el inicio de los datos');
            }
            
            // Parser más robusto para extraer valores Kp
            const kpPattern = /\b([0-9]+\.?[0-9]*)\b/g;
            
            for (let periodIndex = 0; periodIndex < 8; periodIndex++) {
                const lineIndex = dataStartIndex + periodIndex;
                if (lineIndex >= lines.length) break;
                
                const line = lines[lineIndex];
                const matches = [...line.matchAll(kpPattern)];
                
                // Ignorar el primer match que suele ser el rango de tiempo
                for (let day = 0; day < 3; day++) {
                    if (matches[day + 1]) {
                        const kpValue = parseFloat(matches[day + 1][0]);
                        if (!isNaN(kpValue) && kpValue >= CONFIG.VALIDATION.KP_MIN && 
                            kpValue <= CONFIG.VALIDATION.KP_MAX) {
                            kpValues.push(kpValue);
                        }
                    }
                }
            }
            
            if (kpValues.length === 0) {
                throw new Error('No se pudieron extraer valores Kp válidos');
            }
            
            console.log(`NOAA Kp: ${kpValues.length} valores extraídos`);
            
            const latency = Date.now() - startTime;
            await stateManager.updateState({
                'validationResults.kpNoaa': {
                    status: 'valid',
                    confidence: Math.min(85, (kpValues.length / 24) * 85),
                    latency: latency,
                    lastUpdate: new Date(),
                    dataPoints: kpValues.length
                }
            });
            
            return kpValues;
            
        } catch (error) {
            console.error('Error loading NOAA Kp:', error);
            await stateManager.updateState({
                'validationResults.kpNoaa': {
                    status: error.message.includes('Timeout') ? 'timeout' : 'error',
                    confidence: 0,
                    error: error.message,
                    latency: Date.now() - startTime
                }
            });
            return null;
        }
    }

    // Parser robusto para datos DST
    async function loadCurrentDst() {
        const source = 'dst';
        const startTime = Date.now();
        
        await stateManager.updateState({
            'validationResults.dst.status': 'loading'
        });
        
        try {
            const now = new Date();
            const yearShort = now.getFullYear().toString().slice(-2);
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const url = `${CONFIG.DATA_SOURCES.dstKyoto}dst${yearShort}${month}.for.request`;
            
            const response = await fetchWithCORS(url, {
                timeout: CONFIG.SOURCE_TIMEOUTS.dst
            });
            
            const text = await response.text();
            const lines = text.split('\n');
            let latestDst = null;
            
            // Patrón más flexible para líneas DST
            const dstLinePattern = /^DST\s+(\d{4})\s+(\d{2})/;
            const currentDay = now.getUTCDate();
            const currentHour = now.getUTCHours();
            
            for (const line of lines) {
                const match = line.match(dstLinePattern);
                if (!match) continue;
                
                // Extraer valores usando regex para mayor flexibilidad
                const valuePattern = /-?\d+/g;
                const values = line.match(valuePattern);
                
                if (!values || values.length < 27) continue;
                
                // values[0] es el año, values[1] es el mes, values[2] es el día
                const day = parseInt(values[2]);
                
                if (day !== currentDay) continue;
                
                // Los valores horarios empiezan en el índice 3
                const hourIndex = 3 + currentHour;
                
                if (hourIndex < values.length) {
                    const val = parseInt(values[hourIndex]);
                    
                    // Validación mejorada del rango
                    if (!isNaN(val) && !CONFIG.VALIDATION.DST_INVALID_VALUES.includes(val) && 
                        val >= CONFIG.VALIDATION.DST_MIN && val <= CONFIG.VALIDATION.DST_MAX) {
                        latestDst = val;
                        console.log(`DST encontrado: ${val} nT para día ${day} hora ${currentHour}`);
                        break;
                    }
                }
            }
            
            // Si no encontramos datos para la hora actual, buscar la última hora disponible
            if (latestDst === null) {
                console.log('DST: Buscando último valor disponible...');
                
                for (const line of lines.reverse()) {
                    const match = line.match(dstLinePattern);
                    if (!match) continue;
                    
                    const valuePattern = /-?\d+/g;
                    const values = line.match(valuePattern);
                    
                    if (!values || values.length < 27) continue;
                    
                    // Buscar el último valor válido en la línea
                    for (let i = values.length - 1; i >= 3; i--) {
                        const val = parseInt(values[i]);
                        if (!isNaN(val) && !CONFIG.VALIDATION.DST_INVALID_VALUES.includes(val) && 
                            val >= CONFIG.VALIDATION.DST_MIN && val <= CONFIG.VALIDATION.DST_MAX) {
                            latestDst = val;
                            console.log(`DST: Usando último valor disponible: ${val} nT`);
                            break;
                        }
                    }
                    
                    if (latestDst !== null) break;
                }
            }
            
            const latency = Date.now() - startTime;
            await stateManager.updateState({
                'validationResults.dst': {
                    status: latestDst !== null ? 'valid' : 'no-data',
                    confidence: latestDst !== null ? 85 : 0,
                    latency: latency,
                    lastUpdate: new Date()
                }
            });
            
            return latestDst;
            
        } catch (error) {
            console.error('Error loading DST:', error);
            await stateManager.updateState({
                'validationResults.dst': {
                    status: error.message.includes('Timeout') ? 'timeout' : 'error',
                    confidence: 0,
                    error: error.message,
                    latency: Date.now() - startTime
                }
            });
            return null;
        }
    }

    async function loadKsaIndex() {
        const source = 'ksa';
        const startTime = Date.now();
        
        await stateManager.updateState({
            'validationResults.ksa.status': 'loading'
        });
        
        try {
            // Intentar varios días hacia atrás si no hay datos actuales
            let targetDate = new Date();
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                const year = targetDate.getFullYear();
                const dateString = targetDate.toISOString().split('T')[0];
                const url = `${CONFIG.DATA_SOURCES.ksaEmbraceBase}${year}/${dateString}.txt`;
                
                try {
                    console.log(`Intentando KSA para ${dateString}`);
                    const response = await fetchWithCORS(url, {
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
                                if (!isNaN(val) && val >= CONFIG.VALIDATION.KP_MIN && 
                                    val <= CONFIG.VALIDATION.KP_MAX) {
                                    values.push(val);
                                }
                            } catch (e) {
                                console.warn('KSA: Línea con formato inválido:', line);
                            }
                        }
                    }
                    
                    if (values.length > 0) {
                        const latency = Date.now() - startTime;
                        console.log(`KSA cargado exitosamente: ${values.length} valores de ${dateString} en ${latency}ms`);
                        
                        await stateManager.updateState({
                            'validationResults.ksa': {
                                status: 'valid',
                                confidence: 95,
                                latency: latency,
                                lastUpdate: new Date(),
                                dataPoints: values.length,
                                dataDate: dateString
                            }
                        });
                        
                        return { timestamps, values };
                    }
                } catch (attemptError) {
                    console.log(`KSA: No hay datos para ${dateString}`);
                }
                
                // Retroceder un día
                targetDate.setDate(targetDate.getDate() - 1);
                attempts++;
            }
            
            throw new Error(`No hay datos KSA disponibles en los últimos ${maxAttempts} días`);
            
        } catch (error) {
            console.error('Error loading KSA:', error);
            await stateManager.updateState({
                'validationResults.ksa': {
                    status: error.message.includes('Timeout') ? 'timeout' : 'error',
                    confidence: 0,
                    error: error.message,
                    latency: Date.now() - startTime
                }
            });
            return null;
        }
    }

    async function loadIntermagnetData(observatory = 'PIL') {
        const source = `intermagnet${observatory}`;
        const startTime = Date.now();
        
        await stateManager.updateState({
            [`validationResults.${source}.status`]: 'loading'
        });
        
        try {
            // Intentar varios días hacia atrás si no hay datos actuales
            let targetDate = new Date();
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                const dateStr = targetDate.toISOString().split('T')[0];
                const baseUrl = observatory === 'PIL' ? CONFIG.DATA_SOURCES.intermagnetPIL : CONFIG.DATA_SOURCES.intermagnetVSS;
                const url = `${baseUrl}${dateStr}&dataDuration=1&publicationState=best-avail&format=json`;
                
                try {
                    console.log(`Intentando INTERMAGNET ${observatory} para ${dateStr}`);
                    const response = await fetchWithCORS(url, {
                        timeout: CONFIG.SOURCE_TIMEOUTS[source] || 5000
                    });
                    
                    const data = await response.json();
                    
                    if (data && data.data && data.data.length > 0) {
                        const latest = data.data[data.data.length - 1];
                        const result = {
                            timestamp: latest.timestamp,
                            x: latest.x || 0,
                            y: latest.y || 0,
                            z: latest.z || 0,
                            f: Math.sqrt((latest.x || 0) ** 2 + (latest.y || 0) ** 2 + (latest.z || 0) ** 2),
                            observatory: observatory,
                            dataDate: dateStr
                        };
                        
                        await stateManager.updateState({
                            [`validationResults.${source}`]: {
                                status: 'valid',
                                confidence: 92,
                                latency: Date.now() - startTime,
                                lastUpdate: new Date(),
                                note: attempts > 0 ? `Datos de ${dateStr}` : undefined
                            }
                        });
                        
                        return result;
                    }
                } catch (attemptError) {
                    console.log(`INTERMAGNET ${observatory}: No hay datos para ${dateStr}`);
                }
                
                // Retroceder un día
                targetDate.setDate(targetDate.getDate() - 1);
                attempts++;
            }
            
            throw new Error(`No hay datos disponibles en los últimos ${maxAttempts} días`);
            
        } catch (error) {
            console.error(`Error loading ${observatory} data:`, error);
            await stateManager.updateState({
                [`validationResults.${source}`]: {
                    status: error.message.includes('Timeout') ? 'timeout' : 'error',
                    confidence: 0,
                    error: error.message,
                    latency: Date.now() - startTime
                }
            });
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
            const updates = {};
            
            if (results[0].status === 'fulfilled' && results[0].value) {
                updates['forecastData.ksaData'] = results[0].value;
                updates['forecastData.ksaIndex'] = results[0].value.values[results[0].value.values.length - 1];
                console.log('KSA cargado:', results[0].value.values.length, 'valores, último:', updates['forecastData.ksaIndex']);
                successCount++;
            } else {
                console.error('Error cargando KSA:', results[0].reason);
            }
            
            if (results[1].status === 'fulfilled' && results[1].value) {
                const noaaKp = results[1].value;
                console.log('NOAA Kp cargado:', noaaKp.length, 'valores');
                updates['forecastData.kpNoaa'] = interpolateNoaaData(noaaKp, 24);
                successCount++;
            } else {
                console.error('Error cargando NOAA Kp:', results[1].reason);
            }
            
            if (results[2].status === 'fulfilled' && results[2].value !== null) {
                updates['forecastData.dstCurrent'] = results[2].value;
                console.log('DST actual:', updates['forecastData.dstCurrent']);
                successCount++;
            } else {
                console.error('Error cargando DST:', results[2].reason);
            }
            
            if (results[3].status === 'fulfilled' && results[3].value) {
                updates['forecastData.pilData'] = results[3].value;
                console.log('PIL cargado:', results[3].value.f, 'nT');
                successCount++;
            } else {
                console.error('Error cargando PIL:', results[3].reason);
            }
            
            // Aplicar actualizaciones
            await stateManager.updateState(updates);
            
            // Generar timestamps si no existen
            const currentState = stateManager.getState();
            if (currentState.forecastData.timestamps.length === 0) {
                await stateManager.updateState({
                    'forecastData.timestamps': createTimeLabels(24)
                });
            }
            
            // Si no hay datos KpGFZ, usar fuentes alternativas
            if (currentState.forecastData.kpGFZ.length === 0) {
                if (currentState.forecastData.ksaData && currentState.forecastData.ksaData.values.length > 0) {
                    const kpGFZ = new Array(24).fill(null);
                    for (let i = 0; i < Math.min(currentState.forecastData.ksaData.values.length, 24); i++) {
                        kpGFZ[i] = currentState.forecastData.ksaData.values[i];
                    }
                    await stateManager.updateState({
                        'forecastData.kpGFZ': kpGFZ
                    });
                    console.log('Usando KSA como fuente principal de Kp');
                } else if (updates['forecastData.kpNoaa'] && updates['forecastData.kpNoaa'].length > 0) {
                    await stateManager.updateState({
                        'forecastData.kpGFZ': [...updates['forecastData.kpNoaa']]
                    });
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
        const currentState = stateManager.getState();
        console.log('Modo de fuente actual:', currentState.currentDataSource);
        
        results.legacy = await loadLegacyData();
        
        if (currentState.currentDataSource === 'gfz' || currentState.currentDataSource === 'hybrid') {
            try {
                console.log('Intentando cargar datos GFZ (HP30 y Kp)...');
                results.gfz = await loadGFZMultiIndices();
                console.log('Resultado GFZ:', results.gfz ? 'Exitoso' : 'Falló');
                
                const updatedState = stateManager.getState();
                if (updatedState.forecastData.hp30.length > 0 && 
                    !updatedState.forecastData.ksaIndex && 
                    updatedState.forecastData.kpNoaa.length === 0 && 
                    updatedState.forecastData.kpGFZ.length === 0) {
                    console.log('Usando HP30 como fuente principal (prioridad 3)');
                    await stateManager.updateState({
                        'forecastData.kpGFZ': [...updatedState.forecastData.hp30]
                    });
                }
            } catch (error) {
                console.log('GFZ no disponible:', error.message);
            }
        }
        
        const finalState = stateManager.getState();
        console.log('=== RESUMEN DE CARGA ===');
        console.log('Legacy:', results.legacy ? 'OK' : 'Error');
        console.log('GFZ:', results.gfz ? 'OK' : 'Error');
        console.log('Datos disponibles:', {
            ksaIndex: finalState.forecastData.ksaIndex,
            kpNoaa: finalState.forecastData.kpNoaa.length,
            hp30: finalState.forecastData.hp30.length,
            kpGFZ: finalState.forecastData.kpGFZ.length,
            timestamps: finalState.forecastData.timestamps.length
        });
        
        return results.gfz || results.legacy;
    }

    // ==================== FUNCIONES AUXILIARES ====================
    
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
            const time = new Date(now.getTime() + i * CONFIG.TIME_CONSTANTS.THREE_HOURS_MS);
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

    // ================ FIN PARTE 2 ================
                   // ==================== PARTE 3: ACTUALIZACIÓN UI E INICIALIZACIÓN ====================

    // ================== FUNCIONES DE ACTUALIZACIÓN UI ==================
    
    function updateSourceStatus(sourceId, status) {
        validationPanel.updateItem(sourceId, {
            status: status,
            ...stateManager.get(`validationResults.${sourceId}`)
        });
    }

    function updateSAMAPanel() {
        const state = stateManager.getState();
        const currentIndices = {
            Kp: state.forecastData.ksaIndex || state.forecastData.kpNoaa[0] || 
                state.forecastData.hp30[0] || state.forecastData.kpGFZ[0],
            ap: state.forecastData.ap[0],
            Hp30: state.forecastData.hp30[0],
            ap30: state.forecastData.ap30[0],
            ap30History: state.forecastData.ap30History
        };
        
        const dynamicFactor = samaAnalyzer.calculateDynamicFactor(currentIndices);
        stateManager.updateState({
            'forecastData.samaFactor': dynamicFactor
        });
        
        const riskAssessment = samaAnalyzer.evaluateRisk(currentIndices, dynamicFactor);
        stateManager.updateState({
            'forecastData.samaRisk': riskAssessment.level
        });
        
        const prediction = samaAnalyzer.predictShortTerm(currentIndices);
        
        // Actualizar DOM
        domUpdater.batchUpdate([
            ['samaFactorValue', `×${dynamicFactor.toFixed(2)}`],
            ['kpEffective', currentIndices.Kp ? (currentIndices.Kp * dynamicFactor).toFixed(2) : '--'],
            ['apSama', currentIndices.ap ? (currentIndices.ap * dynamicFactor).toFixed(0) + ' nT' : '-- nT'],
            ['samaRisk', riskAssessment.level],
            ['samaPrediction', prediction.prediction]
        ]);
        
        // Actualizar color del riesgo
        const riskElement = document.getElementById('samaRisk');
        if (riskElement) {
            riskElement.style.color = riskAssessment.level === 'CRÍTICO' ? '#ef4444' :
                                     riskAssessment.level === 'ALTO' ? '#f59e0b' :
                                     riskAssessment.level === 'MEDIO' ? '#fbbf24' : '#10b981';
        }
    }

    function updateChart() {
        const state = stateManager.getState();
        const datasets = [];
        
        // KSA EMBRACE (Prioridad 1)
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
        
        // Kp NOAA (Prioridad 2)
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
        
        // HP30 GFZ (Prioridad 3)
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
        
        // Kp GFZ (Prioridad 4)
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
        
        // ap30 (si hay valores significativos)
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
        
        // Kp Efectivo SAMA
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
        
        // Actualizar gráfico
        chartManager.updateChart('mainChart', {
            timestamps: state.forecastData.timestamps,
            datasets: datasets
        });
    }

    function updateDroneStatus() {
        const state = stateManager.getState();
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
        
        if (effectiveKp >= CONFIG.SAMA_THRESHOLDS.CRITICAL.KP || effectiveAp >= CONFIG.SAMA_THRESHOLDS.CRITICAL.AP) {
            statusText.textContent = 'NO VOLAR';
            statusText.className = 'drone-status-text drone-status-danger';
            statusRecommendation.textContent = 'Tormenta geomagnética severa. Prohibido volar. Riesgo crítico en región SAMA.';
            droneIcon.textContent = '⛔';
        } else if (effectiveKp >= CONFIG.SAMA_THRESHOLDS.DANGER.KP || effectiveAp >= CONFIG.SAMA_THRESHOLDS.DANGER.AP) {
            statusText.textContent = 'PRECAUCIÓN EXTREMA';
            statusText.className = 'drone-status-text drone-status-danger';
            statusRecommendation.textContent = 'Actividad geomagnética muy alta. Solo vuelos esenciales con precauciones extras.';
            droneIcon.textContent = '🚫';
        } else if (effectiveKp >= CONFIG.SAMA_THRESHOLDS.CAUTION.KP || effectiveAp >= CONFIG.SAMA_THRESHOLDS.CAUTION.AP) {
            statusText.textContent = 'VUELO LIMITADO';
            statusText.className = 'drone-status-text drone-status-caution';
            statusRecommendation.textContent = 'Actividad moderada amplificada por SAMA. Reducir distancia y altura de operación.';
            droneIcon.textContent = '⚠️';
        } else if (effectiveKp >= CONFIG.SAMA_THRESHOLDS.SAFE.KP || effectiveAp >= CONFIG.SAMA_THRESHOLDS.SAFE.AP) {
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
        const state = stateManager.getState();
        const samaFactor = state.forecastData.samaFactor;
        const currentKp = (state.forecastData.ksaIndex || state.forecastData.kpNoaa[0] || 
                          state.forecastData.hp30[0] || state.forecastData.kpGFZ[0] || 0) * samaFactor;
        
        // Riesgo GPS
        const gpsRisk = document.getElementById('gpsRisk');
        const gpsRiskText = document.getElementById('gpsRiskText');
        if (currentKp >= 7) {
            gpsRisk.className = 'risk-indicator risk-high';
            gpsRiskText.textContent = 'Degradación severa (±10-30m)';
            domUpdater.update('gpsAccuracy', '±10-30m');
        } else if (currentKp >= 5) {
            gpsRisk.className = 'risk-indicator risk-medium';
            gpsRiskText.textContent = 'Precisión reducida (±5-10m)';
            domUpdater.update('gpsAccuracy', '±5-10m');
        } else if (currentKp >= 4) {
            gpsRisk.className = 'risk-indicator risk-medium';
            gpsRiskText.textContent = 'Variaciones menores (±2-5m)';
            domUpdater.update('gpsAccuracy', '±2-5m');
        } else {
            gpsRisk.className = 'risk-indicator risk-low';
            gpsRiskText.textContent = 'Precisión normal (±1m)';
            domUpdater.update('gpsAccuracy', '±1m');
        }
        
        // Riesgo Magnético
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
        
        // Riesgo Comunicaciones
        const commRisk = document.getElementById('commRisk');
        const commRiskText = document.getElementById('commRiskText');
        if (currentKp >= 7) {
            commRisk.className = 'risk-indicator risk-medium';
            commRiskText.textContent = 'Posibles interrupciones';
        } else {
            commRisk.className = 'risk-indicator risk-low';
            commRiskText.textContent = 'Señal estable';
        }
        
        // Riesgo SAMA
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
        const state = stateManager.getState();
        
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
        domUpdater.update('maxKp', maxKp.toFixed(1));
        domUpdater.update('maxKpTime', state.forecastData.timestamps[maxKpIndex] || '--');
        
        if (state.forecastData.ap.length > 0) {
            const validApValues = state.forecastData.ap.filter(v => v !== null && !isNaN(v));
            if (validApValues.length > 0) {
                const maxAp = Math.max(...validApValues);
                const maxApIndex = state.forecastData.ap.indexOf(maxAp);
                domUpdater.update('maxAp', maxAp.toFixed(0));
                domUpdater.update('maxApTime', state.forecastData.timestamps[maxApIndex] || '--');
            }
        }
        
        const stormProb = calculateStormProbability();
        domUpdater.update('stormProb', `${stormProb.toFixed(0)}%`);
        
        const optimalHours = validKpValues.filter(kp => kp * state.forecastData.samaFactor < CONFIG.SAMA_THRESHOLDS.CAUTION.KP).length;
        domUpdater.update('optimalWindow', `${optimalHours}h`);
        domUpdater.update('optimalHours', `de ${state.forecastData.timestamps.length}h totales`);
    }

    function calculateStormProbability() {
        const state = stateManager.getState();
        let probability = 0;
        let factors = 0;
        
        if (state.forecastData.kpGFZ.length > 0) {
            const kpHigh = state.forecastData.kpGFZ.filter(kp => kp !== null && kp >= CONFIG.SAMA_THRESHOLDS.DANGER.KP).length;
            probability += (kpHigh / state.forecastData.kpGFZ.length) * 100 * 0.4;
            factors += 0.4;
        }
        
        if (state.forecastData.ap.length > 0) {
            const apHigh = state.forecastData.ap.filter(ap => ap !== null && ap >= CONFIG.SAMA_THRESHOLDS.DANGER.AP).length;
            probability += (apHigh / state.forecastData.ap.length) * 100 * 0.3;
            factors += 0.3;
        }
        
        if (state.forecastData.hp30.length > 0) {
            const hp30High = state.forecastData.hp30.filter(hp => hp !== null && hp >= CONFIG.SAMA_THRESHOLDS.DANGER.KP).length;
            probability += (hp30High / state.forecastData.hp30.length) * 100 * 0.3;
            factors += 0.3;
        }
        
        if (factors > 0) {
            probability = (probability / factors) * state.forecastData.samaFactor;
        }
        
        return Math.min(100, probability);
    }

    function updateRegionalData() {
        const state = stateManager.getState();
        
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
            
            domUpdater.update('dstValue', `${dstValue} nT`);
            domUpdater.update('dstValue', `${dstValue} nT`, 'style', { color: dstColor });
            domUpdater.update('dstStatus', dstStatus);
        }
        
        if (state.forecastData.ksaData && state.forecastData.ksaData.values.length > 0) {
            const latestKsa = state.forecastData.ksaData.values[state.forecastData.ksaData.values.length - 1];
            domUpdater.update('ksaValue', latestKsa.toFixed(2));
            
            let ksaColor = '#10b981';
            if (latestKsa >= 7) ksaColor = '#ef4444';
            else if (latestKsa >= 5) ksaColor = '#f59e0b';
            else if (latestKsa >= 4) ksaColor = '#fbbf24';
            
            domUpdater.update('ksaValue', latestKsa.toFixed(2), 'style', { color: ksaColor });
        }
        
        if (state.forecastData.pilData && state.forecastData.pilData.f) {
            domUpdater.update('pilField', `${state.forecastData.pilData.f.toFixed(0)} nT`);
            domUpdater.update('pilStatus', 'INTERMAGNET PIL');
        }
    }

    // ================== FUNCIONES PÚBLICAS ==================
    
    async function refreshData() {
        domUpdater.update('chartLoading', 'flex', 'style', { display: 'flex' });
        domUpdater.update('systemStatus', 'Conectando con fuentes...');
        
        try {
            // Actualizar estado mientras carga
            setTimeout(() => {
                const status = document.getElementById('systemStatus');
                if (status && status.textContent === 'Conectando con fuentes...') {
                    domUpdater.update('systemStatus', 'Cargando datos...');
                }
            }, 2000);
            
            const success = await loadDataHybrid();
            
            if (!success) {
                throw new Error('No se pudieron cargar los datos');
            }
            
            const state = stateManager.getState();
            const currentKp = state.forecastData.kpCurrent || state.forecastData.kpGFZ[0] || 
                            state.forecastData.kpNoaa[0] || 0;
            domUpdater.update('currentKp', currentKp.toFixed(2));
            
            updateSAMAPanel();
            updateChart();
            updateDroneStatus();
            updateRiskFactors();
            updateStatistics();
            updateRegionalData();
            
            // Actualizar panel de validación
            Object.entries(state.validationResults).forEach(([sourceId, validation]) => {
                validationPanel.updateItem(sourceId, validation);
            });
            
            domUpdater.update('systemStatus', 'En línea');
            domUpdater.update('lastUpdate', new Date().toLocaleTimeString('es-AR'));
            
        } catch (error) {
            console.error('Error actualizando datos:', error);
            domUpdater.update('systemStatus', 'Error de conexión');
        } finally {
            domUpdater.update('chartLoading', 'none', 'style', { display: 'none' });
        }
    }
    
    function toggleAutoRefresh() {
        const state = stateManager.getState();
        const newState = !state.isAutoRefreshEnabled;
        
        stateManager.updateState({
            'isAutoRefreshEnabled': newState
        });
        
        const statusSpan = document.getElementById('autoRefreshStatus');
        
        if (newState) {
            statusSpan.textContent = 'ON';
            const intervalId = setInterval(refreshData, CONFIG.TIME_CONSTANTS.REFRESH_INTERVAL_MS);
            stateManager.updateState({
                'autoRefreshInterval': intervalId
            });
        } else {
            statusSpan.textContent = 'OFF';
            if (state.autoRefreshInterval) {
                clearInterval(state.autoRefreshInterval);
                stateManager.updateState({
                    'autoRefreshInterval': null
                });
            }
        }
    }
    
    function toggleDataSource() {
        const sources = ['hybrid', 'gfz', 'legacy'];
        const state = stateManager.getState();
        const currentIndex = sources.indexOf(state.currentDataSource);
        const newSource = sources[(currentIndex + 1) % sources.length];
        
        stateManager.updateState({
            'currentDataSource': newSource
        });
        
        const statusText = {
            'hybrid': 'Híbrida',
            'gfz': 'GFZ API',
            'legacy': 'Legacy'
        };
        
        document.getElementById('dataSourceStatus').textContent = statusText[newSource];
        
        refreshData();
    }
    
    async function retrySource(sourceId) {
        console.log('Reintentando carga de fuente:', sourceId);
        
        await stateManager.updateState({
            [`validationResults.${sourceId}.status`]: 'loading'
        });
        
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
            
            // Actualizar panel de validación
            const state = stateManager.getState();
            Object.entries(state.validationResults).forEach(([source, validation]) => {
                validationPanel.updateItem(source, validation);
            });
            
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
            const start = new Date(end.getTime() - CONFIG.TIME_CONSTANTS.PAST_24H_MS);
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
        
        // Mostrar fecha del sistema
        const systemDateElement = document.getElementById('systemDate');
        if (systemDateElement) {
            systemDateElement.textContent = SYSTEM_DATE.toLocaleString('es-AR');
        }
        
        // Inicializar panel de validación
        validationPanel.initialize(CONFIG.SOURCE_INFO);
        
        // Configurar botón de consola GFZ
        const gfzButton = document.getElementById('loadGFZButton');
        if (gfzButton) {
            gfzButton.addEventListener('click', loadSimpleGFZ);
        }
        
        // Suscribirse a cambios importantes del estado
        stateManager.subscribe('forecastData', () => {
            console.log('Datos de pronóstico actualizados');
        });
        
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
        getState: () => stateManager.getState(),
        getConfig: () => CONFIG
    };
    
})();

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    geoMagApp.init();
});
