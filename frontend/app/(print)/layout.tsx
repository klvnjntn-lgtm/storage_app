import type { Metadata } from "next";
import "../globals.css";

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
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
