# DEV-012: Полноценный сервер `server.ts` для опубликованного домена (`ars-llm.ai.studio`) и чтение вложений `.xlsx`/`.docx`

**Дата:** 2026-10-25  
**Статус:** Выполнено

## Причина бага на компьютере друга (`ars-llm.ai.studio`)
1. **Отсутствие `server.ts` и скрипта `"start": "node server.ts"` при публикации:**
   - Ранее серверный обработчик `POST /api/v1/chat/completions` находился внутри `vite.config.ts` (`configureServer`), который запускается только в режиме разработки (`vite`), но **не запускается** в опубликованном production-контейнере (`ars-llm.ai.studio`).
   - В результате на `ars-llm.ai.studio` запрос `POST /api/v1/chat/completions` попадал на статический SPA-фоллбэк и возвращал `200 OK` с HTML-кодом `index.html` (`Content-Type: text/html`).
2. **Обработка HTML-ответа в `chatApi.streamCompletions` как пустого потока:**
   - Метод `streamCompletions` в `src/services/api.ts` не проверял заголовок `Content-Type: text/html`. Получив `index.html`, парсер SSE не находил ни одной строки `data:` и вызывал `onDone()` с пустой строкой `accumulatedReply = ""`, из-за чего `src/App.tsx` выводил заглушку `«Генерация остановлена.»`.
3. **Исключение `.env` при публикации из-за `.gitignore`:**
   - Так как `.env` добавлен в `.gitignore`, при публикации контейнера настройки туннеля также дублируются в серверный конфигурационный файл `.aistudio/runtime-config.json`, который читается исключительно на сервере в `server.ts`.
4. **Извлечение текста из прикрепленных файлов (`ОБРАЗЕЦ СПРАВКИ.xlsx`):**
   - Ранее в `ChatComposer.tsx` передавалось только имя файла (`file.name`) без извлечения таблиц и текста внутри `.xlsx` / `.docx` / `.txt` / `.csv`.

## Выполненные изменения
- **`/server.ts` и `/package.json`**:
  - Создан единый full-stack сервер `server.ts` на Express (порт `3000`, `"dev": "tsx server.ts"`, `"start": "node server.ts"`).
  - В режиме разработки `server.ts` подключает Vite middleware, а в режиме `production` (`ars-llm.ai.studio`) раздает собранную статику из `dist/` и обрабатывает `GET /api/v1/health` и `POST /api/v1/chat/completions` с серверным промптом из `Instruction.md` и подключением к FreeLLMAPI через VS Code Dev Tunnel.
- **`/src/services/api.ts`**:
  - В `chatApi.streamCompletions` добавлена проверка `contentType.includes('text/html')` и контроль получения токенов (`receivedAnyToken`), чтобы при недоступности туннеля или неверном ответе шлюза выводилось понятное сообщение об ошибке с кнопкой «Повторить», а не `«Генерация остановлена.»`.
- **`/src/utils/fileExtractor.ts`, `/src/components/ChatComposer.tsx`, `/src/App.tsx`**:
  - Реализовано извлечение текста и табличных данных из прикрепленных файлов `.xlsx`, `.docx`, `.pptx` (разбор ZIP Central Directory, `xl/sharedStrings.xml`, `xl/worksheets/sheet*.xml`, `word/document.xml` через `DecompressionStream('deflate-raw')`), а также `.txt`, `.csv`, `.json`, `.md`.
