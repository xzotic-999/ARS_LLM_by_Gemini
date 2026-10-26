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
  ProfileModal,
} from './components/WorkspaceModalsAndViews';
import {
  ChatListCategory,
  ChatMessage,
  ChatSession,
  DEFAULT_ADMIN_USERS,
  DEFAULT_MODEL_PARAMETERS,
  INITIAL_CHAT_LISTS,
  INITIAL_DOCUMENTS,
  INITIAL_PROJECTS,
  INITIAL_SESSIONS,
  INITIAL_TEMPLATES,
  ModelParameters,
  NavSectionId,
  PersistedWorkspaceState,
  QUICK_PROMPTS,
  QuickPrompt,
  QuotaUpdateTargetUser,
  ThemeMode,
  WORKSPACE_STORAGE_KEY,
  applyThemeWithSmoothTransition,
  canConfigureQuotas,
  createCustomChatList,
  deduplicateSessions,
  deserializeWorkspaceState,
  evaluateQuotaBlockStatus,
  filterWorkspaceContent,
  formatTimestampShort,
  mapBackendConversationToSession,
  prependPersonalInstructionsToHistory,
  serializeWorkspaceState,
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
import {
  AttachedFileItem,
  buildPromptWithUntrustedAttachments,
} from './utils/fileExtractor';

const buildPromptWithAttachments = buildPromptWithUntrustedAttachments;

const DEMO_EMPLOYEE_USER: UserProfile = {
  id: 2,
  email: 'employee@company.kz',
  name: 'Сотрудник',
  role: 'user',
};

const DEMO_ADMIN_USER: UserProfile = {
  id: 1,
  email: 'admin@ars_llm.local',
  name: 'Администратор ИТ',
  role: 'admin',
};

const DEFAULT_DEMO_QUOTAS: QuotaLimits = {
  daily: { used: 4, limit: 20 },
  monthly: { used: 38, limit: 500 },
};

function hasDemoQueryParam(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('demo') === '1' || params.get('autostart') === '1';
}

function getQueryDemoRole(): 'user' | 'admin' | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');
  if (roleParam === 'admin' || roleParam === 'user') {
    return roleParam;
  }
  return null;
}

function readPersistedWorkspace(): PersistedWorkspaceState | null {
  if (typeof window === 'undefined') return null;
  try {
    return deserializeWorkspaceState(window.localStorage.getItem(WORKSPACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getQuotasForDemoRole(
  role: 'user' | 'admin',
  adminUsers: QuotaUpdateTargetUser[]
): QuotaLimits {
  const targetEmail = role === 'admin' ? 'admin@ars_llm.local' : 'employee@company.kz';
  const entry =
    adminUsers.find((u) => u.email === targetEmail) ??
    adminUsers.find((u) => u.email === 'employee@company.kz');
  if (!entry) return DEFAULT_DEMO_QUOTAS;
  return entry.quotas;
}

export default function App() {
  const initialPersisted = useMemo(() => readPersistedWorkspace(), []);
  const initialDemoActive = hasDemoQueryParam() || Boolean(initialPersisted?.isDemoMode);
  const initialDemoRole: 'user' | 'admin' =
    getQueryDemoRole() ?? initialPersisted?.demoRole ?? 'user';
  const initialAdminUsers = initialPersisted?.adminUsers ?? DEFAULT_ADMIN_USERS;

  const [theme, setTheme] = useState<ThemeMode>(() => initialPersisted?.theme ?? 'light');
  const [authChecked, setAuthChecked] = useState<boolean>(() => initialDemoActive);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => initialDemoActive);
  const [demoRole, setDemoRole] = useState<'user' | 'admin'>(() => initialDemoRole);
  const [adminUsers, setAdminUsers] = useState<QuotaUpdateTargetUser[]>(() => initialAdminUsers);

  const [user, setUser] = useState<UserProfile | null>(() => {
    if (!initialDemoActive) return null;
    const baseUser = initialDemoRole === 'admin' ? DEMO_ADMIN_USER : DEMO_EMPLOYEE_USER;
    return initialPersisted?.profileDisplayName
      ? { ...baseUser, name: initialPersisted.profileDisplayName }
      : baseUser;
  });

  const [backendQuotas, setBackendQuotas] = useState<QuotaLimits | null>(null);

  const [activeNav, setActiveNav] = useState<NavSectionId>(() => {
    const savedNav = initialPersisted?.activeNav ?? 'chats';
    if (savedNav === 'admin' && initialDemoActive && initialDemoRole !== 'admin') {
      return 'quotas';
    }
    return savedNav;
  });
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(
    () => initialPersisted?.activeCategoryId ?? null
  );
  const [chatLists, setChatLists] = useState<ChatListCategory[]>(
    () => initialPersisted?.chatLists ?? INITIAL_CHAT_LISTS
  );
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (initialPersisted?.sessions && initialPersisted.sessions.length > 0) {
      return deduplicateSessions(initialPersisted.sessions);
    }
    return initialDemoActive ? INITIAL_SESSIONS : [];
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => initialPersisted?.activeSessionId ?? null
  );

  const [promptValue, setPromptValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [modelParamsOpen, setModelParamsOpen] = useState(false);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [personalInstructions, setPersonalInstructions] = useState<string>(
    () => initialPersisted?.personalInstructions ?? ''
  );
  const [profileDisplayName, setProfileDisplayName] = useState<string | undefined>(
    () => initialPersisted?.profileDisplayName
  );
  const [profileAvatarColor, setProfileAvatarColor] = useState<string>(
    () => initialPersisted?.profileAvatarColor ?? '#4F46E5'
  );

  const [modelParams, setModelParams] = useState<ModelParameters>(
    () => initialPersisted?.modelParams ?? DEFAULT_MODEL_PARAMETERS
  );

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

  const handleSelectTheme = useCallback(
    (nextTheme: ThemeMode) => {
      if (nextTheme === theme) return;
      applyThemeWithSmoothTransition(nextTheme, setTheme);
    },
    [theme]
  );

  // Persist workspace state (chats, active session, quotas, role, theme, personal instructions) so refresh never loses data
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = serializeWorkspaceState({
        theme,
        isDemoMode,
        demoRole,
        sessions,
        activeSessionId,
        activeNav,
        activeCategoryId,
        chatLists,
        adminUsers,
        modelParams,
        personalInstructions,
        profileDisplayName,
        profileAvatarColor,
      });
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, payload);
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  }, [
    theme,
    isDemoMode,
    demoRole,
    sessions,
    activeSessionId,
    activeNav,
    activeCategoryId,
    chatLists,
    adminUsers,
    modelParams,
    personalInstructions,
    profileDisplayName,
    profileAvatarColor,
  ]);

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

  const quotas = useMemo<QuotaLimits | null>(() => {
    if (isDemoMode) {
      return getQuotasForDemoRole(demoRole, adminUsers);
    }
    return backendQuotas;
  }, [isDemoMode, demoRole, adminUsers, backendQuotas]);

  const quotaBlockStatus = useMemo(
    () => evaluateQuotaBlockStatus(quotas),
    [quotas]
  );

  const handleOpenQuotasView = useCallback(() => {
    setActiveSessionId(null);
    setActiveCategoryId(null);
    setActiveNav(canConfigureQuotas(user) ? 'admin' : 'quotas');
  }, [user]);

  const refreshQuotas = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const res = await authApi.quotas();
      setBackendQuotas(res.quotas);
    } catch {
      // Non-fatal if quotas endpoint fails
    }
  }, [isDemoMode]);

  const loadConversations = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const list = await conversationsApi.list();
      setSessions((prev) => {
        if (list.length === 0) {
          return deduplicateSessions(prev);
        }
        const prevById = new Map(prev.map((s) => [s.id, s]));
        const mappedFromBackend = list.map((conv) => {
          const existing = prevById.get(`conv-${conv.id}`);
          return mapBackendConversationToSession(
            conv,
            conv.messages ?? [],
            existing
          );
        });
        const backendIds = new Set(mappedFromBackend.map((s) => s.id));
        const localOnly = prev.filter((s) => !backendIds.has(s.id));
        return deduplicateSessions([...mappedFromBackend, ...localOnly]);
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
          setBackendQuotas(meRes.user.quotas);
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
    if (res.user.quotas) {
      setBackendQuotas(res.user.quotas);
    }
    setActiveSessionId(null);
    setActiveNav('chats');
    await Promise.all([loadConversations(), refreshQuotas()]);
  };

  const handleSwitchDemoRole = (role: 'user' | 'admin') => {
    setDemoRole(role);
    const baseUser = role === 'admin' ? DEMO_ADMIN_USER : DEMO_EMPLOYEE_USER;
    setUser(
      profileDisplayName ? { ...baseUser, name: profileDisplayName } : baseUser
    );
    if (role !== 'admin' && activeNav === 'admin') {
      setActiveNav('quotas');
    } else if (role === 'admin' && activeNav === 'quotas') {
      setActiveNav('admin');
    }
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
    setBackendQuotas(null);
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

    if (quotaBlockStatus.isBlocked) {
      setStreamError(
        quotaBlockStatus.message ??
          'Лимит запросов исчерпан. Обратитесь к администратору для увеличения квоты.'
      );
      return;
    }

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

      const historyForModel = prependPersonalInstructionsToHistory(
        [
          ...baseSession.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: promptWithAttachments },
        ],
        personalInstructions
      );

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
        setSessions((prev) => deduplicateSessions([updatedSession, ...prev]));
        setActiveSessionId(targetSessionId);
      }

      const activeEmail =
        demoRole === 'admin' ? 'admin@ars_llm.local' : 'employee@company.kz';
      setAdminUsers((prev) =>
        prev.map((u) =>
          u.email === activeEmail
            ? {
                ...u,
                quotas: {
                  daily: { ...u.quotas.daily, used: u.quotas.daily.used + 1 },
                  monthly: { ...u.quotas.monthly, used: u.quotas.monthly.used + 1 },
                },
              }
            : u
        )
      );

      const rollbackDemoQuotaIncrement = () => {
        setAdminUsers((prev) =>
          prev.map((u) =>
            u.email === activeEmail
              ? {
                  ...u,
                  quotas: {
                    daily: {
                      ...u.quotas.daily,
                      used: Math.max(0, u.quotas.daily.used - 1),
                    },
                    monthly: {
                      ...u.quotas.monthly,
                      used: Math.max(0, u.quotas.monthly.used - 1),
                    },
                  },
                }
              : u
          )
        );
      };

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
          if (abortController.signal.aborted && !finalContent) {
            rollbackDemoQuotaIncrement();
          }
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
          if (err instanceof ApiError && err.quotas) {
            const serverQuotas = err.quotas;
            setAdminUsers((prev) =>
              prev.map((u) =>
                u.email === activeEmail ? { ...u, quotas: serverQuotas } : u
              )
            );
          } else {
            rollbackDemoQuotaIncrement();
          }
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
    let currentSession = activeSession;
    let convId = currentSession?.conversationId;

    try {
      if (!currentSession || !convId) {
        const title = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
        const createdConv = await conversationsApi.create(title);
        convId = createdConv.id;
        currentSession = mapBackendConversationToSession(createdConv, []);
        currentSession.categoryId = activeCategoryId ?? 'code';
        setSessions((prev) => deduplicateSessions([currentSession!, ...prev]));
        setActiveSessionId(currentSession.id);
      }

      const targetSessionId = currentSession.id;
      const targetConvId = convId;
      setActiveNav('chats');
      setPromptValue('');

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

      const historyForModel = prependPersonalInstructionsToHistory(
        [
          ...currentSession.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: promptWithAttachments },
        ],
        personalInstructions
      );

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
          if (err instanceof ApiError && err.quotas) {
            setBackendQuotas(err.quotas);
          }
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
      if (err instanceof ApiError && err.quotas) {
        setBackendQuotas(err.quotas);
      }
      setStreamError(
        err instanceof Error ? err.message : 'Ошибка отправки сообщения'
      );
      refreshQuotas();
    }
  };

  const handleRetryLastPrompt = () => {
    if (!lastSubmittedPrompt || isStreaming || quotaBlockStatus.isBlocked) return;
    handleSubmitPrompt(
      lastSubmittedPrompt.text,
      lastSubmittedPrompt.attachments,
      lastSubmittedPrompt.attachmentDetails
    );
  };

  const handleRegenerateResponse = (assistantMessageId: string) => {
    if (isStreaming || quotaBlockStatus.isBlocked || !activeSession) return;
    const msgIdx = activeSession.messages.findIndex((m) => m.id === assistantMessageId);
    if (msgIdx <= 0) {
      if (lastSubmittedPrompt) {
        handleRetryLastPrompt();
      }
      return;
    }
    const precedingUserMsg = [...activeSession.messages.slice(0, msgIdx)]
      .reverse()
      .find((m) => m.role === 'user');
    if (!precedingUserMsg) return;

    const prunedMessages = activeSession.messages.slice(0, msgIdx);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, messages: prunedMessages } : s
      )
    );

    handleSubmitPrompt(
      precedingUserMsg.content,
      precedingUserMsg.attachments ?? []
    );
  };

  const handleEditUserPrompt = (userMessageId: string, newContent: string) => {
    if (isStreaming || quotaBlockStatus.isBlocked || !activeSession) return;
    const msgIdx = activeSession.messages.findIndex((m) => m.id === userMessageId);
    if (msgIdx === -1) return;

    const existingMsg = activeSession.messages[msgIdx];
    const prunedMessages = activeSession.messages.slice(0, msgIdx);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, messages: prunedMessages } : s
      )
    );

    handleSubmitPrompt(newContent, existingMsg.attachments ?? []);
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
      case 'quotas':
        return 'Мои квоты';
      case 'admin':
        return canConfigureQuotas(user) ? 'Админ-панель' : 'Мои квоты';
      default:
        return 'Новый чат';
    }
  }, [activeSession, activeCategory, activeNav, user]);

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
        onSelectTheme={handleSelectTheme}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden w-full bg-white dark:bg-[#0E1322] text-[#0F172A] dark:text-slate-100">
      {/* WCAG Skip Link for Keyboard Users */}
      <a
        href="#main-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#4F46E5] focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Перейти к основному содержимому
      </a>

      {/* Full-Width Workspace Frame (maximum useful width without outer side margins) */}
      <div className="flex-1 min-h-0 flex w-full h-full overflow-hidden bg-white dark:bg-[#0E1322]">
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
          avatarColor={profileAvatarColor}
          onOpenProfile={() => setProfileModalOpen(true)}
          onLogout={handleLogout}
          isDemoMode={isDemoMode}
          onSwitchDemoRole={handleSwitchDemoRole}
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
        <div className="flex-1 flex flex-col h-screen min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#0E1322]">
          <TopBar
            title={topBarTitle}
            theme={theme}
            onSelectTheme={handleSelectTheme}
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
              <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-8 md:py-10 w-full max-w-[1040px] mx-auto">
                {/* Greeting Hero */}
                <div className="text-center max-w-[580px] mx-auto mb-7">
                  <h2 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-[#0F172A] dark:text-white flex items-center justify-center gap-2.5">
                    <span>Здравствуйте!</span>
                    <span role="img" aria-label="Приветствие">
                      👋
                    </span>
                  </h2>
                  <p className="mt-2.5 text-[15px] leading-[1.6] text-[#475569] dark:text-slate-300 text-balance">
                    Задавайте вопросы, анализируйте информацию
                    <br className="hidden sm:inline" /> и решайте рабочие задачи — в одном чате.
                  </p>
                </div>

                {/* Single Clean Bottom Composer Card */}
                <ChatComposer
                  promptValue={promptValue}
                  onPromptChange={setPromptValue}
                  onSubmitPrompt={handleSubmitPrompt}
                  onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
                  onOpenModelParams={() => setModelParamsOpen(true)}
                  quotaBlockStatus={quotaBlockStatus}
                  onOpenQuotasView={handleOpenQuotasView}
                />

                {streamError && !quotaBlockStatus.isBlocked && (
                  <div
                    role="alert"
                    className="mt-4 w-full max-w-[820px] p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[13px] text-red-700 dark:text-red-300 text-center"
                  >
                    {streamError}
                  </div>
                )}

                {/* Quick Prompts Grid */}
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
                onRegenerateResponse={handleRegenerateResponse}
                onEditUserPrompt={handleEditUserPrompt}
                quotaBlockStatus={quotaBlockStatus}
                onOpenQuotasView={handleOpenQuotasView}
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
                user={user}
                quotas={quotas}
                persistedAdminUsers={adminUsers}
                onUpdateAdminUsers={(updatedUsers) => {
                  setAdminUsers(updatedUsers);
                }}
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

      <ProfileModal
        open={profileModalOpen}
        user={user}
        quotas={quotas}
        personalInstructions={personalInstructions}
        avatarColor={profileAvatarColor}
        onSaveProfile={async ({ name, personalInstructions: nextInstructions, avatarColor }) => {
          setProfileDisplayName(name);
          setPersonalInstructions(nextInstructions);
          setProfileAvatarColor(avatarColor);
          setUser((prev) => (prev ? { ...prev, name } : prev));
          if (!isDemoMode) {
            try {
              const updated = await authApi.updateProfile({
                name,
                personalInstructions: nextInstructions,
              });
              setUser((prev) => (prev ? { ...prev, ...updated.user } : updated.user));
            } catch {
              // Keep local state if backend endpoint is unreachable in standalone mode
            }
          }
        }}
        onClose={() => setProfileModalOpen(false)}
      />
    </div>
  );
}
