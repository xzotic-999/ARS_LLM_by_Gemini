import React, { useState } from 'react';
import {
  Search,
  Folder,
  FileText,
  File,
  Clock,
  Star,
  PlusCircle,
  MoreVertical,
  User,
  Check,
  X,
  Shield,
  LogOut,
  Pencil,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { ArsLogo } from './ArsLogo';
import {
  ChatListCategory,
  ChatSession,
  NavSectionId,
  canConfigureQuotas,
} from '../utils/dashboardLogic';
import { QuotaLimits, UserProfile } from '../services/api';

interface SidebarProps {
  activeNav: NavSectionId;
  onSelectNav: (nav: NavSectionId) => void;
  activeCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  chatLists: ChatListCategory[];
  onCreateList: (name: string, colorHex: string) => { ok: boolean; error?: string };
  sessions?: ChatSession[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  user?: UserProfile | null;
  quotas?: QuotaLimits | null;
  avatarColor?: string;
  onOpenProfile?: () => void;
  onLogout?: () => Promise<void> | void;
  isDemoMode?: boolean;
  onSwitchDemoRole?: (role: 'admin' | 'user') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenCommandSearch: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const BASE_NAV_ITEMS: { id: NavSectionId; label: string; adminOnly?: boolean }[] = [
  { id: 'chats', label: 'Чаты' },
  { id: 'projects', label: 'Проекты' },
  { id: 'templates', label: 'Шаблоны' },
  { id: 'documents', label: 'Документы' },
  { id: 'history', label: 'История' },
  { id: 'admin', label: 'Админ-панель', adminOnly: true },
];

const LIST_COLOR_SWATCHES = ['#6366F1', '#3B82F6', '#10B981', '#F59E0B', '#EC4899'];

export const Sidebar: React.FC<SidebarProps> = ({
  activeNav,
  onSelectNav,
  activeCategoryId,
  onSelectCategory,
  chatLists,
  onCreateList,
  sessions = [],
  activeSessionId = null,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  user = null,
  quotas = null,
  avatarColor = '#4F46E5',
  onOpenProfile,
  onLogout,
  isDemoMode = false,
  onSwitchDemoRole,
  searchQuery,
  onSearchChange,
  onOpenCommandSearch,
  collapsed,
  mobileOpen,
  onCloseMobile,
}) => {
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(LIST_COLOR_SWATCHES[0]);
  const [listError, setListError] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const isAdmin = canConfigureQuotas(user);
  const visibleNavItems = BASE_NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin
  );

  const handleCreateListSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = onCreateList(newListName, newListColor);
    if (!res.ok) {
      setListError(res.error ?? 'Ошибка создания списка');
      return;
    }
    setNewListName('');
    setListError(null);
    setIsAddingList(false);
  };

  const handleStartRename = (sess: ChatSession) => {
    setEditingSessionId(sess.id);
    setEditingTitle(sess.title);
  };

  const handleSaveRename = async (sessionId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && onRenameSession) {
      await onRenameSession(sessionId, trimmed);
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const renderNavIcon = (id: NavSectionId, isActive: boolean) => {
    const colorClass = isActive
      ? 'text-[#4F46E5] dark:text-indigo-400'
      : 'text-[#1F2937] dark:text-slate-300';

    switch (id) {
      case 'chats':
        return (
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 ${colorClass}`}
          >
            <path
              d="M3.5 5.5C3.5 4.39543 4.39543 3.5 5.5 3.5H14.5C15.6046 3.5 16.5 4.39543 16.5 5.5V12.5C16.5 13.6046 15.6046 14.5 14.5 14.5H7.5L3.5 17V5.5Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="7.5" cy="9" r="0.9" fill="currentColor" />
            <circle cx="10" cy="9" r="0.9" fill="currentColor" />
            <circle cx="12.5" cy="9" r="0.9" fill="currentColor" />
          </svg>
        );
      case 'projects':
        return <Folder className={`w-[18px] h-[18px] shrink-0 stroke-[1.7] ${colorClass}`} aria-hidden="true" />;
      case 'templates':
        return <FileText className={`w-[18px] h-[18px] shrink-0 stroke-[1.7] ${colorClass}`} aria-hidden="true" />;
      case 'documents':
        return <File className={`w-[18px] h-[18px] shrink-0 stroke-[1.7] ${colorClass}`} aria-hidden="true" />;
      case 'history':
        return <Clock className={`w-[18px] h-[18px] shrink-0 stroke-[1.7] ${colorClass}`} aria-hidden="true" />;
      case 'quotas':
      case 'admin':
        return <Shield className={`w-[18px] h-[18px] shrink-0 stroke-[1.7] ${colorClass}`} aria-hidden="true" />;
    }
  };

  const displayUserName =
    user?.name?.trim() ||
    (isAdmin ? 'Администратор' : 'Сотрудник');
  const displayUserEmail = user?.email || 'employee@company.kz';

  const sidebarContent = (
    <aside
      aria-label="Основная навигация"
      className={`flex flex-col h-full min-h-0 overflow-hidden bg-[#FAFAFC] dark:bg-[#111524] border-r border-[#E6E8F0] dark:border-slate-800/90 select-none transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-[268px]'
      }`}
    >
      {/* Top Brand Header (Report 5: clean logo without confusing [K] icon button) */}
      <div className="shrink-0 flex items-center px-4 pt-4 pb-3">
        <ArsLogo collapsed={collapsed} />
      </div>

      {/* Unified Monolithic Search Input with Ctrl + K */}
      <div className="shrink-0 px-4 pb-2.5">
        {collapsed ? (
          <button
            type="button"
            onClick={onOpenCommandSearch}
            aria-label="Поиск (Ctrl + K)"
            className="focus-ring flex items-center justify-center w-full h-10 rounded-xl border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-slate-900/80 text-[#6B7280] dark:text-slate-400 hover:border-indigo-400"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : (
          <div className="relative flex items-center">
            <Search
              className="w-4 h-4 text-[#6B7280] dark:text-slate-400 absolute left-3 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Поиск"
              aria-label="Поиск по чатам и шаблонам"
              className="focus-ring w-full h-[38px] pl-9 pr-16 rounded-xl border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-[#171C2E] text-[13.5px] text-[#111827] dark:text-slate-100 placeholder:text-[#9CA3AF] dark:placeholder:text-slate-500 transition-colors"
            />
            <button
              type="button"
              onClick={onOpenCommandSearch}
              aria-label="Открыть быстрый поиск (Ctrl + K)"
              className="focus-ring absolute right-2 px-1.5 py-0.5 rounded-md bg-[#F3F4F6] dark:bg-slate-800 text-[11px] font-medium text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-200 transition-colors"
            >
              Ctrl + K
            </button>
          </div>
        )}
      </div>

      {/* Independent Scroll Container for Navigation, Lists & Recent Dialogs (Report 3) */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1">
        {/* Primary Navigation */}
        <nav aria-label="Разделы рабочей области" className="space-y-0.5">
          {visibleNavItems.map((item) => {
            const isActive = activeNav === item.id && activeCategoryId === null && !activeSessionId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectCategory(null);
                  onSelectNav(item.id);
                  onCloseMobile();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`focus-ring w-full flex items-center ${
                  collapsed ? 'justify-center px-0' : 'px-3 gap-3'
                } h-[38px] rounded-xl text-[13.5px] transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#EBEEFF] dark:bg-indigo-500/20 font-semibold text-[#111827] dark:text-white'
                    : 'font-medium text-[#1F2937] dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                }`}
              >
                {renderNavIcon(item.id, isActive)}
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Hairline Divider */}
        <div className="my-2.5 mx-1 border-t border-[#E6E8F0] dark:border-slate-800/90" role="separator" />

        {/* Chat Lists */}
        {!collapsed && (
          <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-[#6B7280] dark:text-slate-400 uppercase">
            СПИСОК ЧАТОВ
          </div>
        )}

        {chatLists.map((list) => {
          const isSelected = activeCategoryId === list.id;
          return (
            <button
              key={list.id}
              type="button"
              onClick={() => {
                onSelectNav('chats');
                onSelectCategory(isSelected ? null : list.id);
                onCloseMobile();
              }}
              aria-pressed={isSelected}
              className={`focus-ring w-full flex items-center ${
                collapsed ? 'justify-center px-0' : 'justify-between px-3'
              } h-[34px] rounded-xl text-[13px] transition-colors whitespace-nowrap ${
                isSelected
                  ? 'bg-[#EBEEFF] dark:bg-indigo-500/20 font-semibold text-[#111827] dark:text-white'
                  : 'font-medium text-[#1F2937] dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                {list.isStar ? (
                  <Star
                    className="w-[15px] h-[15px] shrink-0 text-[#F59E0B] fill-[#F59E0B]"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="w-[13px] h-[13px] rounded-[4px] shrink-0"
                    style={{ backgroundColor: list.colorHex }}
                    aria-hidden="true"
                  />
                )}
                {!collapsed && <span className="truncate">{list.label}</span>}
              </span>
              {!collapsed && isSelected && (
                <span className="text-[11px] text-[#4F46E5] dark:text-indigo-300 tabular-nums">
                  {list.count}
                </span>
              )}
            </button>
          );
        })}

        {/* + Новый список */}
        {!collapsed && !isAddingList && (
          <button
            type="button"
            onClick={() => {
              setIsAddingList(true);
              setListError(null);
            }}
            className="focus-ring w-full flex items-center gap-3 px-3 h-[34px] rounded-xl text-[13px] font-medium text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors whitespace-nowrap"
          >
            <PlusCircle className="w-[16px] h-[16px] shrink-0 stroke-[1.7]" aria-hidden="true" />
            <span>Новый список</span>
          </button>
        )}

        {!collapsed && isAddingList && (
          <form
            onSubmit={handleCreateListSubmit}
            className="p-2.5 mt-1 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
            aria-label="Создание нового списка чатов"
          >
            <input
              type="text"
              value={newListName}
              onChange={(e) => {
                setNewListName(e.target.value);
                if (listError) setListError(null);
              }}
              placeholder="Название списка..."
              aria-label="Название нового списка"
              autoFocus
              className="focus-ring w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Цвет списка">
                {LIST_COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setNewListColor(swatch)}
                    aria-label={`Цвет ${swatch}`}
                    aria-checked={newListColor === swatch}
                    role="radio"
                    className={`w-4 h-4 rounded-full transition-transform ${
                      newListColor === swatch ? 'scale-125 ring-2 ring-offset-1 ring-indigo-500' : ''
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="submit"
                  aria-label="Сохранить список"
                  className="focus-ring p-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingList(false);
                    setListError(null);
                  }}
                  aria-label="Отменить создание списка"
                  className="focus-ring p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {listError && (
              <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">
                {listError}
              </p>
            )}
          </form>
        )}

        {/* Recent Conversations Section */}
        {!collapsed && sessions.length > 0 && onSelectSession && (
          <div className="pt-2.5 space-y-0.5">
            <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-[#6B7280] dark:text-slate-400 uppercase">
              НЕДАВНИЕ ДИАЛОГИ
            </div>
            {sessions.slice(0, 8).map((sess) => {
              const isCurrent = activeSessionId === sess.id;
              const isEditing = editingSessionId === sess.id;

              if (isEditing) {
                return (
                  <div
                    key={sess.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-xl border border-indigo-400 bg-white dark:bg-slate-900"
                  >
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(sess.id);
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                      aria-label="Новое название диалога"
                      autoFocus
                      className="focus-ring flex-1 min-w-0 text-[12.5px] bg-transparent text-slate-900 dark:text-slate-100 px-1"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRename(sess.id)}
                      aria-label="Сохранить название диалога"
                      className="focus-ring p-1 rounded text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSessionId(null)}
                      aria-label="Отменить переименование"
                      className="focus-ring p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={sess.id}
                  className={`group flex items-center justify-between px-2.5 h-[32px] rounded-xl text-[13px] transition-colors ${
                    isCurrent
                      ? 'bg-[#EBEEFF] dark:bg-indigo-500/20 font-semibold text-[#111827] dark:text-white'
                      : 'text-[#374151] dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(sess.id);
                      onCloseMobile();
                    }}
                    className="focus-ring flex-1 flex items-center gap-2.5 min-w-0 text-left h-full"
                  >
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                    <span className="truncate">{sess.title}</span>
                  </button>

                  {(onRenameSession || onDeleteSession) && (
                    <div className="hidden group-hover:flex focus-within:flex items-center gap-0.5 shrink-0 ml-1">
                      {onRenameSession && (
                        <button
                          type="button"
                          onClick={() => handleStartRename(sess)}
                          aria-label={`Переименовать диалог «${sess.title}»`}
                          className="focus-ring p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {onDeleteSession && (
                        <button
                          type="button"
                          onClick={() => onDeleteSession(sess.id)}
                          aria-label={`Удалить диалог «${sess.title}»`}
                          className="focus-ring p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pinned Bottom Section: Quotas + User Profile Footer (Report 3 & Report 4) */}
      <div className="mt-auto shrink-0 pt-2 bg-[#FAFAFC] dark:bg-[#111524]">
        {/* Quota Usage Card with Linear Progress Bars (Report 4) */}
        {!collapsed && quotas && (() => {
          const dailyLimit =
            typeof quotas.daily.limit === 'number' && quotas.daily.limit >= 0
              ? quotas.daily.limit
              : null;
          const monthlyLimit =
            typeof quotas.monthly.limit === 'number' && quotas.monthly.limit >= 0
              ? quotas.monthly.limit
              : null;

          const dailyPct =
            dailyLimit !== null
              ? dailyLimit === 0
                ? 100
                : Math.min(100, Math.round((quotas.daily.used / dailyLimit) * 100))
              : 0;
          const monthlyPct =
            monthlyLimit !== null
              ? monthlyLimit === 0
                ? 100
                : Math.min(100, Math.round((quotas.monthly.used / monthlyLimit) * 100))
              : 0;

          const isExhausted =
            (dailyLimit !== null && quotas.daily.used >= dailyLimit) ||
            (monthlyLimit !== null && quotas.monthly.used >= monthlyLimit);

          const getBarColor = (pct: number, exhausted: boolean) => {
            if (exhausted || pct >= 90) return 'bg-red-500 dark:bg-red-400';
            if (pct >= 75) return 'bg-amber-500 dark:bg-amber-400';
            return 'bg-[#4F46E5] dark:bg-indigo-400';
          };

          return (
            <div
              className={`mx-3 mb-2 p-2.5 rounded-xl border ${
                isExhausted
                  ? 'border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20'
                  : 'border-[#E6E8F0] dark:border-slate-800 bg-white dark:bg-[#151A2D]'
              } space-y-2`}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B7280] dark:text-slate-400">
                <span>{isExhausted ? 'Квота исчерпана' : 'Квоты запросов'}</span>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCategory(null);
                      onSelectNav('admin');
                      onCloseMobile();
                    }}
                    className="focus-ring text-[#4F46E5] dark:text-indigo-400 hover:underline font-semibold"
                  >
                    Настроить
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCategory(null);
                      onSelectNav('quotas');
                      onCloseMobile();
                    }}
                    className="focus-ring text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-200 font-medium"
                    title="Просмотр ваших персональных лимитов"
                  >
                    Только просмотр
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-medium text-[#4B5563] dark:text-slate-300">
                  <span>Дневной лимит</span>
                  <span className="tabular-nums text-[#1F2937] dark:text-slate-200">
                    {quotas.daily.used} / {dailyLimit ?? '∞'}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Использование дневного лимита"
                  aria-valuenow={quotas.daily.used}
                  aria-valuemin={0}
                  aria-valuemax={dailyLimit ?? 100}
                  className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${getBarColor(
                      dailyPct,
                      dailyLimit !== null && quotas.daily.used >= dailyLimit
                    )}`}
                    style={{ width: `${dailyLimit !== null ? dailyPct : 10}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-medium text-[#4B5563] dark:text-slate-300">
                  <span>Месячный лимит</span>
                  <span className="tabular-nums text-[#1F2937] dark:text-slate-200">
                    {quotas.monthly.used} / {monthlyLimit ?? '∞'}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Использование месячного лимита"
                  aria-valuenow={quotas.monthly.used}
                  aria-valuemin={0}
                  aria-valuemax={monthlyLimit ?? 100}
                  className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${getBarColor(
                      monthlyPct,
                      monthlyLimit !== null && quotas.monthly.used >= monthlyLimit
                    )}`}
                    style={{ width: `${monthlyLimit !== null ? monthlyPct : 10}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* User Profile Footer */}
        <div className="relative pt-2.5 pb-3.5 px-3 border-t border-[#E6E8F0] dark:border-slate-800/90">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-1.5`}>
            <button
              type="button"
              onClick={() => {
                if (onOpenProfile) {
                  onOpenProfile();
                  setProfileMenuOpen(false);
                } else {
                  setProfileMenuOpen((prev) => !prev);
                }
              }}
              aria-label={`Открыть профиль: ${displayUserName}`}
              title="Открыть профиль и персональные инструкции"
              className="focus-ring flex items-center gap-2.5 min-w-0 flex-1 p-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-slate-800/70 text-left transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold tracking-wide shrink-0"
                style={{ backgroundColor: avatarColor || '#4F46E5' }}
                aria-hidden="true"
              >
                {(() => {
                  const parts = displayUserName.trim().split(/\s+/).filter(Boolean);
                  if (parts.length >= 2) {
                    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
                  }
                  return displayUserName.trim().slice(0, 2).toUpperCase() || 'СО';
                })()}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                    {displayUserName}
                  </div>
                  <div className="text-[11.5px] text-[#64748B] dark:text-slate-400 truncate font-mono">
                    {displayUserEmail}
                  </div>
                </div>
              )}
            </button>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                aria-label="Меню профиля сотрудника"
                aria-expanded={profileMenuOpen}
                className="focus-ring p-1.5 rounded-lg text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 shrink-0"
              >
                <MoreVertical className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {profileMenuOpen && !collapsed && (
            <div
              role="menu"
              aria-label="Действия профиля"
              className="animate-fade-up absolute bottom-15 left-3 right-3 p-1.5 rounded-[14px] border border-[#E2E5EE] dark:border-slate-700 bg-white dark:bg-[#151B2E] shadow-lg z-30 text-[12.5px] space-y-0.5"
            >
              <div className="px-2.5 py-1.5 text-[11.5px] font-medium text-[#64748B] dark:text-slate-400 border-b border-[#E6E8F0] dark:border-slate-700/70">
                Роль: {isAdmin ? 'Администратор' : 'Сотрудник'}
              </div>
              {onOpenProfile && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onOpenProfile();
                  }}
                  className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-[#0F172A] dark:text-slate-100 hover:bg-[#F8FAFC] dark:hover:bg-slate-800 font-medium flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5 text-[#4F46E5] dark:text-indigo-400" aria-hidden="true" />
                  <span>Профиль и инструкции</span>
                </button>
              )}
              {isAdmin ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectNav('admin');
                    setProfileMenuOpen(false);
                  }}
                  className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-[#F8FAFC] dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-[#4F46E5] dark:text-indigo-400" aria-hidden="true" />
                  <span>Управление квотами (Админ)</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectNav('quotas');
                    setProfileMenuOpen(false);
                  }}
                  className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-[#F8FAFC] dark:hover:bg-slate-800 flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>Мои квоты (только просмотр)</span>
                </button>
              )}
              {isDemoMode && onSwitchDemoRole && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSwitchDemoRole(isAdmin ? 'user' : 'admin');
                    setProfileMenuOpen(false);
                  }}
                  className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-[#4F46E5] dark:text-indigo-400 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 font-medium flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {isAdmin
                      ? 'Роль: Сотрудник'
                      : 'Роль: Администратор'}
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelectNav('history');
                  setProfileMenuOpen(false);
                }}
                className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-[#F8FAFC] dark:hover:bg-slate-800"
              >
                История активности
              </button>
              {onLogout && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout();
                  }}
                  className="focus-ring w-full text-left px-2.5 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Выйти из аккаунта</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:block h-full min-h-0 shrink-0">{sidebarContent}</div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
