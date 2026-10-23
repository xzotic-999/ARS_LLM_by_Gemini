import React, { useId } from 'react';

interface ArsLogoProps {
  collapsed?: boolean;
}

export const ArsLogo: React.FC<ArsLogoProps> = ({ collapsed = false }) => {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const gradLeftId = `ars-grad-left-${uid}`;
  const gradRightId = `ars-grad-right-${uid}`;
  const gradBarId = `ars-grad-bar-${uid}`;

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Geometric faceted 'A' mark matching the ARS LLM reference */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="w-8 h-8 block shrink-0 overflow-visible"
      >
        <defs>
          <linearGradient id={gradLeftId} x1="18" y1="3" x2="5" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
          <linearGradient id={gradRightId} x1="18" y1="3" x2="31" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4338CA" />
            <stop offset="100%" stopColor="#6366F1" />
          </linearGradient>
          <linearGradient id={gradBarId} x1="10" y1="24" x2="26" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
        {/* Left outer facet */}
        <path d="M18 3L4 31H11.5L18 14.5V3Z" fill={`url(#${gradLeftId})`} />
        {/* Right outer facet */}
        <path d="M18 3L32 31H24.5L18 14.5V3Z" fill={`url(#${gradRightId})`} />
        {/* Inner lower prism cross-facet */}
        <path d="M12.5 23.5L18 19L23.5 23.5L26.5 31H9.5L12.5 23.5Z" fill={`url(#${gradBarId})`} opacity="0.9" />
        {/* Center negative-space triangle */}
        <path d="M18 13.5L13.5 24H22.5L18 13.5Z" className="fill-[#FAFAFC] dark:fill-[#111524]" />
      </svg>
      {!collapsed && (
        <span className="text-[18px] font-bold tracking-tight text-[#111827] dark:text-slate-100 whitespace-nowrap">
          ARS LLM
        </span>
      )}
    </div>
  );
};
