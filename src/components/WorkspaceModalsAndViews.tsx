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
} from 'lucide-react';
import {
  ChatSession,
  DocumentItem,
  ModelParameters,
  NavSectionId,
  ProjectItem,
  PromptTemplate,
  validateModelParameters,
} from '../utils/dashboardLogic';
import {
  adminApi,
  AdminUserRecord,
  AdminUsageResponse,
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
}

const DEMO_ADMIN_USERS: AdminUserRecord[] = [
  {
    id: 1,
    email: 'admin@ars_llm.local',
    role: 'admin',
    created_at: '2026-10-01T08:00:00.000Z',
    quotas: { daily: { used: 4, limit: 100 }, monthly: { used: 38, limit: 2000 } },
  },
  {
    id: 2,
    email: 'employee@company.kz',
    role: 'user',
    created_at: '2026-10-05T09:30:00.000Z',
    quotas: { daily: { used: 7, limit: 20 }, monthly: { used: 112, limit: 500 } },
  },
];

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
}) => {
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([]);
  const [adminUsage, setAdminUsage] = useState<AdminUsageResponse | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [quotaDrafts, setQuotaDrafts] = useState<
    Record<number, { daily: string; monthly: string }>
  >({});
  const [quotaSaveMessage, setQuotaSaveMessage] = useState<string | null>(null);

  const loadAdminData = async () => {
    setAdminLoading(true);
    setAdminError(null);
    if (isDemoMode) {
      setAdminUsers(DEMO_ADMIN_USERS);
      setAdminUsage(DEMO_ADMIN_USAGE);
      const drafts: Record<number, { daily: string; monthly: string }> = {};
      for (const u of DEMO_ADMIN_USERS) {
        drafts[u.id] = {
          daily: u.quotas.daily.limit !== null ? String(u.quotas.daily.limit) : '',
          monthly: u.quotas.monthly.limit !== null ? String(u.quotas.monthly.limit) : '',
        };
      }
      setQuotaDrafts(drafts);
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
      const drafts: Record<number, { daily: string; monthly: string }> = {};
      for (const u of usersRes.users) {
        drafts[u.id] = {
          daily: u.quotas.daily.limit !== null ? String(u.quotas.daily.limit) : '',
          monthly: u.quotas.monthly.limit !== null ? String(u.quotas.monthly.limit) : '',
        };
      }
      setQuotaDrafts(drafts);
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : 'Не удалось загрузить данные администратора.'
      );
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (activeNav === 'admin') {
      loadAdminData();
    }
  }, [activeNav, isDemoMode]);

  const handleSaveUserQuota = async (userId: number) => {
    const draft = quotaDrafts[userId];
    if (!draft) return;

    const dailyLimit = draft.daily.trim() === '' ? null : parseInt(draft.daily, 10);
    const monthlyLimit = draft.monthly.trim() === '' ? null : parseInt(draft.monthly, 10);

    if (
      (dailyLimit !== null && (Number.isNaN(dailyLimit) || dailyLimit < 0)) ||
      (monthlyLimit !== null && (Number.isNaN(monthlyLimit) || monthlyLimit < 0))
    ) {
      setAdminError('Лимиты должны быть неотрицательными целыми числами');
      return;
    }

    setAdminError(null);
    setQuotaSaveMessage(null);

    if (isDemoMode) {
      setAdminUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                quotas: {
                  daily: { ...u.quotas.daily, limit: dailyLimit },
                  monthly: { ...u.quotas.monthly, limit: monthlyLimit },
                },
              }
            : u
        )
      );
      setQuotaSaveMessage(`Квоты пользователя #${userId} обновлены`);
      return;
    }

    try {
      const updated = await adminApi.setUserQuotas(userId, dailyLimit, monthlyLimit);
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, quotas: updated.quotas } : u))
      );
      setQuotaSaveMessage(`Квоты пользователя #${userId} сохранены`);
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : 'Ошибка обновления квот пользователя'
      );
    }
  };

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
              Управление дневными и месячными лимитами запросов сотрудников и статистика использования API.
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
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[11.5px] font-semibold ${
                          u.role === 'admin'
                            ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {u.role}
                      </span>
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
          {sessions.map((sess) => (
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-library-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-[560px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-6 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
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

        <div className="my-4 space-y-3 max-h-[360px] overflow-y-auto pr-1">
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[480px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-6 shadow-xl space-y-4"
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
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Быстрый поиск (Ctrl + K)"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-900/50 backdrop-blur-xs"
    >
      <div className="w-full max-w-[540px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131829] p-4 shadow-xl">
        <div className="relative flex items-center border-b border-slate-200 dark:border-slate-800 pb-3">
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

        <div className="mt-3 max-h-[300px] overflow-y-auto space-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase text-slate-400 px-2 mb-1">
              Недавние чаты ({sessions.length})
            </div>
            {sessions.map((s) => (
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
