// Prisma's `contains` / `startsWith` / `endsWith` pass the value into a SQL
// LIKE pattern without escaping, so a search for "100%" or "A_1" matched
// far more than it said. Every user-typed search goes through this first.
// Backslash is Postgres's default LIKE escape character.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
