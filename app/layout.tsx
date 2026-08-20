import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_SITE_NAME || "Factur Team",
  description: "Training, sales leaderboards and reporting for Factur staff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        {/* Applies the saved theme before first paint, so a dark-mode user
            never sees a white flash on the way in. Must not live in a manual
            <head> element -- App Router owns that, and adding one displaces
            the stylesheet it injects. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("factur-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
