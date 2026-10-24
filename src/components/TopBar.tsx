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
  const markdownHref = exportSession ? createChatMarkdownDataUri(exportSession) : undefined;
  const markdownFilename = exportSession ? getChatMarkdownFilename(exportSession) : 'chat-export.md';
  const isDark = theme === 'dark';

  const handleToggleTheme = () => {
    onSelectTheme(isDark ? 'light' : 'dark');
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

      {/* Right Zone: Interactive Theme Switch + Export Markdown Link + New Chat Primary CTA */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Report 7: Interactive Toggle Switch with clear active state and tooltip */}
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Сменить тему на светлую' : 'Сменить тему на тёмную'}
          title="Сменить тему"
          onClick={handleToggleTheme}
          className="focus-ring relative inline-flex h-[36px] w-[68px] shrink-0 cursor-pointer items-center rounded-full border border-[#E2E5EE] dark:border-slate-700/90 bg-[#F0F2F7] dark:bg-slate-800/90 p-1 transition-colors hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <span className="sr-only">Сменить тему</span>
          <span className="flex w-full items-center justify-between px-1.5 text-slate-400 dark:text-slate-500 pointer-events-none">
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span
            className={`absolute left-1 top-1 flex h-[26px] w-[28px] items-center justify-center rounded-full shadow-xs transition-transform duration-200 ${
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

        {markdownHref && (
          <a
            href={markdownHref}
            download={markdownFilename}
            aria-label={`Экспорт чата в Markdown (${markdownFilename})`}
            title={`Скачать ${markdownFilename}`}
            className="focus-ring h-[38px] px-3.5 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200 text-[13px] font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-[#4F46E5] dark:text-indigo-400 stroke-[2]" aria-hidden="true" />
            <span className="hidden sm:inline">Экспорт .md</span>
          </a>
        )}

        <button
          type="button"
          onClick={onNewChat}
          className="focus-ring h-[38px] px-4 rounded-xl bg-[#5046E5] hover:bg-[#4338CA] active:bg-[#3730A3] text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-xs transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
          <span>Новый чат</span>
        </button>
      </div>
    </header>
  );
};
