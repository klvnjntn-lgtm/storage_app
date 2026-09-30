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
