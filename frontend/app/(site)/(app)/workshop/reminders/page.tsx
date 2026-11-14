import { redirect } from 'next/navigation';

// One Reminders page for every module now: vehicle service reminders sit
// there next to delivery alerts. Old links and bookmarks land on it.
export default function WorkshopRemindersRedirect() {
  redirect('/reminders');
}
