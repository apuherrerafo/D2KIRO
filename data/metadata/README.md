# `data/metadata/` — procedencia de los datos generados

Cada archivo de `data/generated/<nombre>.json` **debe** tener su gemelo
`data/metadata/<nombre>.json`. Un dato generado sin metadata es un error de revisión
(ver [ADR-003](../../docs/adr/ADR-003-frontera-curated-generated.md)).

## Formato

```json
{
  "source": "string",           // de dónde salió — p.ej. "dota2coach.sqlite:hero_matchups"
  "generatedAt": "ISO-8601",    // cuándo se corrió el generador
  "generatorVersion": "string", // versión/commit del script que lo produjo
  "sampleWindow": {             // ventana temporal de los datos de entrada, o null
    "from": "ISO-8601",
    "to": "ISO-8601"
  },
  "patch": "string | null",     // parche de Dota al que corresponde (hoy: "60" o null — corpus mono-parche)
  "rowCount": 0,                // nº de filas/entradas en el dato generado
  "schemaVersion": 1            // versión del esquema en data/schemas/<nombre>.schema.json
}
```

## Por qué

Los tres informes de investigación de Fase 9 coinciden en que el *drift* de un modelo de Dota lo
gobierna el parche: un percentil o un winrate calculado con datos de 7.41e no vale para 7.42. Sin
`patch` + `sampleWindow` + `generatedAt` registrados, seis semanas después nadie puede decir si un
`data/generated/*.json` sigue siendo válido o hay que regenerarlo.
