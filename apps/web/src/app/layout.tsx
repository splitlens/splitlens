import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://splitlens.in"),
  title: {
    default: "SplitLens — Local-first personal finance for Indian banks",
    template: "%s · SplitLens",
  },
  description:
    "Drop your HDFC / ICICI / Axis bank PDFs. See your spending clearly. Split it cleanly with flatmates. Your data never leaves your device.",
  keywords: [
    "personal finance",
    "Indian banks",
    "HDFC statement parser",
    "Splitwise alternative",
    "local-first",
    "privacy-first finance app",
    "open source",
  ],
  authors: [{ name: "Prateek Aryan" }],
  creator: "Prateek Aryan",
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://splitlens.in",
    siteName: "SplitLens",
    title: "SplitLens — Your finances, on your device",
    description:
      "Local-first personal finance for Indian banks. Open source. AGPL-3.0.",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@splitlens",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
