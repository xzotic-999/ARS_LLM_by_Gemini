# DEV-012: Полноценный сервер `server.ts` для опубликованного домена (`ars-llm.ai.studio`), чтение `.xlsx` и кастомизация скроллбаров

**Дата:** 2026-10-25  
**Статус:** Выполнено

## Причина бага на `ars-llm.ai.studio` и в режиме инкогнито
1. **На домене `ars-llm.ai.studio` работала старая статическая сборка (`last-modified: 00:08:44 GMT`, `index-DvcrBiLt.js`):**
   - В первой опубликованной сборке отсутствовал `server.ts` и скрипт `"start": "node server.ts"`, поэтому `POST /api/v1/chat/completions` на `ars-llm.ai.studio` возвращал статический `index.html`, а фронтенд интерпретировал пустой SSE-поток как `«Генерация остановлена.»`.
   - Кроме того, при сборке контейнера в облаке файлы `.env` (из-за `.gitignore`) и `.aistudio/` не включаются в контейнер. Для гарантированной работы `node server.ts` в облачном контейнере серверный конфиг туннеля сохранен в `backend/src/config/tunnelRuntime.json` (читается только на сервере через `fs.readFileSync` в `server.ts` и никогда не импортируется в клиентский бандл).
2. **Несоответствие стандартного скроллбара (ползунка) дизайну:**
   - В Windows Chrome стандартный скроллбар имел широкую белую полосу прокрутки со стрелками вверх/вниз и располагался прямо рядом с карточками сообщений внутри узкого контейнера `max-w-[820px]`.

## Выполненные изменения
- **`/src/index.css` и `/src/components/ChatThreadView.tsx` (Дизайн ползунка прокрутки):**
  - Заданы `color-scheme: light` и `:root.dark { color-scheme: dark }`.
  - Стилизованы тонкие (`6px`) кастомные ползунки (`::-webkit-scrollbar`, `scrollbar-width: thin`) с прозрачным треком (`background: transparent`), скругленным ползунком (`border-radius: 9999px`) под светлую и темную тему и полным скрытием системных кнопок-стрелок (`::-webkit-scrollbar-button { display: none }`).
  - Контейнер прокрутки ленты сообщений (`messagesLogRef`) в `ChatThreadView.tsx` расширен на всю ширину рабочей области (`w-full`), чтобы ползунок располагался аккуратно у правого края экрана, а не посреди страницы.
- **`/server.ts`, `/package.json`, `/backend/src/config/tunnelRuntime.json`:**
  - Настроен full-stack сервер `server.ts` (`"dev": "tsx server.ts"`, `"start": "node server.ts"`), использующий `res.on('close')` для корректного жизненного цикла SSE-потока и серверный фоллбэк `backend/src/config/tunnelRuntime.json`.
- **`/src/utils/fileExtractor.ts`, `/src/components/ChatComposer.tsx`, `/src/App.tsx`:**
  - Извлечение текста и табличных ячеек из `.xlsx`, `.docx`, `.pptx`, `.txt`, `.csv`, `.md`, `.json`.
