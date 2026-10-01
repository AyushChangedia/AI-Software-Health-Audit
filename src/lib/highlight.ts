/**
 * A small, dependency-free syntax highlighter.
 *
 * Shiki and Prism are both excellent and both cost more than this page needs:
 * every snippet Sentinel renders is a handful of lines, and shipping a full
 * tokenizer to the browser for that is the wrong trade. This covers the
 * languages the analysis engine actually reads, degrades to plain text for
 * anything else, and runs identically on the server and the client.
 *
 * Output is a token array, never HTML — React does the escaping, so repository
 * source can never become markup.
 */

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'type'
  | 'operator'
  | 'punctuation'
  | 'property';

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS: Record<string, string[]> = {
  javascript: [
    'const','let','var','function','return','if','else','for','while','do','switch','case','break',
    'continue','new','class','extends','super','this','typeof','instanceof','in','of','try','catch',
    'finally','throw','async','await','yield','import','export','from','as','default','delete','void',
    'null','undefined','true','false','static','get','set',
  ],
  typescript: [
    'const','let','var','function','return','if','else','for','while','do','switch','case','break',
    'continue','new','class','extends','implements','super','this','typeof','instanceof','in','of',
    'try','catch','finally','throw','async','await','yield','import','export','from','as','default',
    'delete','void','null','undefined','true','false','interface','type','enum','namespace','declare',
    'readonly','public','private','protected','abstract','static','satisfies','keyof','infer','is','get','set',
  ],
  python: [
    'def','class','return','if','elif','else','for','while','break','continue','import','from','as',
    'try','except','finally','raise','with','lambda','yield','async','await','pass','global','nonlocal',
    'assert','del','in','is','not','and','or','None','True','False','self',
  ],
  sql: [
    'SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','JOIN','LEFT','RIGHT',
    'INNER','OUTER','ON','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','CREATE','TABLE','ALTER','DROP',
    'INDEX','PRIMARY','KEY','FOREIGN','REFERENCES','NOT','NULL','AND','OR','AS','DISTINCT','UNION','CASE',
    'WHEN','THEN','END','RETURNING',
  ],
  go: [
    'package','import','func','return','if','else','for','range','switch','case','default','break',
    'continue','var','const','type','struct','interface','map','chan','go','defer','select','nil','true','false',
  ],
  shell: ['if','then','else','fi','for','in','do','done','while','case','esac','function','export','local','return'],
  json: ['true','false','null'],
  yaml: ['true','false','null'],
};

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  python: 'python',
  sql: 'sql',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  dotenv: 'shell',
  gitignore: 'shell',
  vue: 'javascript',
  svelte: 'javascript',
  ruby: 'python',
  rust: 'typescript',
  java: 'typescript',
  'c#': 'typescript',
  php: 'javascript',
};

export function normalizeLanguage(language: string | undefined): string {
  if (!language) return 'plain';
  return ALIASES[language.toLowerCase()] ?? 'plain';
}

const LINE_COMMENT: Record<string, string[]> = {
  typescript: ['//'],
  javascript: ['//'],
  go: ['//'],
  python: ['#'],
  shell: ['#'],
  yaml: ['#'],
  sql: ['--'],
  json: [],
  plain: [],
};

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
const WHITESPACE = /\s+/y;
const OPERATOR = /[+\-*/%=<>!&|^~?:]+/y;
const PUNCTUATION = /[{}()[\];,.@#]/y;

function push(tokens: Token[], text: string, kind: TokenKind) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ text, kind });
}

/**
 * Tokenizes one line. Multi-line constructs (block comments, template literals
 * spanning lines) are handled per line, which is correct for the short excerpts
 * Sentinel renders and avoids carrying parser state across a virtualised list.
 */
export function highlightLine(line: string, language: string): Token[] {
  const lang = normalizeLanguage(language);
  if (lang === 'plain') return [{ text: line, kind: 'plain' }];

  const keywords = new Set(KEYWORDS[lang] ?? []);
  const caseInsensitiveKeywords = lang === 'sql';
  const comments = LINE_COMMENT[lang] ?? [];
  const tokens: Token[] = [];

  let i = 0;
  while (i < line.length) {
    // Comments run to end of line.
    const comment = comments.find((token) => line.startsWith(token, i));
    if (comment) {
      push(tokens, line.slice(i), 'comment');
      break;
    }
    if (line.startsWith('/*', i)) {
      const end = line.indexOf('*/', i + 2);
      const stop = end === -1 ? line.length : end + 2;
      push(tokens, line.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    const char = line[i]!;

    // Strings, including template literals.
    if (char === '"' || char === "'" || char === '`') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === char) {
          j += 1;
          break;
        }
        j += 1;
      }
      push(tokens, line.slice(i, j), 'string');
      i = j;
      continue;
    }

    WHITESPACE.lastIndex = i;
    const ws = WHITESPACE.exec(line);
    if (ws) {
      push(tokens, ws[0], 'plain');
      i = WHITESPACE.lastIndex;
      continue;
    }

    NUMBER.lastIndex = i;
    const num = NUMBER.exec(line);
    if (num && /[\d]/.test(char)) {
      push(tokens, num[0], 'number');
      i = NUMBER.lastIndex;
      continue;
    }

    IDENT.lastIndex = i;
    const ident = IDENT.exec(line);
    if (ident) {
      const word = ident[0];
      const isKeyword = caseInsensitiveKeywords
        ? keywords.has(word.toUpperCase())
        : keywords.has(word);
      const next = line.slice(IDENT.lastIndex).trimStart()[0];
      const previous = line.slice(0, i).trimEnd().slice(-1);

      let kind: TokenKind = 'plain';
      if (isKeyword) kind = 'keyword';
      else if (next === '(') kind = 'function';
      else if (previous === '.') kind = 'property';
      else if (/^[A-Z]/.test(word)) kind = 'type';

      push(tokens, word, kind);
      i = IDENT.lastIndex;
      continue;
    }

    OPERATOR.lastIndex = i;
    const op = OPERATOR.exec(line);
    if (op) {
      push(tokens, op[0], 'operator');
      i = OPERATOR.lastIndex;
      continue;
    }

    PUNCTUATION.lastIndex = i;
    const punct = PUNCTUATION.exec(line);
    if (punct) {
      push(tokens, punct[0], 'punctuation');
      i = PUNCTUATION.lastIndex;
      continue;
    }

    push(tokens, char, 'plain');
    i += 1;
  }

  return tokens;
}

/** Tailwind classes per token kind. Kept here so the palette stays in one place. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: 'text-[var(--color-ink)]',
  keyword: 'text-[var(--color-signal-soft)]',
  string: 'text-[#7ee787]',
  comment: 'text-[var(--color-ink-faint)] italic',
  number: 'text-[#f0a868]',
  function: 'text-[#79c0ff]',
  type: 'text-[#56d4dd]',
  operator: 'text-[var(--color-ink-muted)]',
  punctuation: 'text-[var(--color-ink-muted)]',
  property: 'text-[#a5d6ff]',
};
