// Shrinks a camera photo on the phone before upload, so a proof photo is a
// few hundred KB instead of the camera's 3–8 MB — the difference between
// seconds and minutes on a weak signal. The server re-encodes it anyway
// (storage/private-photo.ts), so nothing it keeps is lost.
//
// Draws the photo onto a canvas (EXIF orientation applied, metadata
// dropped) and re-encodes as JPEG, stepping quality and then size down
// until it fits. If the browser can't do any of that, the original goes up
// unchanged — the server accepts up to 10 MB.

export const MAX_PROOF_PHOTO_BYTES = 500 * 1024;
const MAX_DIMENSION = 1600;
const QUALITIES = [0.82, 0.7, 0.58];

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function shrinkPhoto(file: File, maxBytes = MAX_PROOF_PHOTO_BYTES): Promise<File> {
  if (file.size <= maxBytes && (file.type === 'image/jpeg' || file.type === 'image/webp')) return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    let smallest: Blob | null = null;
    for (let step = 0; step < 5; step++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        if (!blob) return file;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= maxBytes) return asFile(blob, file.name);
      }
      scale *= 0.75;
    }
    // Still over after every step (very detailed scene): send the smallest
    // try rather than the full original.
    return smallest && smallest.size < file.size ? asFile(smallest, file.name) : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

function asFile(blob: Blob, originalName: string): File {
  const base = originalName.replace(/\.[^.]*$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
