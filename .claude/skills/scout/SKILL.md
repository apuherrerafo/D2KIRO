---
name: scout
description: Trae una página de referencia (UI, UX, modelo de negocio) y la convierte en Markdown limpio con notas de qué específicamente gustó de ella. Usar cuando el usuario dice "me gusta cómo hace esto tal página", "quiero algo parecido a X", o pega un link como referencia visual o de producto.
compatibility: Prefiere Firecrawl si está conectado (confirmado independientemente). "crw-mcp" también es real — confirmado en el registro de npm (v0.28.0, AGPL-3.0, activo) vía `npx crw-mcp`; sirve como alternativa local. Los comandos de instalación tipo `cargo install crw-cli` mencionados en investigaciones externas NO son correctos — ese paquete no existe, usa `npx crw-mcp`. Sin ninguno de los dos: fallback manual (pega el contenido). En cualquier caso, el resultado se escribe a archivo — nunca se vuelca crudo a la conversación.
---

# /scout — Captura de Referencias

## PROPÓSITO
Cuando el usuario dice "quiero algo como esta página", no basta con guardar el link — hay que capturar QUÉ específicamente le gustó (¿el layout? ¿el copy? ¿el modelo de negocio?) para que `/design-forge` o `/pre-flight` lo puedan usar de verdad después.

## REGLAS
1. Pide la URL si no la dio.
2. **Patrón CLI + archivo, no MCP crudo al contexto**: si hay Firecrawl conectado (confirmado), o algún motor local equivalente que hayas verificado tú mismo, ejecútalo para que escriba el Markdown resultante directo a un archivo — nunca dejes que la respuesta cruda del scraping se vuelque entera en la conversación, eso quema contexto sin necesidad.
3. Si no hay ningún motor de scraping disponible: no bloquees la tarea — pide al usuario que pegue el texto/capture de pantalla directamente, y trabaja con eso.
4. Pregunta explícito: "¿Qué específicamente te gusta de esto — el layout, el tono, la paleta, el modelo de negocio, algo puntual?" No asumas que "toda la página" es la referencia.
5. Guarda el resultado en `docs/agents/references/` (crea la carpeta si no existe) — un archivo por referencia, nombrado por dominio o tema, con: la URL, el Markdown/resumen, y la nota de qué se debe imitar (no copiar textual). Después, léelo con `Read` normal cuando lo necesites — no lo vuelvas a traer del scraper.
6. Si la referencia es de negocio/dominio (no de UI), enlázala también desde `/pre-flight` Bloque 2 (competidores).
7. Si la referencia es de UI/UX, enlázala desde `/design-forge`.

## LÍMITES
- No reproduce contenido con copyright textualmente — resume y describe el patrón, no copia el texto de la página.
- No descarga imágenes ni assets — solo texto/estructura y la nota de qué imitar.
