"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, X } from "lucide-react";
import { clearPreviewRole, clearPreviewUser } from "@/actions/preview";

/**
 * Shown on every page while previewing. Without it the app looks like it is
 * simply behaving oddly for you -- which is exactly how the feature reads when
 * you forget it is on.
 */
export function PreviewBanner({ as, kind }: { as: string; kind: "person" | "role" }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        Viewing as {kind === "person" ? <b>{as}</b> : <>the <b>{as}</b> role</>}. What you change is
        still changed by you.
      </span>
      <button
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-200 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await clearPreviewRole();
            await clearPreviewUser();
            router.refresh();
          })
        }
      >
        <X className="h-3 w-3" /> Stop
      </button>
    </div>
  );
}
