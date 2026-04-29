# Migration to Engram HTTP API

Fecha: 2026-04-29

## Contexto

Anteriormente, el plugin interactuaba directamente con la base de datos SQLite de Engram (`~/.engram/engram.db`) mediante la ejecución de comandos `sqlite3` a través de procesos hijos. Esto presentaba varios inconvenientes:

1.  **Dependencia Externa**: Requería que el binario `sqlite3` estuviera instalado y accesible en el `PATH` del sistema.
2.  **Inconsistencia**: No utilizaba la misma capa de abstracción que el resto del ecosistema OpenCode, que ya dispone de un servidor Engram funcionando por HTTP.
3.  **Gestión de Procesos**: Levantar un proceso de línea de comandos para cada consulta es menos eficiente que realizar llamadas HTTP locales.

## Cambios Implementados

### 1. Comunicación vía HTTP
El plugin ahora utiliza la API nativa `fetch` para comunicarse con el servidor de Engram. Por defecto, intenta conectar a `http://127.0.0.1:7437`, respetando la variable de entorno `ENGRAM_PORT` si estuviera definida.

### 2. Endpoints Utilizados

*   **Listado de Memorias**: `GET /observations/recent?project={name}&limit=50`
    *   Se consultan en paralelo todos los candidatos a nombre de proyecto (git remote, git root, alias).
    *   Los resultados se unifican, se deduplican por ID y se ordenan cronológicamente (más recientes primero).
*   **Borrado de Memorias**: `DELETE /observations/{id}`
    *   Realiza un borrado lógico (soft-delete) de la observación a través de la API del servidor.

### 3. Asincronía y UI
Toda la lógica de gestión de memorias en `src/memories.ts` ha pasado a ser asíncrona (`async/await`). Los diálogos en `src/dialogs.tsx` se han actualizado para manejar estas promesas y proporcionar feedback visual al usuario (toasts de error) en caso de que el servidor de Engram no esté respondiendo.

### 4. Actualización de Tests
Se ha reescrito `src/memories.test.ts` eliminando los mocks de `execFileSync` y sustituyéndolos por mocks de la API global `fetch`. Los tests verifican ahora la correcta integración con el formato de respuesta del servidor HTTP.

## Requisitos de Runtime
Para que la funcionalidad de "Project Memories" esté activa, el servidor de Engram debe estar corriendo. OpenCode suele levantarlo automáticamente, pero el plugin ahora es capaz de detectar fallos de conexión y notificar al usuario de forma elegante.
