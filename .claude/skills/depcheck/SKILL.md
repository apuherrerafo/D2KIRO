---
name: depcheck
description: Verificar vigencia de APIs y límites de dependencias con Context7.
---

# @depcheck — Validador de Dependencias

## PROPÓSITO
Verificar en tiempo real lo que un campo estático del frontmatter no puede saber: si una dependencia sigue vigente y no está deprecada hoy. Todo lo que SÍ es estático (qué requiere una skill para funcionar) ya no vive aquí — vive en el campo oficial `compatibility` del frontmatter de cada skill (ver estándar de Agent Skills). Esta skill existe solo para la parte que exige ejecución real.

## REGLAS
- Antes de añadir una dependencia, consulta Context7 MCP — esto es una llamada real, no se puede declarar de antemano en YAML.
- Verifica que la API no esté deprecada.
- Límite: máximo 3 dependencias principales en fase de prototipo. Si se necesita una cuarta, pide autorización.
- Marca el paquete con `// ALLOWED` en el diff para que `verify-simplicity.sh` lo reconozca.
- Si una skill declara un requisito de entorno (una CLI, una versión de runtime), eso se documenta en su propio `compatibility:` — no lo dupliques aquí.

## OUTPUT
"✅ Dependencia verificada y autorizada." o "❌ Dependencia rechazada: [motivo]."
