import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Adele's",
  description: "Staff scheduling & tip distribution",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <script
          // Apply saved theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body className={`${dmSans.className} antialiased`}>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 p-8 overflow-x-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
