import React, { useState } from 'react';
import {
  Copy,
  Check,
  Star,
  ArrowLeft,
  Paperclip,
  User,
} from 'lucide-react';
import { ChatSession } from '../utils/dashboardLogic';
import { ChatComposer } from './ChatComposer';

interface ChatThreadViewProps {
  session: ChatSession;
  promptValue: string;
  onPromptChange: (val: string) => void;
  onSubmitPrompt: (text: string, attachments: string[]) => void;
  onOpenPromptLibrary: () => void;
  onOpenModelParams: () => void;
  onToggleStar: (sessionId: string) => void;
  onBackToWelcome: () => void;
}

export const ChatThreadView: React.FC<ChatThreadViewProps> = ({
  session,
  promptValue,
  onPromptChange,
  onSubmitPrompt,
  onOpenPromptLibrary,
  onOpenModelParams,
  onToggleStar,
  onBackToWelcome,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="flex flex-col h-full max-w-[820px] mx-auto w-full px-4 md:px-6 py-5">
      {/* Context Bar */}
      <div className="flex items-center justify-between gap-4 pb-4 mb-4 border-b border-[#E6E8F0] dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToWelcome}
            aria-label="Вернуться на главный экран нового чата"
            className="focus-ring px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Назад</span>
          </button>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {session.title}
            </h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Обновлено: <span className="tabular-nums">{session.updatedAt}</span> · Сообщений:{' '}
              <span className="tabular-nums">{session.messages.length}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggleStar(session.id)}
          aria-pressed={Boolean(session.starred)}
          aria-label={session.starred ? 'Убрать чат из избранного' : 'Добавить чат в избранное'}
          className="focus-ring p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Star
            className={`w-4 h-4 ${
              session.starred ? 'text-[#F59E0B] fill-[#F59E0B]' : ''
            }`}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Messages Feed */}
      <div
        role="log"
        aria-label="История сообщений чата"
        aria-live="polite"
        className="flex-1 overflow-y-auto space-y-4 pr-1 pb-6"
      >
        {session.messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <article
              key={msg.id}
              className={`rounded-2xl p-4 border ${
                isUser
                  ? 'bg-[#F5F6FA] dark:bg-slate-800/70 border-[#E5E7EB] dark:border-slate-700/80 ml-auto max-w-[88%]'
                  : 'bg-white dark:bg-[#131829] border-[#E5E7EB] dark:border-slate-800 mr-auto w-full'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                  {isUser ? (
                    <>
                      <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                      <span>Сотрудник</span>
                    </>
                  ) : (
                    <>
                      <span className="text-indigo-600 dark:text-indigo-400">ARS LLM</span>
                    </>
                  )}
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="text-[11.5px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                    {msg.timestamp}
                  </span>
                </div>

                {!isUser && (
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    aria-label="Скопировать ответ"
                    className="focus-ring inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {copiedId === msg.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        <span>Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Копировать</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {msg.content}
              </div>

              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                  {msg.attachments.map((file, i) => (
                    <span
                      key={`${file}-${i}`}
                      className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 dark:text-slate-300"
                    >
                      <Paperclip className="w-3 h-3 text-indigo-500" aria-hidden="true" />
                      <span>{file}</span>
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Follow-up Composer */}
      <div className="pt-2 shrink-0">
        <ChatComposer
          promptValue={promptValue}
          onPromptChange={onPromptChange}
          onSubmitPrompt={onSubmitPrompt}
          onOpenPromptLibrary={onOpenPromptLibrary}
          onOpenModelParams={onOpenModelParams}
          compact
        />
      </div>
    </div>
  );
};
