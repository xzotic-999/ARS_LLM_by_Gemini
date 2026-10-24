import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CHAT_LISTS,
  INITIAL_SESSIONS,
  INITIAL_TEMPLATES,
  INITIAL_DOCUMENTS,
  QUICK_PROMPTS,
  DEFAULT_MODEL_PARAMETERS,
  toggleThemeMode,
  getContrastRatio,
  isWcagCompliant,
  createCustomChatList,
  filterWorkspaceContent,
  submitChatPrompt,
  validateModelParameters,
  formatChatSessionAsMarkdown,
  getChatMarkdownFilename,
  createChatMarkdownDataUri,
  detectSpeechLanguage,
  stripMarkdownForSpeech,
  selectBestVoiceForLanguage,
} from './dashboardLogic';

test('Theme toggle transitions cleanly between light and dark mode', () => {
  assert.equal(toggleThemeMode('light'), 'dark');
  assert.equal(toggleThemeMode('dark'), 'light');
});

test('WCAG 2.1 contrast ratio verification for light and dark dashboard palettes', () => {
  // Light mode primary text (#111827) on white surface (#FFFFFF)
  const lightPrimaryRatio = getContrastRatio('#111827', '#FFFFFF');
  assert.ok(lightPrimaryRatio >= 15, `Expected high contrast >= 15, got ${lightPrimaryRatio}`);
  assert.equal(isWcagCompliant('#111827', '#FFFFFF', 'AAA'), true);

  // Light mode muted text (#4B5563) on sidebar background (#FAFAFC)
  assert.equal(isWcagCompliant('#4B5563', '#FAFAFC', 'AA'), true);

  // Primary button white text (#FFFFFF) on indigo accent (#4E46E5)
  const ctaRatio = getContrastRatio('#FFFFFF', '#4E46E5');
  assert.ok(ctaRatio >= 4.5, `Expected CTA contrast >= 4.5, got ${ctaRatio}`);
  assert.equal(isWcagCompliant('#FFFFFF', '#4E46E5', 'AA'), true);

  // Dark mode primary text (#F8FAFC) on dark slate canvas (#0B0F19)
  const darkPrimaryRatio = getContrastRatio('#F8FAFC', '#0B0F19');
  assert.ok(darkPrimaryRatio >= 15, `Expected dark mode contrast >= 15, got ${darkPrimaryRatio}`);
  assert.equal(isWcagCompliant('#F8FAFC', '#0B0F19', 'AAA'), true);
});

test('Custom chat list creation validates empty, overlong, and duplicate names', () => {
  const emptyResult = createCustomChatList(INITIAL_CHAT_LISTS, '   ');
  assert.equal(emptyResult.ok, false);

  const duplicateResult = createCustomChatList(INITIAL_CHAT_LISTS, 'избранное');
  assert.equal(duplicateResult.ok, false);

  const validResult = createCustomChatList(INITIAL_CHAT_LISTS, 'Аналитика', '#8B5CF6');
  assert.equal(validResult.ok, true);
  if (validResult.ok) {
    assert.equal(validResult.lists.length, INITIAL_CHAT_LISTS.length + 1);
    assert.equal(validResult.created.label, 'Аналитика');
    assert.equal(validResult.created.colorHex, '#8B5CF6');
  }
});

test('Workspace search and category filter returns matching sessions, templates, and documents', () => {
  const codeOnly = filterWorkspaceContent({
    sessions: INITIAL_SESSIONS,
    templates: INITIAL_TEMPLATES,
    documents: INITIAL_DOCUMENTS,
    query: '',
    categoryId: 'code',
  });
  assert.equal(codeOnly.sessions.length, 1);
  assert.equal(codeOnly.sessions[0].id, 'sess-1');

  const queryMatch = filterWorkspaceContent({
    sessions: INITIAL_SESSIONS,
    templates: INITIAL_TEMPLATES,
    documents: INITIAL_DOCUMENTS,
    query: 'SQL',
    categoryId: null,
  });
  assert.equal(queryMatch.sessions.length, 1);
  assert.equal(queryMatch.templates.length, 1);
});

test('Chat composer submission rejects empty input and creates or appends messages with quick prompt replies', () => {
  const emptySubmit = submitChatPrompt({
    existingSession: null,
    promptText: '   ',
  });
  assert.equal(emptySubmit.ok, false);

  const quickPrompt = QUICK_PROMPTS[1]; // Анализировать код
  const newChatResult = submitChatPrompt({
    existingSession: null,
    promptText: quickPrompt.promptText,
    attachments: ['auth-service.ts'],
  });
  assert.equal(newChatResult.ok, true);
  if (newChatResult.ok) {
    assert.equal(newChatResult.session.messages.length, 2);
    assert.equal(newChatResult.session.messages[0].role, 'user');
    assert.deepEqual(newChatResult.session.messages[0].attachments, ['auth-service.ts']);
    assert.equal(newChatResult.session.messages[1].role, 'assistant');
    assert.ok(newChatResult.session.messages[1].content.includes('verifySessionToken'));

    // Appending a follow-up message to the same session
    const followUp = submitChatPrompt({
      existingSession: newChatResult.session,
      promptText: 'Добавь тест для истёкшего токена',
    });
    assert.equal(followUp.ok, true);
    if (followUp.ok) {
      assert.equal(followUp.session.messages.length, 4);
    }
  }
});

test('Model parameters validation enforces temperature and token limits', () => {
  assert.equal(validateModelParameters(DEFAULT_MODEL_PARAMETERS).valid, true);
  assert.equal(
    validateModelParameters({ ...DEFAULT_MODEL_PARAMETERS, temperature: 1.5 }).valid,
    false
  );
  assert.equal(
    validateModelParameters({ ...DEFAULT_MODEL_PARAMETERS, maxTokens: 100 }).valid,
    false
  );
  assert.equal(
    validateModelParameters({ ...DEFAULT_MODEL_PARAMETERS, systemPrompt: '  ' }).valid,
    false
  );
});

test('Markdown export formats chat thread with metadata, messages, attachments, and safe filename', () => {
  const session = {
    ...INITIAL_SESSIONS[0],
    messages: [
      {
        ...INITIAL_SESSIONS[0].messages[0],
        attachments: ['schema.sql'],
      },
      INITIAL_SESSIONS[0].messages[1],
    ],
  };

  const filename = getChatMarkdownFilename(session);
  assert.ok(filename.endsWith('.md'), `Expected .md extension, got ${filename}`);
  assert.ok(filename.includes('postgresql'), `Expected slugified title in filename, got ${filename}`);

  const md = formatChatSessionAsMarkdown(session);
  assert.ok(md.startsWith(`# ${session.title}`));
  assert.ok(md.includes('### Сотрудник (12:04)'));
  assert.ok(md.includes('### ARS LLM (12:05)'));
  assert.ok(md.includes('**Вложения**: `schema.sql`'));

  const dataUri = createChatMarkdownDataUri(session);
  assert.ok(dataUri.startsWith('data:text/markdown;charset=utf-8,'));
  assert.equal(decodeURIComponent(dataUri.replace('data:text/markdown;charset=utf-8,', '')), md);
});

test('Text-to-Speech language detection, Markdown stripping, and voice matching work accurately', () => {
  const ruDetected = detectSpeechLanguage('Анализ модуля завершён. Ключевые рекомендации по безопасности.');
  assert.equal(ruDetected.langCode, 'ru-RU');
  assert.equal(ruDetected.shortLabel, 'RU');

  // Russian prose containing an embedded TypeScript code block should still detect Russian
  const mixedCodeAndRu = detectSpeechLanguage(
    'Рекомендация:\n```typescript\nexport function verifyToken(token: string) { return Boolean(token); }\n```'
  );
  assert.equal(mixedCodeAndRu.langCode, 'ru-RU');

  const enDetected = detectSpeechLanguage('Here is the architectural summary for the authentication microservice.');
  assert.equal(enDetected.langCode, 'en-US');
  assert.equal(enDetected.shortLabel, 'EN');

  const kzDetected = detectSpeechLanguage('Сәлеметсіз бе! Жоба бойынша қысқаша есеп дайын.');
  assert.equal(kzDetected.langCode, 'kk-KZ');
  assert.equal(kzDetected.shortLabel, 'KZ');

  const stripped = stripMarkdownForSpeech('### Заголовок\n- **Пункт 1**: `код` и\n```ts\nconst x = 1;\n```\nтекст.');
  assert.equal(stripped, 'Заголовок Пункт 1: код и текст.');

  const mockVoices = [
    { name: 'English US', lang: 'en-US', default: true },
    { name: 'Russian', lang: 'ru-RU', default: false },
  ];
  const matchedRu = selectBestVoiceForLanguage(mockVoices, 'ru-RU');
  assert.equal(matchedRu?.name, 'Russian');
});

test('Backend conversation mapping and SSE streaming parser work accurately', async () => {
  const { mapBackendConversationToSession } = await import('./dashboardLogic');
  const { parseSseLines, isValidCorporateEmail } = await import('../services/api');

  // 1. Validate corporate emails including .local bootstrap domain
  assert.equal(isValidCorporateEmail('admin@ars_llm.local'), true);
  assert.equal(isValidCorporateEmail('employee@company.kz'), true);
  assert.equal(isValidCorporateEmail('invalid-email'), false);

  // 2. Map backend conversation and messages into UI ChatSession
  const session = mapBackendConversationToSession(
    {
      id: 42,
      title: 'Аудит архитектуры безопасности',
      created_at: '2026-10-23T10:00:00.000Z',
      last_message_at: '2026-10-23T10:05:00.000Z',
    },
    [
      {
        id: 101,
        conversation_id: 42,
        role: 'system',
        text: 'Untrusted or internal system note',
        created_at: '2026-10-23T10:00:00.000Z',
      },
      {
        id: 102,
        conversation_id: 42,
        role: 'user',
        text: 'Проверь настройки сессии.',
        created_at: '2026-10-23T10:01:00.000Z',
      },
      {
        id: 103,
        conversation_id: 42,
        role: 'assistant',
        text: 'Сессии используют HttpOnly cookie.',
        created_at: '2026-10-23T10:02:00.000Z',
      },
    ]
  );

  assert.equal(session.id, 'conv-42');
  assert.equal(session.conversationId, 42);
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].role, 'user');
  assert.equal(session.messages[1].role, 'assistant');

  // 3. Parse SSE stream chunks (role delta, content delta, [DONE], and partial buffer)
  const rawSse = [
    'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
    '',
    'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Привет"},"finish_reason":null}]}',
    '',
    'data: {"id":"1","choices":[{"index":0,"delta":{"content":", коллега!"},"finish_reason":null}]}',
    '',
    'data: [DONE]',
    '',
    'data: {"partial":',
  ].join('\n');

  const parsed = parseSseLines(rawSse);
  assert.equal(parsed.events.length, 3);
  assert.deepEqual(parsed.events[0], { type: 'delta', content: 'Привет' });
  assert.deepEqual(parsed.events[1], { type: 'delta', content: ', коллега!' });
  assert.deepEqual(parsed.events[2], { type: 'done' });
  assert.equal(parsed.remainingBuffer, 'data: {"partial":');

  // 4. Parse SSE error event
  const errorSse = 'event: error\ndata: {"error":{"message":"Chat generation failed."}}\n\n';
  const parsedErr = parseSseLines(errorSse);
  assert.equal(parsedErr.events.length, 1);
  assert.deepEqual(parsedErr.events[0], {
    type: 'error',
    message: 'Chat generation failed.',
  });
});
