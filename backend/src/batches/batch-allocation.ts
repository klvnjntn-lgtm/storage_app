// What is left of each batch, given the product's total on hand.
//
// Assumes first-expired-first-out picking: the units still here belong to
// the batches that expire last. So on-hand is handed out to batches
// latest-expiry first (batches with no expiry date count as expiring last
// of all; ties go to the most recently received), each up to the quantity
// it came in with. Whatever on-hand is left after every batch is full is
// stock that predates tracking or arrived without a batch ("unassigned").

export type BatchInput = {
  id: string;
  quantity: number;
  expiryDate: Date | null;
  receivedAt: Date;
};

export function allocateOnHand<T extends BatchInput>(
  batches: T[],
  onHand: number,
) {
  const order = [...batches].sort((a, b) => {
    if (!a.expiryDate !== !b.expiryDate) return a.expiryDate ? 1 : -1;
    const byExpiry =
      (b.expiryDate?.getTime() ?? 0) - (a.expiryDate?.getTime() ?? 0);
    return byExpiry || b.receivedAt.getTime() - a.receivedAt.getTime();
  });
  let left = Math.max(0, onHand);
  const remaining = new Map<string, number>();
  for (const batch of order) {
    const take = Math.min(left, Math.max(0, batch.quantity));
    remaining.set(batch.id, Math.round(take * 100) / 100);
    left -= take;
  }
  return { remaining, unassigned: Math.round(left * 100) / 100 };
}
