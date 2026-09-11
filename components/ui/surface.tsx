import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The app's one container. Everything that groups content into a block uses
 * this -- there is no second way to draw a panel.
 *
 * It replaces `rounded-md border bg-card p-4`, which was typed out by hand in
 * 26 files and had drifted into three different paddings. When the shape of a
 * section changes it changes here, once.
 *
 * How separation works, since it is not the obvious way: sections carry **no
 * border**. A card is distinguishable because its surface is a different
 * colour from the page -- white on faint grey in the light theme, and a step
 * *lighter* than the page in dark, since a raised surface catches more light.
 * The `--card` and `--background` tokens do that work, so nothing here needs
 * to know which theme it is in.
 *
 * Depth is reserved for movement. A section at rest is flat; `interactive`
 * makes it lift on hover, and only things that genuinely float -- menus,
 * dialogs, popovers -- get a shadow permanently.
 */

type Pad = "card" | "tight" | "none";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  /**
   * Padding. `card` (24px) is the default and correct for a top-level block;
   * `tight` (12px) is for a panel nested inside another one, where the outer
   * padding is already doing the work; `none` is for a Surface whose only
   * child is a Table, which brings its own cell padding.
   */
  pad?: Pad;
  /**
   * Set when the whole block is a link or a button -- a row in a card list, a
   * draggable item. Adds the hover lift, which is the app's only resting-state
   * use of shadow.
   */
  interactive?: boolean;
  /**
   * A box inside a card. White on white has no edge, and sections carry no
   * border, so a nested box steps down the surface ladder instead -- the same
   * rule as a card on the page, one level in. In dark mode the ladder runs
   * upwards and this reads as a step lighter, which is the same thing.
   */
  inset?: boolean;
  /** The element, when a div is the wrong one: a section, a list item. */
  as?: "div" | "section" | "article" | "aside" | "ul" | "ol" | "li";
  /**
   * Renders a heading and, optionally, controls on the same line. Saves every
   * caller reinventing the same flex row.
   */
  title?: React.ReactNode;
  actions?: React.ReactNode;
};

const PAD = {
  card: "p-card",
  tight: "p-card-tight",
  none: "",
} as const;

/**
 * The recipe as a class string, for the few things that must look like a
 * surface but cannot be a div -- a <Link> or a <label> that is a card. Same
 * source as <Surface>, so the two cannot drift.
 */
export function surface({
  pad = "card",
  interactive = false,
  inset = false,
}: { pad?: Pad; interactive?: boolean; inset?: boolean } = {}) {
  return cn(
    "rounded-md text-card-foreground",
    inset ? "bg-muted/60" : "bg-card",
    PAD[pad],
    interactive &&
      // The lift, in both themes at once: the shadow token already differs
      // per theme, and card-hover carries the surface change a shadow cannot
      // express (lighter on dark, unchanged on light).
      "cursor-pointer transition-[background-color,box-shadow] duration-base ease-out hover:bg-card-hover hover:shadow-overlay",
  );
}

export const Surface = React.forwardRef<HTMLElement, SurfaceProps>(
  ({ className, pad = "card", interactive, inset, as: Tag = "div", title, actions, children, ...props }, ref) => (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn(surface({ pad, interactive, inset }), className)}
      {...props}
    >
      {(title || actions) && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2",
            children ? "mb-3" : "",
          )}
        >
          {title ? <h2 className="text-section-title">{title}</h2> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </Tag>
  ),
);
Surface.displayName = "Surface";
