import { IsString, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

// Hosts of the browser vendors' push services. The backend POSTs to the
// stored endpoint every time it sends a notification, so an unchecked URL
// would let any signed-in user make the server send requests to internal
// addresses (http://vroom:3000, a cloud metadata IP, ...).
const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung Internet
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // legacy Edge / Windows
  'push.apple.com', // Safari
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

@ValidatorConstraint({ name: 'pushServiceEndpoint' })
class PushServiceEndpoint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isPushServiceEndpoint(value);
  }
  defaultMessage() {
    return 'endpoint must be a browser push service URL';
  }
}

export class PushSubscriptionDto {
  @IsString()
  @MaxLength(1000)
  @Validate(PushServiceEndpoint)
  endpoint!: string;

  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(100)
  auth!: string;
}

export class UnsubscribeDto {
  @IsString()
  endpoint!: string;
}
