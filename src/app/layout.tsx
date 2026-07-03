import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CA Food Finder — Free food near you",
  description:
    "Find food pantries, free meal sites, and food donation drop-offs across California. Free, no sign-up, privacy-first.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#15803d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-white text-stone-900">{children}</body>
    </html>
  );
}
