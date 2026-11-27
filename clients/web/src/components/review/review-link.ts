/** A cited commit to review: the repository, the commit, and the file and line the note cites (HS2-B5K6GM). */
export type CommitTarget = { directory: string; commit: string; path: string; line: number };

/** What following a commit citation answers: a target to open in a new review instead of a destination. */
export type CommitLink = CommitTarget & { kind: 'commit' };

/**
 * The address of a new review at a cited commit, on the same origin so the host and its saved state are shared.
 * The query is the deep-link scheme: `open=commit` with the repository, commit, file and line.
 */
export function reviewLinkUrl(origin: string, { directory, commit, path, line }: CommitTarget): string {
  const query = new URLSearchParams({ open: 'commit', directory, commit, path, line: String(line) });
  return `${origin}/?${query.toString()}`;
}

/** The target a page address names, or `null` for an ordinary page or a malformed link. */
export function parseReviewLink(search: string): CommitTarget | null {
  const query = new URLSearchParams(search);
  if (query.get('open') !== 'commit') return null;
  const directory = query.get('directory');
  const commit = query.get('commit');
  const path = query.get('path');
  const lineText = query.get('line');
  if (directory === null || directory === '' || path === null || path === '' || lineText === null) return null;
  if (commit === null || !/^[0-9a-f]{7,40}$/iu.test(commit)) return null;
  if (!/^[1-9]\d{0,8}$/u.test(lineText)) return null;
  return { directory, commit: commit.toLowerCase(), path, line: Number(lineText) };
}
