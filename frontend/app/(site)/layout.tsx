import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import AuthGuard from "../components/shared/AuthGuard";
import { LanguageProvider } from "../context/LanguageContext";
import { DialogProvider } from "../components/shared/DialogProvider";
import { ThemeProvider, themeInitScript } from "../context/ThemeContext";
import PageReady from "../components/shared/PageReady";
import { pageRecoveryScript } from "@/lib/pageRecovery";

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
  description: "Business operations, simplified. WareSys software helps businesses manage inventory, sales, workshops, and deliveries — all in one ecosystem.",
  manifest: "/manifest.json",
  icons: { apple: "/apple-touch-icon.png" },
  // Home-screen launch on iOS opens full screen, titled WareSys.
  appleWebApp: { capable: true, title: "WareSys", statusBarStyle: "default" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // the theme script below sets data-theme/color-scheme before hydration
      suppressHydrationWarning
    >
      <head>
        {/* Chrome's page translation rewrites text behind React's back, which crashed
            the driver page on slow phones (removeChild). The app has its own ID/EN. */}
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: pageRecoveryScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <PageReady />
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