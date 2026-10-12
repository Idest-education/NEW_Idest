import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { AccountProvider } from "../components/session";
import { Shell } from "../components/shell";
import { ToastProvider } from "../components/toast";
import { THEME_SCRIPT } from "../lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "vietnamese"], variable: "--font-jakarta", display: "swap" });

// Google Fonts serves only these glyphs (the list must stay sorted). Add a name here when you use a new icon.
const ICON_NAMES = [
  "add",
  "add_photo_alternate",
  "arrow_upward",
  "block",
  "check",
  "check_circle",
  "close",
  "cloud_off",
  "content_copy",
  "contrast",
  "dark_mode",
  "description",
  "download",
  "edit_square",
  "error",
  "flag",
  "help",
  "history",
  "hourglass_top",
  "image",
  "info",
  "label",
  "left_panel_close",
  "light_mode",
  "lock",
  "logout",
  "menu",
  "monitoring",
  "person",
  "photo_camera",
  "progress_activity",
  "refresh",
  "stacks",
  "table",
  "unfold_more",
  "upload_file",
];
const ICON_FONT = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=${ICON_NAMES.join(",")}&display=block`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "AIO — Free IELTS Writing grader", template: "%s · AIO" },
  description:
    "Band scores and feedback for IELTS Writing Task 1 and 2 in about a minute. Free, no account needed.",
  applicationName: "AIO",
  openGraph: {
    siteName: "AIO",
    title: "AIO — Grade IELTS Writing in a minute",
    description: "Free band scores and feedback for Task 1 and 2. Bulk grading for teachers.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffbf3" },
    { media: "(prefers-color-scheme: dark)", color: "#13141c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Icon fonts must block, or the ligature names flash as text. */}
        {/* eslint-disable-next-line @next/next/google-font-display */}
        <link rel="stylesheet" href={ICON_FONT} />
      </head>
      <body>
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "var(--accent)",
              colorPrimaryForeground: "var(--accent-contrast)",
              colorBackground: "var(--surface)",
              colorForeground: "var(--text)",
              colorMutedForeground: "var(--text-2)",
              colorInput: "var(--surface)",
              colorInputForeground: "var(--text)",
              colorBorder: "var(--line-strong)",
              colorDanger: "var(--danger)",
              fontFamily: "var(--font-sans)",
              borderRadius: "10px",
            },
          }}
        >
          <AccountProvider>
            <ToastProvider>
              <Shell>{children}</Shell>
            </ToastProvider>
          </AccountProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
