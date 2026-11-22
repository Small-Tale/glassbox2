export interface ReviewTarget { line: number }
export type SourceId = string;
export enum Mode { Before, After }
export const defaultMode = Mode.Before;
export async function resolve(target: ReviewTarget) { return target.line; }
export const makeAnchor = (line: number) => ({ line });
export class History {
  current() { return 1; }
  async goBack() { return this.current(); }
}
export function
  splitDeclaration() { return 2; }
const example = `
function phantom() {}
`;
