import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "ChatGPT Bridge — Open-source Codex plugin",
    template: "%s · ChatGPT Bridge",
  },
  description:
    "Route work from Codex into your own signed-in ChatGPT web session. Generate, verify, and export original image assets without an API key.",
  openGraph: {
    title: "ChatGPT Bridge",
    description:
      "An open-source Codex plugin for reliable ChatGPT web-session routing and original image asset export.",
    type: "website",
    images: ["/assets/bridge-output.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChatGPT Bridge",
    description:
      "Bridge Codex to your own ChatGPT web session, then export original image assets with evidence.",
    images: ["/assets/bridge-output.png"],
  },
  icons: {
    icon: "/assets/bridge-output.png",
    shortcut: "/assets/bridge-output.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
