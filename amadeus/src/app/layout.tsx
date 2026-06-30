import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amadeus",
  description: "Amadeus — 数字伴侣",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
