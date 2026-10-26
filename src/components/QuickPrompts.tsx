import React from 'react';
import {
  Image as ImageIcon,
  Code2,
  FileText,
  ListTodo,
  Lightbulb,
} from 'lucide-react';
import { QuickPrompt, QuickPromptIconType } from '../utils/dashboardLogic';

interface QuickPromptsProps {
  prompts: QuickPrompt[];
  onSelectQuickPrompt: (prompt: QuickPrompt) => void;
}

export const QuickPrompts: React.FC<QuickPromptsProps> = ({
  prompts,
  onSelectQuickPrompt,
}) => {
  const renderIconBadge = (iconType: QuickPromptIconType) => {
    switch (iconType) {
      case 'image':
        return (
          <span
            className="w-7 h-7 rounded-lg bg-[#FFF3E6] dark:bg-orange-500/20 text-[#F97316] dark:text-orange-400 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <ImageIcon className="w-4 h-4 stroke-[2]" />
          </span>
        );
      case 'code':
        return (
          <span
            className="w-7 h-7 rounded-lg bg-[#EEF0FF] dark:bg-indigo-500/20 text-[#4F46E5] dark:text-indigo-400 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Code2 className="w-4 h-4 stroke-[2]" />
          </span>
        );
      case 'summarize':
        return (
          <span
            className="w-7 h-7 rounded-lg bg-[#E8F8EE] dark:bg-emerald-500/20 text-[#22C55E] dark:text-emerald-400 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <FileText className="w-4 h-4 stroke-[2]" />
          </span>
        );
      case 'plan':
        return (
          <span
            className="w-7 h-7 rounded-lg bg-[#FFF4E5] dark:bg-amber-500/20 text-[#F59E0B] dark:text-amber-400 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <ListTodo className="w-4 h-4 stroke-[2]" />
          </span>
        );
      case 'idea':
        return (
          <span
            className="w-7 h-7 rounded-lg bg-[#F1EEFF] dark:bg-violet-500/20 text-[#6366F1] dark:text-violet-400 flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Lightbulb className="w-4 h-4 stroke-[2]" />
          </span>
        );
    }
  };

  return (
    <section
      aria-labelledby="quick-prompts-heading"
      className="w-full max-w-[900px] mx-auto mt-7"
    >
      <h3
        id="quick-prompts-heading"
        className="text-[13.5px] font-semibold text-[#4B5563] dark:text-slate-400 text-center mb-3.5"
      >
        Выберите быстрый запрос
      </h3>

      {/* Symmetric Equal-Column Grid (2x3 on mobile/tablet, 3x2 on desktop — Report 2) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-[900px] mx-auto">
        {prompts.map((qp) => (
          <button
            key={qp.id}
            type="button"
            onClick={() => onSelectQuickPrompt(qp)}
            className="focus-ring group h-[44px] w-full px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-[#131829] hover:border-indigo-400 dark:hover:border-indigo-500/70 hover:shadow-xs flex items-center gap-2.5 text-[13px] font-medium text-[#111827] dark:text-slate-100 text-left"
          >
            {renderIconBadge(qp.iconType)}
            <span className="truncate">{qp.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
