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

type SurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Padding. `card` (24px) is the default and correct for a top-level block;
   * `tight` (12px) is for a panel nested inside another one, where the outer
   * padding is already doing the work; `none` is for a Surface whose only
   * child is a Table, which brings its own cell padding.
   */
  pad?: "card" | "tight" | "none";
  /**
   * Set when the whole block is a link or a button -- a row in a card list, a
   * draggable item. Adds the hover lift, which is the app's only resting-state
   * use of shadow.
   */
  interactive?: boolean;
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

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, pad = "card", interactive, title, actions, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md bg-card text-card-foreground",
        PAD[pad],
        interactive &&
          // The lift, in both themes at once: the shadow token already
          // differs per theme, and card-hover carries the surface change a
          // shadow cannot express (lighter on dark, unchanged on light).
          "cursor-pointer transition-[background-color,box-shadow] duration-base ease-out hover:bg-card-hover hover:shadow-overlay",
        className,
      )}
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
    </div>
  ),
);
Surface.displayName = "Surface";
