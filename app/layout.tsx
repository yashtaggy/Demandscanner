import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DemandScanner — Clarity in every market decision.",
  description:
    "NSE supply and demand zone scanner for informed market decisions.",
  robots: { index: false, follow: false }, // Private tool — do not index
};

export const viewport: Viewport = {
  themeColor: "#F5F0E5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${plexMono.variable} antialiased bg-slate-950 text-slate-100`}
      >
        {/* Suspense boundary required for useSearchParams() in client components */}
        <Suspense>{children}</Suspense>
      </body>
    </html>
  );
}
