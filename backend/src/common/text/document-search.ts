import { escapeLike } from './escape-like';
import { normalizePlate } from '../../lib/plate';

// Shared pieces of the sales/purchasing list searches, so one search box
// finds a document by what people remember about it: the product on it,
// who made it, the car it was for. Each returns a Prisma `where` fragment
// meant to go inside the list's OR.

const ci = (term: string) => ({ contains: escapeLike(term), mode: 'insensitive' as const });

// A line's product by name or SKU, or the line's own free-text description.
export function lineMatches(term: string) {
  return {
    some: {
      OR: [{ description: ci(term) }, { product: { OR: [{ name: ci(term) }, { sku: ci(term) }] } }],
    },
  };
}

// A member (the document's creator) by display name or email.
export function memberMatches(term: string) {
  return { OR: [{ displayName: ci(term) }, { email: ci(term) }] };
}

// A plate typed any way — "B 1234 XY", "b1234xy", "B-1234-XY" — against
// the vehicle's normalized plate. Null when the term has nothing plate-like
// (no digits), so a customer-name search doesn't also scan plates.
export function plateMatches(term: string) {
  const plate = normalizePlate(term);
  if (!plate || !/\d/.test(plate)) return null;
  return { plateNormalized: { contains: escapeLike(plate) } };
}

export { ci as containsInsensitive };
