# Development Journal — 2026-10-23-001: Reference UI Baseline, Audit, and Integration Readiness

## 1. Task and Objective
- **Objective**: Establish the pixel-accurate, WCAG-compliant **ARS LLM** reference dashboard interface (including light/dark theme support, mobile drawer navigation, Markdown chat export, Text-to-Speech playback with language detection, and unit tests), perform a full architectural audit of the repository, and document the integration plan and required contracts for connecting the reference UI to the main production project (`D:\projects\ARS_LLM`).
- **Scope**:
  - **Implemented & Tested**: Reference UI components, pure state/utility logic, unit test suite (`8/8` passing), TypeScript type-checking (`npm run lint`), production Vite build (`npm run build`), and automated browser checks via `playwright-cli`.
  - **Audited & Planned (Awaiting Main Project Files)**: Integration adapter specification for connecting the reference UI to the production backend (`D:\projects\ARS_LLM`) for authentication, chat history, SSE streaming, and user quotas.

---

## 2. Files Changed
During the baseline reference UI implementation and audit:

- `/metadata.json` — Set application name (`ARS LLM Workspace`) and description.
- `/index.html` — Set Russian language attribute (`lang="ru"`), page title (`ARS LLM — Рабочее пространство ИИ`), OpenGraph metadata, and loaded `Plus Jakarta Sans` and `JetBrains Mono` fonts.
- `/src/index.css` — Configured Tailwind CSS v4 `@custom-variant dark (&:where(.dark, .dark *));`, base font variables, `prefers-reduced-motion`-compliant `.theme-transition` rules, and WCAG `.focus-ring:focus-visible` keyboard focus styles.
- `/src/utils/dashboardLogic.ts` — Created decoupled pure logic, TypeScript interfaces, WCAG 2.1 relative luminance and contrast ratio calculators, custom chat list validator, workspace search/category filter, chat prompt handler, model parameter validator, Markdown thread exporter (`formatChatSessionAsMarkdown`, `getChatMarkdownFilename`, `createChatMarkdownDataUri`), and TTS language detection / Markdown speech sanitizer (`detectSpeechLanguage`, `stripMarkdownForSpeech`, `selectBestVoiceForLanguage`), along with baseline in-memory seed data.
- `/src/utils/dashboardLogic.test.ts` — Created 8 deterministic unit tests using `node:test` and `node:assert/strict` covering all pure functions in `src/utils/dashboardLogic.ts`.
- `/src/components/ArsLogo.tsx` — Implemented the faceted geometric `ARS LLM` SVG logo mark using per-instance `React.useId()` gradient IDs so both desktop and mobile drawer instances render visibly without SVG `<defs>` collisions.
- `/src/components/Sidebar.tsx` — Implemented the responsive, collapsible left navigation sidebar (`Чаты`, `Проекты`, `Шаблоны`, `Документы`, `История`), search bar (`Ctrl + K`), categorized chat lists (`СПИСОК ЧАТОВ`), inline custom list creation form (`+ Новый список`), and employee profile footer.
- `/src/components/TopBar.tsx` — Implemented the top header bar with mobile drawer toggle, active view title, segmented theme switcher (`Тема`: Светлая / Тёмная), Markdown export download link (`Экспорт .md`), and primary `+ Новый чат` button.
- `/src/components/ChatComposer.tsx` — Implemented the `Начать новый чат` card with keyboard submission (`Enter` / `Shift+Enter`), file attachment selection, simulated voice dictation toggle, and triggers for the Prompt Library and Model Parameters modals.
- `/src/components/QuickPrompts.tsx` — Implemented the `Выберите быстрый запрос` `3 + 2` pill grid with semantic icon badges.
- `/src/components/ChatThreadView.tsx` — Implemented the active conversation view with message feed (`role="log"`), copy-to-clipboard button, favorite (`Star`) toggle, Text-to-Speech playback button (`Озвучить` / `Стоп`) with automatic language badge (`ru-RU`, `kk-KZ`, `en-US`), and compact follow-up composer.
- `/src/components/WorkspaceModalsAndViews.tsx` — Implemented `WorkspaceSectionView` (tables/cards for `Проекты`, `Шаблоны`, `Документы`, `История`, and category filters), `PromptLibraryModal`, `ModelParamsModal`, and `CommandSearchModal`.
- `/src/App.tsx` — Assembled the main application layout, state orchestration, `.dark` root class synchronization, and `Ctrl + K` keyboard shortcut listener.
- `/docs/dev-log/2026-10-23-001-reference-ui-audit-and-baseline.md` — Created this development journal report.

---

## 3. Implementation Details
1. **Per-Instance SVG Gradient IDs (`src/components/ArsLogo.tsx`)**:
   - Because `Sidebar.tsx` mounts the sidebar markup in both a desktop wrapper (`hidden md:block`) and a mobile drawer wrapper (`md:hidden`), static `<linearGradient id="...">` attributes caused the mobile drawer SVG to reference the hidden desktop `<defs>`, rendering the logo invisible in mobile mode. Using sanitized `React.useId()` suffixes (`ars-grad-left-${uid}`) ensures each SVG instance references its own visible `<defs>`.
2. **Decoupled Pure Logic (`src/utils/dashboardLogic.ts`)**:
   - All data transformations (WCAG contrast math, custom list validation, search filtering, Markdown serialization, and TTS language detection) are pure functions with zero DOM dependencies, enabling fast execution in `node:test` and straightforward replacement of in-memory seed data with production API adapters.
3. **Resilient Text-to-Speech State (`src/components/ChatThreadView.tsx`)**:
   - Combines the native Web Speech API (`window.speechSynthesis` and `SpeechSynthesisUtterance`) with a fallback reading timer so environments without OS speech synthesis voices (such as headless Linux containers) still maintain deterministic playback state transitions (`aria-pressed="true"`, live status announcement, and manual stop).

---

## 4. Verification
The following commands and checks were executed and observed in `/app/applet`:

1. **Unit Tests (`tsx --test`)**:
   - **Command**: `./node_modules/.bin/tsx --test src/utils/dashboardLogic.test.ts`
   - **Actual Result**: Exit code `0` — `tests 8 | pass 8 | fail 0` (`279.27ms`). Verified theme toggling, WCAG 2.1 AA/AAA contrast ratios, custom chat list validation, workspace search/category filtering, chat prompt submission, model parameter validation, Markdown `.md` export formatting/data URI encoding, and TTS language detection (`ru-RU`, `kk-KZ`, `en-US`).
2. **TypeScript Type Check (`npm run lint`)**:
   - **Command**: `npm run lint` (`tsc --noEmit`)
   - **Actual Result**: Exit code `0` with zero type or syntax errors.
3. **Production Build (`npm run build`)**:
   - **Command**: `npm run build` (`vite build`)
   - **Actual Result**: Exit code `0` — `✓ 1668 modules transformed`, built `dist/index.html` (`1.36 kB`), `dist/assets/index-gNqFkllA.css` (`40.11 kB`), and `dist/assets/index-Bkf27EWd.js` (`530.29 kB`) in `447ms`.
4. **Browser & Accessibility Verification (`playwright-cli`)**:
   - Verified desktop light mode (`1440×900`), desktop dark mode (`1440×900`), mobile viewport (`390×844`) with open navigation drawer confirming visible `ARS LLM` SVG logo, active chat thread view with `Экспорт .md` link in `TopBar`, and active TTS playback state (`Стоп (RU)`, `aria-pressed="true"`). Console reported `0` errors and `0` warnings.

---

## 5. Known Issues and Risks
1. **Main Project (`D:\projects\ARS_LLM`) Not Yet Mounted in Sandbox**:
   - **Untested / Pending**: Integration with the production backend located at `D:\projects\ARS_LLM` has not been executed yet because the local directory is external to this container environment and its source files/API contracts have not yet been provided.
2. **In-Memory Demo State**:
   - Chat sessions (`INITIAL_SESSIONS`), projects (`INITIAL_PROJECTS`), templates (`INITIAL_TEMPLATES`), documents (`INITIAL_DOCUMENTS`), and user profile (`Сотрудник` / `employee@company.kz`) are currently held in React state and reset on full page reload until wired to the production API and authentication store.
3. **Simulated Voice Input (`ChatComposer.tsx`)**:
   - Clicking `Голосовой ввод` currently populates a sample prompt string rather than streaming microphone audio to an ASR endpoint.
4. **Vite 8 Config Warning**:
   - `vite build` emits a non-blocking warning that `__dirname` in `vite.config.ts` will require `import.meta.dirname` when Vite's native config loader becomes default in a future major version.

---

## 6. Architecture and API Impact
- **Routes & Backend**: No backend routes, database schemas, authentication flows, SSE streams, or quota enforcement rules were modified in this task.
- **Frontend Readiness**: All UI components accept structured props and callback handlers, isolating state management in `src/App.tsx` and pure helpers in `src/utils/dashboardLogic.ts` so they can be connected to the production API client without restructuring the component tree.

---

## 7. Next Steps
1. Receive the required files/contracts from `D:\projects\ARS_LLM`:
   - Frontend `package.json` and `vite.config.ts`.
   - Existing API client / SSE streaming module (`src/api/*` or `src/services/*`).
   - Authentication context/store (`AuthContext` / user profile & quota types).
   - Main application entry point and router (`src/App.tsx`).
2. Implement the adapter layer connecting `src/App.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `ChatComposer.tsx`, and `ChatThreadView.tsx` to the real backend endpoints (auth, chat history, SSE streaming, and quotas).
3. Run unit tests, `tsc --noEmit`, `vite build`, and browser verification, then record report `2026-10-23-002-...` in `docs/dev-log/`.

---

## 8. Git Reference
- **Branch**: Not available in sandbox (`git rev-parse --abbrev-ref HEAD` returned `no-git-branch`; `.git` metadata is not initialized in the container workspace).
- **Commit SHA**: Not available in sandbox (`no-git-sha`).
