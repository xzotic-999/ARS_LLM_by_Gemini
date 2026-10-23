import React from 'react';
import { Sun, Moon, Plus, Menu } from 'lucide-react';
import { ThemeMode } from '../utils/dashboardLogic';

interface TopBarProps {
  title: string;
  theme: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
  onNewChat: () => void;
  onOpenMobileMenu: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  theme,
  onSelectTheme,
  onNewChat,
  onOpenMobileMenu,
}) => {
  return (
    <header className="h-[68px] px-5 md:px-7 border-b border-[#E6E8F0] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] flex items-center justify-between gap-4 shrink-0">
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
        <h1 className="text-[19px] md:text-[20px] font-bold tracking-tight text-[#111827] dark:text-slate-100 truncate">
          {title}
        </h1>
      </div>

      {/* Right Zone: Theme Switcher + New Chat Primary CTA */}
      <div className="flex items-center gap-4 md:gap-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <span
            id="theme-switcher-label"
            className="hidden sm:inline text-[13.5px] font-medium text-[#1F2937] dark:text-slate-300"
          >
            Тема
          </span>
          <div
            role="group"
            aria-labelledby="theme-switcher-label"
            className="flex items-center p-1 rounded-full bg-[#F0F2F7] dark:bg-slate-800/90 border border-[#E5E7EB]/80 dark:border-slate-700/80"
          >
            <button
              type="button"
              aria-pressed={theme === 'light'}
              aria-label="Светлая тема"
              onClick={() => onSelectTheme('light')}
              className={`focus-ring w-9 h-7 rounded-full flex items-center justify-center transition-all ${
                theme === 'light'
                  ? 'bg-white text-[#4F46E5] shadow-xs'
                  : 'text-[#6B7280] dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-[16px] h-[16px] stroke-[2]" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              aria-label="Тёмная тема"
              onClick={() => onSelectTheme('dark')}
              className={`focus-ring w-9 h-7 rounded-full flex items-center justify-center transition-all ${
                theme === 'dark'
                  ? 'bg-[#1E253B] text-indigo-300 shadow-xs'
                  : 'text-[#6B7280] dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="w-[15px] h-[15px] stroke-[1.9]" aria-hidden="true" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onNewChat}
          className="focus-ring h-[40px] px-4 rounded-xl bg-[#5046E5] hover:bg-[#4338CA] active:bg-[#3730A3] text-white text-[13.5px] font-semibold flex items-center gap-2 shadow-xs transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
          <span>Новый чат</span>
        </button>
      </div>
    </header>
  );
};
