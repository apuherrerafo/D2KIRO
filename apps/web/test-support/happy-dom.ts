// Registro idempotente de happy-dom para pruebas que renderizan React de verdad
// (@testing-library/react). `GlobalRegistrator.register()` lanza si se llama dos veces en el
// mismo proceso -- con más de un archivo de prueba que necesita DOM (CopilotPanel.test.tsx,
// use-random-draft-session.integration.test.ts), `bun test` los corre en el mismo proceso y el
// segundo registro rompía la suite completa (hallazgo real, TSK-125). Import compartido en vez de
// que cada archivo llame `.register()` por su cuenta.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
