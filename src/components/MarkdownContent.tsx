import React from 'react';

interface MarkdownContentProps {
  content: string;
}

/**
 * Parses inline Markdown tokens (**bold**, *italic*, `code`, [link](url))
 * into semantic React nodes without using dangerouslySetInnerHTML.
 */
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const boldText = match[2] ?? match[3];
    const codeText = match[4];
    const italicText = match[5];
    const linkLabel = match[6];
    const linkUrl = match[7];

    if (boldText !== undefined) {
      nodes.push(
        <strong
          key={`${keyPrefix}-b-${tokenIdx++}`}
          className="font-semibold text-slate-900 dark:text-white"
        >
          {renderInlineMarkdown(boldText, `${keyPrefix}-bi-${tokenIdx}`)}
        </strong>
      );
    } else if (codeText !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${tokenIdx++}`}
          className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[12.5px] text-indigo-700 dark:text-indigo-300"
        >
          {codeText}
        </code>
      );
    } else if (italicText !== undefined) {
      nodes.push(
        <em key={`${keyPrefix}-i-${tokenIdx++}`} className="italic">
          {italicText}
        </em>
      );
    } else if (linkLabel !== undefined && linkUrl !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${tokenIdx++}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-500"
        >
          {linkLabel}
        </a>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Renders Markdown text into semantic HTML elements (<p>, <ol>, <ul>, <li>,
 * <strong>, <code>, <pre>, <h3>/<h4>, <blockquote>) for assistant responses.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const normalized = content.replace(/\r\n/g, '\n');

  // Split by fenced code blocks first: ```lang ... ```
  const segments = normalized.split(/(```[\s\S]*?```)/g);
  const elements: React.ReactNode[] = [];

  segments.forEach((segment, segIdx) => {
    if (!segment) return;

    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3).replace(/^\n/, '');
      const firstNewline = inner.indexOf('\n');
      const hasLangLine =
        firstNewline !== -1 && /^[a-zA-Z0-9_-]{1,20}$/.test(inner.slice(0, firstNewline).trim());
      const lang = hasLangLine ? inner.slice(0, firstNewline).trim() : '';
      const codeBody = hasLangLine ? inner.slice(firstNewline + 1) : inner;

      elements.push(
        <div
          key={`codeblock-${segIdx}`}
          className="my-2.5 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/80 bg-slate-900 text-slate-100"
        >
          {lang && (
            <div className="px-3.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-slate-400 bg-slate-800/90 border-b border-slate-700/70">
              {lang}
            </div>
          )}
          <pre className="p-3.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono">
            <code>{codeBody.replace(/\n$/, '')}</code>
          </pre>
        </div>
      );
      return;
    }

    const lines = segment.split('\n');
    let i = 0;

    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // Headings (# to ####)
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        const HeadingTag = level <= 2 ? 'h3' : 'h4';
        elements.push(
          <HeadingTag
            key={`h-${segIdx}-${i}`}
            className={
              level <= 2
                ? 'text-[15px] font-bold text-slate-900 dark:text-white mt-3 mb-1.5 first:mt-0'
                : 'text-[14px] font-semibold text-slate-900 dark:text-white mt-2.5 mb-1 first:mt-0'
            }
          >
            {renderInlineMarkdown(headingText, `h-${segIdx}-${i}`)}
          </HeadingTag>
        );
        i++;
        continue;
      }

      // Ordered list (1. ..., 2. ...)
      if (/^\d+[.)]\s+/.test(trimmed)) {
        const items: string[] = [];
        const startIdx = i;
        while (i < lines.length) {
          const currentTrimmed = lines[i].trim();
          const olMatch = currentTrimmed.match(/^\d+[.)]\s+(.+)$/);
          if (olMatch) {
            items.push(olMatch[1]);
            i++;
          } else if (!currentTrimmed && i + 1 < lines.length && /^\d+[.)]\s+/.test(lines[i + 1].trim())) {
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ol
            key={`ol-${segIdx}-${startIdx}`}
            className="list-decimal pl-5 my-2 space-y-1.5 marker:font-semibold marker:text-slate-600 dark:marker:text-slate-400"
          >
            {items.map((itemText, idx) => (
              <li key={`oli-${segIdx}-${startIdx}-${idx}`} className="pl-1 leading-relaxed">
                {renderInlineMarkdown(itemText, `oli-${segIdx}-${startIdx}-${idx}`)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Unordered list (- ..., * ..., • ...)
      if (/^[-*•]\s+/.test(trimmed)) {
        const items: string[] = [];
        const startIdx = i;
        while (i < lines.length) {
          const currentTrimmed = lines[i].trim();
          const ulMatch = currentTrimmed.match(/^[-*•]\s+(.+)$/);
          if (ulMatch) {
            items.push(ulMatch[1]);
            i++;
          } else if (!currentTrimmed && i + 1 < lines.length && /^[-*•]\s+/.test(lines[i + 1].trim())) {
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ul
            key={`ul-${segIdx}-${startIdx}`}
            className="list-disc pl-5 my-2 space-y-1.5 marker:text-indigo-500 dark:marker:text-indigo-400"
          >
            {items.map((itemText, idx) => (
              <li key={`uli-${segIdx}-${startIdx}-${idx}`} className="pl-1 leading-relaxed">
                {renderInlineMarkdown(itemText, `uli-${segIdx}-${startIdx}-${idx}`)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Blockquote (> ...)
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        const startIdx = i;
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        elements.push(
          <blockquote
            key={`bq-${segIdx}-${startIdx}`}
            className="my-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 italic"
          >
            {renderInlineMarkdown(quoteLines.join(' '), `bq-${segIdx}-${startIdx}`)}
          </blockquote>
        );
        continue;
      }

      // Standard paragraph (collect consecutive non-list, non-heading lines)
      const paraLines: string[] = [];
      const startIdx = i;
      while (i < lines.length) {
        const lineTrimmed = lines[i].trim();
        if (
          !lineTrimmed ||
          /^(#{1,4})\s+/.test(lineTrimmed) ||
          /^\d+[.)]\s+/.test(lineTrimmed) ||
          /^[-*•]\s+/.test(lineTrimmed) ||
          lineTrimmed.startsWith('>')
        ) {
          break;
        }
        paraLines.push(lines[i]);
        i++;
      }

      elements.push(
        <p key={`p-${segIdx}-${startIdx}`} className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">
          {paraLines.map((pLine, pIdx) => (
            <React.Fragment key={`pl-${segIdx}-${startIdx}-${pIdx}`}>
              {pIdx > 0 && <br />}
              {renderInlineMarkdown(pLine, `pl-${segIdx}-${startIdx}-${pIdx}`)}
            </React.Fragment>
          ))}
        </p>
      );
    }
  });

  return <div className="space-y-1.5">{elements}</div>;
};
