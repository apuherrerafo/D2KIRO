// lint-staged.config.js
// Monorepo sin bun workspaces: apps/engine, apps/web y la raíz (scripts/) son 3 árboles de
// instalación independientes (bun.lock propio cada uno) -- ningún comando corre "desde la raíz"
// contra las dependencias de una subapp, así que cada entrada antepone el cwd correcto en vez de
// depender de un binario hoisted que no existe acá.
//
// apps/engine y scripts/ no tienen ESLint instalado, y scripts/ tampoco tiene tsconfig.json propio
// (Governance 2.0: ninguna herramienta nueva se agrega solo para completar esta tabla). Lo
// honesto que lint-staged puede hacer en pre-commit es la verificación real que sí existe hoy en
// cada carpeta: ESLint para apps/web (el único linter del proyecto), tsc de proyecto completo
// para apps/engine (tiene tsconfig propio -- por eso la función ignora los filenames: un chequeo
// de tipos por archivo aislado, sin el resto del proyecto cargado, no es confiable), y su propia
// suite de tests para scripts/ (sin linter ni tsconfig, es el único chequeo real disponible).
// La batería completa (test + tsc + lint) vuelve a correr igual en pre-push -- esto es solo el
// primer aviso rápido, no un sustituto.
const path = require("node:path");

function relativeTo(baseDir) {
  // path.relative usa el separador nativo (`\` en Windows). Esos paths se insertan dentro de
  // `sh -lc '...'`, donde el backslash se interpreta como escape y se pierde
  // (`features\draft\x.tsx` -> `featuresdraftx.tsx` -> "No files matching the pattern").
  // Normalizamos a separador POSIX antes de pasarlos al shell. En Linux/macOS es un no-op.
  return (absolutePaths) =>
    absolutePaths.map((file) => path.relative(path.resolve(baseDir), file).split(path.sep).join("/")).join(" ");
}

module.exports = {
  "apps/web/**/*.{ts,tsx}": (files) => [`sh -lc 'cd apps/web && bunx eslint ${relativeTo("apps/web")(files)}'`],
  "apps/engine/**/*.ts": () => ["sh -lc 'cd apps/engine && bunx tsc --noEmit'"],
  "scripts/**/*.ts": () => ["bun test scripts/"],
};
