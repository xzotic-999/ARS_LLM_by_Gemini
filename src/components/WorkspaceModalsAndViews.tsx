import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Folder,
  FileText,
  Clock,
  Star,
  ArrowUpRight,
  SlidersHorizontal,
  Shield,
  Save,
  RefreshCw,
  Lock,
  User,
  Check,
} from 'lucide-react';
import {
  ChatSession,
  DEFAULT_ADMIN_USERS,
  DocumentItem,
  ModelParameters,
  NavSectionId,
  ProjectItem,
  PromptTemplate,
  applyQuotaLimitChange,
  canConfigureQuotas,
  deduplicateSessions,
  validateModelParameters,
  validateProfileUpdate,
} from '../utils/dashboardLogic';
import {
  adminApi,
  AdminUserRecord,
  AdminUsageResponse,
  QuotaLimits,
  UserProfile,
} from '../services/api';

interface SecondaryViewProps {
  activeNav: NavSectionId;
  activeCategoryLabel: string | null;
  sessions: ChatSession[];
  projects: ProjectItem[];
  templates: PromptTemplate[];
  documents: DocumentItem[];
  onOpenSession: (session: ChatSession) => void;
  onUseTemplate: (promptText: string) => void;
  onResetToNewChat: () => void;
  isDemoMode?: boolean;
  user?: UserProfile | null;
  quotas?: QuotaLimits | null;
  persistedAdminUsers?: AdminUserRecord[];
  onUpdateAdminUsers?: (
    updatedUsers: AdminUserRecord[],
    targetUserId: number,
    updatedQuotas: QuotaLimits
  ) => void;
}

const DEMO_ADMIN_USAGE: AdminUsageResponse = {
  summary: [
    { event_type: 'model_call', count: 150 },
    { event_type: 'message_sent', count: 154 },
  ],
  daily: [
    { date: '2026-10-23', event_type: 'model_call', count: 11 },
    { date: '2026-10-22', event_type: 'model_call', count: 24 },
  ],
  events: [
    {
      id: 501,
      user_id: 2,
      user_email: 'employee@company.kz',
      event_type: 'model_call',
      metadata: { message_count: 4 },
      created_at: '2026-10-23T12:05:00.000Z',
    },
  ],
};

export const WorkspaceSectionView: React.FC<SecondaryViewProps> = ({
  activeNav,
  activeCategoryLabel,
  sessions,
  projects,
  templates,
  documents,
  onOpenSession,
  onUseTemplate,
  onResetToNewChat,
  isDemoMode = false,
  user = null,
  quotas = null,
  persistedAdminUsers = DEFAULT_ADMIN_USERS,
  onUpdateAdminUsers,
}) => {
  const isAdmin = canConfigureQuotas(user);
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>(persistedAdminUsers);
  const [adminUsage, setAdminUsage] = useState<AdminUsageResponse | null>(DEMO_ADMIN_USAGE);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [quotaDrafts, setQuotaDrafts] = useState<
    Record<number, { daily: string; monthly: string }>
  >({});
  const [quotaSaveMessage, setQuotaSaveMessage] = useState<string | null>(null);

  const syncDraftsFromUsers = (usersList: AdminUserRecord[]) => {
    const drafts: Record<number, { daily: string; monthly: string }> = {};
    for (const u of usersList) {
      drafts[u.id] = {
        daily: u.quotas.daily.limit !== null ? String(u.quotas.daily.limit) : '',
        monthly: u.quotas.monthly.limit !== null ? String(u.quotas.monthly.limit) : '',
      };
    }
    setQuotaDrafts(drafts);
  };

  const loadAdminData = async () => {
    if (!isAdmin) return;
    setAdminLoading(true);
    setAdminError(null);
    if (isDemoMode) {
      const sourceUsers =
        persistedAdminUsers && persistedAdminUsers.length > 0
          ? persistedAdminUsers
          : DEFAULT_ADMIN_USERS;
      setAdminUsers(sourceUsers);
      setAdminUsage(DEMO_ADMIN_USAGE);
      syncDraftsFromUsers(sourceUsers);
      setAdminLoading(false);
      return;
    }

    try {
      const [usersRes, usageRes] = await Promise.all([
        adminApi.listUsers(),
        adminApi.getUsage({ days: 30 }),
      ]);
      setAdminUsers(usersRes.users);
      setAdminUsage(usageRes);
      syncDraftsFromUsers(usersRes.users);
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : 'Не удалось загрузить данные администратора.'
      );
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (activeNav === 'admin' && isAdmin) {
      loadAdminData();
    }
  }, [activeNav, isDemoMode, isAdmin]);

  useEffect(() => {
    if (isDemoMode && persistedAdminUsers && persistedAdminUsers.length > 0) {
      setAdminUsers(persistedAdminUsers);
      syncDraftsFromUsers(persistedAdminUsers);
    }
  }, [isDemoMode, persistedAdminUsers]);

  const handleSaveUserQuota = async (userId: number) => {
    const draft = quotaDrafts[userId];
    if (!draft) return;

    const validation = applyQuotaLimitChange({
      actor: user,
      users: adminUsers,
      targetUserId: userId,
      dailyInput: draft.daily,
      monthlyInput: draft.monthly,
    });

    if (!validation.ok) {
      setAdminError(validation.error);
      return;
    }

    setAdminError(null);
    setQuotaSaveMessage(null);

    const dailyLimit = validation.updatedQuotas.daily.limit;
    const monthlyLimit = validation.updatedQuotas.monthly.limit;

    if (isDemoMode) {
      setAdminUsers(validation.users);
      onUpdateAdminUsers?.(validation.users, userId, validation.updatedQuotas);
      const targetEmail = adminUsers.find((u) => u.id === userId)?.email ?? `#${userId}`;
      setQuotaSaveMessage(`Квоты для ${targetEmail} сохранены`);
      return;
    }

    try {
      const updated = await adminApi.setUserQuotas(userId, dailyLimit, monthlyLimit);
      const nextUsers = adminUsers.map((u) =>
        u.id === userId ? { ...u, quotas: updated.quotas } : u
      );
      setAdminUsers(nextUsers);
      onUpdateAdminUsers?.(nextUsers, userId, updated.quotas);
      const targetEmail = adminUsers.find((u) => u.id === userId)?.email ?? `#${userId}`;
      setQuotaSaveMessage(`Квоты для ${targetEmail} сохранены`);
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : 'Ошибка обновления квот пользователя'
      );
    }
  };

  // Read-only quota view for regular users (or if non-admin navigates to 'admin' or 'quotas')
  if (activeNav === 'quotas' || (activeNav === 'admin' && !isAdmin)) {
    const effectiveQuotas: QuotaLimits = quotas ?? {
      daily: { used: 4, limit: 20 },
      monthly: { used: 38, limit: 500 },
    };
    const dailyLimit =
      typeof effectiveQuotas.daily.limit === 'number' && effectiveQuotas.daily.limit >= 0
        ? effectiveQuotas.daily.limit
        : null;
    const monthlyLimit =
      typeof effectiveQuotas.monthly.limit === 'number' && effectiveQuotas.monthly.limit >= 0
        ? effectiveQuotas.monthly.limit
        : null;
    const dailyPct =
      dailyLimit !== null
        ? dailyLimit === 0
          ? 100
          : Math.min(100, Math.round((effectiveQuotas.daily.used / dailyLimit) * 100))
        : 0;
    const monthlyPct =
      monthlyLimit !== null
        ? monthlyLimit === 0
          ? 100
          : Math.min(100, Math.round((effectiveQuotas.monthly.used / monthlyLimit) * 100))
        : 0;
    const dailyRemaining =
      dailyLimit !== null ? Math.max(0, dailyLimit - effectiveQuotas.daily.used) : null;
    const monthlyRemaining =
      monthlyLimit !== null ? Math.max(0, monthlyLimit - effectiveQuotas.monthly.used) : null;

    return (
      <section
        aria-label="Мои квоты запросов"
        className="max-w-[920px] mx-auto w-full px-6 py-8 space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Мои квоты и лимиты запросов</span>
            </h2>
            <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
              Персональная статистика использования ИИ-шлюза ARS LLM · Режим просмотра для сотрудника.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetToNewChat}
            className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            К новому чату
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] space-y-3">
            <div className="flex items-center justify-between text-[13px] text-slate-500 dark:text-slate-400">
              <span>Дневной лимит запросов</span>
              <span className="tabular-nums font-medium">Обновление в 00:00 UTC</span>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-[26px] font-bold text-slate-900 dark:text-white tabular-nums">
                {effectiveQuotas.daily.used}{' '}
                <span className="text-[16px] font-normal text-slate-500 dark:text-slate-400">
                  / {dailyLimit ?? 'Без лимита'}
                </span>
              </div>
              <div className="text-[12.5px] text-slate-600 dark:text-slate-300 tabular-nums">
                {dailyRemaining !== null ? `Доступно: ${dailyRemaining}` : 'Без ограничений'}
              </div>
            </div>
            <div
              role="progressbar"
              aria-label="Использование дневной квоты"
              aria-valuenow={effectiveQuotas.daily.used}
              aria-valuemin={0}
              aria-valuemax={dailyLimit ?? 100}
              className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-[#4F46E5] dark:bg-indigo-400 transition-[width] duration-300"
                style={{ width: `${dailyLimit ? dailyPct : 10}%` }}
              />
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] space-y-3">
            <div className="flex items-center justify-between text-[13px] text-slate-500 dark:text-slate-400">
              <span>Месячный лимит запросов</span>
              <span className="tabular-nums font-medium">Текущий расчётный месяц</span>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-[26px] font-bold text-slate-900 dark:text-white tabular-nums">
                {effectiveQuotas.monthly.used}{' '}
                <span className="text-[16px] font-normal text-slate-500 dark:text-slate-400">
                  / {monthlyLimit ?? 'Без лимита'}
                </span>
              </div>
              <div className="text-[12.5px] text-slate-600 dark:text-slate-300 tabular-nums">
                {monthlyRemaining !== null ? `Доступно: ${monthlyRemaining}` : 'Без ограничений'}
              </div>
            </div>
            <div
              role="progressbar"
              aria-label="Использование месячной квоты"
              aria-valuenow={effectiveQuotas.monthly.used}
              aria-valuemin={0}
              aria-valuemax={monthlyLimit ?? 100}
              className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-[#4F46E5] dark:bg-indigo-400 transition-[width] duration-300"
                style={{ width: `${monthlyLimit ? monthlyPct : 10}%` }}
              />
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#131829]/70 text-[13px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-3">
          <span>
            Учётная запись: <strong className="text-slate-900 dark:text-white">{user?.email ?? 'employee@company.kz'}</strong> · Роль: Сотрудник (только просмотр квот).
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            Изменение лимитов выполняется администратором системы.
          </span>
        </div>
      </section>
    );
  }

  if (activeNav === 'admin') {
    return (
      <section aria-label="Панель администратора" className="max-w-[960px] mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Администрирование и управление квотами</span>
            </h2>
            <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
              Настройка дневных и месячных лимитов запросов сотрудников (доступно только администратору).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAdminData}
              disabled={adminLoading}
              className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${adminLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Обновить</span>
            </button>
            <button
              type="button"
              onClick={onResetToNewChat}
              className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              К новому чату
            </button>
          </div>
        </div>

        {adminError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-[13px] text-red-700 dark:text-red-300"
          >
            {adminError}
          </div>
        )}

        {quotaSaveMessage && (
          <div
            role="status"
            className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-[13px] text-emerald-700 dark:text-emerald-300"
          >
            {quotaSaveMessage}
          </div>
        )}

        {/* Usage Summary Cards */}
        {adminUsage && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829]">
              <div className="text-[12px] text-slate-500 dark:text-slate-400">Пользователей в системе</div>
              <div className="text-[22px] font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {adminUsers.length}
              </div>
            </div>
            {adminUsage.summary.slice(0, 2).map((item) => (
              <div
                key={item.event_type}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829]"
              >
                <div className="text-[12px] text-slate-500 dark:text-slate-400">
                  Событие: <span className="font-mono">{item.event_type}</span> (30 дн.)
                </div>
                <div className="text-[22px] font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                  {item.count}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Users & Quotas Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-[#131829]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Пользователь</th>
                <th className="py-3 px-4">Роль</th>
                <th className="py-3 px-4">Дневной лимит (исп. / лимит)</th>
                <th className="py-3 px-4">Месячный лимит (исп. / лимит)</th>
                <th className="py-3 px-4 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-[13.5px]">
              {adminUsers.map((u) => {
                const draft = quotaDrafts[u.id] ?? { daily: '', monthly: '' };
                return (
                  <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {u.email}
                    </td>
                    <td className="py-3.5 px-4 text-[13px] text-slate-600 dark:text-slate-300">
                      {u.role === 'admin' ? 'Администратор' : 'Сотрудник'}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400 text-[12.5px]">
                          {u.quotas.daily.used} /
                        </span>
                        <input
                          type="number"
                          min="0"
                          aria-label={`Дневной лимит для ${u.email}`}
                          value={draft.daily}
                          onChange={(e) =>
                            setQuotaDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, daily: e.target.value },
                            }))
                          }
                          placeholder="Без лимита"
                          className="focus-ring w-24 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13px] text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 tabular-nums">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400 text-[12.5px]">
                          {u.quotas.monthly.used} /
                        </span>
                        <input
                          type="number"
                          min="0"
                          aria-label={`Месячный лимит для ${u.email}`}
                          value={draft.monthly}
                          onChange={(e) =>
                            setQuotaDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, monthly: e.target.value },
                            }))
                          }
                          placeholder="Без лимита"
                          className="focus-ring w-24 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13px] text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleSaveUserQuota(u.id)}
                        aria-label={`Сохранить квоты для ${u.email}`}
                        className="focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5046E5] hover:bg-[#4338CA] text-white text-[12.5px] font-semibold"
                      >
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Сохранить</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (activeNav === 'projects') {
    return (
      <section aria-label="Проекты" className="max-w-[920px] mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100">
              Корпоративные проекты
            </h2>
            <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
              Рабочие пространства департаментов с общим контекстом и документацией.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetToNewChat}
            className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            К новому чату
          </button>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-[#131829]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Проект</th>
                <th className="py-3 px-4">Подразделение</th>
                <th className="py-3 px-4 text-right">Чатов</th>
                <th className="py-3 px-4 text-right">Обновлено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-[13.5px]">
              {projects.map((proj) => (
                <tr
                  key={proj.id}
                  onClick={onResetToNewChat}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
                    <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
                    <span>{proj.name}</span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{proj.department}</td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {proj.chatCount}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {proj.updatedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (activeNav === 'templates') {
    return (
      <section aria-label="Шаблоны промптов" className="max-w-[920px] mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100">
              Шаблоны рабочих запросов
            </h2>
            <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
              Проверенные промпты для инженеров, аналитиков и менеджеров.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetToNewChat}
            className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            К новому чату
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((tpl) => (
            <article
              key={tpl.id}
              className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] flex flex-col justify-between"
            >
              <div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400 mb-1">
                  {tpl.category} · Шаблон ARS LLM
                </div>
                <h3 className="text-[15.5px] font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                  {tpl.title}
                </h3>
                <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {tpl.description}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => onUseTemplate(tpl.promptText)}
                  className="focus-ring inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                >
                  <span>Использовать шаблон</span>
                  <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (activeNav === 'documents') {
    return (
      <section aria-label="Корпоративные документы" className="max-w-[920px] mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100">
              База документов (RAG)
            </h2>
            <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
              Проиндексированные файлы, доступные для цитирования и анализа в чате.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetToNewChat}
            className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            К новому чату
          </button>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-[#131829]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Документ</th>
                <th className="py-3 px-4">Формат</th>
                <th className="py-3 px-4 text-right">Размер</th>
                <th className="py-3 px-4 text-right">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 text-[13.5px]">
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => onUseTemplate(`Проанализируй документ «${doc.title}» и выдели ключевые тезисы.`)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
                    <span>{doc.title}</span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 font-mono text-[12px]">
                    {doc.format}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {doc.sizeLabel}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {doc.updatedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  // History or Category filtered sessions view
  return (
    <section
      aria-label={activeCategoryLabel ? `Список: ${activeCategoryLabel}` : 'История чатов'}
      className="max-w-[920px] mx-auto w-full px-6 py-8"
    >
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900 dark:text-slate-100">
            {activeCategoryLabel ? `Список чатов: ${activeCategoryLabel}` : 'История диалогов'}
          </h2>
          <p className="text-[13.5px] text-slate-600 dark:text-slate-400 mt-1">
            Выберите диалог для продолжения работы или начните новый чат.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetToNewChat}
          className="focus-ring px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          К новому чату
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] text-center">
          <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            В этом разделе пока нет диалогов
          </h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 mb-4">
            Создайте новый чат или выберите другой фильтр в боковой панели.
          </p>
          <button
            type="button"
            onClick={onResetToNewChat}
            className="focus-ring px-4 py-2 rounded-xl bg-[#5046E5] text-white text-[13px] font-semibold hover:bg-[#4338CA]"
          >
            Начать новый чат
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {deduplicateSessions(sessions).map((sess) => (
            <div
              key={sess.id}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] hover:border-indigo-400 dark:hover:border-indigo-500/70 flex items-center justify-between gap-4 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {sess.starred && (
                    <Star className="w-4 h-4 text-[#F59E0B] fill-[#F59E0B] shrink-0" aria-hidden="true" />
                  )}
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {sess.title}
                  </h3>
                </div>
                <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                  {sess.messages[sess.messages.length - 1]?.content}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[12px] text-slate-400 tabular-nums">{sess.updatedAt}</span>
                <button
                  type="button"
                  onClick={() => onOpenSession(sess)}
                  className="focus-ring px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 hover:text-white text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 transition-colors"
                >
                  Открыть
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

function useModalScrollAndEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) {
      document.body.style.overflow = 'unset';
      return;
    }
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
}

interface PromptLibraryModalProps {
  open: boolean;
  templates: PromptTemplate[];
  onClose: () => void;
  onSelectTemplate: (promptText: string) => void;
}

export const PromptLibraryModal: React.FC<PromptLibraryModalProps> = ({
  open,
  templates,
  onClose,
  onSelectTemplate,
}) => {
  useModalScrollAndEscape(open, onClose);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-library-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overscroll-contain"
    >
      <div className="w-full max-w-[560px] max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-6 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <h2 id="prompt-library-modal-title" className="text-[17px] font-bold text-slate-900 dark:text-slate-100">
            Библиотека промптов
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть библиотеку промптов"
            className="focus-ring p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 overflow-y-auto modal-scroll-thin pr-1">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex items-start justify-between gap-3"
            >
              <div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {tpl.category}
                </div>
                <div className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                  {tpl.title}
                </div>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mt-0.5">
                  {tpl.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelectTemplate(tpl.promptText);
                  onClose();
                }}
                className="focus-ring px-3 py-1.5 rounded-lg bg-[#5046E5] hover:bg-[#4338CA] text-white text-[12.5px] font-medium shrink-0"
              >
                Выбрать
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface ModelParamsModalProps {
  open: boolean;
  params: ModelParameters;
  onSave: (updated: ModelParameters) => void;
  onClose: () => void;
}

export const ModelParamsModal: React.FC<ModelParamsModalProps> = ({
  open,
  params,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState<ModelParameters>(params);
  const [error, setError] = useState<string | null>(null);

  useModalScrollAndEscape(open, onClose);

  useEffect(() => {
    setDraft(params);
    setError(null);
  }, [params, open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateModelParameters(draft);
    if (!check.valid) {
      setError(check.error ?? 'Некорректные параметры');
      return;
    }
    onSave(draft);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-params-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overscroll-contain"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[480px] max-h-[85vh] overflow-y-auto modal-scroll-thin rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <h2 id="model-params-modal-title" className="text-[16.5px] font-bold text-slate-900 dark:text-slate-100">
              Параметры модели ARS LLM
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки модели"
            className="focus-ring p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label htmlFor="model-select" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
            Модель
          </label>
          <select
            id="model-select"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value as ModelParameters['model'] })}
            className="focus-ring w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13.5px] text-slate-900 dark:text-slate-100"
          >
            <option value="ars-llm-pro-2.5">ARS LLM Pro 2.5 (Аналитика и рассуждения)</option>
            <option value="ars-llm-coder-2.5">ARS LLM Coder 2.5 (Разработка и архитектура)</option>
            <option value="ars-llm-fast-2.0">ARS LLM Fast 2.0 (Быстрые ответы)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="temp-input" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Температура (0.0 – 1.0)
            </label>
            <input
              id="temp-input"
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={draft.temperature}
              onChange={(e) => setDraft({ ...draft, temperature: parseFloat(e.target.value) })}
              className="focus-ring w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13.5px] text-slate-900 dark:text-slate-100 tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="tokens-input" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Макс. токенов
            </label>
            <input
              id="tokens-input"
              type="number"
              step="256"
              min="256"
              max="8192"
              value={draft.maxTokens}
              onChange={(e) => setDraft({ ...draft, maxTokens: parseInt(e.target.value, 10) })}
              className="focus-ring w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13.5px] text-slate-900 dark:text-slate-100 tabular-nums"
            />
          </div>
        </div>

        <div>
          <label htmlFor="sys-prompt-input" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1">
            Системная инструкция
          </label>
          <textarea
            id="sys-prompt-input"
            rows={3}
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            className="focus-ring w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[13px] text-slate-900 dark:text-slate-100"
          />
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-300"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="focus-ring px-4 py-2 rounded-xl bg-[#5046E5] hover:bg-[#4338CA] text-white text-[13px] font-semibold"
          >
            Сохранить параметры
          </button>
        </div>
      </form>
    </div>
  );
};

interface CommandSearchModalProps {
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  sessions: ChatSession[];
  templates: PromptTemplate[];
  onSelectSession: (s: ChatSession) => void;
  onSelectTemplate: (promptText: string) => void;
  onClose: () => void;
}

export const CommandSearchModal: React.FC<CommandSearchModalProps> = ({
  open,
  query,
  onQueryChange,
  sessions,
  templates,
  onSelectSession,
  onSelectTemplate,
  onClose,
}) => {
  useModalScrollAndEscape(open, onClose);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Быстрый поиск (Ctrl + K)"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-900/50 backdrop-blur-xs overscroll-contain"
    >
      <div className="w-full max-w-[540px] max-h-[80vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-4 shadow-xl overflow-hidden">
        <div className="relative flex items-center border-b border-slate-200 dark:border-slate-800 pb-3 shrink-0">
          <Search className="w-4 h-4 text-slate-400 mr-2.5" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Поиск по чатам, шаблонам и документам..."
            aria-label="Запрос быстрого поиска"
            autoFocus
            className="focus-ring flex-1 bg-transparent text-[14px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть быстрый поиск"
            className="focus-ring p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 overflow-y-auto modal-scroll-thin space-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase text-slate-400 px-2 mb-1">
              Недавние чаты ({deduplicateSessions(sessions).length})
            </div>
            {deduplicateSessions(sessions).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelectSession(s);
                  onClose();
                }}
                className="focus-ring w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-[13.5px] font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between"
              >
                <span className="truncate">{s.title}</span>
                <span className="text-[11.5px] text-slate-400 tabular-nums">{s.updatedAt}</span>
              </button>
            ))}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase text-slate-400 px-2 mb-1">
              Шаблоны ({templates.length})
            </div>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelectTemplate(t.promptText);
                  onClose();
                }}
                className="focus-ring w-full text-left px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-[13.5px] font-medium text-slate-800 dark:text-slate-200 flex items-center justify-between"
              >
                <span className="truncate">{t.title}</span>
                <span className="text-[11.5px] text-indigo-600 dark:text-indigo-400">{t.category}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const AVATAR_COLOR_SWATCHES = [
  { hex: '#4F46E5', label: 'Индиго (основной)' },
  { hex: '#0F172A', label: 'Тёмный сланец' },
  { hex: '#0284C7', label: 'Корпоративный синий' },
  { hex: '#059669', label: 'Изумрудный' },
  { hex: '#475569', label: 'Нейтральный графит' },
];

export function getInitialsFromName(name: string, fallbackEmail?: string): string {
  const cleaned = name.trim();
  if (cleaned) {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  }
  if (fallbackEmail && fallbackEmail.trim()) {
    return fallbackEmail.trim().slice(0, 2).toUpperCase();
  }
  return 'СО';
}

interface ProfileModalProps {
  open: boolean;
  user: UserProfile | null;
  quotas: QuotaLimits | null;
  personalInstructions: string;
  avatarColor: string;
  onSaveProfile: (payload: {
    name: string;
    personalInstructions: string;
    avatarColor: string;
  }) => void;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  open,
  user,
  quotas,
  personalInstructions,
  avatarColor,
  onSaveProfile,
  onClose,
}) => {
  const defaultName =
    user?.name?.trim() || (user?.role === 'admin' ? 'Администратор ИТ' : 'Сотрудник');
  const corporateEmail = user?.email || 'employee@company.kz';

  const [draftName, setDraftName] = useState(defaultName);
  const [draftInstructions, setDraftInstructions] = useState(personalInstructions);
  const [draftAvatarColor, setDraftAvatarColor] = useState(avatarColor || '#4F46E5');
  const [error, setError] = useState<string | null>(null);

  useModalScrollAndEscape(open, onClose);

  useEffect(() => {
    if (open) {
      setDraftName(
        user?.name?.trim() || (user?.role === 'admin' ? 'Администратор ИТ' : 'Сотрудник')
      );
      setDraftInstructions(personalInstructions);
      setDraftAvatarColor(avatarColor || '#4F46E5');
      setError(null);
    }
  }, [open, user, personalInstructions, avatarColor]);

  if (!open) return null;

  const initials = getInitialsFromName(draftName, corporateEmail);
  const dailyLimit =
    quotas?.daily.limit && quotas.daily.limit > 0 ? quotas.daily.limit : null;
  const monthlyLimit =
    quotas?.monthly.limit && quotas.monthly.limit > 0 ? quotas.monthly.limit : null;
  const dailyUsed = quotas?.daily.used ?? 0;
  const monthlyUsed = quotas?.monthly.used ?? 0;

  const dailyPct = dailyLimit
    ? Math.min(100, Math.round((dailyUsed / dailyLimit) * 100))
    : 8;
  const monthlyPct = monthlyLimit
    ? Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100))
    : 8;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateProfileUpdate({
      name: draftName,
      currentEmail: corporateEmail,
      personalInstructions: draftInstructions,
      avatarColor: draftAvatarColor,
    });
    if (!check.valid) {
      setError(check.error);
      return;
    }
    onSaveProfile({
      name: check.name,
      personalInstructions: check.personalInstructions,
      avatarColor: check.avatarColor,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overscroll-contain"
    >
      <form
        onSubmit={handleSubmit}
        className="animate-fade-up w-full max-w-[540px] max-h-[88vh] flex flex-col rounded-[20px] border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-[#0E1322] shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.55)] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E8F0] dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4 text-[#4F46E5] dark:text-indigo-400" aria-hidden="true" />
            <h2
              id="profile-modal-title"
              className="text-[16.5px] font-bold tracking-tight text-[#0F172A] dark:text-white"
            >
              Профиль и персональные инструкции
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно профиля"
            className="focus-ring p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Single Thin-Scrollbar Body */}
        <div className="p-6 overflow-y-auto modal-scroll-thin space-y-5">
          {/* Avatar + Identity Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6E8F0] dark:border-slate-800/80">
            <div className="flex items-center gap-3.5 min-w-0">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[15px] font-bold tracking-wide shrink-0 shadow-2xs"
                style={{ backgroundColor: draftAvatarColor }}
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-[#0F172A] dark:text-white truncate">
                  {draftName.trim() || defaultName}
                </div>
                <div className="text-[12px] text-[#64748B] dark:text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                  <span className="whitespace-nowrap">
                    {user?.role === 'admin' ? 'Администратор ИТ' : 'Сотрудник организации'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px] whitespace-nowrap">{corporateEmail}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Цвет аватара профиля">
              {AVATAR_COLOR_SWATCHES.map((swatch) => {
                const selected = draftAvatarColor === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={swatch.label}
                    title={swatch.label}
                    onClick={() => setDraftAvatarColor(swatch.hex)}
                    className={`focus-ring w-6 h-6 rounded-full flex items-center justify-center transition-transform ${
                      selected ? 'ring-2 ring-offset-2 ring-[#4F46E5] dark:ring-offset-[#0E1322]' : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {selected && <Check className="w-3 h-3 text-white stroke-[2.5]" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name & Read-Only Corporate Email Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="profile-name-input"
                className="block text-[12.5px] font-semibold text-[#1E293B] dark:text-slate-200 mb-1.5"
              >
                Имя сотрудника
              </label>
              <input
                id="profile-name-input"
                type="text"
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Имя и фамилия"
                className="focus-ring w-full h-[40px] px-3.5 rounded-[11px] border border-[#E2E5EE] dark:border-slate-700 bg-[#F8FAFC] dark:bg-[#131829] focus:bg-white dark:focus:bg-[#151B2E] focus:border-[#4F46E5] text-[13.5px] text-[#0F172A] dark:text-slate-100"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="profile-email-readonly"
                  className="block text-[12.5px] font-semibold text-[#1E293B] dark:text-slate-200"
                >
                  Корпоративная почта
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64748B] dark:text-slate-400">
                  <Lock className="w-3 h-3" aria-hidden="true" />
                  <span>Read-only</span>
                </span>
              </div>
              <input
                id="profile-email-readonly"
                type="email"
                value={corporateEmail}
                readOnly
                aria-readonly="true"
                className="w-full h-[40px] px-3.5 rounded-[11px] border border-[#E2E5EE] dark:border-slate-800 bg-[#F1F5F9] dark:bg-slate-800/60 text-[13.5px] text-[#64748B] dark:text-slate-400 font-mono cursor-not-allowed select-all focus:outline-none"
              />
            </div>
          </div>

          {/* Request Quotas Summary Block */}
          <div className="rounded-[14px] border border-[#E2E5EE] dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#131829] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-[#0F172A] dark:text-slate-100">
                Квоты запросов учётной записи
              </span>
              <span className="text-[11.5px] text-[#64748B] dark:text-slate-400">
                {user?.role === 'admin' ? 'Тариф: Администратор' : 'Тариф: Стандартный корпоративный'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#475569] dark:text-slate-300 font-medium">Дневной лимит</span>
                  <span className="tabular-nums font-semibold text-[#0F172A] dark:text-slate-100">
                    {dailyUsed} / {dailyLimit ?? '∞'}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Дневная квота в профиле"
                  aria-valuenow={dailyUsed}
                  aria-valuemin={0}
                  aria-valuemax={dailyLimit ?? 100}
                  className="h-1.5 w-full rounded-full bg-[#E2E8F0] dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-[#4F46E5] dark:bg-indigo-400 transition-[width] duration-300"
                    style={{ width: `${dailyPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[#475569] dark:text-slate-300 font-medium">Месячный лимит</span>
                  <span className="tabular-nums font-semibold text-[#0F172A] dark:text-slate-100">
                    {monthlyUsed} / {monthlyLimit ?? '∞'}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Месячная квота в профиле"
                  aria-valuenow={monthlyUsed}
                  aria-valuemin={0}
                  aria-valuemax={monthlyLimit ?? 100}
                  className="h-1.5 w-full rounded-full bg-[#E2E8F0] dark:bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-[#4F46E5] dark:bg-indigo-400 transition-[width] duration-300"
                    style={{ width: `${monthlyPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Personal Instructions Field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="profile-personal-instructions"
                className="block text-[12.5px] font-semibold text-[#1E293B] dark:text-slate-200"
              >
                Персональные инструкции для ARS LLM
              </label>
              <span className="text-[11.5px] text-[#64748B] dark:text-slate-400 tabular-nums">
                {draftInstructions.length} / 1500
              </span>
            </div>
            <textarea
              id="profile-personal-instructions"
              rows={4}
              value={draftInstructions}
              onChange={(e) => {
                setDraftInstructions(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Укажите вашу роль, подразделение или желаемый стиль ответов (например: «Я ведущий аналитик данных. Отвечай структурированно, приводи SQL/TypeScript примеры и выделяй ключевые риски»)."
              className="focus-ring w-full p-3.5 rounded-[12px] border border-[#E2E5EE] dark:border-slate-700 bg-[#F8FAFC] dark:bg-[#131829] focus:bg-white dark:focus:bg-[#151B2E] focus:border-[#4F46E5] text-[13px] leading-relaxed text-[#0F172A] dark:text-slate-100 placeholder:text-[#94A3B8] dark:placeholder:text-slate-500 resize-y"
            />
            <p className="mt-1.5 text-[11.5px] text-[#64748B] dark:text-slate-400 leading-relaxed">
              Эти инструкции автоматически передаются в контекст новых диалогов и помогают адаптировать ответы под ваши рабочие задачи.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-[11px] border border-[#FECACA] dark:border-red-900/60 bg-[#FEF2F2] dark:bg-red-950/40 text-[12.5px] text-[#B91C1C] dark:text-red-300"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-[#E6E8F0] dark:border-slate-800 bg-[#F8FAFC] dark:bg-[#111627] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-[38px] px-4 rounded-[11px] border border-[#E2E5EE] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 text-[13px] font-medium text-[#1E293B] dark:text-slate-200 transition-colors"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="focus-ring h-[38px] px-4 rounded-[11px] bg-[#4F46E5] hover:bg-[#4338CA] active:bg-[#3730A3] text-white text-[13px] font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Сохранить профиль</span>
          </button>
        </div>
      </form>
    </div>
  );
};


