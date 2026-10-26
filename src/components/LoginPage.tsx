import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  FileText,
  SlidersHorizontal,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ArsLogo } from './ArsLogo';
import { ThemeMode } from '../utils/dashboardLogic';
import { isValidCorporateEmail } from '../services/api';

interface LoginPageProps {
  theme: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  initialError?: string | null;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  theme,
  onSelectTheme,
  onLogin,
  initialError = null,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  const isFormIncomplete = !email.trim() || !password;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidCorporateEmail(email)) {
      setError('Укажите корректный корпоративный адрес электронной почты');
      return;
    }

    if (!password) {
      setError('Введите пароль учётной записи');
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить вход. Проверьте учётные данные или обратитесь к администратору.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#EEF1F7] dark:bg-[#070A12] text-[#0F172A] dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Minimal Top Utility Row */}
      <header className="w-full max-w-[1160px] mx-auto flex items-center justify-between py-1">
        <div className="text-[12px] font-medium text-[#64748B] dark:text-slate-400 tracking-tight">
          ARS LLM · Enterprise AI Workspace
        </div>
        <div
          role="group"
          aria-label="Переключение темы оформления"
          className="flex items-center p-1 rounded-xl bg-white dark:bg-[#0E1322] border border-[#E2E5EE] dark:border-slate-800"
        >
          <button
            type="button"
            aria-pressed={theme === 'light'}
            aria-label="Светлая тема"
            onClick={() => onSelectTheme('light')}
            className={`focus-ring w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${
              theme === 'light'
                ? 'bg-[#EEF1F7] text-[#4F46E5]'
                : 'text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={theme === 'dark'}
            aria-label="Тёмная тема"
            onClick={() => onSelectTheme('dark')}
            className={`focus-ring w-8 h-7 rounded-lg flex items-center justify-center transition-colors ${
              theme === 'dark'
                ? 'bg-[#1E253B] text-indigo-300'
                : 'text-[#64748B] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Two-Section Split Login Container */}
      <main className="flex-1 flex items-center justify-center py-6">
        <div className="animate-fade-up w-full max-w-[1040px] rounded-[20px] border border-[#E2E5EE] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] shadow-[0_12px_36px_rgba(15,23,42,0.05)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)] overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* Left Section: Corporate Brand & Architecture Description (5 cols) */}
          <section
            aria-label="О платформе ARS LLM"
            className="lg:col-span-5 bg-[#F8FAFC] dark:bg-[#111627] border-b lg:border-b-0 lg:border-r border-[#E2E5EE] dark:border-slate-800/90 p-7 sm:p-9 lg:p-10 flex flex-col justify-between"
          >
            <div>
              <ArsLogo />

              <h1 className="mt-8 text-[22px] sm:text-[24px] font-bold tracking-tight text-[#0F172A] dark:text-white leading-[1.3]">
                Единая корпоративная среда для работы с ИИ
              </h1>

              <p className="mt-3 text-[14px] leading-[1.65] text-[#475569] dark:text-slate-300">
                Решайте аналитические, инженерные и документационные задачи в защищённом контуре организации с единым контролем квот и корпоративными шаблонами.
              </p>

              <dl className="mt-8 pt-6 border-t border-[#E2E5EE] dark:border-slate-800/90 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-lg border border-[#E2E5EE] dark:border-slate-700/80 bg-white dark:bg-[#161C30] flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                    <FileText className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                  </div>
                  <div>
                    <dt className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                      Контекстная работа с документами
                    </dt>
                    <dd className="text-[12.5px] text-[#64748B] dark:text-slate-400 leading-relaxed mt-0.5">
                      Анализ отчётов, кода и регламентов с сохранением истории диалогов и экспортом в Markdown.
                    </dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-lg border border-[#E2E5EE] dark:border-slate-700/80 bg-white dark:bg-[#161C30] flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                    <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                  </div>
                  <div>
                    <dt className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                      Персональные инструкции и квоты
                    </dt>
                    <dd className="text-[12.5px] text-[#64748B] dark:text-slate-400 leading-relaxed mt-0.5">
                      Индивидуальная настройка формата ответов и прозрачный учёт дневных и месячных лимитов.
                    </dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-lg border border-[#E2E5EE] dark:border-slate-700/80 bg-white dark:bg-[#161C30] flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                    <ShieldCheck className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                  </div>
                  <div>
                    <dt className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                      Корпоративная безопасность
                    </dt>
                    <dd className="text-[12.5px] text-[#64748B] dark:text-slate-400 leading-relaxed mt-0.5">
                      Авторизация через изолированную серверную сессию и разграничение прав доступа.
                    </dd>
                  </div>
                </div>
              </dl>
            </div>

            <div className="mt-8 pt-4 border-t border-[#E2E5EE] dark:border-slate-800/80 flex items-center justify-between text-[11.5px] text-[#64748B] dark:text-slate-400">
              <span>Протокол сессии: HttpOnly TLS</span>
              <span className="font-mono">v2.5 Enterprise</span>
            </div>
          </section>

          {/* Right Section: Authentication Form (7 cols) */}
          <section
            aria-labelledby="login-heading"
            className="lg:col-span-7 p-7 sm:p-10 lg:p-12 flex flex-col justify-center bg-white dark:bg-[#0E1322]"
          >
            <div className="w-full max-w-[400px] mx-auto">
              <div className="mb-7">
                <h2
                  id="login-heading"
                  className="text-[22px] sm:text-[24px] font-bold tracking-tight text-[#0F172A] dark:text-white"
                >
                  Вход в рабочую область
                </h2>
                <p className="mt-1.5 text-[13.5px] text-[#64748B] dark:text-slate-400 leading-relaxed">
                  Введите учётные данные корпоративного каталога для продолжения работы.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-[13px] font-semibold text-[#1E293B] dark:text-slate-200 mb-1.5"
                  >
                    Корпоративный Email
                  </label>
                  <div className="relative flex items-center">
                    <Mail
                      className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="login-email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="name@company.kz"
                      disabled={submitting}
                      aria-invalid={Boolean(error)}
                      className={`focus-ring w-full h-[42px] pl-10 pr-3.5 rounded-[12px] border text-[14px] text-[#0F172A] dark:text-slate-100 placeholder:text-[#94A3B8] dark:placeholder:text-slate-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                        error
                          ? 'border-[#DC2626] dark:border-red-500/80 bg-[#FEF2F2]/40 dark:bg-red-950/20'
                          : 'border-[#E2E5EE] dark:border-slate-700/90 bg-[#F8FAFC] dark:bg-[#131829] hover:border-[#CBD5E1] dark:hover:border-slate-600 focus:bg-white dark:focus:bg-[#151B2E] focus:border-[#4F46E5]'
                      }`}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-[13px] font-semibold text-[#1E293B] dark:text-slate-200 mb-1.5"
                  >
                    Пароль
                  </label>
                  <div className="relative flex items-center">
                    <Lock
                      className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Введите пароль"
                      disabled={submitting}
                      aria-invalid={Boolean(error)}
                      className={`focus-ring w-full h-[42px] pl-10 pr-10 rounded-[12px] border text-[14px] text-[#0F172A] dark:text-slate-100 placeholder:text-[#94A3B8] dark:placeholder:text-slate-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                        error
                          ? 'border-[#DC2626] dark:border-red-500/80 bg-[#FEF2F2]/40 dark:bg-red-950/20'
                          : 'border-[#E2E5EE] dark:border-slate-700/90 bg-[#F8FAFC] dark:bg-[#131829] hover:border-[#CBD5E1] dark:hover:border-slate-600 focus:bg-white dark:focus:bg-[#151B2E] focus:border-[#4F46E5]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      disabled={submitting}
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      className="focus-ring absolute right-2.5 p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="p-3 rounded-[12px] border border-[#FECACA] dark:border-red-900/60 bg-[#FEF2F2] dark:bg-red-950/40 text-[13px] text-[#B91C1C] dark:text-red-300 flex items-start gap-2.5"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626] dark:text-red-400" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={submitting || isFormIncomplete}
                    className="focus-ring w-full h-[44px] rounded-[12px] bg-[#4F46E5] enabled:hover:bg-[#4338CA] enabled:active:bg-[#3730A3] disabled:bg-[#E2E8F0] dark:disabled:bg-slate-800 disabled:text-[#94A3B8] dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-colors shadow-2xs"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Проверка учётных данных...</span>
                      </>
                    ) : (
                      <>
                        <span>Войти в систему</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="mt-7 pt-5 border-t border-[#E6E8F0] dark:border-slate-800/90 text-[12px] text-[#64748B] dark:text-slate-400 leading-relaxed">
                Для получения доступа или сброса пароля обратитесь в службу технической поддержки вашей организации.
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="text-center text-[12px] text-[#64748B] dark:text-slate-500 py-1">
        © {new Date().getFullYear()} ARS LLM · Корпоративное рабочее пространство ИИ
      </footer>
    </div>
  );
};
