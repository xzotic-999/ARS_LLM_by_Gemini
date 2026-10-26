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
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  theme,
  onSelectTheme,
  onNewChat,
  onOpenMobileMenu,
  exportSession,
}) => {
  const canExport = Boolean(exportSession && exportSession.messages.length > 0);
  const isDark = theme === 'dark';

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
    <header className="h-[60px] px-5 md:px-7 border-b border-[#E6E8F0] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] flex items-center justify-between gap-4 shrink-0">
      {/* Left Zone: Mobile Menu Trigger + Current View Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Открыть меню навигации"
          className="focus-ring md:hidden p-2 rounded-xl border border-[#E2E5EE] dark:border-slate-700 text-[#0F172A] dark:text-slate-200 hover:bg-[#F8FAFC] dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <h1 className="text-[17px] md:text-[18px] font-bold tracking-tight text-[#0F172A] dark:text-slate-100 truncate">
          {title}
        </h1>
      </div>

      {/* Right Zone: Theme Switch + Export Markdown + New Chat CTA */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Сменить тему на светлую' : 'Сменить тему на тёмную'}
          title="Сменить тему"
          onClick={handleToggleTheme}
          className="focus-ring relative inline-flex h-[36px] w-[66px] shrink-0 cursor-pointer items-center rounded-full border border-[#E2E5EE] dark:border-slate-700/90 bg-[#F1F5F9] dark:bg-slate-800/90 p-1 hover:border-[#4F46E5] dark:hover:border-indigo-500 transition-colors"
        >
          <span className="sr-only">Сменить тему</span>
          <span className="flex w-full items-center justify-between px-1.5 text-[#64748B] dark:text-slate-500 pointer-events-none">
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span
            className={`absolute left-1 top-1 flex h-[26px] w-[27px] items-center justify-center rounded-full shadow-2xs transition-transform duration-200 ease-out ${
              isDark
                ? 'translate-x-[29px] bg-[#4F46E5] text-white'
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
          className="focus-ring h-[36px] px-3.5 rounded-[11px] border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/80 enabled:hover:bg-[#F8FAFC] dark:enabled:hover:bg-slate-800 text-[#1E293B] dark:text-slate-200 text-[13px] font-medium flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
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
          className="focus-ring h-[36px] px-4 rounded-[11px] bg-[#4F46E5] hover:bg-[#4338CA] active:bg-[#3730A3] text-white text-[13px] font-semibold flex items-center gap-1.5 shadow-2xs whitespace-nowrap shrink-0 transition-colors"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
          <span>Новый чат</span>
        </button>
      </div>
    </header>
  );
};
