import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import RecentScans from "./components/RecentScans";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Site-wide default: keep search engines out of every page. Individual
// pages that are ready for indexing (right now: issue pages with a
// front_cover scan and postcard pages with a scan) opt back in inside
// their own generateMetadata. Anything not yet polished stays hidden.
export const metadata: Metadata = {
  title: "Collectibot",
  description: "Public knowledge graph for collectibles",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <RecentScans />
        {children}
      </body>
    </html>
  );
}
