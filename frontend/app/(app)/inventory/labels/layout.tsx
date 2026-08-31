import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Product Labels",
};

export default function LabelsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}