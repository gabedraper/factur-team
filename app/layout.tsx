import type { Metadata } from "next";
import { Inter, Montserrat } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });

/*
 * Montserrat is Factur's typeface for internal material -- the brand guide
 * names Sweet Sans Pro first but says to use Montserrat wherever that licence
 * does not reach, which is here.
 *
 * Headings only, though. Montserrat is a geometric face with wide, even
 * letterforms: handsome on a title, and costly across a table of forty rows,
 * where it takes more width per figure and reads less cleanly at 13px than
 * Inter does. So the brand voice sits on the headings and the data keeps the
 * face built for it.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Factur Team",
  description: "Training, sales leaderboards and reporting for Factur staff",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * The theme is decided here, on the server, from a cookie.
   *
   * It used to be applied by an inline script reading localStorage. React 19
   * handles <script> children itself and runs them after hydration, by which
   * point it has already rendered <html> without the class -- so a refresh
   * flipped a dark-mode user back to light. The server cannot read
   * localStorage, so the preference travels in a cookie instead and the correct
   * class is in the HTML before the browser paints anything.
   */
  const theme = (await cookies()).get("factur-theme")?.value;

  return (
    <html lang="en" className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <body className={`${inter.variable} ${montserrat.variable}`}>
        {/* Only for a first visit, where there is no cookie yet: follow the
            operating system's setting rather than assuming light. Once anyone
            chooses, the cookie decides and this does nothing. */}
        {!theme && (
          <script
            dangerouslySetInnerHTML={{
              __html: `try{if(window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.add("dark");document.cookie="factur-theme=dark;path=/;max-age=31536000;samesite=lax"}}catch(e){}`,
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
