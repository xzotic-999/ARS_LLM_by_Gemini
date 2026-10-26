import React, { useState } from 'react';
import { Copy, Check, Table as TableIcon } from 'lucide-react';

interface MarkdownContentProps {
  content: string;
}

/**
 * Common language keywords for deterministic lightweight syntax highlighting
 */
const KEYWORDS_BY_LANG: Record<string, Set<string>> = {
  javascript: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'default', 'try', 'catch', 'finally', 'throw', 'new',
    'class', 'extends', 'super', 'this', 'import', 'export', 'from', 'as', 'default',
    'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined',
    'true', 'false', 'void', 'delete'
  ]),
  typescript: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'default', 'try', 'catch', 'finally', 'throw', 'new',
    'class', 'extends', 'super', 'this', 'import', 'export', 'from', 'as', 'default',
    'async', 'await', 'yield', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined',
    'true', 'false', 'interface', 'type', 'enum', 'implements', 'declare', 'namespace',
    'abstract', 'readonly', 'private', 'protected', 'public', 'keyof', 'is'
  ]),
  python: new Set([
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass',
    'try', 'except', 'finally', 'raise', 'import', 'from', 'as', 'class', 'with',
    'lambda', 'yield', 'global', 'nonlocal', 'assert', 'True', 'False', 'None',
    'and', 'or', 'not', 'is', 'in', 'async', 'await'
  ]),
  sql: new Set([
    'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
    'create', 'table', 'alter', 'drop', 'index', 'primary', 'key', 'foreign', 'references',
    'join', 'inner', 'left', 'right', 'full', 'outer', 'on', 'group', 'by', 'order',
    'having', 'limit', 'offset', 'union', 'all', 'as', 'distinct', 'case', 'when',
    'then', 'end', 'and', 'or', 'not', 'null', 'is', 'in', 'between', 'like', 'exists'
  ]),
  bash: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until',
    'case', 'esac', 'function', 'return', 'exit', 'echo', 'cd', 'export', 'source',
    'sudo', 'curl', 'wget', 'cat', 'grep', 'sed', 'awk', 'chmod', 'chown', 'mkdir', 'rm'
  ])
};

// Aliases
KEYWORDS_BY_LANG.ts = KEYWORDS_BY_LANG.typescript;
KEYWORDS_BY_LANG.js = KEYWORDS_BY_LANG.javascript;
KEYWORDS_BY_LANG.py = KEYWORDS_BY_LANG.python;
KEYWORDS_BY_LANG.sh = KEYWORDS_BY_LANG.bash;
KEYWORDS_BY_LANG.shell = KEYWORDS_BY_LANG.bash;
KEYWORDS_BY_LANG.zsh = KEYWORDS_BY_LANG.bash;
KEYWORDS_BY_LANG.ps1 = KEYWORDS_BY_LANG.bash;
KEYWORDS_BY_LANG.powershell = KEYWORDS_BY_LANG.bash;
KEYWORDS_BY_LANG.pgsql = KEYWORDS_BY_LANG.sql;
KEYWORDS_BY_LANG.postgres = KEYWORDS_BY_LANG.sql;
KEYWORDS_BY_LANG.postgresql = KEYWORDS_BY_LANG.sql;

/**
 * Tokenizes and renders highlighted syntax for code lines
 */
function renderSyntaxHighlightedLine(
  line: string,
  lang: string,
  lineKey: string
): React.ReactNode {
  const normalizedLang = lang.toLowerCase().trim();
  const keywordSet = KEYWORDS_BY_LANG[normalizedLang];

  if (!line) {
    return <span key={lineKey}>{'\n'}</span>;
  }

  // Tokenize comments first
  if (
    line.trim().startsWith('//') ||
    line.trim().startsWith('#') ||
    line.trim().startsWith('--') ||
    line.trim().startsWith('/*')
  ) {
    return (
      <span key={lineKey} className="text-slate-400 dark:text-slate-500 italic">
        {line}
      </span>
    );
  }

  // General tokenizer: strings, keywords, numbers, punctuation
  const tokenRegex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[{}()[\];,.:=<>!&|+\-*/%])/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }

    const token = match[0];
    const firstChar = token[0];

    if (firstChar === '"' || firstChar === "'" || firstChar === '`') {
      nodes.push(
        <span key={`${lineKey}-str-${idx++}`} className="text-emerald-600 dark:text-emerald-400">
          {token}
        </span>
      );
    } else if (/^\d+(?:\.\d+)?$/.test(token)) {
      nodes.push(
        <span key={`${lineKey}-num-${idx++}`} className="text-amber-600 dark:text-amber-400">
          {token}
        </span>
      );
    } else if (
      keywordSet &&
      (keywordSet.has(token) || keywordSet.has(token.toLowerCase()))
    ) {
      nodes.push(
        <span key={`${lineKey}-kw-${idx++}`} className="font-semibold text-indigo-600 dark:text-indigo-400">
          {token}
        </span>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return <React.Fragment key={lineKey}>{nodes}</React.Fragment>;
}

/**
 * Fenced Code Block component with header, language badge and copy action
 */
const CodeBlockItem: React.FC<{
  code: string;
  language: string;
}> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language.trim() || 'plaintext';
  const lines = code.split('\n');

  return (
    <div className="my-3.5 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0F172A] text-slate-100 shadow-xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1E293B]/90 border-b border-slate-700/80 text-[11.5px] select-none">
        <span className="font-mono text-slate-400 uppercase tracking-wider font-semibold">
          {displayLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Код скопирован' : 'Скопировать код'}
          className="focus-ring inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400 font-medium">Скопировано</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Копировать</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code>
          {lines.map((l, i) => (
            <React.Fragment key={`cb-line-${i}`}>
              {i > 0 && '\n'}
              {renderSyntaxHighlightedLine(l, displayLang, `cb-l-${i}`)}
            </React.Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
};

/**
 * Interactive Markdown Table with alignment, number formatting and CSV/TSV copy
 */
interface TableColumnAlign {
  align: 'left' | 'center' | 'right';
}

const MarkdownTableItem: React.FC<{
  headers: string[];
  alignments: TableColumnAlign[];
  rows: string[][];
}> = ({ headers, alignments, rows }) => {
  const [copied, setCopied] = useState(false);

  const handleCopyTable = () => {
    const tsvLines = [
      headers.join('\t'),
      ...rows.map((r) => r.join('\t')),
    ].join('\n');

    if (navigator.clipboard) {
      navigator.clipboard.writeText(tsvLines).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isNumericValue = (val: string): boolean => {
    const cleaned = val.trim().replace(/\s+/g, '').replace(/,/g, '.');
    return (
      /^[-+]?\d+(?:\.\d+)?%?$/.test(cleaned) ||
      /^[-+]?[\d.]+\s*(?:тыс\.|млн|млрд|тг|₸|\$|€|₽)?$/i.test(cleaned)
    );
  };

  return (
    <div className="my-3.5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-2xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11.5px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5 font-medium">
          <TableIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>Таблица данных ({rows.length} строк)</span>
        </div>
        <button
          type="button"
          onClick={handleCopyTable}
          aria-label={copied ? 'Таблица скопирована' : 'Скопировать таблицу в буфер обмена'}
          className="focus-ring inline-flex items-center gap-1 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Скопировано</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Копировать таблицу</span>
            </>
          )}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-[13.5px] sm:text-[14px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/80">
              {headers.map((h, i) => {
                const align = alignments[i]?.align ?? 'left';
                const alignClass =
                  align === 'right'
                    ? 'text-right'
                    : align === 'center'
                    ? 'text-center'
                    : 'text-left';

                return (
                  <th
                    key={`th-${i}`}
                    className={`px-3.5 py-2.5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap ${alignClass}`}
                  >
                    {renderInlineMarkdown(h, `th-${i}`)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {rows.map((row, rIdx) => (
              <tr
                key={`tr-${rIdx}`}
                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
              >
                {row.map((cell, cIdx) => {
                  const specifiedAlign = alignments[cIdx]?.align;
                  const autoAlignRight =
                    specifiedAlign === 'right' ||
                    (!specifiedAlign && isNumericValue(cell));
                  const alignClass = autoAlignRight
                    ? 'text-right tabular-nums'
                    : specifiedAlign === 'center'
                    ? 'text-center'
                    : 'text-left';

                  return (
                    <td
                      key={`td-${rIdx}-${cIdx}`}
                      className={`px-3.5 py-2 text-slate-800 dark:text-slate-200 ${alignClass}`}
                    >
                      {renderInlineMarkdown(cell, `td-${rIdx}-${cIdx}`)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * Parses inline Markdown tokens into semantic React elements:
 * - Bold (**bold**, __bold__)
 * - Italic (*italic*, _italic_)
 * - Strikethrough (~~strikethrough~~)
 * - Inline code (`code`)
 * - Inline LaTeX formulas ($formula$)
 * - Links ([label](url))
 */
export function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\$([^$\n]+)\$|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const boldText = match[2] ?? match[3];
    const strikeText = match[4];
    const codeText = match[5];
    const mathText = match[6];
    const italicText = match[7];
    const linkLabel = match[8];
    const linkUrl = match[9];

    if (boldText !== undefined) {
      nodes.push(
        <strong
          key={`${keyPrefix}-b-${tokenIdx++}`}
          className="font-semibold text-slate-900 dark:text-white"
        >
          {renderInlineMarkdown(boldText, `${keyPrefix}-bi-${tokenIdx}`)}
        </strong>
      );
    } else if (strikeText !== undefined) {
      nodes.push(
        <del key={`${keyPrefix}-s-${tokenIdx++}`} className="line-through text-slate-400">
          {strikeText}
        </del>
      );
    } else if (codeText !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${tokenIdx++}`}
          className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[13px] text-indigo-700 dark:text-indigo-300 border border-slate-200/60 dark:border-slate-700/60"
        >
          {codeText}
        </code>
      );
    } else if (mathText !== undefined) {
      nodes.push(
        <span
          key={`${keyPrefix}-m-${tokenIdx++}`}
          className="inline-block font-serif italic text-slate-900 dark:text-slate-100 px-1 py-0.5 bg-slate-100/70 dark:bg-slate-800/60 rounded text-[13.5px]"
        >
          {mathText}
        </span>
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
          className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-500 font-medium"
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
 * Universal production-grade Markdown renderer:
 * - ChatGPT-level typography & hierarchy
 * - Paragraphs with natural line height
 * - Headings H1-H6
 * - Code blocks with copy and syntax tokens
 * - GFM tables with responsive scroll & copy
 * - Ordered & unordered lists with nested indent
 * - Task lists / checklists (- [ ] / - [x])
 * - Formulas ($$math$$ block and $math$ inline)
 * - Blockquotes and horizontal rules
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const normalized = (content || '').replace(/\r\n/g, '\n');

  // Split by fenced code blocks (```lang ... ```) and block math ($$ ... $$)
  const segments = normalized.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);
  const elements: React.ReactNode[] = [];

  segments.forEach((segment, segIdx) => {
    if (!segment) return;

    // 1. Fenced Code Block
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3).replace(/^\n/, '');
      const firstNewline = inner.indexOf('\n');
      const hasLangLine =
        firstNewline !== -1 && /^[a-zA-Z0-9_#+-]{1,24}$/.test(inner.slice(0, firstNewline).trim());
      const lang = hasLangLine ? inner.slice(0, firstNewline).trim() : '';
      const codeBody = hasLangLine ? inner.slice(firstNewline + 1) : inner;

      elements.push(
        <CodeBlockItem
          key={`codeblock-${segIdx}`}
          code={codeBody.replace(/\n$/, '')}
          language={lang}
        />
      );
      return;
    }

    // 2. Block Math ($$ ... $$)
    if (segment.startsWith('$$') && segment.endsWith('$$') && segment.length > 4) {
      const mathBody = segment.slice(2, -2).trim();
      elements.push(
        <div
          key={`math-block-${segIdx}`}
          className="my-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-center font-serif text-[15px] italic text-slate-900 dark:text-slate-100 overflow-x-auto"
        >
          {mathBody}
        </div>
      );
      return;
    }

    // 3. Process lines
    const lines = segment.split('\n');
    let i = 0;

    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // Horizontal Rule (--- or ***)
      if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) {
        elements.push(
          <hr
            key={`hr-${segIdx}-${i}`}
            className="my-4 border-t border-slate-200 dark:border-slate-800"
          />
        );
        i++;
        continue;
      }

      // Headings (# to ######)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];

        const headingClasses: Record<number, string> = {
          1: 'text-[21px] sm:text-[23px] font-bold text-slate-900 dark:text-slate-50 mt-5 mb-2 pb-1.5 border-b border-slate-200 dark:border-slate-800 tracking-tight first:mt-0',
          2: 'text-[18px] sm:text-[20px] font-bold text-slate-900 dark:text-slate-100 mt-4 mb-2 tracking-tight first:mt-0',
          3: 'text-[16px] sm:text-[17px] font-semibold text-slate-900 dark:text-slate-100 mt-3.5 mb-1.5 first:mt-0',
          4: 'text-[15px] font-semibold text-slate-900 dark:text-slate-100 mt-3 mb-1 first:mt-0',
          5: 'text-[14px] font-semibold text-slate-800 dark:text-slate-200 mt-2.5 mb-1 first:mt-0',
          6: 'text-[13.5px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mt-2 mb-1 first:mt-0',
        };

        type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        const Tag: HeadingTag =
          level === 1
            ? 'h1'
            : level === 2
            ? 'h2'
            : level === 3
            ? 'h3'
            : level === 4
            ? 'h4'
            : level === 5
            ? 'h5'
            : 'h6';

        elements.push(
          <Tag
            key={`h-${segIdx}-${i}`}
            className={headingClasses[level] ?? headingClasses[3]}
          >
            {renderInlineMarkdown(headingText, `h-${segIdx}-${i}`)}
          </Tag>
        );
        i++;
        continue;
      }

      // Markdown Tables (| Header 1 | Header 2 | ...)
      if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length) {
        const nextTrimmed = lines[i + 1].trim();
        if (
          nextTrimmed.startsWith('|') &&
          nextTrimmed.endsWith('|') &&
          /^\|(?:\s*:?-+:?\s*\|)+$/.test(nextTrimmed)
        ) {
          const headerCells = trimmed
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim());

          const delimiterCells = nextTrimmed
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim());

          const alignments: TableColumnAlign[] = delimiterCells.map((d) => {
            const hasLeft = d.startsWith(':');
            const hasRight = d.endsWith(':');
            if (hasLeft && hasRight) return { align: 'center' };
            if (hasRight) return { align: 'right' };
            return { align: 'left' };
          });

          i += 2; // skip header and delimiter

          const rowData: string[][] = [];
          while (i < lines.length) {
            const rLine = lines[i].trim();
            if (!rLine.startsWith('|') || !rLine.endsWith('|')) {
              break;
            }
            const cells = rLine
              .slice(1, -1)
              .split('|')
              .map((c) => c.trim());
            rowData.push(cells);
            i++;
          }

          elements.push(
            <MarkdownTableItem
              key={`table-${segIdx}-${i}`}
              headers={headerCells}
              alignments={alignments}
              rows={rowData}
            />
          );
          continue;
        }
      }

      // Task list item (- [ ] or - [x] or * [ ])
      const taskMatch = trimmed.match(/^[-*•]\s+\[([ xX])\]\s+(.+)$/);
      if (taskMatch) {
        const isChecked = taskMatch[1].toLowerCase() === 'x';
        const taskText = taskMatch[2];

        elements.push(
          <div
            key={`task-${segIdx}-${i}`}
            className="flex items-start gap-2.5 my-1.5 pl-1 leading-relaxed text-slate-800 dark:text-slate-200"
          >
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-0 border-slate-300 dark:border-slate-700 cursor-default"
              aria-label={taskText}
            />
            <span className={isChecked ? 'line-through text-slate-400' : ''}>
              {renderInlineMarkdown(taskText, `task-${segIdx}-${i}`)}
            </span>
          </div>
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
          } else if (
            !currentTrimmed &&
            i + 1 < lines.length &&
            /^\d+[.)]\s+/.test(lines[i + 1].trim())
          ) {
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ol
            key={`ol-${segIdx}-${startIdx}`}
            className="list-decimal pl-5 my-2.5 space-y-1.5 marker:font-semibold marker:text-slate-600 dark:marker:text-slate-400 text-slate-800 dark:text-slate-200 leading-[1.68]"
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
          } else if (
            !currentTrimmed &&
            i + 1 < lines.length &&
            /^[-*•]\s+/.test(lines[i + 1].trim())
          ) {
            i++;
          } else {
            break;
          }
        }
        elements.push(
          <ul
            key={`ul-${segIdx}-${startIdx}`}
            className="list-disc pl-5 my-2.5 space-y-1.5 marker:text-indigo-500 dark:marker:text-indigo-400 text-slate-800 dark:text-slate-200 leading-[1.68]"
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
            className="my-3 pl-4 py-1.5 border-l-3 border-indigo-500 bg-slate-50/50 dark:bg-slate-850/40 rounded-r-lg text-slate-700 dark:text-slate-300 italic leading-relaxed"
          >
            {renderInlineMarkdown(quoteLines.join(' '), `bq-${segIdx}-${startIdx}`)}
          </blockquote>
        );
        continue;
      }

      // Standard paragraph
      const paraLines: string[] = [];
      const startIdx = i;
      while (i < lines.length) {
        const lineTrimmed = lines[i].trim();
        if (
          !lineTrimmed ||
          /^(?:[-*_]\s*){3,}$/.test(lineTrimmed) ||
          /^(#{1,6})\s+/.test(lineTrimmed) ||
          (lineTrimmed.startsWith('|') && lineTrimmed.endsWith('|')) ||
          /^[-*•]\s+\[[ xX]\]/.test(lineTrimmed) ||
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
        <p
          key={`p-${segIdx}-${startIdx}`}
          className="my-2.5 first:mt-0 last:mb-0 leading-[1.7] text-slate-800 dark:text-slate-200 text-balance"
        >
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

  return <div className="space-y-1.5 text-[15px] sm:text-[15.5px] md:text-[16px] text-slate-800 dark:text-slate-200 font-sans leading-[1.7] break-words">{elements}</div>;
};
