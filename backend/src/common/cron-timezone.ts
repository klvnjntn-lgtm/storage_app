import { DEFAULT_TIMEZONE } from '../accounting/business-date';

// Daily jobs ("9 AM reminders", "3 AM cleanup") are meant in business hours,
// not the server clock — the Docker image runs on UTC, which sent 9 AM
// payment reminders at 16:00 WIB. CRON_TZ overrides it for a deployment
// whose customers are elsewhere.
export const CRON_TIMEZONE = process.env.CRON_TZ || DEFAULT_TIMEZONE;
