// Nest error bodies are JSON ({ message: string | string[], ... }) —
// returns the message itself instead of the raw JSON text.
export async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    if (msg) return String(msg);
  } catch {
    // not JSON — fall through to the raw text
  }
  return text;
}

// The message of something caught in a `catch`, which TypeScript types as
// unknown — '' when it isn't an Error, so `errorMessage(e) || fallback` works.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '';
}
