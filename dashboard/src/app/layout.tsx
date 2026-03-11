import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import ClientProviders from "@/components/layout/ClientProviders";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Leaders of Growth 2026 — Dashboard",
  description:
    "Business intelligence dashboard for Italy's fastest growing companies — Il Sole 24 Ore ranking 2026.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased bg-slate-50 text-slate-900 min-h-screen">
        <ClientProviders>
          <Navbar />
          <main>{children}</main>
        </ClientProviders>
      </body>
    </html>
  );
}
