import React from 'react';
import { Sun, Moon, Plus, Menu, Download } from 'lucide-react';
import {
  ChatSession,
  ThemeMode,
  createChatMarkdownDataUri,
  getChatMarkdownFilename,
} from '../utils/dashboardLogic';

interface TopBarProps {
  title: string;
  theme: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
  onNewChat: () => void;
  onOpenMobileMenu: () => void;
  exportSession: ChatSession | null;
  isDemoMode?: boolean;
  userRole?: string;
  onSwitchDemoRole?: (role: 'admin' | 'user') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  theme,
  onSelectTheme,
  onNewChat,
  onOpenMobileMenu,
  exportSession,
  isDemoMode = false,
  userRole = 'user',
  onSwitchDemoRole,
}) => {
  const canExport = Boolean(exportSession && exportSession.messages.length > 0);
  const isDark = theme === 'dark';
  const isAdmin = userRole === 'admin';

  const handleToggleTheme = () => {
    onSelectTheme(isDark ? 'light' : 'dark');
  };

  const handleExportMarkdown = () => {
    if (!exportSession || exportSession.messages.length === 0) return;
    const href = createChatMarkdownDataUri(exportSession);
    const filename = getChatMarkdownFilename(exportSession);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <header className="h-[62px] px-5 md:px-7 border-b border-[#E6E8F0] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] flex items-center justify-between gap-4 shrink-0">
      {/* Left Zone: Mobile Menu Trigger + Current View Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Открыть меню навигации"
          className="focus-ring md:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <h1 className="text-[18px] md:text-[19px] font-bold tracking-tight text-[#111827] dark:text-slate-100 truncate">
          {title}
        </h1>
      </div>

      {/* Right Zone: Demo Role Segmented Switcher + Theme Switch + Export Markdown + New Chat CTA */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {isDemoMode && onSwitchDemoRole && (
          <div
            role="group"
            aria-label="Переключение роли для демонстрации"
            className="hidden lg:flex items-center p-0.5 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-[#F4F6FA] dark:bg-slate-800/80 text-[12px]"
          >
            <button
              type="button"
              aria-pressed={!isAdmin}
              onClick={() => onSwitchDemoRole('user')}
              className={`focus-ring px-2.5 py-1 rounded-[9px] font-medium whitespace-nowrap ${
                !isAdmin
                  ? 'bg-white dark:bg-[#151B2E] text-[#111827] dark:text-white font-semibold shadow-2xs'
                  : 'text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-200'
              }`}
            >
              Сотрудник
            </button>
            <button
              type="button"
              aria-pressed={isAdmin}
              onClick={() => onSwitchDemoRole('admin')}
              className={`focus-ring px-2.5 py-1 rounded-[9px] font-medium whitespace-nowrap ${
                isAdmin
                  ? 'bg-white dark:bg-[#151B2E] text-[#4F46E5] dark:text-indigo-300 font-semibold shadow-2xs'
                  : 'text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-200'
              }`}
            >
              Админ
            </button>
          </div>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Сменить тему на светлую' : 'Сменить тему на тёмную'}
          title="Сменить тему"
          onClick={handleToggleTheme}
          className="focus-ring relative inline-flex h-[36px] w-[68px] shrink-0 cursor-pointer items-center rounded-full border border-[#E2E5EE] dark:border-slate-700/90 bg-[#F0F2F7] dark:bg-slate-800/90 p-1 hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <span className="sr-only">Сменить тему</span>
          <span className="flex w-full items-center justify-between px-1.5 text-slate-400 dark:text-slate-500 pointer-events-none">
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span
            className={`absolute left-1 top-1 flex h-[26px] w-[28px] items-center justify-center rounded-full shadow-xs transition-transform duration-200 ease-out ${
              isDark
                ? 'translate-x-[30px] bg-[#4F46E5] text-white'
                : 'translate-x-0 bg-white text-[#4F46E5]'
            }`}
          >
            {isDark ? (
              <Moon className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
            ) : (
              <Sun className="w-3.5 h-3.5 stroke-[2.2]" aria-hidden="true" />
            )}
          </span>
        </button>

        {/* Report 3: Disabled when messages.length === 0 or on empty New Chat screen */}
        <button
          type="button"
          disabled={!canExport}
          onClick={handleExportMarkdown}
          aria-label={
            canExport
              ? `Экспорт чата в Markdown (${getChatMarkdownFilename(exportSession!)})`
              : 'Экспорт чата в Markdown (недоступно в пустом чате)'
          }
          title={
            canExport
              ? `Скачать ${getChatMarkdownFilename(exportSession!)}`
              : 'Экспорт доступен после отправки первого сообщения'
          }
          className="focus-ring h-[38px] px-3.5 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/80 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200 text-[13px] font-medium flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <Download
            className="w-4 h-4 text-[#4F46E5] dark:text-indigo-400 stroke-[2]"
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Экспорт .md</span>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="focus-ring h-[38px] px-4 rounded-xl bg-[#5046E5] hover:bg-[#4338CA] active:bg-[#3730A3] text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-xs whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
          <span>Новый чат</span>
        </button>
      </div>
    </header>
  );
};
