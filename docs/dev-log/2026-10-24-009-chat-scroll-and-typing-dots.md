# 2026-10-24-009 — Chat Thread Scroll Containment & Animated 3-Dots Typing Indicator

- **Date**: 2026-10-24
- **Task / Issue ID**: DEV-009 (Chat Viewport Scroll Containment & Typing Dots Indicator)
- **Objective**:
  1. Prevent the chat thread container (`main#main-workspace > div`) from expanding the full page height as messages accumulate; enforce internal vertical scrolling within the message feed while keeping the header and bottom composer pinned within the viewport.
  2. Replace the text label `"Генерация ответа..."` / `"печатает..."` during assistant response generation with an intuitive animated 3-dots typing indicator (`animate-bounce` staggered dots).

## Files Created / Modified / Deleted
- **Modified**:
  - `src/App.tsx` — Added `h-screen overflow-hidden` and `min-h-0` flex constraints on the outer layout frame, right workspace column, and `main#main-workspace`.
  - `src/components/ChatThreadView.tsx` — Added `flex-1 min-h-0 overflow-hidden` on the chat container, `min-h-0 overflow-y-auto` + auto-scroll ref (`messagesLogRef`) on the message log, and replaced `'Генерация ответа...'` with an animated 3-dots indicator while waiting for the first streaming token.
- **Created**:
  - `docs/dev-log/2026-10-24-009-chat-scroll-and-typing-dots.md` — This development log entry.

## Verification Results
- `compile_applet` (`vite build`) -> **PASS**
- `npx tsx --test backend/src/services/backendLogic.test.ts src/utils/dashboardLogic.test.ts` -> **PASS** (22/22 unit tests passed)
