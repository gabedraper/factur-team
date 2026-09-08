import Link from "next/link";

/*
 * The three pages the Google Workspace Marketplace requires of any listed app:
 * terms, a privacy notice, and somewhere to get help.
 *
 * They sit outside the (dashboard) group so they get the bare root layout, and
 * outside `protectedPrefixes` in middleware.ts so they resolve without an
 * account. That last part is the whole point -- a link in a store listing that
 * bounces to a login page is not a link to anything.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        Factur
      </Link>
      <div className="prose-sm mt-8 space-y-4 text-sm leading-relaxed">{children}</div>
      <div className="mt-12 flex gap-4 border-t pt-4 text-xs text-muted-foreground">
        <Link href="/legal/terms" className="hover:underline">Terms</Link>
        <Link href="/legal/privacy" className="hover:underline">Privacy</Link>
        <Link href="/legal/support" className="hover:underline">Support</Link>
      </div>
    </div>
  );
}
