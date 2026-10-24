# 2026-10-24-010 — QA & UI/UX Audit Report Fixes (Reports 1–7)

- **Date**: 2026-10-24
- **Task / Issue ID**: DEV-010 (QA & UI/UX Audit Report Resolution)
- **Objective**: Resolve all 7 findings from the QA & UI/UX Audit Report:
  1. **Report 1 (Blocker — Prompt Input Area Viewport Containment)**: Fix root flex layout (`h-screen overflow-hidden`, `min-h-0`, `overflow-hidden` on active chat `main`), compact follow-up composer spacing, and always-visible Send button so the prompt input area is never clipped at the viewport bottom.
  2. **Report 2 (Major — Markdown Rendering)**: Add `src/components/MarkdownContent.tsx` to parse `**bold**`, `*italic*`, `` `code` ``, fenced code blocks ```` ``` ````, ordered lists `<ol><li>`, unordered lists `<ul><li>`, headings, blockquotes, and links into semantic HTML with hierarchy and indentation.
  3. **Report 3 (Major — Sidebar Footer Quotas & Profile Pinned)**: Isolate sidebar navigation, chat lists, and recent dialogs inside an independent `flex-1 min-h-0 overflow-y-auto` scroll container and pin the Quota Usage Card and User Profile Footer at the bottom with `mt-auto shrink-0`.
  4. **Report 4 (Minor — Duplicate Dialog Header)**: Remove the duplicate `<h2>{session.title}</h2>` from the inner chat header in `ChatThreadView.tsx`, keeping the compact single-line metadata bar (`[← Назад] Обновлено: ... · Сообщений: ...` and `[★]`).
  5. **Report 5 (Minor — Duplicate Shortcut Indicator `[K]` in Sidebar Header)**: Remove the `[K]`-looking button next to `<ArsLogo />` in the sidebar header, leaving the unified search input `[ 🔍 Поиск   Ctrl + K ]`.
  6. **Report 6 (Minor — Stray Space in TTS Button Label `Озвучить (RU)`)**: Render `{`Озвучить (${localeBadge})`}` and `{`Стоп (${localeBadge})`}` as single trimmed strings so no extra space appears before `)`.
  7. **Report 7 (Trivial — Theme Switcher Control)**: Replace the text+icons `Тема ☀ ☾` block in `TopBar.tsx` with an interactive `role="switch"` toggle control with tooltip `title="Сменить тему"`.

## Files Created / Modified
- **Created**:
  - `src/components/MarkdownContent.tsx`
  - `docs/dev-log/2026-10-24-010-qa-ui-ux-audit-fixes.md`
- **Modified**:
  - `src/App.tsx`
  - `src/components/ChatThreadView.tsx`
  - `src/components/ChatComposer.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/TopBar.tsx`

## Verification Results
- `compile_applet` (`vite build`) -> **PASS**
- `npx tsx --test backend/src/services/backendLogic.test.ts src/utils/dashboardLogic.test.ts` -> **PASS** (22/22 unit tests passed)
