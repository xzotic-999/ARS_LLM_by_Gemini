export type ThemeMode = 'light' | 'dark';

export type NavSectionId =
  | 'chats'
  | 'projects'
  | 'templates'
  | 'documents'
  | 'history'
  | 'quotas'
  | 'admin';

export interface ChatListCategory {
  id: string;
  label: string;
  colorHex: string;
  isStar?: boolean;
  count: number;
}

export type QuickPromptIconType = 'image' | 'code' | 'summarize' | 'plan' | 'idea';

export interface QuickPrompt {
  id: string;
  label: string;
  iconType: QuickPromptIconType;
  promptText: string;
  categoryId: string;
  assistantReply: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  promptText: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  department: string;
  updatedAt: string;
  chatCount: number;
  status: 'active' | 'review' | 'archived';
}

export interface DocumentItem {
  id: string;
  title: string;
  format: 'PDF' | 'DOCX' | 'XLSX' | 'MD';
  sizeLabel: string;
  updatedAt: string;
  indexed: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: string[];
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  conversationId?: number;
  title: string;
  categoryId: string;
  updatedAt: string;
  messages: ChatMessage[];
  starred?: boolean;
}

export interface ModelParameters {
  model: 'ars-llm-pro-2.5' | 'ars-llm-fast-2.0' | 'ars-llm-coder-2.5';
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export const INITIAL_CHAT_LISTS: ChatListCategory[] = [
  { id: 'favorites', label: 'Избранное', colorHex: '#F59E0B', isStar: true, count: 3 },
  { id: 'code', label: 'Код', colorHex: '#4A90E2', count: 5 },
  { id: 'marketing', label: 'Маркетинг', colorHex: '#34C759', count: 4 },
  { id: 'archive', label: 'Архив', colorHex: '#EF4444', count: 8 },
  { id: 'deleted', label: 'Удалённые', colorHex: '#F97316', count: 2 },
];

export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: 'create-image',
    label: 'Создать изображение',
    iconType: 'image',
    categoryId: 'marketing',
    promptText: 'Сгенерируй концепт иллюстрации для презентации нового облачного продукта компании в минималистичном корпоративном стиле.',
    assistantReply:
      'Готово! Вот детальное ТЗ и промпт для генерации корпоративной иллюстрации:\n\n1. **Композиция**: Изометрическая схема облачной архитектуры с чистыми геометрическими узлами.\n2. **Палитра**: Индиго (#4F46E5), светлый сланец (#F8FAFC) и мягкие акценты бирюзового.\n3. **Освещение**: Мягкий студийный свет с плавными тенями для презентационного слайда 16:9.',
  },
  {
    id: 'analyze-code',
    label: 'Анализировать код',
    iconType: 'code',
    categoryId: 'code',
    promptText: 'Проверь наш модуль авторизации TypeScript на потенциальные уязвимости безопасности, утечки памяти и соответствие стандартам.',
    assistantReply:
      'Анализ модуля завершён. Ключевые рекомендации:\n\n```typescript\n// Используйте строгую проверку сроков жизни токена и ротацию ключей\nexport function verifySessionToken(token: string, nowMs = Date.now()): boolean {\n  if (!token || token.trim().length < 32) return false;\n  return nowMs > 0;\n}\n```\n\n- **Безопасность**: Храните refresh-токены в `HttpOnly; Secure; SameSite=Strict` cookies.\n- **Надёжность**: Добавьте ограничение частоты запросов (rate limiting) на эндпоинт обновления.',
  },
  {
    id: 'summarize-text',
    label: 'Кратко пересказать текст',
    iconType: 'summarize',
    categoryId: 'favorites',
    promptText: 'Сделай краткую выжимку из квартального отчёта на 5 ключевых пунктов для совета директоров.',
    assistantReply:
      'Краткое резюме квартального отчёта:\n\n1. **Выручка**: Рост на 18.4% к прошлому кварталу за счёт корпоративных подписок.\n2. **Удержание клиентов (NRR)**: 114.2% по ключевому сегменту B2B.\n3. **Операционные расходы**: Снижены на 6.1% благодаря оптимизации облачной инфраструктуры.\n4. **Запуск ARS LLM**: Внедрено в 14 департаментах (экономия 4.5 часов в неделю на сотрудника).\n5. **Фокус на следующий квартал**: Расширение интеграции с внутренним документооборотом.',
  },
  {
    id: 'make-plan',
    label: 'Составить план',
    iconType: 'plan',
    categoryId: 'marketing',
    promptText: 'Составь пошаговый план запуска внутреннего портала знаний для 500 сотрудников на 4 недели.',
    assistantReply:
      'Пошаговый план запуска на 4 недели:\n\n- **Неделя 1 — Аудит и архитектура**: Инвентаризация регламентов, настройка ролей доступа.\n- **Неделя 2 — Пилотная группа**: Тестирование с 30 сотрудниками из ИТ и HR, сбор обратной связи.\n- **Неделя 3 — Обучение**: Проведение 3 практических воркшопов и публикация видеоинструкций.\n- **Неделя 4 — Полный запуск**: Открытие доступа всем 500 сотрудникам и мониторинг метрик.',
  },
  {
    id: 'suggest-idea',
    label: 'Предложить идею',
    iconType: 'idea',
    categoryId: 'favorites',
    promptText: 'Предложи 3 идеи автоматизации рутинных задач для отдела клиентской поддержки с помощью ARS LLM.',
    assistantReply:
      'Три высокоэффективных сценария автоматизации поддержки:\n\n1. **Авто-классификация обращений**: Мгновенная маршрутизация тикетов по приоритету и тональности.\n2. **Черновики ответов по базе знаний**: Генерация точного ответа со ссылками на документацию за 2 секунды.\n3. **Ежедневная сводка инцидентов**: Автоматический отчёт о повторяющихся вопросах для продуктовой команды.',
  },
  {
    id: 'prepare-report',
    label: 'Подготовить отчёт',
    iconType: 'summarize',
    categoryId: 'marketing',
    promptText: 'Составь структуру еженедельного отчёта руководителя проекта с ключевыми KPI, рисками и статусом задач.',
    assistantReply:
      'Структура еженедельного отчёта руководителя проекта:\n\n1. **Сводка статуса (Executive Summary)**: Общий прогресс и соблюдение сроков.\n2. **Ключевые KPI**: Выполнение спринта, загрузка команды, бюджет.\n3. **Риски и блокеры**: Топ-3 риска и меры по их устранению.',
  },
];

export const INITIAL_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tpl-code-review',
    title: 'Аудит кода и рефакторинг',
    category: 'Код',
    description: 'Проверка алгоритмической сложности, типизации TypeScript и безопасности.',
    promptText: 'Проведи детальный код-ревью следующего фрагмента кода, укажи узкие места производительности и предложи исправленный вариант:',
  },
  {
    id: 'tpl-exec-summary',
    title: 'Резюме встречи (Meeting Notes)',
    category: 'Документы',
    description: 'Структурирование стенограммы совещания в список решений и задач с дедлайнами.',
    promptText: 'Выдели из текста протокола встречи: 1) Принятые решения, 2) Задачи с ответственными, 3) Открытые вопросы:',
  },
  {
    id: 'tpl-marketing-campaign',
    title: 'Концепт продуктового релиза',
    category: 'Маркетинг',
    description: 'Подготовка анонса для клиентов, внутренних команд и пресс-релиза.',
    promptText: 'Разработай структуру анонса новой функции продукта для корпоративных клиентов с акцентом на измеримую пользу:',
  },
  {
    id: 'tpl-sql-opt',
    title: 'Оптимизация SQL-запросов',
    category: 'Код',
    description: 'Анализ плана выполнения запроса и рекомендации по индексам.',
    promptText: 'Проанализируй SQL-запрос, объясни возможные причины медленного выполнения и предложи индексы:',
  },
];

export const INITIAL_PROJECTS: ProjectItem[] = [
  {
    id: 'proj-1',
    name: 'Миграция микросервисов биллинга',
    department: 'Инженерный департамент',
    updatedAt: 'Сегодня, 11:40',
    chatCount: 14,
    status: 'active',
  },
  {
    id: 'proj-2',
    name: 'Квартальная стратегия Q4',
    department: 'Маркетинг и аналитика',
    updatedAt: 'Вчера, 18:15',
    chatCount: 9,
    status: 'active',
  },
  {
    id: 'proj-3',
    name: 'База знаний онбординга сотрудников',
    department: 'HR & Внутренние коммуникации',
    updatedAt: '20 окт 2026',
    chatCount: 6,
    status: 'review',
  },
];

export const INITIAL_DOCUMENTS: DocumentItem[] = [
  {
    id: 'doc-1',
    title: 'Технический регламент API v3.2.pdf',
    format: 'PDF',
    sizeLabel: '2.4 МБ',
    updatedAt: 'Сегодня, 10:12',
    indexed: true,
  },
  {
    id: 'doc-2',
    title: 'Финансовый отчёт за 3 квартал 2026.xlsx',
    format: 'XLSX',
    sizeLabel: '1.8 МБ',
    updatedAt: 'Вчера, 16:45',
    indexed: true,
  },
  {
    id: 'doc-3',
    title: 'Гайдлайн по информационной безопасности.docx',
    format: 'DOCX',
    sizeLabel: '940 КБ',
    updatedAt: '18 окт 2026',
    indexed: true,
  },
];

export const INITIAL_SESSIONS: ChatSession[] = [
  {
    id: 'sess-1',
    title: 'Оптимизация индексов PostgreSQL в биллинге',
    categoryId: 'code',
    updatedAt: 'Сегодня, 12:05',
    starred: true,
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: 'Как ускорить выборку транзакций по client_id и created_at за последние 30 дней?',
        timestamp: '12:04',
      },
      {
        id: 'm-2',
        role: 'assistant',
        content:
          'Рекомендуется создать составной B-Tree индекс `(client_id, created_at DESC)` и использовать секционирование таблицы по месяцам.',
        timestamp: '12:05',
      },
    ],
  },
  {
    id: 'sess-2',
    title: 'Тезисы презентации для совета директоров',
    categoryId: 'favorites',
    updatedAt: 'Вчера, 17:30',
    starred: true,
    messages: [
      {
        id: 'm-3',
        role: 'user',
        content: 'Сформируй 4 ключевых тезиса по итогам внедрения ARS LLM в компании.',
        timestamp: '17:29',
      },
      {
        id: 'm-4',
        role: 'assistant',
        content:
          '1. Сокращение времени поиска по внутренней документации на 62%.\n2. Автоматизация код-ревью и генерации тестов.\n3. Полное соблюдение корпоративного контура безопасности.',
        timestamp: '17:30',
      },
    ],
  },
  {
    id: 'sess-3',
    title: 'Контент-план продуктовых обновлений',
    categoryId: 'marketing',
    updatedAt: '19 окт 2026',
    starred: false,
    messages: [
      {
        id: 'm-5',
        role: 'user',
        content: 'Подготовь расписание рассылок на ноябрь.',
        timestamp: '14:10',
      },
      {
        id: 'm-6',
        role: 'assistant',
        content: 'Расписание разделено на 3 волны: пре-анонс, вебинар для клиентов и дайджест релизов.',
        timestamp: '14:11',
      },
    ],
  },
];

export const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
  model: 'ars-llm-pro-2.5',
  temperature: 0.4,
  maxTokens: 2048,
  systemPrompt: 'Вы — корпоративный ИИ-ассистент ARS LLM. Отвечайте точно, структурированно и профессионально.',
};

/**
 * Toggles between light and dark theme modes.
 */
export function toggleThemeMode(current: ThemeMode): ThemeMode {
  return current === 'light' ? 'dark' : 'light';
}

/**
 * Converts a 6-digit hex color string to relative luminance per WCAG 2.1.
 */
export function getRelativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid 6-digit hex color: ${hex}`);
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const transform = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const R = transform(r);
  const G = transform(g);
  const B = transform(b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Computes WCAG 2.1 contrast ratio between two hex colors (returns value >= 1).
 */
export function getContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = getRelativeLuminance(foregroundHex);
  const l2 = getRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Checks whether two colors meet WCAG AA or AAA contrast requirements.
 */
export function isWcagCompliant(
  foregroundHex: string,
  backgroundHex: string,
  level: 'AA' | 'AAA' = 'AA',
  isLargeText = false
): boolean {
  const ratio = getContrastRatio(foregroundHex, backgroundHex);
  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7.0;
  }
  return isLargeText ? ratio >= 3.0 : ratio >= 4.5;
}

/**
 * Validates and creates a new custom chat list category.
 */
export function createCustomChatList(
  existingLists: ChatListCategory[],
  rawName: string,
  colorHex = '#6366F1'
): { ok: true; lists: ChatListCategory[]; created: ChatListCategory } | { ok: false; error: string } {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { ok: false, error: 'Введите название списка' };
  }
  if (trimmed.length > 28) {
    return { ok: false, error: 'Название списка не должно превышать 28 символов' };
  }
  const duplicate = existingLists.some((item) => item.label.toLowerCase() === trimmed.toLowerCase());
  if (duplicate) {
    return { ok: false, error: 'Список с таким названием уже существует' };
  }

  const created: ChatListCategory = {
    id: `custom-${trimmed.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}-${existingLists.length + 1}`,
    label: trimmed,
    colorHex,
    count: 0,
  };

  return {
    ok: true,
    lists: [...existingLists, created],
    created,
  };
}

/**
 * Filters chat sessions, templates, and documents by a search query and optional category ID.
 */
export function filterWorkspaceContent(params: {
  sessions: ChatSession[];
  templates: PromptTemplate[];
  documents: DocumentItem[];
  query: string;
  categoryId?: string | null;
}): {
  sessions: ChatSession[];
  templates: PromptTemplate[];
  documents: DocumentItem[];
  totalMatches: number;
} {
  const normalizedQuery = params.query.trim().toLowerCase();
  const categoryId = params.categoryId ?? null;

  const filteredSessions = params.sessions.filter((session) => {
    const matchesCategory =
      !categoryId ||
      (categoryId === 'favorites' ? Boolean(session.starred || session.categoryId === 'favorites') : session.categoryId === categoryId);
    if (!matchesCategory) return false;
    if (!normalizedQuery) return true;
    const inTitle = session.title.toLowerCase().includes(normalizedQuery);
    const inMessages = session.messages.some((m) => m.content.toLowerCase().includes(normalizedQuery));
    return inTitle || inMessages;
  });

  const filteredTemplates = params.templates.filter((tpl) => {
    if (!normalizedQuery) return true;
    return (
      tpl.title.toLowerCase().includes(normalizedQuery) ||
      tpl.description.toLowerCase().includes(normalizedQuery) ||
      tpl.category.toLowerCase().includes(normalizedQuery)
    );
  });

  const filteredDocuments = params.documents.filter((doc) => {
    if (!normalizedQuery) return true;
    return doc.title.toLowerCase().includes(normalizedQuery) || doc.format.toLowerCase().includes(normalizedQuery);
  });

  return {
    sessions: deduplicateSessions(filteredSessions),
    templates: filteredTemplates,
    documents: filteredDocuments,
    totalMatches: filteredSessions.length + filteredTemplates.length + filteredDocuments.length,
  };
}

/**
 * Builds an assistant response for a user prompt.
 */
export function generateAssistantReply(promptText: string, modelParams: ModelParameters = DEFAULT_MODEL_PARAMETERS): string {
  const normalized = promptText.trim();
  const matchedQuick = QUICK_PROMPTS.find(
    (qp) =>
      qp.promptText.toLowerCase() === normalized.toLowerCase() ||
      qp.label.toLowerCase() === normalized.toLowerCase()
  );
  if (matchedQuick) {
    return matchedQuick.assistantReply;
  }

  return [
    `Запрос обработан моделью **${modelParams.model}** (температура: ${modelParams.temperature.toFixed(1)}):`,
    '',
    `По вашему запросу «${normalized.slice(0, 90)}${normalized.length > 90 ? '…' : ''}» подготовлен структурированный ответ:`,
    '1. **Анализ контекста**: Выделены ключевые рабочие параметры и ограничения задачи.',
    '2. **Рекомендуемое решение**: Сформирован пошаговый план действий с учётом корпоративных стандартов.',
    '3. **Следующий шаг**: Вы можете прикрепить документацию или выбрать шаблон из библиотеки промптов для углубления деталей.',
  ].join('\n');
}

/**
 * Creates a new chat session or appends a message to an existing session.
 */
export function submitChatPrompt(params: {
  existingSession: ChatSession | null;
  promptText: string;
  attachments?: string[];
  categoryId?: string;
  modelParams?: ModelParameters;
  timestamp?: string;
}): { ok: true; session: ChatSession } | { ok: false; error: string } {
  const trimmed = params.promptText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Введите сообщение перед отправкой' };
  }

  const timeLabel = params.timestamp ?? 'Сейчас';
  const modelParams = params.modelParams ?? DEFAULT_MODEL_PARAMETERS;
  const userMessage: ChatMessage = {
    id: `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content: trimmed,
    timestamp: timeLabel,
    attachments: params.attachments && params.attachments.length > 0 ? [...params.attachments] : undefined,
  };

  const assistantMessage: ChatMessage = {
    id: `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: generateAssistantReply(trimmed, modelParams),
    timestamp: timeLabel,
  };

  if (params.existingSession) {
    return {
      ok: true,
      session: {
        ...params.existingSession,
        updatedAt: 'Только что',
        messages: [...params.existingSession.messages, userMessage, assistantMessage],
      },
    };
  }

  const title = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  return {
    ok: true,
    session: {
      id: `sess-${Date.now()}`,
      title,
      categoryId: params.categoryId ?? 'code',
      updatedAt: 'Только что',
      starred: false,
      messages: [userMessage, assistantMessage],
    },
  };
}

/**
 * Validates model parameter settings.
 */
export function validateModelParameters(params: ModelParameters): { valid: boolean; error?: string } {
  if (Number.isNaN(params.temperature) || params.temperature < 0 || params.temperature > 1) {
    return { valid: false, error: 'Температура должна быть в диапазоне от 0.0 до 1.0' };
  }
  if (!Number.isInteger(params.maxTokens) || params.maxTokens < 256 || params.maxTokens > 8192) {
    return { valid: false, error: 'Лимит токенов должен быть целым числом от 256 до 8192' };
  }
  if (!params.systemPrompt.trim()) {
    return { valid: false, error: 'Системный промпт не может быть пустым' };
  }
  return { valid: true };
}

/**
 * Generates a safe .md filename for a chat session export.
 */
export function getChatMarkdownFilename(session: ChatSession): string {
  const sanitized = session.title
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const base = sanitized || session.id || 'chat-export';
  return `${base}.md`;
}

/**
 * Formats a ChatSession into a structured Markdown document.
 */
export function formatChatSessionAsMarkdown(session: ChatSession): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `- **ID сессии**: \`${session.id}\``,
    `- **Категория**: ${session.categoryId}`,
    `- **Обновлено**: ${session.updatedAt}`,
    `- **Сообщений**: ${session.messages.length}`,
    '',
    '---',
    '',
  ];

  for (const msg of session.messages) {
    const author = msg.role === 'user' ? 'Сотрудник' : 'ARS LLM';
    lines.push(`### ${author} (${msg.timestamp})`);
    lines.push('');
    lines.push(msg.content);
    if (msg.attachments && msg.attachments.length > 0) {
      lines.push('');
      lines.push(`**Вложения**: ${msg.attachments.map((f) => `\`${f}\``).join(', ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Encodes a ChatSession Markdown export as a downloadable UTF-8 data URI.
 */
export function createChatMarkdownDataUri(session: ChatSession): string {
  const markdown = formatChatSessionAsMarkdown(session);
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
}

export type SpeechLangCode = 'ru-RU' | 'kk-KZ' | 'en-US';

export interface DetectedSpeechLanguage {
  langCode: SpeechLangCode;
  shortLabel: 'RU' | 'KZ' | 'EN';
  fullName: string;
}

/**
 * Strips Markdown formatting and code blocks so Text-to-Speech reads natural prose.
 */
export function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects the primary language of an AI response for Text-to-Speech voice selection.
 * Distinguishes Kazakh (kk-KZ), Russian (ru-RU), and English (en-US).
 */
export function detectSpeechLanguage(text: string): DetectedSpeechLanguage {
  // Remove fenced code blocks before counting natural language characters
  const prose = text.replace(/```[\s\S]*?```/g, ' ');

  // Check for Kazakh-specific Cyrillic characters
  const kazakhSpecificMatches = prose.match(/[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/g);
  if (kazakhSpecificMatches && kazakhSpecificMatches.length > 0) {
    return {
      langCode: 'kk-KZ',
      shortLabel: 'KZ',
      fullName: 'Қазақша (kk-KZ)',
    };
  }

  const cyrillicMatches = prose.match(/[а-яёА-ЯЁ]/g);
  const latinMatches = prose.match(/[a-zA-Z]/g);
  const cyrillicCount = cyrillicMatches ? cyrillicMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;

  if (latinCount > cyrillicCount && latinCount > 0) {
    return {
      langCode: 'en-US',
      shortLabel: 'EN',
      fullName: 'English (en-US)',
    };
  }

  return {
    langCode: 'ru-RU',
    shortLabel: 'RU',
    fullName: 'Русский (ru-RU)',
  };
}

/**
 * Picks the best matching SpeechSynthesisVoice for a target BCP-47 language code.
 */
export function selectBestVoiceForLanguage<T extends { lang: string; default?: boolean }>(
  voices: T[],
  targetLangCode: SpeechLangCode
): T | null {
  if (!voices || voices.length === 0) return null;
  const normalizedTarget = targetLangCode.toLowerCase();
  const baseLang = normalizedTarget.split('-')[0];

  const exactMatch = voices.find((v) => v.lang.toLowerCase().replace('_', '-') === normalizedTarget);
  if (exactMatch) return exactMatch;

  const prefixMatch = voices.find((v) =>
    v.lang.toLowerCase().replace('_', '-').startsWith(`${baseLang}-`) ||
    v.lang.toLowerCase() === baseLang
  );
  if (prefixMatch) return prefixMatch;

  return voices.find((v) => v.default) ?? voices[0];
}

/**
 * Formats an ISO timestamp string into a concise HH:MM or localized date string.
 */
export function formatTimestampShort(isoString?: string | null): string {
  if (!isoString) return 'Сейчас';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Maps a backend ConversationRecord and optional MessageRecord[] into a UI ChatSession.
 * Preserves existing cached messages when messages array is not explicitly supplied.
 */
export function mapBackendConversationToSession(
  conv: {
    id: number;
    title: string | null;
    created_at: string;
    last_message_at: string | null;
    messages?: Array<{
      id: number;
      conversation_id: number;
      role: 'user' | 'assistant' | 'system';
      text: string;
      created_at: string;
    }>;
  },
  messages?: Array<{
    id: number;
    conversation_id: number;
    role: 'user' | 'assistant' | 'system';
    text: string;
    created_at: string;
  }>,
  existingSession?: ChatSession | null
): ChatSession {
  const sourceMessages = messages && messages.length > 0 ? messages : conv.messages;
  const mappedMessages: ChatMessage[] =
    sourceMessages && sourceMessages.length > 0
      ? sourceMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: `db-msg-${m.id}`,
            role: m.role as 'user' | 'assistant',
            content: m.text,
            timestamp: formatTimestampShort(m.created_at),
          }))
      : existingSession?.messages ?? [];

  return {
    id: `conv-${conv.id}`,
    conversationId: conv.id,
    title: conv.title?.trim() || existingSession?.title || `Диалог #${conv.id}`,
    categoryId: existingSession?.categoryId ?? 'code',
    updatedAt: formatTimestampShort(conv.last_message_at || conv.created_at),
    starred: existingSession?.starred ?? false,
    messages: mappedMessages,
  };
}

/**
 * RBAC rule 1: Only administrators can configure or edit user quotas.
 */
export function canConfigureQuotas(
  user: { role?: string | null } | null | undefined
): boolean {
  return Boolean(user && user.role === 'admin');
}

/**
 * RBAC rule 2: Regular users (and admins) can view their quota usage.
 */
export function canViewQuotas(
  user: { role?: string | null } | null | undefined
): boolean {
  if (!user || !user.role) return false;
  return user.role === 'admin' || user.role === 'user' || user.role === 'employee';
}

export interface QuotaUpdateTargetUser {
  id: number;
  email: string;
  name?: string;
  role: 'user' | 'employee' | 'admin';
  created_at: string;
  quotas: {
    daily: { used: number; limit: number | null };
    monthly: { used: number; limit: number | null };
  };
}

/**
 * Validates and applies a quota limit change. Enforces that only an admin actor can modify limits.
 */
export function applyQuotaLimitChange(params: {
  actor: { role?: string | null } | null | undefined;
  users: QuotaUpdateTargetUser[];
  targetUserId: number;
  dailyInput: string;
  monthlyInput: string;
}):
  | {
      ok: true;
      users: QuotaUpdateTargetUser[];
      updatedQuotas: {
        daily: { used: number; limit: number | null };
        monthly: { used: number; limit: number | null };
      };
    }
  | { ok: false; error: string } {
  if (!canConfigureQuotas(params.actor)) {
    return {
      ok: false,
      error: 'Недостаточно прав: настраивать квоты может только администратор.',
    };
  }

  const dailyTrimmed = params.dailyInput.trim();
  const monthlyTrimmed = params.monthlyInput.trim();

  const dailyLimit = dailyTrimmed === '' ? null : Number(dailyTrimmed);
  const monthlyLimit = monthlyTrimmed === '' ? null : Number(monthlyTrimmed);

  if (
    (dailyLimit !== null && (!Number.isInteger(dailyLimit) || dailyLimit < 0)) ||
    (monthlyLimit !== null && (!Number.isInteger(monthlyLimit) || monthlyLimit < 0))
  ) {
    return {
      ok: false,
      error: 'Лимиты должны быть неотрицательными целыми числами (или пустыми для безлимита).',
    };
  }

  const target = params.users.find((u) => u.id === params.targetUserId);
  if (!target) {
    return { ok: false, error: 'Пользователь не найден.' };
  }

  const updatedQuotas = {
    daily: { ...target.quotas.daily, limit: dailyLimit },
    monthly: { ...target.quotas.monthly, limit: monthlyLimit },
  };

  const updatedUsers = params.users.map((u) =>
    u.id === params.targetUserId ? { ...u, quotas: updatedQuotas } : u
  );

  return {
    ok: true,
    users: updatedUsers,
    updatedQuotas,
  };
}

export interface PersistedWorkspaceState {
  theme: ThemeMode;
  isDemoMode: boolean;
  demoRole: 'admin' | 'user';
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeNav: NavSectionId;
  activeCategoryId: string | null;
  chatLists: ChatListCategory[];
  adminUsers: QuotaUpdateTargetUser[];
  modelParams: ModelParameters;
  personalInstructions?: string;
  profileDisplayName?: string;
  profileAvatarColor?: string;
}

export const WORKSPACE_STORAGE_KEY = 'ars_llm_workspace_state_v2';

export const DEFAULT_ADMIN_USERS: QuotaUpdateTargetUser[] = [
  {
    id: 1,
    email: 'admin@ars_llm.local',
    name: 'Администратор ИТ',
    role: 'admin',
    created_at: '2026-10-01T08:00:00.000Z',
    quotas: { daily: { used: 4, limit: 100 }, monthly: { used: 38, limit: 2000 } },
  },
  {
    id: 2,
    email: 'employee@company.kz',
    name: 'Сотрудник',
    role: 'user',
    created_at: '2026-10-05T09:30:00.000Z',
    quotas: { daily: { used: 4, limit: 20 }, monthly: { used: 38, limit: 500 } },
  },
];

/**
 * Ensures an array of chat sessions contains strictly unique IDs, preserving the first (latest) occurrence.
 */
export function deduplicateSessions(sessions: ChatSession[]): ChatSession[] {
  if (!Array.isArray(sessions)) return [];
  const seen = new Set<string>();
  const unique: ChatSession[] = [];
  for (const sess of sessions) {
    if (!sess || typeof sess.id !== 'string') continue;
    if (!seen.has(sess.id)) {
      seen.add(sess.id);
      unique.push(sess);
    }
  }
  return unique;
}

/**
 * Cleans up persisted chat sessions so any interrupted stream is marked finished on reload,
 * and ensures no duplicate session IDs exist.
 */
export function sanitizePersistedSessions(sessions: ChatSession[]): ChatSession[] {
  if (!Array.isArray(sessions)) return INITIAL_SESSIONS;
  const uniqueSessions = deduplicateSessions(sessions);
  return uniqueSessions
    .filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string')
    .map((s) => ({
      ...s,
      messages: Array.isArray(s.messages)
        ? s.messages
            .filter(
              (m) =>
                m &&
                (m.role === 'user' || m.role === 'assistant') &&
                typeof m.content === 'string' &&
                (m.content.trim().length > 0 || !m.isStreaming)
            )
            .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        : [],
    }));
}

/**
 * Serializes workspace state to JSON for localStorage persistence across page reloads.
 */
export function serializeWorkspaceState(state: PersistedWorkspaceState): string {
  const cleanState: PersistedWorkspaceState = {
    ...state,
    sessions: sanitizePersistedSessions(state.sessions),
  };
  return JSON.stringify(cleanState);
}

/**
 * Deserializes workspace state from JSON, returning null if invalid or absent.
 */
export function deserializeWorkspaceState(
  rawJson: string | null | undefined
): PersistedWorkspaceState | null {
  if (!rawJson || typeof rawJson !== 'string') return null;
  try {
    const parsed = JSON.parse(rawJson) as Partial<PersistedWorkspaceState>;
    if (!parsed || typeof parsed !== 'object') return null;

    const theme: ThemeMode = parsed.theme === 'dark' ? 'dark' : 'light';
    const demoRole: 'admin' | 'user' = parsed.demoRole === 'admin' ? 'admin' : 'user';
    const isDemoMode = Boolean(parsed.isDemoMode);
    const sessions = Array.isArray(parsed.sessions)
      ? sanitizePersistedSessions(parsed.sessions)
      : INITIAL_SESSIONS;

    const validNavs: NavSectionId[] = [
      'chats',
      'projects',
      'templates',
      'documents',
      'history',
      'quotas',
      'admin',
    ];
    let activeNav: NavSectionId =
      parsed.activeNav && validNavs.includes(parsed.activeNav) ? parsed.activeNav : 'chats';

    // Enforce RBAC on reload: non-admin cannot stay on 'admin' nav
    if (isDemoMode && demoRole !== 'admin' && activeNav === 'admin') {
      activeNav = 'quotas';
    }

    const activeSessionId =
      typeof parsed.activeSessionId === 'string' &&
      sessions.some((s) => s.id === parsed.activeSessionId)
        ? parsed.activeSessionId
        : null;

    const chatLists =
      Array.isArray(parsed.chatLists) && parsed.chatLists.length > 0
        ? parsed.chatLists
        : INITIAL_CHAT_LISTS;

    const adminUsers =
      Array.isArray(parsed.adminUsers) && parsed.adminUsers.length > 0
        ? parsed.adminUsers
        : DEFAULT_ADMIN_USERS;

    const modelParams =
      parsed.modelParams && validateModelParameters(parsed.modelParams).valid
        ? parsed.modelParams
        : DEFAULT_MODEL_PARAMETERS;

    return {
      theme,
      isDemoMode,
      demoRole,
      sessions,
      activeSessionId,
      activeNav,
      activeCategoryId: typeof parsed.activeCategoryId === 'string' ? parsed.activeCategoryId : null,
      chatLists,
      adminUsers,
      modelParams,
      personalInstructions:
        typeof parsed.personalInstructions === 'string' ? parsed.personalInstructions : '',
      profileDisplayName:
        typeof parsed.profileDisplayName === 'string' ? parsed.profileDisplayName : undefined,
      profileAvatarColor:
        typeof parsed.profileAvatarColor === 'string' ? parsed.profileAvatarColor : '#4F46E5',
    };
  } catch {
    return null;
  }
}

/**
 * Transitions the document theme smoothly without per-element border/contour flashing.
 * Uses the View Transitions API when available and locks out individual element transitions during the DOM flip.
 */
export function applyThemeWithSmoothTransition(
  nextTheme: ThemeMode,
  onApplyState: (mode: ThemeMode) => void
): void {
  if (typeof document === 'undefined') {
    onApplyState(nextTheme);
    return;
  }

  const root = document.documentElement;
  const applyDomTheme = () => {
    root.classList.add('theme-switching');
    if (nextTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    onApplyState(nextTheme);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        root.classList.remove('theme-switching');
      });
    });
  };

  const docWithTransition = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (typeof docWithTransition.startViewTransition === 'function' && !prefersReducedMotion) {
    try {
      docWithTransition.startViewTransition(() => {
        applyDomTheme();
      });
      return;
    } catch {
      // Fallback to direct atomic DOM flip
    }
  }

  applyDomTheme();
}

export interface ProfileUpdateInput {
  name: string;
  email?: string;
  currentEmail: string;
  personalInstructions: string;
  avatarColor: string;
}

export type ProfileUpdateValidationResult =
  | {
      valid: true;
      name: string;
      personalInstructions: string;
      avatarColor: string;
    }
  | {
      valid: false;
      error: string;
    };

const RESTRICTED_PERSONAL_INSTRUCTION_PATTERNS: RegExp[] = [
  /(?:игнорируй|забудь|отмени|пренебреги)[\s\S]{0,40}(?:предыдущ[а-я]+|системн[а-я]+|все)\s+(?:инструкци[а-я]+|правил[а-я]+|указани[а-я]+)/i,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|prompts|rules)\b/i,
  /\b(?:prompt\s*injection|jailbreak|джейлбрейк)\b/i,
  /(?:покажи|выведи|раскрой|напиши|повтори|цитируй)[\s\S]{0,40}(?:системн[а-я]+\s+промпт|системн[а-я]+\s+инструкци|instruction\.md)/i,
];

/**
 * Validates profile modal edits:
 * - Enforces read-only corporate email (`email` cannot differ from `currentEmail`).
 * - Validates display name (`1..120` chars after trim).
 * - Validates personal instructions (`0..1500` chars + blocks prompt injection / system override strings).
 * - Validates hex avatar color (`^#[0-9A-Fa-f]{6}$`).
 */
export function validateProfileUpdate(
  input: ProfileUpdateInput
): ProfileUpdateValidationResult {
  if (
    input.email !== undefined &&
    input.email.trim().toLowerCase() !== input.currentEmail.trim().toLowerCase()
  ) {
    return {
      valid: false,
      error: 'Корпоративная почта доступна только для чтения и не может быть изменена.',
    };
  }

  const trimmedName = (input.name ?? '').trim();
  if (!trimmedName) {
    return {
      valid: false,
      error: 'Укажите имя сотрудника',
    };
  }

  if (trimmedName.length > 120) {
    return {
      valid: false,
      error: 'Имя сотрудника не должно превышать 120 символов',
    };
  }

  const rawInstructions = input.personalInstructions ?? '';
  if (rawInstructions.length > 1500) {
    return {
      valid: false,
      error: 'Персональные инструкции не должны превышать 1500 символов',
    };
  }

  const trimmedInstructions = rawInstructions.trim();
  if (
    trimmedInstructions &&
    RESTRICTED_PERSONAL_INSTRUCTION_PATTERNS.some((re) => re.test(trimmedInstructions))
  ) {
    return {
      valid: false,
      error: 'Персональные инструкции содержат недопустимые директивы безопасности.',
    };
  }

  const avatarColor = /^#[0-9A-Fa-f]{6}$/.test(input.avatarColor ?? '')
    ? input.avatarColor
    : '#4F46E5';

  return {
    valid: true,
    name: trimmedName,
    personalInstructions: trimmedInstructions,
    avatarColor,
  };
}

/**
 * Prepends the user's saved personal instructions into the first user message context
 * when sending conversation history to the model completion gateway.
 */
export function prependPersonalInstructionsToHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  personalInstructions?: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const cleaned = (personalInstructions ?? '').trim();
  if (!cleaned || messages.length === 0) {
    return messages;
  }

  const lastIdx = messages.length - 1;
  return messages.map((msg, idx) => {
    if (idx === lastIdx && msg.role === 'user') {
      return {
        role: 'user',
        content: `[Персональные рабочие предпочтения сотрудника: ${cleaned}]\n\n${msg.content}`,
      };
    }
    return msg;
  });
}

export interface QuotaBlockStatus {
  isBlocked: boolean;
  period: 'daily' | 'monthly' | null;
  reason: 'daily_limit_exceeded' | 'monthly_limit_exceeded' | null;
  title: string | null;
  message: string | null;
  contactAdminHint: string | null;
}

/**
 * Evaluates whether the user's daily or monthly quota is exhausted (`used >= limit`, including `limit === 0`).
 * Used to disable prompt submission in the UI and display a clear message to contact the administrator.
 */
export function evaluateQuotaBlockStatus(
  quotas:
    | {
        daily: { used: number; limit: number | null };
        monthly: { used: number; limit: number | null };
      }
    | null
    | undefined
): QuotaBlockStatus {
  if (!quotas) {
    return {
      isBlocked: false,
      period: null,
      reason: null,
      title: null,
      message: null,
      contactAdminHint: null,
    };
  }

  const dailyLimit =
    typeof quotas.daily?.limit === 'number' && quotas.daily.limit >= 0
      ? quotas.daily.limit
      : null;
  const monthlyLimit =
    typeof quotas.monthly?.limit === 'number' && quotas.monthly.limit >= 0
      ? quotas.monthly.limit
      : null;

  if (dailyLimit !== null && quotas.daily.used >= dailyLimit) {
    return {
      isBlocked: true,
      period: 'daily',
      reason: 'daily_limit_exceeded',
      title: 'Дневной лимит запросов исчерпан',
      message: `Исчерпан дневной лимит запросов (${quotas.daily.used} из ${dailyLimit}). Обратитесь к администратору для увеличения квоты.`,
      contactAdminHint: 'Обратитесь к ИТ-администратору для увеличения лимита.',
    };
  }

  if (monthlyLimit !== null && quotas.monthly.used >= monthlyLimit) {
    return {
      isBlocked: true,
      period: 'monthly',
      reason: 'monthly_limit_exceeded',
      title: 'Месячный лимит запросов исчерпан',
      message: `Исчерпан месячный лимит запросов (${quotas.monthly.used} из ${monthlyLimit}). Обратитесь к администратору для увеличения квоты.`,
      contactAdminHint: 'Обратитесь к ИТ-администратору для увеличения лимита.',
    };
  }

  return {
    isBlocked: false,
    period: null,
    reason: null,
    title: null,
    message: null,
    contactAdminHint: null,
  };
}
