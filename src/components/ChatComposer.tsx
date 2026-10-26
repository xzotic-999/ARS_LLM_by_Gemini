import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Paperclip,
  Mic,
  FileText,
  SlidersHorizontal,
  Send,
  X,
  AlertCircle,
} from 'lucide-react';
import { AttachedFileItem, extractAttachmentText } from '../utils/fileExtractor';
import type { QuotaBlockStatus } from '../utils/dashboardLogic';

interface ChatComposerProps {
  promptValue: string;
  onPromptChange: (val: string) => void;
  onSubmitPrompt: (
    text: string,
    attachments: string[],
    attachmentDetails?: AttachedFileItem[]
  ) => void;
  onOpenPromptLibrary: () => void;
  onOpenModelParams: () => void;
  compact?: boolean;
  disabled?: boolean;
  quotaBlockStatus?: QuotaBlockStatus | null;
  onOpenQuotasView?: () => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  promptValue,
  onPromptChange,
  onSubmitPrompt,
  onOpenPromptLibrary,
  onOpenModelParams,
  compact = false,
  disabled = false,
  quotaBlockStatus = null,
  onOpenQuotasView,
}) => {
  const [attachments, setAttachments] = useState<AttachedFileItem[]>([]);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [actionsPopoverOpen, setActionsPopoverOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const popoverContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isQuotaBlocked = Boolean(quotaBlockStatus?.isBlocked);
  const effectiveDisabled = disabled || isQuotaBlocked;
  const hasText = promptValue.trim().length > 0;

  useEffect(() => {
    if (!actionsPopoverOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (
        popoverContainerRef.current &&
        !popoverContainerRef.current.contains(e.target as Node)
      ) {
        setActionsPopoverOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionsPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [actionsPopoverOpen]);

  // Auto-adjust textarea height cleanly up to 140px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [promptValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSubmit();
    }
  };

  const triggerSubmit = () => {
    if (effectiveDisabled) return;
    if (!promptValue.trim()) {
      setComposerError('Введите сообщение или выберите быстрый запрос');
      return;
    }
    setComposerError(null);
    setActionsPopoverOpen(false);
    onSubmitPrompt(
      promptValue,
      attachments.map((a) => a.name),
      attachments
    );
    setAttachments([]);
    setIsRecordingVoice(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList: File[] = Array.from(files);
    e.target.value = '';
    const extracted = await Promise.all(fileList.map((f) => extractAttachmentText(f)));
    setAttachments((prev) => [...prev, ...extracted]);
    setActionsPopoverOpen(false);
  };

  const handleAttachButtonClick = () => {
    setActionsPopoverOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleToggleVoice = () => {
    if (effectiveDisabled) return;
    setIsRecordingVoice((prev) => {
      const next = !prev;
      if (next && !promptValue.trim()) {
        onPromptChange('Подготовь краткую сводку по ключевым метрикам проекта за неделю');
        setComposerError(null);
      }
      return next;
    });
  };

  return (
    <section
      aria-label="Создание нового сообщения"
      className={`w-full ${
        compact ? 'max-w-[960px]' : 'max-w-[900px]'
      } mx-auto rounded-[16px] border ${
        isQuotaBlocked || composerError
          ? 'border-[#DC2626] dark:border-red-500/80'
          : 'border-[#E2E5EE] dark:border-slate-800 focus-within:border-[#4F46E5] dark:focus-within:border-indigo-500/90'
      } bg-white dark:bg-[#131829] px-3 py-2 shadow-[0_4px_20px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition-colors`}
    >
      {/* Quota Blocked Notice Banner */}
      {isQuotaBlocked && quotaBlockStatus && (
        <div
          role="alert"
          data-testid="quota-blocked-banner"
          className="mb-2 px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-red-700 dark:text-red-300"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span className="font-medium">
              {quotaBlockStatus.message ??
                'Лимит запросов исчерпан. Обратитесь к администратору для увеличения квоты.'}
            </span>
          </div>
          {onOpenQuotasView && (
            <button
              type="button"
              onClick={onOpenQuotasView}
              className="focus-ring px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 text-[12px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100/60 dark:hover:bg-red-900/40 shrink-0"
            >
              Мои квоты
            </button>
          )}
        </div>
      )}
      {/* Attached Files Chips (only visible when files are attached, no extra inner box border) */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2 px-1">
          {attachments.map((file, idx) => (
            <span
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1E293B] dark:text-slate-200 bg-[#F1F5F9] dark:bg-slate-800 px-2.5 py-1 rounded-lg"
            >
              <Paperclip className="w-3 h-3 text-[#4F46E5] dark:text-indigo-400" aria-hidden="true" />
              <span className="truncate max-w-[200px]">{file.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                aria-label={`Удалить вложение ${file.name}`}
                className="focus-ring text-[#64748B] hover:text-[#0F172A] dark:hover:text-white rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Hidden Native File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Single Clean Input Row: [+] Popover Trigger on Left | Borderless Textarea in Center | [Mic] + [Send] on Right */}
      <div className="flex items-center gap-2.5 min-h-[40px]">
        {/* Left: Secondary Actions '+' Popover Trigger */}
        <div ref={popoverContainerRef} className="relative shrink-0">
          <button
            type="button"
            disabled={effectiveDisabled}
            onClick={() => setActionsPopoverOpen((prev) => !prev)}
            aria-label="Дополнительные действия (файл, шаблоны, параметры ответа)"
            aria-expanded={actionsPopoverOpen}
            aria-haspopup="menu"
            title="Вложения, библиотека промптов и параметры ответа"
            className={`focus-ring w-[36px] h-[36px] rounded-[11px] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              actionsPopoverOpen
                ? 'bg-[#EEF2FF] dark:bg-indigo-500/20 text-[#4F46E5] dark:text-indigo-300 border border-[#C7D2FE] dark:border-indigo-500/40'
                : 'bg-[#F8FAFC] dark:bg-slate-800/80 text-[#475569] dark:text-slate-300 border border-[#E2E5EE] dark:border-slate-700/80 hover:bg-[#F1F5F9] dark:hover:bg-slate-800 hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            <Plus
              className={`w-[18px] h-[18px] stroke-[2] transition-transform duration-150 ${
                actionsPopoverOpen ? 'rotate-45' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          {/* Compact Secondary Actions Popover */}
          {actionsPopoverOpen && (
            <div
              role="menu"
              aria-label="Вторичные действия чата"
              className={`animate-fade-up absolute left-0 w-[264px] rounded-[14px] border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-[#151B2E] p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] z-30 ${
                compact ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
              }`}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleAttachButtonClick}
                className="focus-ring w-full text-left px-3 py-2 rounded-[10px] hover:bg-[#F8FAFC] dark:hover:bg-slate-800/80 flex items-center gap-3 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-[#F1F5F9] dark:bg-slate-800 flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                  <Paperclip className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                    Прикрепить файл
                  </div>
                  <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                    Документы, таблицы или код
                  </div>
                </div>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActionsPopoverOpen(false);
                  onOpenPromptLibrary();
                }}
                className="focus-ring w-full text-left px-3 py-2 rounded-[10px] hover:bg-[#F8FAFC] dark:hover:bg-slate-800/80 flex items-center gap-3 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-[#F1F5F9] dark:bg-slate-800 flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                  <FileText className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                    Библиотека промптов
                  </div>
                  <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                    Готовые корпоративные шаблоны
                  </div>
                </div>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setActionsPopoverOpen(false);
                  onOpenModelParams();
                }}
                className="focus-ring w-full text-left px-3 py-2 rounded-[10px] hover:bg-[#F8FAFC] dark:hover:bg-slate-800/80 flex items-center gap-3 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-[#F1F5F9] dark:bg-slate-800 flex items-center justify-center text-[#4F46E5] dark:text-indigo-400 shrink-0">
                  <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.9]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A] dark:text-slate-100">
                    Параметры ответа
                  </div>
                  <div className="text-[11px] text-[#64748B] dark:text-slate-400 truncate">
                    Модель, температура, лимит токенов
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Center: Clean Borderless Textarea (No inner frame) */}
        <div className="flex-1 min-w-0 flex items-center">
          <label htmlFor="chat-prompt-textarea" className="sr-only">
            Чем я могу помочь вам сегодня?
          </label>
          <textarea
            ref={textareaRef}
            id="chat-prompt-textarea"
            rows={1}
            disabled={effectiveDisabled}
            value={promptValue}
            onChange={(e) => {
              onPromptChange(e.target.value);
              if (composerError) setComposerError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isQuotaBlocked
                ? 'Лимит запросов исчерпан — обратитесь к администратору системы'
                : 'Задайте рабочий вопрос, вставьте фрагмент кода или опишите задачу...'
            }
            className="w-full resize-none border-0 bg-transparent py-1.5 px-1 text-[14px] leading-[1.45] text-[#0F172A] dark:text-slate-100 placeholder:text-[#64748B] dark:placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Right: Microphone + Send Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={effectiveDisabled}
            onClick={handleToggleVoice}
            aria-pressed={isRecordingVoice}
            aria-label={isRecordingVoice ? 'Остановить голосовой ввод' : 'Голосовой ввод'}
            title={isRecordingVoice ? 'Голосовой ввод активен' : 'Голосовой ввод'}
            className={`focus-ring w-[36px] h-[36px] rounded-[11px] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isRecordingVoice
                ? 'bg-[#EEF2FF] dark:bg-indigo-500/25 text-[#4F46E5] dark:text-indigo-300 border border-[#C7D2FE] dark:border-indigo-500/40'
                : 'text-[#475569] dark:text-slate-300 hover:bg-[#F1F5F9] dark:hover:bg-slate-800 hover:text-[#0F172A] dark:hover:text-white'
            }`}
          >
            <Mic className="w-[17px] h-[17px] stroke-[1.9]" aria-hidden="true" />
          </button>

          <button
            type="button"
            disabled={effectiveDisabled}
            onClick={triggerSubmit}
            aria-label="Отправить сообщение"
            title={
              isQuotaBlocked
                ? 'Отправка заблокирована: лимит запросов исчерпан'
                : 'Отправить сообщение (Enter)'
            }
            className={`focus-ring w-[36px] h-[36px] rounded-[11px] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              hasText && !effectiveDisabled
                ? 'bg-[#4F46E5] text-white hover:bg-[#4338CA] active:bg-[#3730A3] shadow-2xs cursor-pointer'
                : 'bg-[#F1F5F9] dark:bg-slate-800 text-[#94A3B8] dark:text-slate-500 hover:bg-[#E2E8F0] dark:hover:bg-slate-700'
            }`}
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Inline Status & Error Feedback */}
      {isRecordingVoice && (
        <div
          role="status"
          aria-live="polite"
          className="mt-1.5 pl-11 text-[11.5px] font-medium text-[#4F46E5] dark:text-indigo-400"
        >
          Голосовой ввод активен — текст распознан в поле ввода.
        </div>
      )}

      {composerError && (
        <div
          role="alert"
          className="mt-1.5 pl-11 text-[11.5px] font-medium text-[#DC2626] dark:text-red-400"
        >
          {composerError}
        </div>
      )}
    </section>
  );
};
