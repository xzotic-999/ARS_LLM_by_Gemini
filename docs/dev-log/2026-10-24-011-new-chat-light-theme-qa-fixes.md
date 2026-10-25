# 2026-10-24-011 — QA & UI/UX Audit Report Fixes: «Новый чат» (Light Theme)

- **Date**: 2026-10-24
- **Task / Issue ID**: DEV-011 (New Chat Screen QA & UI/UX Audit Fixes — Reports 1–5)
- **Objective**: Resolve all 5 findings from the New Chat (Light Theme) QA & UI/UX Audit Report:
  1. **Report 1 (Major — Floating Input Bar & Visual Hierarchy)**: Removed the outer card wrapper and the duplicate internal heading `«Начать новый чат»` inside `src/components/ChatComposer.tsx`, transforming the composer into a clean single-surface Floating Input Bar below the `«Здравствуйте! 👋»` welcome heading.
  2. **Report 2 (Minor — Symmetric Quick Prompts Grid)**: Updated `src/components/QuickPrompts.tsx` to use a symmetric `grid grid-cols-2 md:grid-cols-3 gap-3 max-w-[680px] mx-auto` layout with 6 equal-column prompt items (`src/utils/dashboardLogic.ts`), eliminating uneven hanging chips.
  3. **Report 3 (Minor — Disabled «Экспорт .md» on Empty New Chat)**: Passed `exportSession={activeSession}` in `src/App.tsx` and added `disabled={!canExport}` (`messages.length === 0`) with `disabled:opacity-45 disabled:cursor-not-allowed` in `src/components/TopBar.tsx`.
  4. **Report 4 (Minor — Sidebar Quota Progress Bars)**: Updated `Дневной лимит` and `Месячный лимит` in `src/components/Sidebar.tsx` to `text-xs font-medium` and added thin linear `progressbar` indicators under each limit that shift color at `>=75%` and `>=90%` utilization.
  5. **Report 5 (Trivial — Model Parameters Tooltip & Label)**: Wrapped the Model Parameters button (`SlidersHorizontal`) in `src/components/ChatComposer.tsx` with an accessible hover/focus Tooltip (`role="tooltip"`, `aria-describedby="model-params-tooltip"`) and text label `Параметры`.

## Files Created / Modified
- **Created**:
  - `docs/dev-log/2026-10-24-011-new-chat-light-theme-qa-fixes.md`
- **Modified**:
  - `src/components/ChatComposer.tsx`
  - `src/components/QuickPrompts.tsx`
  - `src/utils/dashboardLogic.ts`
  - `src/components/TopBar.tsx`
  - `src/components/Sidebar.tsx`
  - `src/App.tsx`

## Verification Results
- `compile_applet` (`vite build`) -> **PASS**
- `npx tsx --test backend/src/services/backendLogic.test.ts src/utils/dashboardLogic.test.ts` -> **PASS** (22/22 unit tests passed)
