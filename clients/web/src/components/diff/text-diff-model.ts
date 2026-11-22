export type DiffLine = {
  kind: 'context' | 'added' | 'removed';
  before_line: number | null;
  after_line: number | null;
  text: string;
  ends_with_newline: boolean;
};

export type TextHunk = {
  before_start: number;
  before_count: number;
  after_start: number;
  after_count: number;
  lines: DiffLine[];
};

export type MediaMetadata = { content_type: string; size: number; revision: string };
export type MediaSides<T> = { before: T | null; after: T | null };

export type FileContent =
  | { kind: 'text'; revision: string; hunks: TextHunk[]; diagram?: boolean }
  | ({ kind: 'media' } & MediaSides<MediaMetadata>)
  | { kind: 'unavailable_lfs' }
  | { kind: 'binary' };

export function splitLines(lines: readonly DiffLine[]) {
  const rows: { before?: DiffLine; after?: DiffLine }[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  function flushChanges() {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ before: removed[index], after: added[index] });
    }
    removed = [];
    added = [];
  }

  for (const line of lines) {
    switch (line.kind) {
      case 'removed':
        removed.push(line);
        break;
      case 'added':
        added.push(line);
        break;
      case 'context':
        flushChanges();
        rows.push({ before: line, after: line });
        break;
    }
  }
  flushChanges();
  return rows;
}

type Token = { text: string; kind: 'plain' | 'comment' | 'keyword' | 'number' | 'string' | 'symbol' };

const codeExtensions = new Set([
  'c',
  'cpp',
  'cs',
  'go',
  'h',
  'java',
  'cjs',
  'js',
  'jsx',
  'mjs',
  'rs',
  'swift',
  'ts',
  'tsx',
  'mts',
  'cts',
]);
const hashExtensions = new Set(['bash', 'py', 'pyi', 'rb', 'sh', 'toml', 'yaml', 'yml', 'zsh']);
const keywords = new Set(
  'async await break case class const continue def do else enum export false fn for from function if impl import in let match mod new nil none null pub return self static struct super switch this throw trait true try type use var void while'.split(
    ' ',
  ),
);
const codeTokens =
  /\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[\p{L}_$][\p{L}\p{N}_$]*/gu;
const hashTokens = /#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*/g;

export function syntaxTokens(text: string, path: string, navigate = false): Token[] {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const pattern = hashExtensions.has(extension)
    ? hashTokens
    : codeExtensions.has(extension) || extension === 'json'
      ? codeTokens
      : null;
  if (pattern === null) return [{ text, kind: 'plain' }];

  let offset = 0;
  const tokens: Token[] = [];
  for (const match of text.matchAll(pattern)) {
    const [value] = match;
    const kind =
      value.startsWith('//') || value.startsWith('#')
        ? 'comment'
        : /^["'`]/u.test(value)
          ? 'string'
          : /^\d/u.test(value)
            ? 'number'
            : keywords.has(value.toLowerCase())
              ? 'keyword'
              : navigate
                ? 'symbol'
                : 'plain';
    if (kind === 'plain') continue;
    const index = match.index;
    if (index > offset) tokens.push({ text: text.slice(offset, index), kind: 'plain' });
    tokens.push({ text: value, kind });
    offset = index + value.length;
  }
  if (offset < text.length) tokens.push({ text: text.slice(offset), kind: 'plain' });
  return tokens;
}
