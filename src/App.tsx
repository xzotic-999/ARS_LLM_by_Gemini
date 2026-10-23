/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChatComposer } from './components/ChatComposer';
import { QuickPrompts } from './components/QuickPrompts';
import { ChatThreadView } from './components/ChatThreadView';
import {
  WorkspaceSectionView,
  PromptLibraryModal,
  ModelParamsModal,
  CommandSearchModal,
} from './components/WorkspaceModalsAndViews';
import {
  ChatListCategory,
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
  submitChatPrompt,
} from './utils/dashboardLogic';

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [activeNav, setActiveNav] = useState<NavSectionId>('chats');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [chatLists, setChatLists] = useState<ChatListCategory[]>(INITIAL_CHAT_LISTS);
  const [sessions, setSessions] = useState<ChatSession[]>(INITIAL_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [promptValue, setPromptValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [modelParamsOpen, setModelParamsOpen] = useState(false);
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [modelParams, setModelParams] = useState<ModelParameters>(DEFAULT_MODEL_PARAMETERS);

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
    setActiveSessionId(null);
    setActiveCategoryId(null);
    setActiveNav('chats');
    setPromptValue('');
  };

  const handleSubmitPrompt = (text: string, attachments: string[]) => {
    const res = submitChatPrompt({
      existingSession: activeSession,
      promptText: text,
      attachments,
      categoryId: activeCategoryId ?? 'code',
      modelParams,
    });
    if (!res.ok) return;

    if (activeSession) {
      setSessions((prev) => prev.map((s) => (s.id === res.session.id ? res.session : s)));
    } else {
      setSessions((prev) => [res.session, ...prev]);
      setActiveSessionId(res.session.id);
    }
    setActiveNav('chats');
    setPromptValue('');
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
      default:
        return 'Новый чат';
    }
  }, [activeSession, activeCategory, activeNav]);

  const showNewChatWelcome =
    activeNav === 'chats' && activeSession === null && activeCategoryId === null && !searchQuery.trim();

  return (
    <div className="theme-transition min-h-screen w-full bg-[#EEF1F7] dark:bg-[#070A12] text-[#111827] dark:text-slate-100 flex flex-col md:p-4 lg:p-5">
      {/* WCAG Skip Link for Keyboard Users */}
      <a
        href="#main-workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#5046E5] focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Перейти к основному содержимому
      </a>

      {/* Outer Dashboard Frame matching the reference screenshot */}
      <div className="flex-1 flex w-full max-w-[1440px] mx-auto md:rounded-[24px] overflow-hidden border border-[#E2E5EE] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] shadow-[0_14px_44px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_44px_rgba(0,0,0,0.45)] min-h-[calc(100vh-2.5rem)]">
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
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#0E1322]">
          <TopBar
            title={topBarTitle}
            theme={theme}
            onSelectTheme={setTheme}
            onNewChat={handleNewChat}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
          />

          <main
            id="main-workspace"
            tabIndex={-1}
            className="flex-1 flex flex-col overflow-y-auto focus:outline-none"
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
                  setActiveSessionId(sess.id);
                  setActiveNav('chats');
                }}
                onUseTemplate={(tplText) => {
                  setPromptValue(tplText);
                  setActiveSessionId(null);
                  setActiveCategoryId(null);
                  setActiveNav('chats');
                  setSearchQuery('');
                }}
                onResetToNewChat={handleNewChat}
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
          setActiveSessionId(sess.id);
          setActiveNav('chats');
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
