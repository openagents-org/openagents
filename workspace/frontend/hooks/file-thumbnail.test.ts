// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createFileThumbnail } from './file-thumbnail';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('bounds both dimensions, preserves aspect ratio, and releases decoded pixels', async () => {
  const bitmap = { width: 4000, height: 2000, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  const output = new Blob(['thumbnail'], { type: 'image/webp' });
  let dimensions: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    dimensions = [this.width, this.height]; callback(output);
  });
  expect(await createFileThumbnail(new Blob(['large original']))).toBe(output);
  expect(dimensions).toEqual([256, 128]);
  expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 256, 128);
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('serializes original decodes and recovers after a failed thumbnail', async () => {
  let rejectDecode!: (error: Error) => void;
  const bitmap = { width: 20, height: 40, close: vi.fn() };
  const decode = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectDecode = reject; })).mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const output = new Blob(['small']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    expect([this.width, this.height]).toEqual([20, 40]); callback(output);
  });
  const first = createFileThumbnail(new Blob(['broken']));
  const failure = expect(first).rejects.toThrow('decode failed');
  const second = createFileThumbnail(new Blob(['valid']));
  await Promise.resolve();
  expect(decode).toHaveBeenCalledTimes(1);
  rejectDecode(new Error('decode failed'));
  await failure;
  expect(await second).toBe(output);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
