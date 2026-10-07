# Agent Friction Log — UX-0 Foundation

This log records genuine architectural, tooling, and environment friction encountered during the implementation of the UX-0 foundation. It documents why certain workarounds were needed and how future agents can navigate these constraints safely.

## 1. Environment & Platform Friction

- **PowerShell Script Execution Policy (`npx.ps1` vs `bun run` / `.exe`)**:
  - *Friction*: On Windows PowerShell, running `npx` invokes `npx.ps1`, which is blocked by the default Windows execution policy (`PSSecurityException`).
  - *Resolution*: Run commands through `bun run <script>` or directly call `.exe` binaries under `node_modules/.bin/` (e.g., `playwright.exe`). All test commands in `apps/web/package.json` are bound to `playwright test` so Bun executes them without triggering PowerShell script restrictions.
- **Host Shell Ambiguity (WSL vs Git Bash)**:
  - *Friction*: PowerShell resolves `bash` to WSL by default on this host. WSL does not have the native Bun runtime installed, causing root repository test scripts (`verify-simplicity.sh`) to fail.
  - *Resolution*: Canonical bash script execution must explicitly prepend Git Bash (`C:\Program Files\Git\bin`) to `PATH` or invoke `C:\Program Files\Git\bin\bash.exe`.

## 2. Test Runner & Runtime Friction

- **Happy DOM Global Registration Contaminates Node `AbortSignal`**:
  - *Friction*: Multiple existing frontend tests import `@happy-dom/global-registrator`. Happy DOM patches global objects, including `AbortSignal`. When ESLint's Node.js engine subsequent calls `node:fs/promises.readFile`, Node's C++ bindings reject Happy DOM's `AbortSignal` with `TypeError: The "signal" argument must be of type AbortSignal. Received an instance of AbortSignal`.
  - *Resolution*: In `apps/web/design/enforcement/enforcement.test.ts`, fixture files are read using Node's synchronous `readFileSync` and passed to `eslint.lintText(code, { filePath })`. This avoids `fs/promises.readFile` and prevents Happy DOM's global patch from breaking ESLint tests.
- **Playwright Core Peer Version Alignment**:
  - *Friction*: In the architecture spike, installing `@axe-core/playwright` resolved a newer transitive `playwright-core` (1.63) while the root runner was pinned to 1.62.1. This caused a TypeScript type split requiring `page as unknown as Page`.
  - *Resolution*: In `apps/web/package.json`, `@playwright/test@1.62.1` was explicitly pinned alongside `@axe-core/playwright@4.13.0`. Both packages now resolve the identical `playwright-core@1.62.1`, resulting in zero type divergence and direct passing of `page` to `new AxeBuilder({ page })`.

## 3. Tooling & Workshop Friction

- **Storybook React-Vite Path Aliasing**:
  - *Friction*: `@storybook/react-vite` does not automatically infer Next.js / TypeScript `@/*` path aliases from `tsconfig.json`. Without custom configuration, stories importing from `@/design/components` fail during static build.
  - *Resolution*: An explicit `viteFinal` hook was added to `apps/web/.storybook/main.ts` resolving `@` to the `apps/web` root directory.
- **Generated Build Artifacts Ignored by ESLint**:
  - *Friction*: `storybook build` generates static distribution files (`storybook-static/`) containing minified vendor chunks. Next.js ESLint configuration does not automatically ignore nested Storybook build directories, which would cause hundreds of lint errors.
  - *Resolution*: Added `storybook-static/**` to `globalIgnores` in `apps/web/eslint.config.mjs` and `/storybook-static/` to `apps/web/.gitignore`.

## 4. Architecture & Enforcement Friction

- **Separation of Lockfiles**:
  - *Friction*: The repository contains `bun.lock` at root, `apps/web/bun.lock`, and `apps/web/package-lock.json`.
  - *Resolution*: Bun is the canonical package manager. Only `apps/web/bun.lock` and `apps/web/package.json` were updated when adding devDependencies. `package-lock.json` was left completely untouched.
- **Enforcement Ratchet Design**:
  - *Friction*: Legacy product screens (`DraftView.tsx`, `TeamCoachBoard.tsx`) contain existing custom button styles and legacy classes. Enabling design rules globally would immediately fail CI on pre-existing code.
  - *Resolution*: Implemented a strict ratchet in `apps/web/eslint.config.mjs` scoping `design-system/*` rules to `design/**/*.{ts,tsx}`. New design code must be 100% compliant, while legacy code remains grandfathered until migration waves are authorized.
