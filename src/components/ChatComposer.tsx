import React, { useState, useRef } from 'react';
import {
  Paperclip,
  Mic,
  FileText,
  SlidersHorizontal,
  Send,
  X,
} from 'lucide-react';

interface ChatComposerProps {
  promptValue: string;
  onPromptChange: (val: string) => void;
  onSubmitPrompt: (text: string, attachments: string[]) => void;
  onOpenPromptLibrary: () => void;
  onOpenModelParams: () => void;
  compact?: boolean;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  promptValue,
  onPromptChange,
  onSubmitPrompt,
  onOpenPromptLibrary,
  onOpenModelParams,
  compact = false,
}) => {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSubmit();
    }
  };

  const triggerSubmit = () => {
    if (!promptValue.trim()) {
      setComposerError('Введите вопрос или выберите быстрый запрос ниже');
      return;
    }
    setComposerError(null);
    onSubmitPrompt(promptValue, attachments);
    setAttachments([]);
    setIsRecordingVoice(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added = Array.from(files).map((f) => f.name);
    setAttachments((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const handleAttachButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleToggleVoice = () => {
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
      className="w-full max-w-[680px] mx-auto rounded-[20px] border border-[#E5E7EB] dark:border-slate-800 bg-[#FAFAFC] dark:bg-[#131829] p-4 shadow-[0_4px_20px_rgba(15,23,42,0.03)]"
    >
      {/* Top Row inside Outer Card: Icon + "Начать новый чат" + Sliders Button */}
      {!compact && (
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2.5">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="text-[#4F46E5] dark:text-indigo-400 shrink-0"
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
            <h2 className="text-[15.5px] font-bold text-[#111827] dark:text-slate-100">
              Начать новый чат
            </h2>
          </div>

          <button
            type="button"
            onClick={onOpenModelParams}
            aria-label="Параметры модели ИИ"
            title="Параметры модели"
            className="focus-ring w-9 h-9 rounded-xl border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800 text-[#1F2937] dark:text-slate-200 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center justify-center transition-colors shrink-0"
          >
            <SlidersHorizontal className="w-4 h-4 stroke-[1.8]" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Inner White/Dark Box */}
      <div className="rounded-[14px] border border-[#E6E8F0] dark:border-slate-800 bg-white dark:bg-[#0E1322] p-4">
        <div className="relative">
          <label htmlFor="chat-prompt-textarea" className="sr-only">
            Чем я могу помочь вам сегодня?
          </label>
          <textarea
            id="chat-prompt-textarea"
            rows={compact ? 2 : 3}
            value={promptValue}
            onChange={(e) => {
              onPromptChange(e.target.value);
              if (composerError) setComposerError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Чем я могу помочь вам сегодня?"
            className="focus-ring w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-[#111827] dark:text-slate-100 placeholder:text-[#6B7280] dark:placeholder:text-slate-400 pr-11"
          />

          {/* Submit Action Button (visible when text is entered) */}
          {promptValue.trim().length > 0 && (
            <button
              type="button"
              onClick={triggerSubmit}
              aria-label="Отправить сообщение"
              className="focus-ring absolute right-0 bottom-1 w-9 h-9 rounded-xl flex items-center justify-center transition-all bg-[#5046E5] text-white hover:bg-[#4338CA] shadow-xs"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Attached Files List (if any) */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            {attachments.map((file, idx) => (
              <span
                key={`${file}-${idx}`}
                className="inline-flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg"
              >
                <Paperclip className="w-3 h-3 text-indigo-500" aria-hidden="true" />
                <span>{file}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label={`Удалить вложение ${file}`}
                  className="focus-ring text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Voice Input Status Alert */}
        {isRecordingVoice && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 text-[12px] font-medium text-indigo-600 dark:text-indigo-400 flex items-center gap-2"
          >
            <span>Голосовой ввод активен — текст распознан в поле ввода.</span>
          </div>
        )}

        {/* Validation Error Alert */}
        {composerError && (
          <div role="alert" className="mt-2 text-[12px] font-medium text-red-600 dark:text-red-400">
            {composerError}
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

        {/* Hairline Divider inside Input Box */}
        <div className="my-3 border-t border-[#ECEEF4] dark:border-slate-800/90" role="separator" />

        {/* Action Buttons Row */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleAttachButtonClick}
            className="focus-ring h-[36px] px-3.5 rounded-[10px] border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800 text-[13px] font-medium text-[#1F2937] dark:text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <Paperclip className="w-[15px] h-[15px] text-[#374151] dark:text-slate-300 stroke-[1.8]" aria-hidden="true" />
            <span>Прикрепить файл</span>
          </button>

          <button
            type="button"
            onClick={handleToggleVoice}
            aria-pressed={isRecordingVoice}
            className={`focus-ring h-[36px] px-3.5 rounded-[10px] border text-[13px] font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
              isRecordingVoice
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                : 'border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200'
            }`}
          >
            <Mic className="w-[15px] h-[15px] stroke-[1.8]" aria-hidden="true" />
            <span>Голосовой ввод</span>
          </button>

          <button
            type="button"
            onClick={onOpenPromptLibrary}
            className="focus-ring h-[36px] px-3.5 rounded-[10px] border border-[#E2E5EE] dark:border-slate-700/90 bg-white dark:bg-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800 text-[13px] font-medium text-[#1F2937] dark:text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <FileText className="w-[15px] h-[15px] text-[#374151] dark:text-slate-300 stroke-[1.8]" aria-hidden="true" />
            <span>Библиотека промптов</span>
          </button>
        </div>
      </div>
    </section>
  );
};
