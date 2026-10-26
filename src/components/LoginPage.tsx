import React, { useState } from 'react';
import { Sun, Moon, Lock, Mail, ArrowRight, Eye } from 'lucide-react';
import { ArsLogo } from './ArsLogo';
import { ThemeMode } from '../utils/dashboardLogic';
import { isValidCorporateEmail } from '../services/api';

interface LoginPageProps {
  theme: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onEnterDemoMode: (role?: 'admin' | 'user') => void;
  initialError?: string | null;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  theme,
  onSelectTheme,
  onLogin,
  onEnterDemoMode,
  initialError = null,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidCorporateEmail(email)) {
      setError('Введите корректный корпоративный email (например, admin@ars_llm.local)');
      return;
    }

    if (!password) {
      setError('Введите пароль для входа в систему');
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить вход. Проверьте доступность сервера и учётные данные.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#EEF1F7] dark:bg-[#070A12] text-[#111827] dark:text-slate-100 flex flex-col justify-between p-4 md:p-6">
      {/* Top Bar with Logo and Theme Switcher */}
      <header className="w-full max-w-[1200px] mx-auto flex items-center justify-between py-2">
        <ArsLogo />
        <div
          role="group"
          aria-label="Переключение темы оформления"
          className="flex items-center p-1 rounded-full bg-white dark:bg-slate-800/90 border border-[#E5E7EB] dark:border-slate-700/80 shadow-xs"
        >
          <button
            type="button"
            aria-pressed={theme === 'light'}
            aria-label="Светлая тема"
            onClick={() => onSelectTheme('light')}
            className={`focus-ring w-9 h-7 rounded-full flex items-center justify-center ${
              theme === 'light'
                ? 'bg-[#EEF1F7] text-[#4F46E5] shadow-xs'
                : 'text-[#6B7280] dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sun className="w-4 h-4 stroke-[2]" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={theme === 'dark'}
            aria-label="Тёмная тема"
            onClick={() => onSelectTheme('dark')}
            className={`focus-ring w-9 h-7 rounded-full flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-[#1E253B] text-indigo-300 shadow-xs'
                : 'text-[#6B7280] dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Moon className="w-[15px] h-[15px] stroke-[1.9]" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Centered Login Card */}
      <main className="flex-1 flex items-center justify-center py-8">
        <section
          aria-labelledby="login-heading"
          className="w-full max-w-[440px] rounded-[24px] border border-[#E2E5EE] dark:border-slate-800/90 bg-white dark:bg-[#0E1322] p-7 sm:p-8 shadow-[0_14px_44px_rgba(15,23,42,0.06)] dark:shadow-[0_14px_44px_rgba(0,0,0,0.45)]"
        >
          <div className="mb-6">
            <h1
              id="login-heading"
              className="text-[24px] font-bold tracking-tight text-[#111827] dark:text-white"
            >
              Вход в ARS LLM
            </h1>
            <p className="mt-1.5 text-[14px] text-[#4B5563] dark:text-slate-400 leading-relaxed">
              Корпоративное рабочее пространство ИИ. Используйте учётные данные сотрудника или администратора.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="login-email"
                className="block text-[13px] font-semibold text-[#1F2937] dark:text-slate-200 mb-1.5"
              >
                Корпоративный Email
              </label>
              <div className="relative flex items-center">
                <Mail
                  className="w-4 h-4 text-[#6B7280] dark:text-slate-400 absolute left-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="admin@ars_llm.local"
                  disabled={submitting}
                  className="focus-ring w-full h-[42px] pl-10 pr-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-[#131829] text-[14px] text-[#111827] dark:text-slate-100 placeholder:text-[#9CA3AF] dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[13px] font-semibold text-[#1F2937] dark:text-slate-200 mb-1.5"
              >
                Пароль
              </label>
              <div className="relative flex items-center">
                <Lock
                  className="w-4 h-4 text-[#6B7280] dark:text-slate-400 absolute left-3.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••"
                  disabled={submitting}
                  className="focus-ring w-full h-[42px] pl-10 pr-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-[#131829] text-[14px] text-[#111827] dark:text-slate-100 placeholder:text-[#9CA3AF] dark:placeholder:text-slate-500"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 text-[13px] text-red-700 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="focus-ring w-full h-[44px] rounded-xl bg-[#5046E5] hover:bg-[#4338CA] active:bg-[#3730A3] disabled:opacity-60 text-white text-[14px] font-semibold flex items-center justify-center gap-2 shadow-xs"
            >
              <span>{submitting ? 'Выполняется вход...' : 'Войти в рабочую область'}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          <div className="my-5 border-t border-[#E6E8F0] dark:border-slate-800/90" role="separator" />

          <div className="space-y-2">
            <div className="text-[11.5px] font-semibold text-[#6B7280] dark:text-slate-400 text-center">
              Демо-режим для презентации
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onEnterDemoMode('user')}
                className="focus-ring h-[40px] px-3 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200 text-[12.5px] font-medium flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 text-[#4F46E5] dark:text-indigo-400 shrink-0" aria-hidden="true" />
                <span>Сотрудник (просмотр квот)</span>
              </button>
              <button
                type="button"
                onClick={() => onEnterDemoMode('admin')}
                className="focus-ring h-[40px] px-3 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200 text-[12.5px] font-medium flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-[#4F46E5] dark:text-indigo-400 shrink-0" aria-hidden="true" />
                <span>Админ (настройка квот)</span>
              </button>
            </div>
            <p className="text-[11.5px] text-center text-[#6B7280] dark:text-slate-400 pt-0.5">
              Авторизация выполняется через защищённую сессию PostgreSQL (HttpOnly cookie).
            </p>
          </div>
        </section>
      </main>

      <footer className="text-center text-[12px] text-[#6B7280] dark:text-slate-500 py-2">
        ARS LLM · Корпоративная платформа искусственного интеллекта
      </footer>
    </div>
  );
};
