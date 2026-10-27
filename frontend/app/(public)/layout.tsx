import type { Metadata } from "next";
import "../globals.css";
import { LanguageProvider } from "../context/LanguageContext";

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
    <html lang="id" className="antialiased">
      <body style={{ margin: 0 }} className="bg-gray-50 text-black">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
