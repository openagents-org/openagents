/** Copy using the capabilities of this environment; resolve only after success.
 * These apps ship independently, so keep this contract and its tests local.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  let nativeError: unknown;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    nativeError = error;
  }

  try {
    if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
      throw new Error('Clipboard is unavailable');
    }

    const active = document.activeElement as HTMLElement | null;
    const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
    const inputSelection = input && input.selectionStart !== null
      ? { start: input.selectionStart, end: input.selectionEnd!, direction: input.selectionDirection! }
      : null;
    const selection = document.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.fontSize = '16px';
    // Stay inside a modal's focus trap when copying from a dialog.
    const container = active?.closest('[role="dialog"], dialog') || document.body;
    try {
      container.appendChild(textarea);
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      if (!document.execCommand('copy')) throw new Error('Copy command failed');
    } finally {
      textarea.remove();
      if (active?.isConnected) {
        active.focus({ preventScroll: true });
      }
      if (selection) {
        selection.removeAllRanges();
        ranges.forEach(range => selection.addRange(range));
      }
      // Chromium can reset an input selection when document ranges are restored.
      if (input?.isConnected && inputSelection) input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
    }
  } catch (fallbackError) {
    // Never include the copied text (which may be a credential) in an error.
    throw Object.assign(new Error('Failed to copy text to clipboard'), { cause: nativeError ?? fallbackError });
  }
}
