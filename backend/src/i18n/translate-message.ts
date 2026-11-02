import type { Request } from 'express';
import { ERROR_MESSAGES_ID } from './error-messages-id';

// The web app's language choice, mirrored into this cookie (see
// LanguageContext on the frontend) so it reaches every request — including
// uploads that don't go through apiFetch.
export const LANG_COOKIE = 'waresys_lang';

export function wantsIndonesian(req: Request | undefined): boolean {
  const header = req?.headers?.cookie;
  if (!header) return false;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === LANG_COOKIE) return part.slice(eq + 1).trim() === 'id';
  }
  return false;
}

type Pattern = { re: RegExp; to: string; literal: number };

const exact = new Map<string, string>();
const patterns: Pattern[] = [];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const [en, id] of ERROR_MESSAGES_ID) {
  if (!en.includes('{}')) {
    exact.set(en, id);
    continue;
  }
  const parts = en.split('{}');
  patterns.push({
    re: new RegExp(`^${parts.map(escapeRe).join('([\\s\\S]*?)')}$`),
    to: id,
    literal: parts.join('').length,
  });
}
// The most specific pattern wins: "{} not found" must not swallow
// "Product {} not found".
patterns.sort((a, b) => b.literal - a.literal);

// class-validator's built-in DTO messages ("$property must be a string"),
// for the decorators this API uses. The property name stays as it is.
const VALIDATOR_RULES: [RegExp, string][] = [
  [/^(\S+) should not be empty$/, '$1 tidak boleh kosong'],
  [/^(\S+) must be a string$/, '$1 harus berupa teks'],
  [/^(\S+) must be a number conforming to the specified constraints$/, '$1 harus berupa angka'],
  [/^(\S+) must be an integer number$/, '$1 harus berupa bilangan bulat'],
  [/^(\S+) must be a positive number$/, '$1 harus berupa angka positif'],
  [/^(\S+) must be a boolean value$/, '$1 harus bernilai true/false'],
  [/^(\S+) must be an email$/, '$1 harus berupa alamat email yang valid'],
  [/^(\S+) must be a UUID$/, '$1 harus berupa ID yang valid'],
  [/^(\S+) must be an array$/, '$1 harus berupa daftar'],
  [/^(\S+) must be an object$/, '$1 harus berupa objek'],
  [/^(\S+) must be a valid ISO 8601 date string$/, '$1 harus berupa tanggal yang valid'],
  [/^(\S+) must be a latitude string or number$/, '$1 harus berupa latitude yang valid'],
  [/^(\S+) must be a longitude string or number$/, '$1 harus berupa longitude yang valid'],
  [/^(\S+) must be one of the following values: (.*)$/, '$1 harus salah satu dari: $2'],
  [/^(\S+) must be a valid enum value$/, '$1 berisi pilihan yang tidak valid'],
  [/^(\S+) must not be less than (\S+)$/, '$1 tidak boleh kurang dari $2'],
  [/^(\S+) must not be greater than (\S+)$/, '$1 tidak boleh lebih dari $2'],
  [/^(\S+) must be longer than or equal to (\d+) characters$/, '$1 minimal $2 karakter'],
  [/^(\S+) must be shorter than or equal to (\d+) characters$/, '$1 maksimal $2 karakter'],
  [/^(\S+) must contain at least (\d+) elements$/, '$1 minimal berisi $2 item'],
  [/^(\S+) must contain no more than (\d+) elements$/, '$1 maksimal berisi $2 item'],
  [/^(\S+) must match (.+) regular expression$/, 'Format $1 tidak valid'],
  [/^(\S+) should not be equal to (.+)$/, '$1 tidak boleh bernilai $2'],
  [/^property (\S+) should not exist$/, 'Kolom $1 tidak dikenal'],
];

function fill(template: string, values: string[]): string {
  let next = 0;
  return template
    .replace(/\{(\d+)\}/g, (_, i: string) => values[Number(i)] ?? '')
    .replace(/\{\}/g, () => values[next++] ?? '');
}

// One message into Indonesian; anything unknown is returned unchanged.
// Values filled into a pattern are translated too, for messages built from
// other messages (an approval's reason inside "{}. An admin needs to
// approve it first.").
export function toIndonesian(message: string, depth = 0): string {
  const hit = exact.get(message);
  if (hit !== undefined) return hit;
  const each = /^each value in (\S+) (.+)$/.exec(message);
  if (each) {
    const rest = toIndonesian(`${each[1]} ${each[2]}`, depth);
    return rest === `${each[1]} ${each[2]}` ? message : `Setiap nilai di ${rest}`;
  }
  for (const p of patterns) {
    const m = p.re.exec(message);
    if (!m) continue;
    const values = m.slice(1).map((v) => (depth < 2 ? toIndonesian(v, depth + 1) : v));
    return fill(p.to, values);
  }
  for (const [re, to] of VALIDATOR_RULES) {
    if (re.test(message)) return message.replace(re, to);
  }
  return message;
}

// An error/response body's `message` (a string, or a list of them from DTO
// validation) in Indonesian.
export function translateBody<T>(body: T): T {
  if (!body || typeof body !== 'object' || !('message' in body)) return body;
  const { message } = body as { message: unknown };
  if (typeof message === 'string') return { ...body, message: toIndonesian(message) };
  if (Array.isArray(message)) {
    return { ...body, message: message.map((m) => (typeof m === 'string' ? toIndonesian(m) : m)) };
  }
  return body;
}
