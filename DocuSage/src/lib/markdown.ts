/**
 * Lightweight, zero-dependency Markdown block parser and syntax tokenizer.
 * Keeps the desktop bundle tiny while rendering headings, lists, blockquotes,
 * inline formatting, citations `[Source: ...]`, and syntax-highlighted code fences.
 */

export type MarkdownBlock =
  | { type: 'code'; lang: string; content: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

export function parseMarkdownBlocks(raw: string): MarkdownBlock[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```([\w.+-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        qLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: qLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: para.join('\n') });
    }
  }

  return blocks;
}

export type CodeToken = { kind: 'plain' | 'keyword' | 'string' | 'comment' | 'number'; text: string };

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'match', 'switch',
  'case', 'break', 'continue', 'async', 'await', 'import', 'export', 'from', 'default', 'class',
  'interface', 'type', 'struct', 'enum', 'impl', 'fn', 'pub', 'use', 'mod', 'def', 'elif',
  'try', 'catch', 'except', 'finally', 'true', 'false', 'null', 'None', 'Some', 'Ok', 'Err',
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'JOIN',
]);

export function highlightCodeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const regex = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(line)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: 'plain', text: line.slice(lastIndex, m.index) });
    }
    const word = m[0];
    if (word.startsWith('//') || word.startsWith('#')) {
      tokens.push({ kind: 'comment', text: word });
    } else if (word.startsWith('"') || word.startsWith("'") || word.startsWith('`')) {
      tokens.push({ kind: 'string', text: word });
    } else if (/^\d/.test(word)) {
      tokens.push({ kind: 'number', text: word });
    } else if (KEYWORDS.has(word)) {
      tokens.push({ kind: 'keyword', text: word });
    } else {
      tokens.push({ kind: 'plain', text: word });
    }
    lastIndex = m.index + word.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: 'plain', text: line.slice(lastIndex) });
  }
  return tokens;
}
