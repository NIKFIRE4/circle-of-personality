import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
  title: "КОНТУР.КОСТРОВ — персональная система баланса",
  description: "Планируйте важное, замечайте прогресс и сохраняйте баланс.",
};

export const viewport: Viewport = {
  // viewport-fit=cover is what makes env(safe-area-inset-*) resolve to real
  // values, so the fixed bottom navigation can clear the iPhone home
  // indicator instead of sitting underneath it.
  viewportFit: "cover",
  // Matches --ink so the mobile browser chrome blends into the page.
  themeColor: "#10110e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
