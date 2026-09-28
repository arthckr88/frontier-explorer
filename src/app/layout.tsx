import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PathLinks } from "@/components/app-link";
import { Shell } from "@/components/shell";
import { staticChrome } from "@/static/adapter";
import { loadCatalog } from "@/static/load";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Frontier Route Explorer",
  description: "Search a Frontier route and date.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const chrome = staticChrome(loadCatalog());
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#090b0d]">
        <PathLinks>
          <Shell status={chrome.status} links={chrome.links}>
            {children}
          </Shell>
        </PathLinks>
      </body>
    </html>
  );
}
