import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { viVN } from "@clerk/localizations";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Idest AI",
  description:
    "Trợ lý AI hỗ trợ chấm bài IELTS Writing cho Giáo viên.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${beVietnam.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <ClerkProvider localization={viVN}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
