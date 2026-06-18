import { copyTextToClipboard } from '../clipboard';

function installFallback(execResult: boolean) {
  const remove = jest.fn();
  const textArea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: jest.fn(),
    select: jest.fn(),
    setSelectionRange: jest.fn(),
    remove,
  };
  const appendChild = jest.fn();
  const execCommand = jest.fn(() => execResult);

  Object.defineProperty(global, 'document', {
    value: {
      body: { appendChild },
      createElement: jest.fn(() => textArea),
      execCommand,
    },
    configurable: true,
  });

  return { appendChild, execCommand, remove, textArea };
}

function installNavigator(clipboard?: { writeText: jest.Mock }) {
  Object.defineProperty(global, 'navigator', {
    value: clipboard ? { clipboard } : {},
    configurable: true,
  });
}

describe('copyTextToClipboard', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    installNavigator({ writeText });
    const fallback = installFallback(true);

    await copyTextToClipboard('hello');

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(fallback.appendChild).not.toHaveBeenCalled();
  });

  it('uses the iOS-compatible fallback when Clipboard API is unavailable', async () => {
    installNavigator();
    const fallback = installFallback(true);

    await copyTextToClipboard('fallback');

    expect(fallback.textArea.setAttribute).toHaveBeenCalledWith('readonly', '');
    expect(fallback.textArea.select).toHaveBeenCalledTimes(1);
    expect(fallback.textArea.setSelectionRange).toHaveBeenCalledWith(0, 8);
    expect(fallback.execCommand).toHaveBeenCalledWith('copy');
    expect(fallback.remove).toHaveBeenCalledTimes(1);
  });

  it('falls back when Clipboard API writing is rejected', async () => {
    installNavigator({ writeText: jest.fn().mockRejectedValue(new Error('denied')) });
    const fallback = installFallback(true);

    await copyTextToClipboard('retry');

    expect(fallback.execCommand).toHaveBeenCalledWith('copy');
    expect(fallback.remove).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans up when the fallback reports failure', async () => {
    installNavigator();
    const fallback = installFallback(false);

    await expect(copyTextToClipboard('nope')).rejects.toThrow(
      'Failed to copy text to clipboard',
    );
    expect(fallback.remove).toHaveBeenCalledTimes(1);
  });

  it('cleans up when the fallback throws', async () => {
    installNavigator();
    const fallback = installFallback(true);
    fallback.execCommand.mockImplementation(() => {
      throw new Error('blocked');
    });

    await expect(copyTextToClipboard('nope')).rejects.toThrow('blocked');
    expect(fallback.remove).toHaveBeenCalledTimes(1);
  });
});
