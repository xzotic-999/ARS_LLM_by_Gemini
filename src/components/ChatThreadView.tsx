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
  ThumbsUp,
  ThumbsDown,
  Pencil,
  ArrowDown,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ChatSession,
  QuotaBlockStatus,
  detectSpeechLanguage,
  stripMarkdownForSpeech,
  selectBestVoiceForLanguage,
} from '../utils/dashboardLogic';
import { ChatComposer } from './ChatComposer';
import { MarkdownContent } from './MarkdownContent';
import type { AttachedFileItem } from '../utils/fileExtractor';

interface ChatThreadViewProps {
  session: ChatSession;
  promptValue: string;
  onPromptChange: (val: string) => void;
  onSubmitPrompt: (
    text: string,
    attachments: string[],
    attachmentDetails?: AttachedFileItem[]
  ) => void;
  onOpenPromptLibrary: () => void;
  onOpenModelParams: () => void;
  onToggleStar: (sessionId: string) => void;
  onBackToWelcome: () => void;
  isStreaming?: boolean;
  onAbortStream?: () => void;
  streamError?: string | null;
  onRetryLastPrompt?: () => void;
  onRegenerateResponse?: (messageId: string) => void;
  onEditUserPrompt?: (messageId: string, content: string) => void;
  quotaBlockStatus?: QuotaBlockStatus | null;
  onOpenQuotasView?: () => void;
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
  onRegenerateResponse,
  onEditUserPrompt,
  quotaBlockStatus = null,
  onOpenQuotasView,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [ratings, setRatings] = useState<Record<string, 'up' | 'down'>>({});
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);

  const fallbackTimerRef = useRef<number | null>(null);
  const messagesLogRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolledUpRef = useRef<boolean>(false);

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

  // Handle scroll detection so streaming doesn't jerk viewport if user scrolled up
  const handleScroll = () => {
    const el = messagesLogRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceToBottom > 120;
    isUserScrolledUpRef.current = scrolledUp;
    setShowScrollBottom(scrolledUp);
  };

  const scrollToBottom = (smooth = true) => {
    const el = messagesLogRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      isUserScrolledUpRef.current = false;
      setShowScrollBottom(false);
    }
  };

  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      const el = messagesLogRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
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

  const handleRate = (msgId: string, type: 'up' | 'down') => {
    setRatings((prev) => ({
      ...prev,
      [msgId]: prev[msgId] === type ? (undefined as unknown as 'up') : type,
    }));
  };

  const startEditMessage = (msgId: string, content: string) => {
    setEditingMsgId(msgId);
    setEditingContent(content);
  };

  const cancelEditMessage = () => {
    setEditingMsgId(null);
    setEditingContent('');
  };

  const submitEditMessage = () => {
    if (!editingContent.trim() || isStreaming) return;
    if (onEditUserPrompt && editingMsgId) {
      onEditUserPrompt(editingMsgId, editingContent.trim());
    } else {
      onSubmitPrompt(editingContent.trim(), []);
    }
    cancelEditMessage();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden bg-white dark:bg-[#0B0F19]">
      {/* Compact Top Navigation / Header Bar */}
      <div className="shrink-0 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0B0F19]/80 backdrop-blur-md z-10">
        <div className="max-w-[840px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToWelcome}
              aria-label="Вернуться к новому чату"
              className="focus-ring px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700/80 text-[12.5px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Новый чат</span>
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
                className="focus-ring px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
              >
                <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                <span>Остановить</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleStar(session.id)}
              aria-pressed={Boolean(session.starred)}
              aria-label={session.starred ? 'Убрать чат из избранного' : 'Добавить чат в избранное'}
              className="focus-ring p-1.5 rounded-lg border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
      </div>

      {/* Main Message Scroll Area */}
      <div
        ref={messagesLogRef}
        onScroll={handleScroll}
        role="log"
        aria-label="История сообщений диалога"
        aria-live="polite"
        className="flex-1 overflow-y-auto min-h-0 w-full relative"
      >
        <div className="max-w-[840px] mx-auto w-full px-4 sm:px-6 py-6 md:py-8 space-y-7 md:space-y-9">
          {session.messages.length === 0 ? (
            <div className="py-12 text-center text-[14px] text-slate-500 dark:text-slate-400">
              В этом диалоге пока нет сообщений. Отправьте рабочий вопрос ниже, чтобы начать.
            </div>
          ) : (
            session.messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const detectedLang = !isUser ? detectSpeechLanguage(msg.content) : null;
              const isSpeakingThis = speakingId === msg.id;
              const localeBadge = detectedLang ? detectedLang.shortLabel.trim() : '';
              const isEditingThis = editingMsgId === msg.id;
              const userRating = ratings[msg.id];
              const isLastAssistant =
                !isUser &&
                index === session.messages.length - 1;

              // USER MESSAGE: Elegant right-aligned bubble
              if (isUser) {
                return (
                  <article
                    key={msg.id}
                    className="flex flex-col items-end group ml-auto max-w-[88%] sm:max-w-[80%]"
                  >
                    <div className="flex items-center gap-2 mb-1.5 text-[12px] text-slate-500 dark:text-slate-400 pr-1">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Сотрудник</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{msg.timestamp}</span>
                    </div>

                    {isEditingThis ? (
                      <div className="w-full p-3 rounded-2xl bg-white dark:bg-slate-800 border border-indigo-400 dark:border-indigo-500 shadow-sm">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full bg-transparent text-[15px] leading-relaxed text-slate-900 dark:text-slate-100 resize-none outline-none focus:ring-0 min-h-[72px]"
                          rows={3}
                          autoFocus
                          aria-label="Редактировать сообщение"
                        />
                        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={cancelEditMessage}
                            className="focus-ring px-2.5 py-1 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            onClick={submitEditMessage}
                            className="focus-ring px-3 py-1 rounded-lg text-[12px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                          >
                            Сохранить и отправить
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl px-4 py-3 bg-[#F4F4F6] dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/60 shadow-2xs text-[15px] sm:text-[15.5px] leading-[1.65] whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    )}

                    {/* Attachments preview on user message */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
                        {msg.attachments.map((file, i) => (
                          <span
                            key={`att-${i}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11.5px] font-medium text-slate-700 dark:text-slate-300 border border-slate-200/70 dark:border-slate-700/60"
                          >
                            <Paperclip className="w-3 h-3 text-slate-400" />
                            <span>{file}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Quick actions for user message on hover/focus */}
                    {!isEditingThis && (
                      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => startEditMessage(msg.id, msg.content)}
                          aria-label="Редактировать сообщение"
                          className="focus-ring p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                          title="Редактировать"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          aria-label="Скопировать сообщение"
                          className="focus-ring p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                          title="Копировать"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}
                  </article>
                );
              }

              // ASSISTANT MESSAGE: Modern ChatGPT style — NO card box, NO outer border, transparent background, natural typography
              return (
                <article
                  key={msg.id}
                  className="w-full bg-transparent border-0 p-0 shadow-none text-left"
                >
                  {/* Subtle Assistant Brand Header */}
                  <div className="flex items-center gap-2 mb-2 text-[12.5px]">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                      <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" aria-hidden="true" />
                      <span>ARS LLM</span>
                    </div>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-[12px] text-slate-400 tabular-nums">{msg.timestamp}</span>
                    {detectedLang && (
                      <>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                        <span
                          className="text-[11.5px] font-mono text-slate-400 uppercase"
                          title={`Определённый язык ответа: ${detectedLang.fullName}`}
                        >
                          {detectedLang.shortLabel}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Speech status banner if reading aloud */}
                  {isSpeakingThis && detectedLang && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mb-2.5 px-3 py-1.5 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-[12px] font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-2"
                    >
                      <Volume2 className="w-3.5 h-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                      <span>{`Воспроизведение речи (${detectedLang.fullName})`}</span>
                    </div>
                  )}

                  {/* Natural Body Content directly in dialogue canvas */}
                  <div className="text-[15.5px] md:text-[16px] leading-[1.7] text-[#0D0D0D] dark:text-[#ECECEC] font-sans antialiased">
                    {msg.content ? (
                      <>
                        <MarkdownContent content={msg.content} />
                        {msg.isStreaming && (
                          <span
                            className="inline-block w-2 h-4.5 bg-indigo-600 dark:bg-indigo-400 animate-pulse ml-1 align-middle rounded-xs"
                            aria-label="Генерация текста..."
                          />
                        )}
                      </>
                    ) : msg.isStreaming ? (
                      <div
                        role="status"
                        aria-label="Ожидание ответа модели"
                        className="flex items-center gap-1.5 py-2 text-indigo-600 dark:text-indigo-400"
                      >
                        <span className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 rounded-full bg-current animate-bounce" />
                      </div>
                    ) : null}
                  </div>

                  {/* Subtle ChatGPT-style action toolbar under assistant answer */}
                  {msg.content && !msg.isStreaming && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-1 text-slate-400 dark:text-slate-500 select-none">
                      {/* Copy Action */}
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        aria-label="Скопировать ответ"
                        className="focus-ring inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                        title="Скопировать"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Скопировано</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Копировать</span>
                          </>
                        )}
                      </button>

                      {/* Read Aloud Action */}
                      {detectedLang && (
                        <button
                          type="button"
                          onClick={() => handleToggleSpeech(msg.id, msg.content)}
                          aria-pressed={isSpeakingThis}
                          aria-label={
                            isSpeakingThis
                              ? `Остановить озвучивание (${detectedLang.fullName})`
                              : `Озвучить ответ (${detectedLang.fullName})`
                          }
                          className={`focus-ring inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] transition-colors ${
                            isSpeakingThis
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 font-medium'
                              : 'hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                          }`}
                          title={`Озвучить (${detectedLang.fullName})`}
                        >
                          {isSpeakingThis ? (
                            <>
                              <Square className="w-3.5 h-3.5 fill-current" />
                              <span>{`Стоп (${localeBadge})`}</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>{`Озвучить (${localeBadge})`}</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Regenerate Action */}
                      {onRegenerateResponse && (
                        <button
                          type="button"
                          onClick={() => onRegenerateResponse(msg.id)}
                          aria-label="Перегенерировать ответ"
                          className="focus-ring inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                          title="Повторить генерацию"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Повторить</span>
                        </button>
                      )}

                      {/* Rating Feedback */}
                      <div className="flex items-center gap-0.5 ml-1 border-l border-slate-200 dark:border-slate-800 pl-1">
                        <button
                          type="button"
                          onClick={() => handleRate(msg.id, 'up')}
                          aria-pressed={userRating === 'up'}
                          aria-label="Хороший ответ"
                          className={`focus-ring p-1 rounded-md transition-colors ${
                            userRating === 'up'
                              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60'
                              : 'hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                          }`}
                          title="Полезно"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRate(msg.id, 'down')}
                          aria-pressed={userRating === 'down'}
                          aria-label="Плохой ответ"
                          className={`focus-ring p-1 rounded-md transition-colors ${
                            userRating === 'down'
                              ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60'
                              : 'hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                          }`}
                          title="Не помогло"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline Error Notice with Retry */}
                  {isLastAssistant && streamError && (
                    <div
                      role="alert"
                      className="mt-4 p-3.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-[13px] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                        <span>{streamError}</span>
                      </div>
                      {onRetryLastPrompt && (
                        <button
                          type="button"
                          onClick={onRetryLastPrompt}
                          className="focus-ring px-3 py-1 rounded-lg text-[12px] font-semibold bg-rose-600 hover:bg-rose-700 text-white shrink-0 transition-colors"
                        >
                          Повторить попытку
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {/* Scroll to bottom button if user scrolled up */}
        {showScrollBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            aria-label="Прокрутить к последнему сообщению"
            className="focus-ring absolute bottom-4 right-6 p-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all z-20"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Bottom Composer Canvas */}
      <div className="shrink-0 w-full border-t border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-[#0B0F19]/95 backdrop-blur-md pb-4 pt-3">
        <div className="max-w-[840px] mx-auto px-4 sm:px-6">
          <ChatComposer
            promptValue={promptValue}
            onPromptChange={onPromptChange}
            onSubmitPrompt={onSubmitPrompt}
            onOpenPromptLibrary={onOpenPromptLibrary}
            onOpenModelParams={onOpenModelParams}
            quotaBlockStatus={quotaBlockStatus}
            onOpenQuotasView={onOpenQuotasView}
            isStreaming={isStreaming}
            onAbortStream={onAbortStream}
          />
        </div>
      </div>
    </div>
  );
};
