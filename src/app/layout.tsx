import type { Metadata } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
