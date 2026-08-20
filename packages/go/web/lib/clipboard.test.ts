import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

function installFallback(execResult: boolean) {
  const remove = vi.fn();
  const textArea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove,
  };
  const appendChild = vi.fn();
  const execCommand = vi.fn(() => execResult);

  vi.stubGlobal('document', {
    body: { appendChild },
    createElement: vi.fn(() => textArea),
    execCommand,
  });

  return { appendChild, execCommand, remove, textArea };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fallback = installFallback(true);

    await copyTextToClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(fallback.appendChild).not.toHaveBeenCalled();
  });

  it('falls back when navigator.clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const fallback = installFallback(true);

    await copyTextToClipboard('fallback');

    expect(fallback.textArea.value).toBe('fallback');
    expect(fallback.textArea.setAttribute).toHaveBeenCalledWith('readonly', '');
    expect(fallback.textArea.select).toHaveBeenCalledOnce();
    expect(fallback.textArea.setSelectionRange).toHaveBeenCalledWith(0, 8);
    expect(fallback.execCommand).toHaveBeenCalledWith('copy');
    expect(fallback.remove).toHaveBeenCalledOnce();
  });

  it('falls back when navigator is unavailable', async () => {
    vi.stubGlobal('navigator', undefined);
    const fallback = installFallback(true);

    await copyTextToClipboard('server-safe');

    expect(fallback.execCommand).toHaveBeenCalledWith('copy');
    expect(fallback.remove).toHaveBeenCalledOnce();
  });

  it('falls back when Clipboard API writing is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fallback = installFallback(true);

    await copyTextToClipboard('retry');

    expect(fallback.execCommand).toHaveBeenCalledWith('copy');
    expect(fallback.remove).toHaveBeenCalledOnce();
  });

  it('rejects when the fallback reports failure', async () => {
    vi.stubGlobal('navigator', {});
    const fallback = installFallback(false);

    await expect(copyTextToClipboard('nope')).rejects.toThrow(
      'Failed to copy text to clipboard',
    );
    expect(fallback.remove).toHaveBeenCalledOnce();
  });

  it('cleans up when the fallback throws', async () => {
    vi.stubGlobal('navigator', {});
    const fallback = installFallback(true);
    fallback.execCommand.mockImplementation(() => {
      throw new Error('blocked');
    });

    await expect(copyTextToClipboard('nope')).rejects.toThrow('blocked');
    expect(fallback.remove).toHaveBeenCalledOnce();
  });
});
