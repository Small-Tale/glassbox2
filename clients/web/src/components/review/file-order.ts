/** HS2-5P1B23: the changed files in the order the analysis gives them, with everything it did not cover kept visible. */

export type FileOrder = 'path' | 'risk' | 'narrative';
export type Tone = 'danger' | 'warning' | 'neutral' | 'info';
export type OrderedEntry = { index: number; detail: string; badge: { label: string; tone: Tone } | null };
export type OrderedSection = { id: string; label: string; entries: OrderedEntry[] };

type Analysis = {
  files: { path: string; analysis: { kind: string; rationale?: string; aggregate?: number } }[];
  narrative?: { path: string; reason: string }[];
  skipped?: string[];
  failures?: { path: string; message: string }[];
} | null;

export function riskLevel(aggregate: number): { label: string; tone: Tone } {
  if (aggregate >= 0.7) return { label: 'High Risk', tone: 'danger' };
  if (aggregate >= 0.35) return { label: 'Medium Risk', tone: 'warning' };
  return { label: 'Low Risk', tone: 'neutral' };
}

/**
 * Sections for the Risk or Narrative order. Files the analysis did not reach stay listed after the ordered ones,
 * failed files apart from the rest, so a late, partial or failed result never hides a file.
 */
export function orderFiles(
  paths: readonly string[],
  order: 'risk' | 'narrative',
  analysis: Analysis,
): OrderedSection[] {
  const indexOf = new Map<string, number>();
  paths.forEach((path, index) => {
    if (!indexOf.has(path)) indexOf.set(path, index);
  });
  const placed = new Set<number>();
  const ordered: OrderedEntry[] = [];
  if (order === 'risk') {
    const scored = (analysis?.files ?? []).flatMap((file) => {
      const index = indexOf.get(file.path);
      const aggregate = file.analysis.aggregate;
      return file.analysis.kind === 'risk' && index !== undefined && aggregate !== undefined
        ? [{ index, aggregate, rationale: file.analysis.rationale ?? '' }]
        : [];
    });
    scored.sort((a, b) => b.aggregate - a.aggregate || (paths[a.index] ?? '').localeCompare(paths[b.index] ?? ''));
    for (const { index, aggregate, rationale } of scored) {
      if (placed.has(index)) continue;
      placed.add(index);
      ordered.push({ index, detail: rationale, badge: riskLevel(aggregate) });
    }
  } else {
    (analysis?.narrative ?? []).forEach(({ path, reason }) => {
      const index = indexOf.get(path);
      if (index === undefined || placed.has(index)) return;
      placed.add(index);
      ordered.push({ index, detail: reason, badge: { label: `Step ${ordered.length + 1}`, tone: 'info' } });
    });
  }
  const failed: OrderedEntry[] = [];
  for (const { path, message } of analysis?.failures ?? []) {
    const index = indexOf.get(path);
    if (index === undefined || placed.has(index)) continue;
    placed.add(index);
    failed.push({ index, detail: message, badge: null });
  }
  const rest: OrderedEntry[] = [];
  paths.forEach((_, index) => {
    if (!placed.has(index)) rest.push({ index, detail: '', badge: null });
  });
  const sections: OrderedSection[] = [];
  if (ordered.length > 0) {
    sections.push({
      id: 'ordered',
      label: order === 'risk' ? 'Highest Risk First' : 'Review in This Order',
      entries: ordered,
    });
  }
  if (failed.length > 0) sections.push({ id: 'failed', label: 'Analysis Failed', entries: failed });
  if (rest.length > 0) {
    sections.push({ id: 'rest', label: order === 'risk' ? 'Not Analyzed' : 'Not in the Narrative', entries: rest });
  }
  return sections;
}
