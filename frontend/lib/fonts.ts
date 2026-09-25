import { Space_Grotesk } from 'next/font/google';

// Display face for headings. Declared once here so every page shares a
// single font instance instead of each module creating its own.
export const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });
