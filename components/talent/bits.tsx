import Link from "next/link";
import { Plug, Star } from "lucide-react";
import { tone } from "@/lib/talent/types";
import { initials } from "@/lib/talent/format";
import { cn } from "@/lib/utils";

/**
 * The small pieces every talent screen is built from.
 *
 * They live together because each is a handful of lines and splitting them into
 * ten files would make the imports longer than the components.
 */

export function Chip({
  children, colour, className,
}: {
  children: React.ReactNode;
  colour?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone(colour).chip,
        className
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ colour }: { colour?: string | null }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", tone(colour).dot)} />;
}

/** Initials in a circle. An avatar image would need a source we do not have. */
export function Avatar({ name, size = 8 }: { name: string | null; size?: 6 | 8 | 10 | 12 }) {
  const px = { 6: "h-6 w-6 text-[10px]", 8: "h-8 w-8 text-xs", 10: "h-10 w-10 text-sm", 12: "h-12 w-12 text-base" }[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
        px
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Stars({
  value, onPick, size = 4,
}: {
  value: number | null;
  onPick?: (n: number | null) => void;
  size?: 3 | 4;
}) {
  const px = size === 3 ? "h-3 w-3" : "h-4 w-4";
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          role={onPick ? "button" : undefined}
          aria-label={onPick ? `${n} star${n > 1 ? "s" : ""}` : undefined}
          onClick={onPick ? () => onPick(value === n ? null : n) : undefined}
          className={cn(
            px,
            onPick && "cursor-pointer",
            (value ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
          )}
        />
      ))}
    </span>
  );
}

export function PageHeader({
  title, count, children,
}: {
  title: string;
  count?: number | string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {count !== undefined && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Panel({
  title, action, children, className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
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

/** A label above a value, used all over the detail panes. */
export function Stat({
  label, value, tint,
}: {
  label: string;
  value: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm tabular-nums", tint)}>{value}</div>
    </div>
  );
}

/**
 * What a feature shows instead of pretending to work.
 *
 * Every screen that depends on an outside service renders this when the
 * integration register says it is not connected, so "nothing happened" is never
 * the answer somebody has to work out for themselves.
 */
export function NotConnected({
  name, requires, canAdmin,
}: {
  name: string;
  requires: string | null;
  canAdmin: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{name}</span>
        <Chip colour="amber">Not connected</Chip>
      </div>
      {requires && <p className="mt-2 text-sm text-muted-foreground">{requires}</p>}
      {canAdmin && (
        <Link
          href="/settings/talent?tab=integrations"
          className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Integrations
        </Link>
      )}
    </div>
  );
}

/** A row of links that behaves as tabs, driven by the URL rather than state. */
export function Tabs({
  tabs, active, base,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  base: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === tabs[0].key ? base : `${base}?tab=${t.key}`}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
            active === t.key
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
