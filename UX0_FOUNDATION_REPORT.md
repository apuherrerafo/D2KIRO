# UX-0 Foundation Implementation Report

## Baseline & Workspace

- **BASE_SHA:** `63bfd39d8999c796e2f51a8ea66baee724684006`
- **BRANCH:** `ux/vnext-foundation`
- **WORKTREE:** `D:\JULIO\apuherrerafoprojects\dota2coach-wt\ux-vnext-foundation`
- **COMMITS:**
  - `7a40931` tokens: implement primitive and semantic CSS architecture (UX-0)
  - `07e5619` docs: establish design intent principles (UX-0)
  - `d73b4ef` components: implement initial Button and StatusNotice primitives (UX-0)
  - `6ae691e` storybook: add React-Vite workshop and stories (UX-0)
  - `ff567b1` discovery: implement mechanical component catalog generator (UX-0)
  - `3a4d00c` enforcement: add ESLint design rules with ratchet baseline (UX-0)
  - `d484218` qa: add Playwright visual regression, accessibility tests, and friction log (UX-0)

- **FILES_CHANGED:**
  - `AGENT_FRICTION_LOG.md`
  - `UX0_FOUNDATION_REPORT.md`
  - `docs/design/DESIGN_INTENT.md`
  - `apps/web/.gitignore`
  - `apps/web/.storybook/main.ts`
  - `apps/web/.storybook/preview.ts`
  - `apps/web/app/tokens.css`
  - `apps/web/bun.lock`
  - `apps/web/design/COMPONENTS.generated.json`
  - `apps/web/design/COMPONENTS.llms.txt`
  - `apps/web/design/components/Button.tsx`
  - `apps/web/design/components/StatusNotice.tsx`
  - `apps/web/design/components/components.test.tsx`
  - `apps/web/design/components/index.ts`
  - `apps/web/design/discovery/catalog.test.ts`
  - `apps/web/design/discovery/generate.ts`
  - `apps/web/design/enforcement/enforcement.test.ts`
  - `apps/web/design/enforcement/eslint-plugin.mjs`
  - `apps/web/design/enforcement/fixtures/bad.tsx`
  - `apps/web/design/enforcement/fixtures/false-positive.tsx`
  - `apps/web/design/enforcement/fixtures/good.tsx`
  - `apps/web/design/playwright.config.ts`
  - `apps/web/design/serve-static.ts`
  - `apps/web/design/stories/Button.stories.tsx`
  - `apps/web/design/stories/StatusNotice.stories.tsx`
  - `apps/web/design/tests/accessibility.pw.ts`
  - `apps/web/design/tests/visual.pw.ts`
  - `apps/web/design/tests/visual.pw.ts-snapshots/button-default-win32.png`
  - `apps/web/design/tests/visual.pw.ts-snapshots/button-disabled-win32.png`
  - `apps/web/design/tests/visual.pw.ts-snapshots/statusnotice-warning-win32.png`
  - `apps/web/design/tokens/primitives.css`
  - `apps/web/design/tokens/semantic.css`
  - `apps/web/design/tokens/token-contract.test.ts`
  - `apps/web/design/tokens/workshop.css`
  - `apps/web/eslint.config.mjs`
  - `apps/web/package.json`

- **DEPENDENCIES_ADDED:**
  - Added strictly as `devDependencies` in `apps/web/package.json`:
    - `storybook@10.6.1` (MIT)
    - `@storybook/react-vite@10.6.1` (MIT)
    - `@axe-core/playwright@4.13.0` (MPL-2.0)
    - `@playwright/test@1.62.1` (Apache-2.0, pinned to match root version exactly)
  - Zero production runtime dependencies added.
  - Zero modifications to `apps/web/package-lock.json`.

---

## Technical Foundations

### 1. Token Architecture
- **Model:** Strict two-layer `PRIMITIVE -> SEMANTIC` hierarchy with no component-token layer.
- **Authoring:** Written directly in CSS (`apps/web/design/tokens/primitives.css` and `semantic.css`).
- **Integration:** Exposes semantic definitions to Tailwind CSS v4 via `@theme inline`.
- **Backward Compatibility:** `apps/web/app/tokens.css` imports the design tokens and preserves 100% value parity with the baseline.
- **Contract Enforcement:** Verified via `apps/web/design/tokens/token-contract.test.ts` (ensuring no hardcoded hex in semantic layers and complete variable mapping).

### 2. Design Intent
- **Location:** `docs/design/DESIGN_INTENT.md`
- **Purpose:** Human-authored, concise principles capturing what tokens cannot express:
  - D2KIRO is a decision-support tool under time pressure, not a generic analytics dashboard.
  - Exactly one canonical recommendation dominates visually; secondary alternatives remain subordinate.
  - Recommendation is strictly advisory; legality is authoritative.
  - Scarcity of primary emphasis; avoidance of "card soup" and pill proliferation.
  - Accessibility is core behavior from Day 1.
- **Human Decision Boundary:** Final brand personality, typography direction, color palette, and esports HUD theming are explicitly marked `HUMAN_DECISION_REQUIRED`.

### 3. Components Implemented
- **Button (`apps/web/design/components/Button.tsx`)**:
  - Strict TypeScript interface (`ButtonProps`), concise JSDoc/TSDoc metadata.
  - Variants: `primary` (accent surface) and `secondary` (bordered neutral).
  - Semantic token consumption only (`bg-accent-primary`, `border-surface-border`, `rounded-control`, `text-caption`).
  - Accessibility: Stable accessible name, native `disabled` attribute, `aria-busy="true"` state, visible `outline-focus-ring` indicator, and `motion-reduce:transition-none`.
- **StatusNotice (`apps/web/design/components/StatusNotice.tsx`)**:
  - Strict TypeScript interface (`StatusNoticeProps`), concise JSDoc/TSDoc metadata.
  - Tones: `neutral` (`role="status"`, `aria-live="polite"`), `warning` (`role="status"`, `aria-live="polite"`), `error` (`role="alert"`, `aria-live="assertive"`).
  - Structural heading landmark (`h3`) with secondary text body, semantic border and text tones (`border-signal-negative`, `border-signal-warning`).
- **Tests:** `apps/web/design/components/components.test.tsx` (9 unit tests passing via Bun Test + Happy DOM).

### 4. Storybook Workshop
- **Stack:** Storybook 10.6.1 React-Vite.
- **Configuration:** `.storybook/main.ts` with explicit `@/*` Vite path alias and `.storybook/preview.ts` with centered layout.
- **Isolation:** Completely self-contained via `apps/web/design/tokens/workshop.css`; zero reliance on Next.js font or server runtime.
- **Static Build:** Successfully builds in ~800ms via `bun run storybook:build` to `apps/web/storybook-static/`.
- **Stories:** Deterministic CSF stories for Button (Default, Secondary, Disabled, Busy, FocusVisible, KeyboardActivation) and StatusNotice (Neutral, Warning, Error, LongContent).

### 5. Component Manifest & Discovery
- **Canonical Output:** `apps/web/design/COMPONENTS.generated.json`
- **Projection:** `apps/web/design/COMPONENTS.llms.txt` (derived strictly as a view from canonical JSON).
- **Generator:** `apps/web/design/discovery/generate.ts` leveraging TypeScript Compiler API (`ts.createProgram`, `getTypeChecker`) to extract props, types, optionality, variants, and states mechanically without manual duplication.
- **Commands:**
  - Generation: `bun run catalog:generate`
  - Stale verification: `bun run catalog:check` (`apps/web/design/discovery/catalog.test.ts` fails CI if JSON output drifts from code).

### 6. Design Enforcement
- **Engine:** Focused local ESLint plugin (`apps/web/design/enforcement/eslint-plugin.mjs`). No ast-grep.
- **Rules Implemented:**
  1. `design-system/no-raw-hex`: Rejects raw hex colors in JSX attributes.
  2. `design-system/no-arbitrary-tailwind`: Rejects arbitrary bracket notation (`p-[...]`, `bg-[#...]`, `rounded-[...]`).
  3. `design-system/no-primitive-token`: Rejects direct consumption of `--primitive-*` in components.
  4. `design-system/no-native-button`: Prohibits raw `<button>` elements outside canonical primitive.
  5. `design-system/no-duplicate-button`: Flags components duplicating button primitives.
- **Guidance Quality:** Every rule emits structured error messages with:
  - `PROBLEM:` Concise statement of the violation.
  - `WHY:` Architectural rationale.
  - `WHAT TO USE INSTEAD:` Specific semantic replacement.
- **Ratchet / Grandfathering:** Scoped via `apps/web/eslint.config.mjs` to `design/**/*.{ts,tsx}`. Legacy application features remain untouched and do not fail lint.

### 7. Visual Regression Testing (VRT)
- **Framework:** Playwright using `toHaveScreenshot`.
- **Controls:** Fixed viewport (960×720), `colorScheme: "dark"`, `locale: "en-US"`, `reducedMotion: "reduce"`, `animations: "disabled"`, zero network images, clocks, or random data.
- **Curated Budget:** Exactly 3 snapshot baselines:
  - `button-default-win32.png` (2,121 bytes)
  - `button-disabled-win32.png` (1,780 bytes)
  - `statusnotice-warning-win32.png` (5,090 bytes)
  - **Total Baseline Footprint:** 8,991 bytes (< 9 KB total).
- **Execution:** `bun run test:design:vrt` passes in ~2.7s with 100% deterministic pixel match.

### 8. Accessibility (A11y)
- **Integration:** `@axe-core/playwright` co-located and pinned to Playwright Core 1.62.1 with zero type divergence.
- **Automated Audits:** Zero axe violations across Button and StatusNotice stories.
- **Behavioral Assertions:**
  - Stable accessible names.
  - Visible focus outline (`focus-visible:outline-focus-ring`).
  - Keyboard activation (Tab + Enter / Space).
  - Native disabled and busy states (`aria-busy="true"`).
  - Targeted ARIA snapshots for semantic landmarks (`status`, `alert`, `heading`, `button`).
- **Certification Boundary:** Explicitly documented that automated testing does NOT constitute accessibility certification.

---

## Enforcement & Ratchet Status

- **Legacy Violations in Codebase:** Grandfathered. Pre-existing button implementations in `features/` and `components/` continue to function without failing CI.
- **Ratchet Mechanism:** Scoped in `eslint.config.mjs` to `design/**/*.{ts,tsx}`.
- **New Violations in Design System:** 0 violations. Clean pass.

---

## Verification Test Results

| Gate / Command | Result | Notes |
|---|---|---|
| `bun test apps/engine` | **PASS** | 1,854 pass, 0 fail (154 files) |
| `bun test apps/web` | **PASS** | 495 pass, 0 fail (67 files) |
| `bun test scripts` | **PASS** | 572 pass, 0 fail (64 files) |
| Canonical `bun run test` | **PASS** | 2,921 pass, 0 fail across all roots |
| `apps/web tsc` (`bun run typecheck`) | **PASS** | Zero TypeScript errors |
| `apps/web lint` (`bun run lint`) | **PASS** | Zero errors (5 pre-existing legacy warnings) |
| Storybook static build (`bun run storybook:build`) | **PASS** | Built in 771ms to `storybook-static/` |
| Component discovery (`bun run catalog:check`) | **PASS** | 4/4 tests pass; manifest verified |
| Token contract tests | **PASS** | 9/9 tests pass |
| Component unit tests | **PASS** | 9/9 tests pass |
| ESLint enforcement unit tests | **PASS** | 3/3 tests pass |
| Playwright a11y (`bun run test:design:a11y`) | **PASS** | 8/8 tests pass (Axe + keyboard + ARIA) |
| Playwright VRT (`bun run test:design:vrt`) | **PASS** | 3/3 screenshots match baseline |
| `verify-simplicity.sh` | **PASS** | Invariants, security, and toolchain OK |
| `git diff --check` | **PASS** | Zero whitespace or formatting errors |

---

## Agent Friction Summary

1. **PowerShell Script Policy vs Executables:** Windows PowerShell blocks `.ps1` execution scripts by default (`npx.ps1` rejected). Resolved by binding all test commands directly to `playwright test` or `bun run`.
2. **Happy DOM Global Registration Contamination:** `@happy-dom/global-registrator` patches global `AbortSignal`, breaking Node's C++ `fs/promises.readFile` inside in-process ESLint runs. Resolved by using synchronous `readFileSync` + `eslint.lintText`.
3. **Playwright Core Peer Version Alignment:** Pinned `@playwright/test@1.62.1` in `apps/web` alongside `@axe-core/playwright@4.13.0` to eliminate the spike's TypeScript type split.
4. **Storybook React-Vite Path Resolution:** Required an explicit `viteFinal` alias in `.storybook/main.ts` to support `@/*`.
5. **ESLint Ignore for Build Artifacts:** Added `storybook-static/**` to `apps/web/eslint.config.mjs` `globalIgnores` to avoid linting generated bundles.
6. **Windows Host Shell Resolution:** Prepending Git Bash to `PATH` ensures bash scripts execute against the native Windows Bun toolchain instead of WSL.

---

## Known Limitations

- **Platform-Dependent Screenshot Baselines:** Playwright screenshots are generated with `-win32.png` suffix. Running VRT on Linux CI will require generating corresponding Linux baselines or running within a container.
- **Accessibility Automation Scope:** Axe and ARIA tests verify programmatic semantics and contrast, but do not replace screen reader or human accessibility certification.
- **Grandfathered Legacy Code:** Existing product buttons (e.g. in `DraftView.tsx`) have not yet been migrated to `<Button>`.

---

## Areas Requiring Human Decision

The following areas are intentionally NOT decided in UX-0 and are marked `HUMAN_DECISION_REQUIRED` in `docs/design/DESIGN_INTENT.md`:
- Final Brand Personality
- Final Color Palette
- Final Typography Personality
- Dota / Esports HUD Theming
- Visual Direction (Radiant/Dire styling, glassmorphism, decorative gradients)

---

## Files and Areas Intentionally Not Migrated

- `TeamCoachBoard`: Untouched.
- `LiveDotaView`: Untouched.
- `Simulator`: Untouched.
- `NavBar`: Untouched.
- `HeroGrid`: Untouched.
- All existing 91 product button instances: Untouched.
- Recommendation behavior, draft legality, scoring weights: Untouched.
- Staging soak branch (`staging/private-beta-1`): Untouched.
