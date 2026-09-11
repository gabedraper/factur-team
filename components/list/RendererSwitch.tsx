import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Table or board. Links, like the view chips, so the choice lives in the URL
 * (?as=board) and survives a reload or a pasted link.
 *
 * Only offered where the list has an ordered pipeline -- see `renderers` in
 * lib/list-views/catalogue.ts. A status column is not a pipeline.
 */
export function RendererSwitch({
  options,
}: {
  options: { label: string; href: string; current: boolean }[];
}) {
  return (
    <nav aria-label="Show as" className="inline-flex rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <Link
          key={o.label}
          href={o.href}
          aria-current={o.current ? "true" : undefined}
          className={cn(
            "rounded-sm px-3 py-1 text-meta transition-colors duration-fast ease-out",
            o.current ? "bg-card text-foreground shadow-raised" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
