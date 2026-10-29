import type { Metadata } from "next";
import "../globals.css";
import { LanguageProvider } from "../context/LanguageContext";
import { ThemeProvider, themeInitScript } from "../context/ThemeContext";

// Pages opened by people outside the workshop (e.g. a customer approving an
// estimate) — no sign-in, no app shell.
export const metadata: Metadata = {
  title: "WareSys",
  robots: { index: false, follow: false },
};

export default function PublicRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className="antialiased"
      // the theme script below sets data-theme/color-scheme before hydration
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* Same light/dark palette as the app (theme.css): the customer's saved choice, else their phone's. */}
      <body style={{ margin: 0, backgroundColor: 'var(--page-bg)' }} className="text-gray-900">
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
