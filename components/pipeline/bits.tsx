import Link from "next/link";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader as StandardPageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";

/**
 * The small pieces the pipeline screens are built from.
 *
 * Deliberately not imported from components/talent/bits -- talent and
 * pipeline are separate domains, and coupling them would make talent's next
 * redesign a pipeline concern too. That still holds for what is genuinely
 * pipeline's own: the stage colours, the A-Z filter, the Dialpad notice.
 *
 * Page headers and panels are not domain logic, though, so those now come
 * from the shared design system -- both kits depend on components/ui, and
 * neither depends on the other.
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

/*
 * The shared page header, under the name this kit's pages already import.
 *
 * This used to be its own copy -- identical to the one in the pipeline kit,
 * both drifting separately from the app's. It now delegates, so the pages
 * that use it get the standard title without any of them changing. Children
 * are still the actions, because that is the contract those pages were written
 * against.
 */
export function PageHeader({
  title, count, children,
}: {
  title: string;
  count?: number | string;
  children?: React.ReactNode;
}) {
  return <StandardPageHeader title={title} count={count} actions={children} />;
}

/*
 * A Surface with a header bar, under the name this kit's pages already use.
 *
 * Built on <Surface> so it follows the app's rule for sections: no outer
 * border, the surface colour does the separating. The header keeps its own
 * divider -- that line separates the header from its contents inside one
 * block, which is different from outlining the block.
 *
 * Contents stay flush to the edges (pad="none"), because what goes in a panel
 * is usually a table or a list that brings its own cell padding.
 */
export function Panel({
  title, action, children, className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Surface pad="none" className={cn("overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-center gap-2 border-b px-card py-2.5">
          <h2 className="text-section-title">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{action}</div>
        </header>
      )}
      {children}
    </Surface>
  );
}

/** A one-line "nothing here" inside a panel. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-card py-6 text-body text-muted-foreground">{children}</p>;
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

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * A-Z jump filter, shared across every list (People, Companies, My
 * Opportunities and its per-client list). Two ways to drive it depending on
 * whether the list is a client component with data already in hand
 * (`onSelect`) or a server-rendered page that re-fetches per query param
 * (`hrefFor`) — same as the Stage/Lead-status buttons already do.
 */
export function AlphaFilter({
  active, onSelect, hrefFor,
}: {
  active: string | null;
  onSelect?: (letter: string | null) => void;
  hrefFor?: (letter: string | null) => string;
}) {
  const cls = (isActive: boolean) =>
    cn("rounded px-1.5 py-0.5 text-xs tabular-nums", isActive ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-muted");

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {hrefFor ? (
        <Link href={hrefFor(null)} className={cls(!active)}>All</Link>
      ) : (
        <button type="button" onClick={() => onSelect?.(null)} className={cls(!active)}>All</button>
      )}
      {LETTERS.map((l) =>
        hrefFor ? (
          <Link key={l} href={hrefFor(l)} className={cls(active === l)}>{l}</Link>
        ) : (
          <button key={l} type="button" onClick={() => onSelect?.(l)} className={cls(active === l)}>{l}</button>
        )
      )}
    </div>
  );
}
