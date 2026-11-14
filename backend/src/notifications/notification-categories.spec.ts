import { NotificationType } from '@prisma/client';
import { NOTIFICATION_CATEGORIES } from './notifications.service';

// The Reminders page filters alerts by these groups; a type left out of
// every group would only ever show under "All".
describe('NOTIFICATION_CATEGORIES', () => {
  it('puts every notification type in exactly one category', () => {
    const listed = Object.values(NOTIFICATION_CATEGORIES).flat();
    expect([...listed].sort()).toEqual(Object.values(NotificationType).sort());
  });
});
