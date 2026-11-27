/**
 * Copies text for a "Copy Path" action and answers the status line to show (GB2-SWK512). The clipboard write is
 * replaceable so tests need no browser.
 */
export async function copyText(
  text: string,
  what = 'Path',
  write: (text: string) => Promise<void> = (value) => navigator.clipboard.writeText(value),
): Promise<string> {
  try {
    await write(text);
    return `${what} copied.`;
  } catch {
    return `Could not copy the ${what.toLowerCase()}.`;
  }
}
