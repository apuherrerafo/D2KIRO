import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import designPlugin from "./design/enforcement/eslint-plugin.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["design/**/*.{ts,tsx}"],
    plugins: {
      "design-system": designPlugin,
    },
    rules: {
      "design-system/no-raw-hex": "error",
      "design-system/no-arbitrary-tailwind": "error",
      "design-system/no-primitive-token": "error",
      "design-system/no-native-button": "error",
      "design-system/no-duplicate-button": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // TSK-217 (E2E): playwright.config.ts fija NEXT_DIST_DIR=.next-e2e para no pisar el .next del
    // `bun run dev` del desarrollador -- ese build generado quedaba fuera de la lista de arriba y
    // eslint lo lintaba entero (780 errores / 10831 warnings sobre código generado, no escrito a
    // mano). Hallazgo real: bloqueó un push tras la primera corrida local del E2E.
    ".next-e2e/**",
    // Hero loop lab: playwright.hero-loop.config.ts builds into .next-hero-loop, same reason as above.
    ".next-hero-loop/**",
    // Coach motion labs: scripts/coach-motion-v2 builds into .next-coach-motion-v2-* (NEXT_DIST_DIR), same reason.
    ".next-coach-*/**",
    "storybook-static/**",
    "design/enforcement/fixtures/**",
  ]),
]);

export default eslintConfig;
