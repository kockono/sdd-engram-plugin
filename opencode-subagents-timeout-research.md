# Estrategia de Watchdog y Timeouts para Subagentes (v2.0)

Fecha: 2026-04-29
Estado: **Especificación de Implementación Validada**

## Contexto Actualizado

Tras una revisión profunda de las últimas actualizaciones de las APIs de OpenCode (`@opencode-ai/plugin` y `@opencode-ai/sdk`), se ha validado la viabilidad técnica de implementar un **Watchdog de Delegación** robusto desde el plugin, sin necesidad de modificar el core de OpenCode ni inflar `opencode.json`.

---

## Hallazgos Críticos (v2.0)

### 1. Control de Ejecución: `session.abort`
Contrario a lo supuesto inicialmente, el SDK ya expone una vía programática para intervenir subagentes:
- **API**: `api.client.session.abort({ sessionID })`
- **Capacidad**: Permite al orquestador (padre) terminar una ejecución colgada en una sesión hija de forma limpia y controlada.

### 2. Monitoreo de "Progreso Útil"
Ya no dependemos de estimaciones de tiempo bruto. Podemos medir actividad real mediante los siguientes eventos del bus:
- **`session.status`**: Permite detectar transiciones a `busy` (inicio de ejecución) e `idle` (terminado o pausado).
- **`message.part.updated`**: Se dispara con cada token del stream o actualización de herramienta. Es el pulsómetro perfecto para detectar un "stall" (estancamiento).

### 3. Sinergia con la Lógica de Sesiones
La lógica recientemente implementada en el plugin (`resolveSessionActiveModel`) permite identificar con precisión:
- Qué agente está "al mando" de la sesión actual.
- Si el agente activo es un `sdd-*` primario o un subagente derivado.
- Cuál es el agente `-fallback` correspondiente para el rescate.

---

## Estrategia Recomendada: Watchdog Lógico (Opción C Validada)

### Funcionamiento
El plugin implementará un servicio de Watchdog que funcionará como un guardián de las delegaciones.

1.  **Activación**: Al detectar un evento `session.status` con tipo `busy`, se inicia un timer de inactividad (`max_idle_ms`).
2.  **Reset del Watchdog**: Cada evento `message.part.updated` o `message.updated` reinicia el timer.
3.  **Detección de Stall**: Si el timer expira (ej. 45-60 segundos sin un solo token), el subagente se considera "estancado".
4.  **Intervención**:
    *   Llamar a `api.client.session.abort()`.
    *   Notificar al usuario mediante `api.ui.toast` (variant: `error`).
    *   Ofrecer el botón de "Lanzar Fallback" para reanudar con el agente seguro.

---

## Diseño Técnico de Implementación

### Módulo: `src/watchdog.ts`
Responsabilidades:
- Mantener un registro de timers activos por `sessionID`.
- Escuchar los eventos del bus de OpenCode.
- Resolver el agente activo usando `resolveSessionActiveModel`.

### Parámetros Configurables
- `IDLE_THRESHOLD`: 45,000 ms (default).
- `MAX_TOTAL_RUNTIME`: 600,000 ms (10 min).

---

## Ventajas sobre las opciones A y B
- **No ensucia la configuración**: No requiere modificar `opencode.json`.
- **Inteligente**: Distingue entre una ejecución lenta pero constante y una ejecución realmente bloqueada.
- **Accionable**: Proporciona un mecanismo de salida (`abort`) y una vía de recuperación (`fallback`).

## Conclusión
La infraestructura actual de OpenCode es suficiente para soportar un sistema de timeouts lógicos superior a cualquier ajuste nativo de transportes. La solución definitiva es el **Watchdog 2.0** integrado en el ciclo de vida de los mensajes del plugin.
