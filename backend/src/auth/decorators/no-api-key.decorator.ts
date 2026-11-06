import { SetMetadata } from '@nestjs/common';

// Refuses API keys on a controller or route. Read from the matched route, not
// the URL, so no spelling of the path can get around it.
export const NO_API_KEY = 'noApiKey';
export const NoApiKey = () => SetMetadata(NO_API_KEY, true);
