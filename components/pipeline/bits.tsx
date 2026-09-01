import Link from "next/link";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small pieces the pipeline screens are built from.
 *
 * Deliberately not imported from components/talent/bits -- talent and
 * pipeline are separate domains that happen to want similar-looking chips
 * and panels today. Coupling them for a few shared lines would make talent's
 * next redesign a pipeline concern too.
 */

const TONE: Record<string, { chip: string; dot: string }> = {
  slate: { chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
  amber: { chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500" },
  emerald: { chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500" },
  rose: { chip: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300", dot: "bg-rose-500" },
  blue: { chip: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300", dot: "bg-blue-500" },
};

export function Chip({ children, colour = "slate", className }: { children: React.ReactNode; colour?: keyof typeof TONE; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[colour]?.chip ?? TONE.slate.chip, className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, count, children }: { title: string; count?: number | string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {count !== undefined && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Panel({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      {(title || action) && (
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{action}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

/**
 * What a feature shows instead of pretending to work. Same purpose as
 * talent's NotConnected -- render this whenever a page depends on a
 * client-side key (like the Dialpad CTI Client ID) that isn't set, so
 * "nothing happened" is never the answer someone has to work out for
 * themselves.
 */
export function NotConnected({ name, requires, canAdmin }: { name: string; requires: string | null; canAdmin: boolean }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{name}</span>
        <Chip colour="amber">Not connected</Chip>
      </div>
      {requires && <p className="mt-2 text-sm text-muted-foreground">{requires}</p>}
      {canAdmin && (
        <Link href="/settings/dialpad" className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Dialpad settings
        </Link>
      )}
    </div>
  );
}

export function stageTone(stage: string): keyof typeof TONE {
  if (stage.startsWith("closed")) return stage.includes("won") ? "emerald" : "rose";
  if (stage.startsWith("prospecting")) return "slate";
  return "blue";
}
