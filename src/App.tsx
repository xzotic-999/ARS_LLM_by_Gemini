/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChatComposer } from './components/ChatComposer';
import { QuickPrompts } from './components/QuickPrompts';
import { ChatThreadView } from './components/ChatThreadView';
import { LoginPage } from './components/LoginPage';
import {
  WorkspaceSectionView,
  PromptLibraryModal,
  ModelParamsModal,
  CommandSearchModal,
} from './components/WorkspaceModalsAndViews';
import {
  ChatListCategory,
  ChatMessage,
  ChatSession,
  DEFAULT_MODEL_PARAMETERS,
  INITIAL_CHAT_LISTS,
  INITIAL_DOCUMENTS,
  INITIAL_PROJECTS,
  INITIAL_SESSIONS,
  INITIAL_TEMPLATES,
  ModelParameters,
  NavSectionId,
  QUICK_PROMPTS,
  QuickPrompt,
  ThemeMode,
  createCustomChatList,
  filterWorkspaceContent,
  formatTimestampShort,
  mapBackendConversationToSession,
  submitChatPrompt,
} from './utils/dashboardLogic';
import {
  ApiError,
  authApi,
  chatApi,
  conversationsApi,
  messagesApi,
  QuotaLimits,
  UserProfile,
} from './services/api';
import type { AttachedFileItem } from './utils/fileExtractor';

function buildPromptWithAttachments(
  trimmedPrompt: string,
  attachments: string[],
  attachmentDetails?: AttachedFileItem[]
): string {
  if (!attachments || attachments.length === 0) return trimmedPrompt;

  const sections: string[] = [];
  if (attachmentDetails && attachmentDetails.length > 0) {
    for (const item of attachmentDetails) {
      if (item.extractedText && item.extractedText.trim()) {
        sections.push(
          `--- Содержимое файла "${item.name}" ---\n${item.extractedText.trim()}\n--- Конец файла "${item.name}" ---`
        );
      } else {
        sections.push(`[Прикрепленный файл: ${item.name}]`);
      }
    }
  } else {
    sections.push(`[Прикрепленные файлы: ${attachments.join(', ')}]`);
  }

  return `${trimmedPrompt}\n\n${sections.join('\n\n')}`;
}

const DEMO_USER: UserProfile = {
  id: 1,
  email: 'employee@company.kz',
  name: 'Сотрудник',
  role: 'admin',
};

const DEMO_QUOTAS: QuotaLimits = {
  daily: { used: 4, limit: 20 },
  monthly: { used: 38, limit: 500 },
};

function hasDemoQueryParam(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('demo') === '1' || params.get('autostart') === '1';
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [authChecked, setAuthChecked] = useState<boolean>(() => hasDemoQueryParam());
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => hasDemoQueryParam());
  const [user, setUser] = useState<UserProfile | null>(() =>
    hasDemoQueryParam() ? DEMO_USER : null
  );
  const [quotas, setQuotas] = useState<QuotaLimits | null>(() =>
    hasDemoQueryParam() ? DEMO_QUOTAS : null
  );

  const [activeNav, setActiveNav] = useState<NavSectionId>('chats');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [chatLists, setChatLists] = useState<ChatListCategory[]>(INITIAL_CHAT_LISTS);
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    hasDemoQueryParam() ? INITIAL_SESSIONS : []
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [promptValue, setPromptValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [modelParamsOpen, setModelParamsOpen] = useState(false);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [modelParams, setModelParams] = useState<ModelParameters>(DEFAULT_MODEL_PARAMETERS);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState<{
    text: string;
    attachments: string[];
    attachmentDetails?: AttachedFileItem[];
  } | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Sync dark mode class on root HTML element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Global Ctrl+K / Cmd+K shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const refreshQuotas = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const res = await authApi.quotas();
      setQuotas(res.quotas);
    } catch {
      // Non-fatal if quotas endpoint fails
    }
  }, [isDemoMode]);

  const loadConversations = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const list = await conversationsApi.list();
      setSessions((prev) => {
        const prevById = new Map(prev.map((s) => [s.id, s]));
        return list.map((conv) => {
          const existing = prevById.get(`conv-${conv.id}`);
          return mapBackendConversationToSession(
            conv,
            [],
            existing
          );
        });
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      }
    }
  }, [isDemoMode]);

  // Check backend session on mount unless in explicit demo mode
  useEffect(() => {
    if (isDemoMode) {
      setAuthChecked(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const meRes = await authApi.me();
        if (cancelled) return;
        setUser(meRes.user);
        if (meRes.user.quotas) {
          setQuotas(meRes.user.quotas);
        } else {
          refreshQuotas();
        }
        await loadConversations();
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemoMode, loadConversations, refreshQuotas]);

  const handleLogin = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setIsDemoMode(false);
    setUser(res.user);
    setActiveSessionId(null);
    setActiveNav('chats');
    await Promise.all([loadConversations(), refreshQuotas()]);
  };

  const handleEnterDemoMode = () => {
    setIsDemoMode(true);
    setUser(DEMO_USER);
    setQuotas(DEMO_QUOTAS);
    setSessions(INITIAL_SESSIONS);
    setActiveSessionId(null);
    setActiveNav('chats');
    setStreamError(null);
  };

  const handleLogout = async () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    if (!isDemoMode) {
      try {
        await authApi.logout();
      } catch {
        // Ignore network errors on logout
      }
    }
    setIsDemoMode(false);
    setUser(null);
    setQuotas(null);
    setSessions([]);
    setActiveSessionId(null);
    setStreamError(null);
  };

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveNav('chats');
    setStreamError(null);

    if (isDemoMode) return;

    const target = sessions.find((s) => s.id === sessionId);
    const convId =
      target?.conversationId ??
      (sessionId.startsWith('conv-') ? parseInt(sessionId.slice(5), 10) : NaN);

    if (Number.isNaN(convId)) return;

    try {
      const msgs = await messagesApi.list(convId);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // Always sync messages (even when msgs is empty!) to avoid stale messages
          const mapped: ChatMessage[] = msgs
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: `db-msg-${m.id}`,
              role: m.role as 'user' | 'assistant',
              content: m.text,
              timestamp: formatTimestampShort(m.created_at),
            }));
          return { ...s, messages: mapped };
        })
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return;
      }
      setStreamError(
        err instanceof Error ? err.message : 'Не удалось загрузить историю сообщений'
      );
    }
  };

  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s))
    );

    if (isDemoMode) return;

    const target = sessions.find((s) => s.id === sessionId);
    if (target?.conversationId) {
      try {
        await conversationsApi.rename(target.conversationId, trimmed);
      } catch {
        // Reload list if rename failed
        loadConversations();
      }
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }

    if (isDemoMode) return;

    if (target?.conversationId) {
      try {
        await conversationsApi.delete(target.conversationId);
      } catch {
        loadConversations();
      }
    }
  };

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const activeCategory = useMemo(
    () => chatLists.find((c) => c.id === activeCategoryId) ?? null,
    [chatLists, activeCategoryId]
  );

  const filteredContent = useMemo(
    () =>
      filterWorkspaceContent({
        sessions,
        templates: INITIAL_TEMPLATES,
        documents: INITIAL_DOCUMENTS,
        query: searchQuery,
        categoryId: activeCategoryId,
      }),
    [sessions, searchQuery, activeCategoryId]
  );

  const handleCreateList = (name: string, colorHex: string) => {
    const res = createCustomChatList(chatLists, name, colorHex);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    setChatLists(res.lists);
    return { ok: true };
  };

  const handleNewChat = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
      setIsStreaming(false);
    }
    setActiveSessionId(null);
    setActiveCategoryId(null);
    setActiveNav('chats');
    setPromptValue('');
    setStreamError(null);
  };

  const handleAbortStream = () => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleSubmitPrompt = async (
    text: string,
    attachments: string[],
    attachmentDetails?: AttachedFileItem[]
  ) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setStreamError(null);
    setLastSubmittedPrompt({ text: trimmed, attachments, attachmentDetails });
    const promptWithAttachments = buildPromptWithAttachments(
      trimmed,
      attachments,
      attachmentDetails
    );

    // Demo / Preview workspace mode: stream real completion via server-side /api/v1/chat/completions
    if (isDemoMode) {
      const nowStamp = 'Сейчас';
      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: nowStamp,
        attachments: attachments.length > 0 ? [...attachments] : undefined,
      };

      const streamingAssistantId = `stream-a-${Date.now()}`;
      const assistantPlaceholder: ChatMessage = {
        id: streamingAssistantId,
        role: 'assistant',
        content: '',
        timestamp: nowStamp,
        isStreaming: true,
      };

      const baseSession: ChatSession = activeSession ?? {
        id: `sess-${Date.now()}`,
        title: trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed,
        categoryId: activeCategoryId ?? 'code',
        updatedAt: 'Только что',
        starred: false,
        messages: [],
      };

      const targetSessionId = baseSession.id;

      const historyForModel = [
        ...baseSession.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: promptWithAttachments },
      ];

      const updatedSession: ChatSession = {
        ...baseSession,
        updatedAt: 'Только что',
        messages: [...baseSession.messages, userMsg, assistantPlaceholder],
      };

      if (activeSession) {
        setSessions((prev) =>
          prev.map((s) => (s.id === targetSessionId ? updatedSession : s))
        );
      } else {
        setSessions((prev) => [updatedSession, ...prev]);
        setActiveSessionId(targetSessionId);
      }

      setQuotas((prev) =>
        prev
          ? {
              daily: { ...prev.daily, used: prev.daily.used + 1 },
              monthly: { ...prev.monthly, used: prev.monthly.used + 1 },
            }
          : prev
      );
      setActiveNav('chats');
      setPromptValue('');

      setIsStreaming(true);
      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      let accumulatedReply = '';

      await chatApi.streamCompletions(
        historyForModel,
        (token) => {
          accumulatedReply += token;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === streamingAssistantId
                        ? { ...m, content: accumulatedReply }
                        : m
                    ),
                  }
                : s
            )
          );
        },
        () => {
          setIsStreaming(false);
          streamAbortRef.current = null;
          const finalContent = accumulatedReply.trim();
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === streamingAssistantId
                        ? {
                            ...m,
                            content: finalContent || 'Генерация остановлена.',
                            isStreaming: false,
                          }
                        : m
                    ),
                  }
                : s
            )
          );
        },
        (err) => {
          setIsStreaming(false);
          streamAbortRef.current = null;
          setStreamError(err.message);
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages
                      .filter(
                        (m) => !(m.id === streamingAssistantId && !m.content.trim())
                      )
                      .map((m) =>
                        m.id === streamingAssistantId ? { ...m, isStreaming: false } : m
                      ),
                  }
                : s
            )
          );
        },
        abortController.signal
      );
      return;
    }

    // Production backend mode:
    // 1. Ensure conversation exists in PostgreSQL
    let currentSession = activeSession;
    let convId = currentSession?.conversationId;

    try {
      if (!currentSession || !convId) {
        const title = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
        const createdConv = await conversationsApi.create(title);
        convId = createdConv.id;
        currentSession = mapBackendConversationToSession(createdConv, []);
        currentSession.categoryId = activeCategoryId ?? 'code';
        setSessions((prev) => [currentSession!, ...prev]);
        setActiveSessionId(currentSession.id);
      }

      const targetSessionId = currentSession.id;
      const targetConvId = convId;
      setActiveNav('chats');
      setPromptValue('');

      // 2. Persist user message in PostgreSQL (defer quota increment to completion endpoint)
      const savedUserMsg = await messagesApi.send(targetConvId, trimmed, 'user', true);

      const userChatMsg: ChatMessage = {
        id: `db-msg-${savedUserMsg.id}`,
        role: 'user',
        content: trimmed,
        timestamp: formatTimestampShort(savedUserMsg.created_at),
        attachments: attachments.length > 0 ? [...attachments] : undefined,
      };

      const streamingAssistantId = `stream-a-${Date.now()}`;
      const assistantPlaceholder: ChatMessage = {
        id: streamingAssistantId,
        role: 'assistant',
        content: '',
        timestamp: 'Сейчас',
        isStreaming: true,
      };

      const historyForModel = [
        ...currentSession.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: promptWithAttachments },
      ];

      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                updatedAt: 'Только что',
                messages: [...s.messages, userChatMsg, assistantPlaceholder],
              }
            : s
        )
      );

      // 3. Stream completion from POST /api/v1/chat/completions
      setIsStreaming(true);
      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      let accumulatedReply = '';

      await chatApi.streamCompletions(
        historyForModel,
        (token) => {
          accumulatedReply += token;
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === streamingAssistantId
                        ? { ...m, content: accumulatedReply }
                        : m
                    ),
                  }
                : s
            )
          );
        },
        async () => {
          setIsStreaming(false);
          streamAbortRef.current = null;
          const finalContent = accumulatedReply.trim();

          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === streamingAssistantId
                        ? {
                            ...m,
                            content: finalContent || 'Генерация остановлена.',
                            isStreaming: false,
                          }
                        : m
                    ),
                  }
                : s
            )
          );

          if (finalContent) {
            try {
              await messagesApi.send(targetConvId, finalContent, 'assistant');
            } catch {
              // Non-fatal if assistant message persistence fails after stream
            }
          }
          refreshQuotas();
        },
        (err) => {
          setIsStreaming(false);
          streamAbortRef.current = null;
          if (err instanceof ApiError && err.status === 401) {
            setUser(null);
            return;
          }
          setStreamError(err.message);
          // Remove empty placeholder if no tokens arrived
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages
                      .filter(
                        (m) => !(m.id === streamingAssistantId && !m.content.trim())
                      )
                      .map((m) =>
                        m.id === streamingAssistantId ? { ...m, isStreaming: false } : m
                      ),
                  }
                : s
            )
          );
          refreshQuotas();
        },
        abortController.signal
      );
    } catch (err) {
      setIsStreaming(false);
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return;
      }
      setStreamError(
        err instanceof Error ? err.message : 'Ошибка отправки сообщения'
      );
    }
  };

  const handleRetryLastPrompt = () => {
    if (!lastSubmittedPrompt || isStreaming) return;
    handleSubmitPrompt(
      lastSubmittedPrompt.text,
      lastSubmittedPrompt.attachments,
      lastSubmittedPrompt.attachmentDetails
    );
  };

  const handleSelectQuickPrompt = (qp: QuickPrompt) => {
    handleSubmitPrompt(qp.promptText, []);
  };

  const handleToggleStar = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, starred: !s.starred } : s))
    );
  };

  const topBarTitle = useMemo(() => {
    if (activeSession) return activeSession.title;
    if (activeCategory) return activeCategory.label;
    switch (activeNav) {
      case 'projects':
        return 'Проекты';
      case 'templates':
        return 'Шаблоны';
      case 'documents':
        return 'Документы';
      case 'history':
        return 'История';
      case 'admin':
        return 'Админ-панель';
      default:
        return 'Новый чат';
    }
  }, [activeSession, activeCategory, activeNav]);

  const showNewChatWelcome =
    activeNav === 'chats' && activeSession === null && activeCategoryId === null && !searchQuery.trim();

  if (!authChecked) {
    return (
      <div className="min-h-screen w-full bg-[#EEF1F7] dark:bg-[#070A12] flex items-center justify-center p-6">
        <div
          role="status"
          className="px-6 py-4 rounded-2xl bg-white dark:bg-[#0E1322] border border-[#E2E5EE] dark:border-slate-800 text-[14px] font-medium text-slate-700 dark:text-slate-200 shadow-sm"
        >
          Проверка сессии ARS LLM...
        </div>
      </div>
    );
  }

  if (!user && !isDemoMode) {
    return (
      <LoginPage
        theme={theme}
        onSelectTheme={setTheme}
        onLogin={handleLogin}
        onEnterDemoMode={handleEnterDemoMode}
      />
    );
  }

  return (
    <div className="theme-transition h-screen overflow-hidden w-full bg-[#EEF1F7] dark:bg-[#070A12] text-[#111827] dark:text-slate-100 flex flex-col md:p-4 lg:p-5">
      {/* WCAG Skip Link for Keyboard Users */}
      <a
        href="#main-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#5046E5] focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Перейти к основному содержимому
      </a>

      {/* Outer Dashboard Frame matching the reference screenshot */}
      <div className="flex-1 min-h-0 flex w-full max-w-[1440px] mx-auto md:rounded-[24px] overflow-hidden border border-[#E2E5EE] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] shadow-[0_14px_44px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_44px_rgba(0,0,0,0.45)] h-full">
        {/* Left Sidebar */}
        <Sidebar
          activeNav={activeNav}
          onSelectNav={(nav) => {
            setActiveNav(nav);
            setActiveSessionId(null);
          }}
          activeCategoryId={activeCategoryId}
          onSelectCategory={(catId) => {
            setActiveCategoryId(catId);
            setActiveSessionId(null);
          }}
          chatLists={chatLists}
          onCreateList={handleCreateList}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          user={user}
          quotas={quotas}
          onLogout={handleLogout}
          isDemoMode={isDemoMode}
          searchQuery={searchQuery}
          onSearchChange={(q) => {
            setSearchQuery(q);
            if (q.trim() && activeSessionId) {
              setActiveSessionId(null);
            }
          }}
          onOpenCommandSearch={() => setCommandSearchOpen(true)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#0E1322]">
          <TopBar
            title={topBarTitle}
            theme={theme}
            onSelectTheme={setTheme}
            onNewChat={handleNewChat}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            exportSession={activeSession}
          />

          <main
            id="main-workspace"
            tabIndex={-1}
            className={`flex-1 min-h-0 flex flex-col focus:outline-none ${
              activeSession && !showNewChatWelcome ? 'overflow-hidden' : 'overflow-y-auto'
            }`}
          >
            {showNewChatWelcome ? (
              <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 md:py-12">
                {/* Greeting Hero */}
                <div className="text-center max-w-[540px] mx-auto mb-8">
                  <h2 className="text-[30px] sm:text-[34px] font-bold tracking-tight text-[#111827] dark:text-white flex items-center justify-center gap-2.5">
                    <span>Здравствуйте!</span>
                    <span role="img" aria-label="Приветствие">
                      👋
                    </span>
                  </h2>
                  <p className="mt-3 text-[15px] sm:text-[15.5px] leading-[1.6] text-[#4B5563] dark:text-slate-300 text-balance">
                    Задавайте вопросы, анализируйте информацию
                    <br className="hidden sm:inline" /> и решайте рабочие задачи — в одном чате.
                  </p>
                </div>

                {/* Main Composer Card */}
                <ChatComposer
                  promptValue={promptValue}
                  onPromptChange={setPromptValue}
                  onSubmitPrompt={handleSubmitPrompt}
                  onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
                  onOpenModelParams={() => setModelParamsOpen(true)}
                />

                {streamError && (
                  <div
                    role="alert"
                    className="mt-4 w-full max-w-[680px] p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[13px] text-red-700 dark:text-red-300 text-center"
                  >
                    {streamError}
                  </div>
                )}

                {/* Quick Prompts 3 + 2 Grid */}
                <QuickPrompts
                  prompts={QUICK_PROMPTS}
                  onSelectQuickPrompt={handleSelectQuickPrompt}
                />
              </div>
            ) : activeSession ? (
              <ChatThreadView
                session={activeSession}
                promptValue={promptValue}
                onPromptChange={setPromptValue}
                onSubmitPrompt={handleSubmitPrompt}
                onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
                onOpenModelParams={() => setModelParamsOpen(true)}
                onToggleStar={handleToggleStar}
                onBackToWelcome={handleNewChat}
                isStreaming={isStreaming}
                onAbortStream={handleAbortStream}
                streamError={streamError}
                onRetryLastPrompt={lastSubmittedPrompt ? handleRetryLastPrompt : undefined}
              />
            ) : (
              <WorkspaceSectionView
                activeNav={activeNav}
                activeCategoryLabel={activeCategory?.label ?? null}
                sessions={filteredContent.sessions}
                projects={INITIAL_PROJECTS}
                templates={filteredContent.templates}
                documents={filteredContent.documents}
                onOpenSession={(sess) => {
                  handleSelectSession(sess.id);
                }}
                onUseTemplate={(tplText) => {
                  setPromptValue(tplText);
                  setActiveSessionId(null);
                  setActiveCategoryId(null);
                  setActiveNav('chats');
                  setSearchQuery('');
                }}
                onResetToNewChat={handleNewChat}
                isDemoMode={isDemoMode}
              />
            )}
          </main>
        </div>
      </div>

      {/* Accessible Modals */}
      <PromptLibraryModal
        open={promptLibraryOpen}
        templates={INITIAL_TEMPLATES}
        onClose={() => setPromptLibraryOpen(false)}
        onSelectTemplate={(tplText) => {
          setPromptValue(tplText);
        }}
      />

      <ModelParamsModal
        open={modelParamsOpen}
        params={modelParams}
        onSave={setModelParams}
        onClose={() => setModelParamsOpen(false)}
      />

      <CommandSearchModal
        open={commandSearchOpen}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        sessions={filteredContent.sessions}
        templates={filteredContent.templates}
        onSelectSession={(sess) => {
          handleSelectSession(sess.id);
        }}
        onSelectTemplate={(tplText) => {
          setPromptValue(tplText);
          setActiveSessionId(null);
          setActiveCategoryId(null);
          setActiveNav('chats');
        }}
        onClose={() => setCommandSearchOpen(false)}
      />
    </div>
  );
}
