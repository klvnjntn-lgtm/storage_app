// Shrinks a camera photo on the phone before upload, so a proof photo is a
// few hundred KB instead of the camera's 3–8 MB — the difference between
// seconds and minutes on a weak signal. The server re-encodes it anyway
// (storage/private-photo.ts), so nothing it keeps is lost.
//
// Draws the photo onto a canvas (EXIF orientation applied, metadata
// dropped), optionally burns a text stamp into its bottom-left corner
// (date, time, GPS — see the driver page), and re-encodes as JPEG, stepping
// quality and then size down until it fits. If the browser can't do any of
// that, the original goes up unchanged and unstamped — the server accepts
// up to 10 MB.

export const MAX_PROOF_PHOTO_BYTES = 500 * 1024;
const MAX_DIMENSION = 1600;
const QUALITIES = [0.82, 0.7, 0.58];

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function shrinkPhoto(
  file: File,
  { maxBytes = MAX_PROOF_PHOTO_BYTES, stamp = [] }: { maxBytes?: number; stamp?: string[] } = {},
): Promise<File> {
  if (stamp.length === 0 && file.size <= maxBytes && (file.type === 'image/jpeg' || file.type === 'image/webp')) {
    return file;
  }
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
      drawStamp(ctx, canvas.width, canvas.height, stamp);
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

// White text on a dark band in the bottom-left corner, sized to the photo
// so it reads the same on a thumbnail and full size.
function drawStamp(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  if (lines.length === 0) return;
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 28));
  const pad = Math.round(fontSize * 0.6);
  const lineHeight = Math.round(fontSize * 1.3);
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Roboto, sans-serif`;
  ctx.textBaseline = 'top';
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxWidth = Math.min(width, Math.ceil(textWidth + pad * 2));
  const boxHeight = lines.length * lineHeight + pad * 2 - (lineHeight - fontSize);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, height - boxHeight, boxWidth, boxHeight);
  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => ctx.fillText(line, pad, height - boxHeight + pad + i * lineHeight));
}

function asFile(blob: Blob, originalName: string): File {
  const base = originalName.replace(/\.[^.]*$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
