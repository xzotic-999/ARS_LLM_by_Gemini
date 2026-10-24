import React, { useState, useEffect, useRef } from 'react';
import {
  Copy,
  Check,
  Star,
  ArrowLeft,
  Paperclip,
  User,
  Volume2,
  Square,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  ChatSession,
  detectSpeechLanguage,
  stripMarkdownForSpeech,
  selectBestVoiceForLanguage,
} from '../utils/dashboardLogic';
import { ChatComposer } from './ChatComposer';
import { MarkdownContent } from './MarkdownContent';

interface ChatThreadViewProps {
  session: ChatSession;
  promptValue: string;
  onPromptChange: (val: string) => void;
  onSubmitPrompt: (text: string, attachments: string[]) => void;
  onOpenPromptLibrary: () => void;
  onOpenModelParams: () => void;
  onToggleStar: (sessionId: string) => void;
  onBackToWelcome: () => void;
  isStreaming?: boolean;
  onAbortStream?: () => void;
  streamError?: string | null;
  onRetryLastPrompt?: () => void;
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
  isStreaming = false,
  onAbortStream,
  streamError = null,
  onRetryLastPrompt,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const messagesLogRef = useRef<HTMLDivElement | null>(null);

  const stopSpeechPlayback = () => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore errors if speechSynthesis is restricted
      }
    }
    setSpeakingId(null);
  };

  useEffect(() => {
    return () => {
      stopSpeechPlayback();
    };
  }, [session.id]);

  useEffect(() => {
    const el = messagesLogRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [session.messages]);

  const handleToggleSpeech = (msgId: string, content: string) => {
    if (speakingId === msgId) {
      stopSpeechPlayback();
      return;
    }

    stopSpeechPlayback();
    const detected = detectSpeechLanguage(content);
    const spokenText = stripMarkdownForSpeech(content);
    if (!spokenText) return;

    setSpeakingId(msgId);
    const startTimestamp = Date.now();
    const fallbackDurationMs = Math.min(15000, Math.max(4000, spokenText.length * 45));

    fallbackTimerRef.current = window.setTimeout(() => {
      setSpeakingId((current) => (current === msgId ? null : current));
      fallbackTimerRef.current = null;
    }, fallbackDurationMs);

    if (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    ) {
      try {
        const utterance = new window.SpeechSynthesisUtterance(spokenText);
        utterance.lang = detected.langCode;

        const voices = window.speechSynthesis.getVoices();
        const matchedVoice = selectBestVoiceForLanguage(voices, detected.langCode);
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }

        utterance.onend = () => {
          if (Date.now() - startTimestamp > 300) {
            if (fallbackTimerRef.current !== null) {
              window.clearTimeout(fallbackTimerRef.current);
              fallbackTimerRef.current = null;
            }
            setSpeakingId((current) => (current === msgId ? null : current));
          }
        };

        window.speechSynthesis.speak(utterance);
      } catch {
        // Fallback timer handles state reset when Web Speech API is unavailable
      }
    }
  };

  const handleCopy = (id: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden max-w-[820px] mx-auto w-full px-4 md:px-6 pt-3 pb-3">
      {/* Compact Single-Line Context Bar (no duplicate title; title is in TopBar) */}
      <div className="shrink-0 flex items-center justify-between gap-3 pb-2.5 mb-3 border-b border-[#E6E8F0] dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToWelcome}
            aria-label="Вернуться на главный экран нового чата"
            className="focus-ring px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Назад</span>
          </button>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
            Обновлено: <span className="tabular-nums font-medium">{session.updatedAt}</span> · Сообщений:{' '}
            <span className="tabular-nums font-medium">{session.messages.length}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isStreaming && onAbortStream && (
            <button
              type="button"
              onClick={onAbortStream}
              aria-label="Остановить генерацию ответа"
              className="focus-ring px-3 py-1 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[12px] font-semibold flex items-center gap-1.5"
            >
              <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              <span>Остановить генерацию</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onToggleStar(session.id)}
            aria-pressed={Boolean(session.starred)}
            aria-label={session.starred ? 'Убрать чат из избранного' : 'Добавить чат в избранное'}
            className="focus-ring p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Star
              className={`w-4 h-4 ${
                session.starred ? 'text-[#F59E0B] fill-[#F59E0B]' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Scrollable Messages Feed */}
      <div
        ref={messagesLogRef}
        role="log"
        aria-label="История сообщений чата"
        aria-live="polite"
        className="flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-1 pb-3"
      >
        {session.messages.length === 0 ? (
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131829] text-center text-[13.5px] text-slate-500 dark:text-slate-400">
            В этом диалоге пока нет сообщений. Отправьте вопрос ниже, чтобы начать.
          </div>
        ) : (
          session.messages.map((msg) => {
            const isUser = msg.role === 'user';
            const detectedLang = !isUser ? detectSpeechLanguage(msg.content) : null;
            const isSpeakingThis = speakingId === msg.id;
            const localeBadge = detectedLang ? detectedLang.shortLabel.trim() : '';

            return (
              <article
                key={msg.id}
                className={`rounded-2xl p-4 border ${
                  isUser
                    ? 'bg-[#F5F6FA] dark:bg-slate-800/70 border-[#E5E7EB] dark:border-slate-700/80 ml-auto max-w-[88%]'
                    : 'bg-white dark:bg-[#131829] border-[#E5E7EB] dark:border-slate-800 mr-auto w-full'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                    {isUser ? (
                      <>
                        <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                        <span>Сотрудник</span>
                      </>
                    ) : (
                      <span className="text-indigo-600 dark:text-indigo-400">ARS LLM</span>
                    )}
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span className="text-[11.5px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                      {msg.timestamp}
                    </span>
                    {!isUser && detectedLang && (
                      <>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className="text-[11.5px] font-normal text-slate-500 dark:text-slate-400 font-mono"
                          title={`Определённый язык озвучивания: ${detectedLang.fullName}`}
                        >
                          {detectedLang.langCode}
                        </span>
                      </>
                    )}
                  </div>

                  {!isUser && detectedLang && msg.content.trim().length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleSpeech(msg.id, msg.content)}
                        aria-pressed={isSpeakingThis}
                        aria-label={
                          isSpeakingThis
                            ? `Остановить озвучивание (${detectedLang.fullName})`
                            : `Озвучить ответ (${detectedLang.fullName})`
                        }
                        title={`Голосовое воспроизведение: ${detectedLang.fullName}`}
                        className={`focus-ring inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap ${
                          isSpeakingThis
                            ? 'bg-indigo-50 dark:bg-indigo-500/20 text-[#4F46E5] dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isSpeakingThis ? (
                          <>
                            <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                            <span>{`Стоп (${localeBadge})`}</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{`Озвучить (${localeBadge})`}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        aria-label="Скопировать ответ"
                        className="focus-ring inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
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
                    </div>
                  )}
                </div>

                {isSpeakingThis && detectedLang && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mb-2.5 text-[12px] font-medium text-[#4F46E5] dark:text-indigo-400 flex items-center gap-1.5"
                  >
                    <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{`Воспроизведение аудио · Голос: ${detectedLang.fullName}`}</span>
                  </div>
                )}

                <div className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">
                  {msg.content ? (
                    isUser ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <MarkdownContent content={msg.content} />
                    )
                  ) : msg.isStreaming ? (
                    <span
                      role="status"
                      aria-label="Ожидание ответа"
                      className="inline-flex items-center gap-1.5 py-1.5 px-1"
                    >
                      <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-bounce" />
                    </span>
                  ) : null}
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
          })
        )}

        {streamError && (
          <div
            role="alert"
            className="p-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 flex flex-wrap items-center justify-between gap-3 text-[13.5px] text-red-700 dark:text-red-300"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{streamError}</span>
            </div>
            {onRetryLastPrompt && (
              <button
                type="button"
                onClick={onRetryLastPrompt}
                className="focus-ring px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[12.5px] font-semibold flex items-center gap-1.5 shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Повторить запрос</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pinned Follow-up Composer at Bottom of Viewport */}
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
