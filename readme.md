# Monitor Geomagnético Avanzado para Drones

Sistema de monitoreo y predicción de actividad geomagnética optimizado para operaciones con drones en Sudamérica, con análisis especializado de la Anomalía Magnética del Atlántico Sur (SAMA).

![Estado](https://img.shields.io/badge/estado-activo-brightgreen)
![Versión](https://img.shields.io/badge/versión-2.0.0-blue)
![Licencia](https://img.shields.io/badge/licencia-MIT-green)

## 🌍 Características Principales

- **Multi-índices en tiempo real**: Integración de datos de GFZ Potsdam, NOAA/SWPC, EMBRACE, WDC Kyoto e INTERMAGNET
- **Análisis SAMA mejorado**: Factor de amplificación dinámico para la región de la Anomalía Magnética del Atlántico Sur
- **Sistema de prioridades**: Jerarquía inteligente de fuentes de datos (KSA > NOAA > HP30 > Kp GFZ)
- **Predicción 72 horas**: Pronóstico integrado con múltiples modelos
- **Recomendaciones operacionales**: Sistema de alertas específico para drones
- **Validación en tiempo real**: Monitoreo del estado y calidad de todas las fuentes de datos

## 📊 Índices Monitoreados

### Prioridad 1-4 (Principales)
- **KSA (EMBRACE)**: Índice K Sudamericano - Máxima prioridad para la región
- **Kp NOAA**: Pronóstico oficial de NOAA/SWPC
- **HP30 GFZ**: Índice de alta resolución (30 minutos)
- **Kp GFZ**: Índice planetario de GFZ Potsdam

### Índices de Amplitud
- **ap/ap30**: Amplitud planetaria en nanoteslas
- **Ap**: Promedio diario
- **C9**: Clasificación simplificada de 9 niveles

### Índices Regionales
- **DST**: Disturbance Storm Time (WDC Kyoto)

## 🚁 Sistema de Recomendaciones para Drones

El sistema evalúa múltiples factores de riesgo:

- **GPS**: Precisión y disponibilidad de señal
- **Brújula**: Interferencias magnéticas
- **Comunicaciones**: Estabilidad de enlaces de radio
- **SAMA**: Efecto amplificado en la región
- **Validación**: Confiabilidad de los datos

### Niveles de Operación

1. **VUELO SEGURO** (Verde): Condiciones óptimas
2. **PRECAUCIÓN** (Amarillo): Monitoreo constante recomendado
3. **VUELO LIMITADO** (Naranja): Reducir distancia y altura
4. **NO VOLAR** (Rojo): Prohibido operar

## 🛠️ Instalación

### Requisitos
- Navegador web moderno (Chrome, Firefox, Safari, Edge)
- Conexión a internet para datos en tiempo real
- No requiere instalación de servidor

### Uso Local

1. Clona el repositorio:
```bash
git clone https://github.com/tuusuario/geomagnetic-monitor.git
cd geomagnetic-monitor
```

2. Abre el archivo HTML en tu navegador:
```bash
# En Linux/Mac
open index.html

# En Windows
start index.html
```

### Despliegue en Servidor Web

1. Sube los archivos a tu servidor web:
```bash
scp index.html geomagnetic-monitor.js usuario@servidor:/var/www/html/
```

2. Accede desde cualquier navegador:
```
https://tudominio.com/index.html
```

## 📡 Fuentes de Datos

- **GFZ Potsdam**: API oficial de índices geomagnéticos
- **NOAA/SWPC**: Space Weather Prediction Center
- **EMBRACE/INPE**: Programa brasileño de clima espacial
- **WDC Kyoto**: World Data Center for Geomagnetism
- **INTERMAGNET**: Red global de observatorios magnéticos

## 🔧 Configuración

El sistema incluye configuración personalizable en `geomagnetic-monitor.js`:

```javascript
const CONFIG = {
    SOURCE_TIMEOUTS: {
        gfzApi: 20000,      // 20 segundos
        kpNoaa: 30000,      // 30 segundos
        // ... más timeouts
    },
    // ... más configuraciones
};
```

## 📈 API y Métodos Públicos

```javascript
// Inicializar la aplicación
geoMagApp.init();

// Actualizar datos manualmente
geoMagApp.refreshData();

// Activar/desactivar actualización automática
geoMagApp.toggleAutoRefresh();

// Cambiar fuente de datos
geoMagApp.toggleDataSource();

// Reintentar carga de fuente específica
geoMagApp.retrySource('ksa');

// Obtener estado actual
const estado = geoMagApp.getState();

// Obtener configuración
const config = geoMagApp.getConfig();
```

## 🐛 Solución de Problemas

### Error de CORS
Algunas fuentes de datos pueden requerir un proxy CORS. El sistema incluye manejo automático con fallback a proxy.

### Timeouts
Si experimentas timeouts frecuentes, ajusta los valores en `CONFIG.SOURCE_TIMEOUTS`.

### Datos faltantes
El sistema maneja automáticamente las fuentes no disponibles y utiliza fuentes alternativas según la jerarquía de prioridades.

## 📊 Interpretación de Datos

### Factor SAMA
- **×1.0 - ×1.3**: Efecto mínimo a moderado
- **×1.3 - ×1.5**: Efecto significativo
- **×1.5 - ×2.0**: Efecto severo

### Índice Kp
- **0-3**: Actividad baja (verde)
- **4**: Actividad moderada (amarillo)
- **5-6**: Tormenta menor (naranja)
- **7-9**: Tormenta mayor (rojo)

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 👥 Autores

- Sistema original desarrollado para monitoreo de drones en agricultura de precisión
- Optimizado para la región SAMA (Sudamérica)

## 🙏 Agradecimientos

- GFZ German Research Centre for Geosciences
- NOAA Space Weather Prediction Center
- EMBRACE/INPE Brasil
- World Data Center for Geomagnetism, Kyoto
- INTERMAGNET

## 📞 Contacto

Para preguntas o soporte, por favor abre un issue en GitHub.

---

**Nota**: Este sistema está diseñado como herramienta de apoyo. Siempre siga las regulaciones locales y las mejores prácticas de seguridad para operaciones con drones.
