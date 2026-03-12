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
      <body className="font-sans antialiased text-slate-900">
        <ClientProviders>
          <div className="flex h-screen overflow-hidden">
            <Navbar />
            <main className="flex-1 overflow-auto bg-slate-50">{children}</main>
          </div>
        </ClientProviders>
      </body>
    </html>
  );
}
