import type { Metadata } from "next";
import "../globals.css";
import { LanguageProvider } from "../context/LanguageContext";

export const metadata: Metadata = {
  title: "Print",
};

export default function PrintRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body style={{ margin: 0 }}>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
