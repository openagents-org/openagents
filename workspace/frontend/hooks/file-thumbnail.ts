/** Keep full-resolution screenshots out of the grid's decoded image surfaces. */
const MAX_EDGE = 256;
let pending: Promise<unknown> = Promise.resolve();

export function createFileThumbnail(blob: Blob): Promise<Blob> {
  // Decode only one original at a time, even when several downloads finish
  // together. A compressed screenshot can occupy far more memory as pixels.
  const result = pending.then(async () => {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Thumbnail rendering unavailable');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('Thumbnail encoding failed')),
          'image/webp', 0.8,
        ));
      } finally {
        canvas.width = canvas.height = 0;
      }
    } finally {
      bitmap.close();
    }
  });
  pending = result.catch(() => {});
  return result;
}
