import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Shown in place of a section someone cannot open.
 *
 * Not a redirect: bouncing a person to a different page tells them nothing
 * about what happened, and the page they land on may say something false --
 * /unauthorized exists for "wrong Google account", which is a different problem
 * with different advice.
 */
export function NoAccess({ section, need }: { section: string; need: string }) {
  return (
    <div className="p-8">
      <div className="flex items-center gap-2">
        <Lock className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{section}</h1>
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Your role doesn&apos;t include &ldquo;{need}&rdquo;. An administrator can
        grant it under Settings → Roles.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline">
        Back to the app
      </Link>
    </div>
  );
}
