import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import AuthGuard from "../components/shared/AuthGuard";
import { LanguageProvider } from "../context/LanguageContext";
import { DialogProvider } from "../components/shared/DialogProvider";
import { ThemeProvider, themeInitScript } from "../context/ThemeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "WareSys",
    template: "%s · WareSys",
  },
  description: "Warehouse inventory management system",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // the theme script below sets data-theme/color-scheme before hydration
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <LanguageProvider>
            <DialogProvider>
              <AuthGuard>{children}</AuthGuard>
            </DialogProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}