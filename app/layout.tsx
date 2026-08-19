import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Nav from "@/components/Nav";
import SessionKeepalive from "@/components/SessionKeepalive";

// Elms Sans (brand primary) is on Google Fonts but postdates this Next
// version's next/font/google list, so it's self-hosted (OFL — see
// app/fonts/OFL.txt).
const elmsSans = localFont({
  src: [
    { path: "./fonts/elms-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/elms-sans-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/elms-sans-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/elms-sans-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-sans",
  display: "swap",
});

// Crimson Text (brand serif) is self-hosted too (PR #25): build-time Google
// Fonts fetches fail behind TLS-intercepting networks, and self-hosting
// removes the network dependency entirely (OFL — see
// app/fonts/OFL-crimson-text.txt).
const crimson = localFont({
  src: [
    { path: "./fonts/crimson-text-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/crimson-text-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/crimson-text-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/crimson-text-latin-600-italic.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Manadele",
  description: "Staff scheduling & tip distribution",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${elmsSans.variable} ${crimson.variable}`}>
      <body className="antialiased">
        <SessionKeepalive />
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 p-6 overflow-x-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
