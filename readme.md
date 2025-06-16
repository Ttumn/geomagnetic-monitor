# Monitor Geomagnético Avanzado para Drones v3.0

Sistema de monitoreo en tiempo real de condiciones geomagnéticas optimizado para operaciones de drones en Sudamérica, con análisis especial de la Anomalía Magnética del Atlántico Sur (SAMA).

## 🌟 Características Principales

- **Multi-índice avanzado**: Integración de Kp, ap, Hp30, ap30, DST, KSA
- **Análisis SAMA**: Factor de amplificación dinámico para la región
- **Predicción 72 horas**: Pronóstico integrado de múltiples fuentes
- **Validación en tiempo real**: Sistema de verificación de calidad de datos
- **Interfaz adaptativa**: Diseño responsivo para escritorio y móvil
- **Gestión de estado centralizada**: Prevención de condiciones de carrera
- **Parsers robustos**: Resistente a cambios en formatos de datos externos
- **Optimización de rendimiento**: Actualizaciones eficientes del DOM y gráficos

## 🚀 Uso Rápido

### Opción 1: GitHub Pages
Acceder directamente a: `https://[tu-usuario].github.io/geomagnetic-monitor/`

### Opción 2: Uso Local
1. Descargar todos los archivos del repositorio
2. Abrir `index.html` en un navegador moderno

## 📊 Fuentes de Datos

El sistema integra datos de:
- **GFZ Potsdam** (Alemania): Índices Kp, ap, Hp30, ap30
- **NOAA/SWPC** (USA): Pronóstico Kp 3 días
- **EMBRACE/INPE** (Brasil): Índice KSA regional
- **WDC Kyoto** (Japón): Índice DST
- **INTERMAGNET**: Datos magnéticos de Pilar (Argentina)

## 🔧 Configuración

El sistema funciona sin configuración adicional. Para personalizar:

```javascript
// En geomagnetic-monitor.js
const CONFIG = {
    // Ajustar timeouts según conexión
    SOURCE_TIMEOUTS: {
        gfzApi: 30000,  // 30 segundos
        kpNoaa: 40000,  // 40 segundos
        // ...
    },
    
    // Modificar umbrales SAMA
    SAMA_THRESHOLDS: {
        SAFE: { KP: 3, AP: 18 },
        CAUTION: { KP: 4, AP: 27 },
        DANGER: { KP: 5, AP: 48 }
    },
    
    // Configurar proxies CORS (agregar propios si es necesario)
    CORS_PROXIES: [
        {
            name: 'Custom Proxy',
            url: 'https://tu-proxy.com/cors?url=',
            timeout: 8000,
            priority: 0  // 0 = máxima prioridad
        }
    ]
};
```

## 📱 Compatibilidad

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Navegadores móviles modernos

## 🛡️ Interpretación de Índices

### Índice Kp (0-9)
- **0-2**: Condiciones tranquilas
- **3-4**: Perturbación menor
- **5-6**: Tormenta geomagnética
- **7-9**: Tormenta severa

### Factor SAMA
- **×1.0-1.2**: Amplificación baja
- **×1.3-1.5**: Amplificación moderada  
- **×1.6-2.0**: Amplificación alta

### Índices de Alta Resolución
- **Hp30**: Kp calculado cada 30 minutos
- **ap30**: Amplitud cada 30 minutos en nT
- **ap**: Equivalente lineal de Kp en nanoteslas

## 🚁 Recomendaciones para Drones

### Vuelo Seguro (Verde)
- Kp efectivo < 3
- Operaciones normales
- Precisión GPS ±1m

### Precaución (Amarillo)
- Kp efectivo 3-4
- Monitorear constantemente
- Reducir distancia de operación

### No Volar (Rojo)
- Kp efectivo ≥ 5
- Riesgo crítico
- Posponer operaciones

## 🆕 Novedades v3.0

### Mejoras Técnicas
1. **Parsers Robustos**: Uso de expresiones regulares para mayor flexibilidad
2. **Gestión de Estado**: StateManager centralizado previene condiciones de carrera
3. **Múltiples Proxies CORS**: Sistema de fallback con prioridades configurables
4. **Optimización de Rendimiento**: 
   - ChartManager con detección de cambios
   - DOMUpdater con actualizaciones batch
   - ValidationPanelUpdater granular

### Mejoras de Arquitectura
- Configuración completamente centralizada
- Documentación inline detallada
- Manejo de errores mejorado
- Sistema de suscripciones a cambios de estado

## 🔍 Solución de Problemas

### "Error de conexión"
- Verificar conexión a internet
- Algunas fuentes pueden estar temporalmente inactivas
- El sistema usa fuentes alternativas automáticamente
- Revisar el panel de validación para detalles por fuente

### Datos no actualizados
- Hacer clic en "🔄 Actualizar"
- Verificar el panel de validación
- Activar actualización automática
- Usar botón "Reintentar" en fuentes con error

### Timeout en fuentes
- Normal en conexiones lentas
- El sistema intentará con proxies alternativos
- Considerar aumentar timeouts en CONFIG

## 🤝 Contribuciones

Las contribuciones son bienvenidas:

1. Fork del repositorio
2. Crear rama de feature (`git checkout -b feature/NuevaCaracteristica`)
3. Commit cambios (`git commit -m 'Agregar nueva característica'`)
4. Push a la rama (`git push origin feature/NuevaCaracteristica`)
5. Abrir Pull Request

### Guías de Contribución
- Mantener la estructura modular del código
- Documentar nuevas funciones y clases
- Agregar constantes a CONFIG en lugar de hardcodear
- Probar en múltiples navegadores

## 📄 Licencia

Este proyecto está bajo licencia MIT. Ver archivo `LICENSE.txt` para detalles.

## 🙏 Agradecimientos

- GFZ Potsdam por la API de índices geomagnéticos
- NOAA/SWPC por datos de pronóstico
- EMBRACE/INPE por índice KSA regional
- WDC Kyoto por datos DST
- INTERMAGNET por datos magnéticos

## 📞 Contacto

Para consultas o sugerencias:
- Abrir un issue en GitHub
- Contribuir con mejoras mediante PR

---

**Nota**: Este sistema es una herramienta de referencia. Siempre consultar múltiples fuentes y usar criterio profesional para decisiones operacionales críticas.
