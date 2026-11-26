import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are self-hosted (Latin variable woff2 files from Google Fonts, SIL OFL) so builds never
// depend on reaching fonts.googleapis.com; that download kept failing inside the Docker build.
// None of these fonts has a ₦ glyph, so ₦ uses the system fallback, same as before.

const body = localFont({
  src: "./fonts/outfit-latin.woff2",
  weight: "100 900",
  variable: "--font-body",
  display: "swap",
});

const display = localFont({
  src: "./fonts/sora-latin.woff2",
  weight: "600 700",
  variable: "--font-display",
  display: "swap",
});

/** Handwritten accent lines on the home page ("Your financial freedom, our priority"). */
const script = localFont({
  src: "./fonts/caveat-latin.woff2",
  weight: "600 700",
  variable: "--font-script",
  display: "swap",
  // Only the home page uses it, so don't preload it on every page.
  preload: false,
});

export const metadata: Metadata = {
  title: "Nexora  -  Crypto & Gift Cards to Naira",
  description:
    "Sell crypto and gift cards for Naira in Nigeria. Fast rates, verified payouts, secure by design.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable} ${script.variable} h-full antialiased`}
      // globals.css scrolls smoothly; this lets Next.js turn it off during page changes.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
