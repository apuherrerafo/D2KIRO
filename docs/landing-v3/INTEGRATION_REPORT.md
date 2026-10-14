# Landing V3 — implementation report

Branch `feat/landing-v3` · cut from `feat/landing-v2-coach-motion-integration` (b99cf70; Motion V2 pack 7def294; frozen Landing V2 ancestor 118b564) · not merged, not deployed.
Visual target: the approved local prototype `d2kiro-landing-v3/index-b.html`. This is a translation, not a redesign.

## How it is served
`/` serves Landing V3 when the environment variable `LANDING_VARIANT=v3` is set (same switch as `v2`; unset keeps Landing 01B). Landing V3 is imported only inside its branch, so its stylesheet and fonts never load for the other variants. Code: `apps/web/features/landing-v3/`.

| Part | File |
|---|---|
| every player-facing word | `copy.ts` |
| Draft A (one persistent illustrative draft) | `fixture.ts` |
| graph model (beats, edges, rows; pure) / stage (imperative SVG) / controller | `graph/model.ts` · `graph/stage.ts` · `graph/use-story-controller.ts` |
| Hero loop (pure timeline) / scene (map, trace, Coach walk) | `hero/timeline.ts` · `hero/scene.ts` |
| integration boundaries (waitlist, legal, help links) | `config.ts` |
| metadata + FAQPage JSON-LD (generated from the rendered FAQ) | `seo.ts` |

## Decisions
- **Coach**: the approved Coach Motion V2 pack drives the desktop Hero only (cues `watching` / `analyzing`, requested once the page is idle, never on Save-Data, phones or reduced motion). Phones show the approved still sprite at home; reduced motion shows the static still. The graph, payoff, trust and close use the approved Coach Web Pack stills moved by transform. The prototype's band/tile Coach engine was not ported.
- **Theme**: V3 ships the approved light design. The prototype never had a dark design and none was invented; there is no theme toggle. Landing V2 (dark + light) stays available behind `LANDING_VARIANT=v2` / `/lab/landing-v2`.
- **Hero motion toggle**: the Hero loop runs longer than five seconds, so a small "Pause motion" control sits in the product card footer (WCAG 2.2.2, the same reason Landing V2 had a Pause). Calm-on-focus of the waitlist is kept.
- **Contrast**: `--faint` text was darkened from `#7f8a87` to `#626d6a` (4.5:1 on every surface); the same grey stays as `--faint-line` for strokes.
- **Fonts**: Syne, Bricolage Grotesque, IBM Plex Sans / Mono are self-hosted by `next/font` (no request to Google at runtime).

## Blockers kept explicit (nothing is faked)
- **WAITLIST_BACKEND_BLOCKED** — no approved waitlist endpoint, provider or storage exists in the repo (Landing 01B / V2 only had an `onJoin` seam). `LANDING_CONFIG.joinWaitlist` is `null`; the forms validate and run as a clearly marked PREVIEW ("Preview only", success reads "Preview only, not sent.") and never claim a sign-up. Needed: an approved destination (a first-party route over a storage the project owns, or a provider approved under the dependency policy) and its configuration; then set `joinWaitlist` in `config.ts`.
- **LEGAL_COPY_BLOCKED** — no approved Privacy / Terms pages or URLs exist. `LANDING_CONFIG.legal.*` are `null`; the footer links nothing it cannot deliver. Needed: approved copy / URLs (public routes, plus proxy allowlist entries) and then set them in `config.ts`.
- Public collection (`collectionEnabled`) turns on only when an endpoint AND both legal pages exist.
- "Want to help shape D2KIRO?" actions (Share feedback / Follow development) have no approved destination: no button is rendered. Founding Supporter stays a quiet post-signup note ("Not open yet"); there is no payment UI.

## Content still needing sign-off (carried from V2, never presented as fact)
Draft A (Queen of Pain 84 / Puck 82 / Void Spirit 77; your games +6 / −1 / none; for you 88 / 83 / 77) is the same illustrative fixture as Landing V2's Counterfactual, labelled "Illustrative draft" everywhere, with "FIT is a recommendation score, not a win rate". Dota/content sign-off of those numbers is still a promotion gate. The modes copy says "built around All Pick and Captain's Mode; additional modes are not promised yet" and never says a mode is publicly supported.

## Performance (production build, headless Chromium, load + full-page scroll, transferred bytes)
| | V3 desktop 1440 | V2 desktop 1440 | V3 phone 390 | V2 phone 390 |
|---|---|---|---|---|
| total | 3.1 MB | 5.6 MB | 1.9 MB | 4.5 MB |
| requests | 69 | 122 | 54 | 108 |
| JS (compressed, whole app shell included) | 894 KB | 844 KB | 894 KB | 844 KB |
| Coach (stills + pack) | 1.7 MB (15 pack requests) | 1.9 MB | 0.43 MB (0 pack requests) | 0.85 MB |
| CLS | 0.002 | 0.027 | 0 | 0.001 |
| long tasks at 4x CPU | 15 / 1.5 s | 65 / 6.1 s | 28 / 2.4 s | 35 / 3.4 s |

JS grows by about 50 KB over V2 (graph stage, hero scene); weight and long tasks fall. Fixes made after the first measurement: the graph caption now reserves its tallest height (the stage no longer shifts between beats), and on phones the map canvas redraws only a band around the Mid lane (the rest is masked) instead of the whole tall column. axe (wcag2a/2aa/21a/21aa): 0 violations at 1440, 1024 and 390.

## Verification
- `bun test features/landing-v3` (model, fixture truth, copy honesty, SEO, boundaries, source hygiene), `bun run typecheck`, `npx eslint features/landing-v3 app/page.tsx`.
- Release spec: `playwright.landing-v3.config.ts` + `e2e-landing-v3/` over desktop 1440, desktop 1024, iPhone-class WebKit 390 and reduced motion. Run against a production build:
  `NEXT_DIST_DIR=.next-landing-v3 npx next build` (from `apps/web`, with `SESSION_SECRET` / `INTERNAL_AUTH_SECRET` set), then `LAB_PROD=1 LAB_PORT=3211 npx playwright test -c playwright.landing-v3.config.ts`.
- Real iPhone Safari smoke is still required before release: Syne typography (headless WebKit on Windows renders Syne oddly everywhere), sticky graph, Safari toolbar / viewport behaviour, waitlist form, reduced motion, Coach / map performance.

## Release notes
- `next build` downloads the four typefaces from Google Fonts at build time (like the existing Geist). One transient `next/font/google queries have exactly one entry` failure was seen locally and the retry passed: CI needs network access for the build. Vendoring the font files with `next/font/local` would remove that dependency if it ever matters.
- Landing V3 dist dirs (`apps/web/.next-landing-v3*/`) are gitignored. Tailwind v4 scans every non-ignored file, so an un-ignored dev dist feeds compiled CSS back into Tailwind and breaks the dev server.
- The project-level `reducedMotion` option of Playwright is not honoured by this Playwright / Chromium pairing; the spec asks for it explicitly with `page.emulateMedia`.
