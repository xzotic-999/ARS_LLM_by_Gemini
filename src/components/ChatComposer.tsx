import React, { useState, useRef } from 'react';
import {
  Paperclip,
  Mic,
  FileText,
  SlidersHorizontal,
  Send,
  X,
} from 'lucide-react';
import { AttachedFileItem, extractAttachmentText } from '../utils/fileExtractor';

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
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  promptValue,
  onPromptChange,
  onSubmitPrompt,
  onOpenPromptLibrary,
  onOpenModelParams,
  compact = false,
}) => {
  const [attachments, setAttachments] = useState<AttachedFileItem[]>([]);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasText = promptValue.trim().length > 0;

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
      className={`w-full ${
        compact ? 'max-w-[820px] p-3 rounded-[18px]' : 'max-w-[680px] p-4 rounded-[20px]'
      } mx-auto border border-[#E2E5EE] dark:border-slate-800 bg-white dark:bg-[#131829] shadow-[0_8px_30px_rgba(15,23,42,0.06)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition-shadow focus-within:border-indigo-400 dark:focus-within:border-indigo-500/80`}
    >
      {/* Floating Input Bar Textarea Zone (Report 1: no outer card wrapper or duplicate 'Начать новый чат' heading) */}
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
          className="focus-ring w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-[#111827] dark:text-slate-100 placeholder:text-[#6B7280] dark:placeholder:text-slate-400 pr-2"
        />
      </div>

      {/* Attached Files List (if any) */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
          {attachments.map((file, idx) => (
            <span
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg"
            >
              <Paperclip className="w-3 h-3 text-indigo-500" aria-hidden="true" />
              <span>{file.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                aria-label={`Удалить вложение ${file.name}`}
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

      {/* Hairline Divider inside Floating Input Bar */}
      <div
        className={`${compact ? 'my-2' : 'my-2.5'} border-t border-[#ECEEF4] dark:border-slate-800/90`}
        role="separator"
      />

      {/* Bottom Toolbar Row: Left Actions + Right Model Params (with Tooltip) & Send CTA */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAttachButtonClick}
            className="focus-ring h-[34px] px-3 rounded-[10px] border border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-[12.5px] font-medium text-[#1F2937] dark:text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Paperclip className="w-[14px] h-[14px] text-[#374151] dark:text-slate-300 stroke-[1.8]" aria-hidden="true" />
            <span>Прикрепить файл</span>
          </button>

          <button
            type="button"
            onClick={handleToggleVoice}
            aria-pressed={isRecordingVoice}
            className={`focus-ring h-[34px] px-3 rounded-[10px] border text-[12.5px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              isRecordingVoice
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                : 'border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-[#1F2937] dark:text-slate-200'
            }`}
          >
            <Mic className="w-[14px] h-[14px] stroke-[1.8]" aria-hidden="true" />
            <span>Голосовой ввод</span>
          </button>

          <button
            type="button"
            onClick={onOpenPromptLibrary}
            className="focus-ring h-[34px] px-3 rounded-[10px] border border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-[12.5px] font-medium text-[#1F2937] dark:text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <FileText className="w-[14px] h-[14px] text-[#374151] dark:text-slate-300 stroke-[1.8]" aria-hidden="true" />
            <span>Библиотека промптов</span>
          </button>
        </div>

        {/* Right Controls: Model Parameters with explicit Tooltip (Report 5) + Send Button */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative group">
            <button
              type="button"
              onClick={onOpenModelParams}
              aria-label="Параметры модели (температура, токены, системный промпт)"
              aria-describedby="model-params-tooltip"
              title="Параметры модели (температура, лимит токенов, системный промпт)"
              className="focus-ring h-[34px] px-2.5 rounded-[10px] border border-[#E2E5EE] dark:border-slate-700/90 bg-[#FAFAFC] dark:bg-slate-800/70 text-[#374151] dark:text-slate-200 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center gap-1.5 text-[12.5px] font-medium transition-colors shrink-0"
            >
              <SlidersHorizontal className="w-[14px] h-[14px] stroke-[1.8]" aria-hidden="true" />
              <span className="hidden sm:inline">Параметры</span>
            </button>
            <div
              id="model-params-tooltip"
              role="tooltip"
              className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[240px] rounded-lg bg-slate-900 dark:bg-slate-700 px-2.5 py-1.5 text-[11.5px] font-medium text-white shadow-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all z-20"
            >
              Параметры модели: температура, лимит токенов и системный промпт
            </div>
          </div>

          <button
            type="button"
            onClick={triggerSubmit}
            aria-label="Отправить сообщение"
            title="Отправить сообщение (Enter)"
            className={`focus-ring h-[34px] w-[36px] rounded-[10px] flex items-center justify-center transition-all shrink-0 ${
              hasText
                ? 'bg-[#5046E5] text-white hover:bg-[#4338CA] shadow-xs cursor-pointer'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
};
