import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCodeLine, parseMarkdownBlocks } from '../../lib/markdown';

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\[Source:[^\]]+\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    const token = m[0];
    if (token.startsWith('[Source:')) {
      parts.push(
        <span
          key={key++}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
        >
          {token.slice(1, -1)}
        </span>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-black/25 font-mono text-[12px] text-emerald-300"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + token.length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted environments
    }
  };

  const lines = content.split('\n');

  return (
    <div className="my-2.5 rounded-lg overflow-hidden border border-zinc-700/70 bg-[#0d1017] text-zinc-100">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] bg-zinc-900/90 border-b border-zinc-800">
        <span className="font-mono uppercase tracking-wider text-zinc-400">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[12.5px] leading-relaxed font-mono">
        <code>
          {lines.map((line, li) => (
            <div key={li}>
              {highlightCodeLine(line).map((tok, ti) => {
                const cls =
                  tok.kind === 'keyword'
                    ? 'text-violet-400 font-medium'
                    : tok.kind === 'string'
                    ? 'text-emerald-300'
                    : tok.kind === 'comment'
                    ? 'text-zinc-500 italic'
                    : tok.kind === 'number'
                    ? 'text-amber-300'
                    : 'text-zinc-100';
                return (
                  <span key={ti} className={cls}>
                    {tok.text}
                  </span>
                );
              })}
              {line.length === 0 ? '\u00A0' : null}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

export const Markdown: React.FC<{ content: string }> = React.memo(({ content }) => {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed break-words">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return <CodeBlock key={idx} lang={block.lang} content={block.content} />;
          case 'heading': {
            const cls =
              block.level === 1
                ? 'text-base font-semibold mt-3'
                : block.level === 2
                ? 'text-[14.5px] font-semibold mt-2.5'
                : 'text-[13.5px] font-semibold mt-2';
            return (
              <div key={idx} className={cls}>
                {renderInline(block.text)}
              </div>
            );
          }
          case 'blockquote':
            return (
              <blockquote
                key={idx}
                className="border-l-2 border-emerald-500/60 pl-3 py-0.5 text-zinc-400 italic space-y-1"
              >
                {block.lines.map((l, i) => (
                  <p key={i}>{renderInline(l)}</p>
                ))}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={idx} className="list-disc pl-5 space-y-1">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="list-decimal pl-5 space-y-1">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={idx} className="border-zinc-700/60 my-2" />;
          case 'paragraph':
            return (
              <p key={idx} className="whitespace-pre-wrap">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
});
