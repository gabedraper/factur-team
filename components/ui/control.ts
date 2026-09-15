import { cn } from "@/lib/utils";

/**
 * What an editable control looks like, in one place.
 *
 * `<Input>`, `<Textarea>` and the Select trigger are all built from this, and
 * so is every native `<select>` and `<input>` the app draws directly -- which
 * is most of them, because a native select posts, works with a keyboard and
 * needs no popover library to be right.
 *
 * Before this there were 62 hand-typed recipes across 27 spellings, in eight
 * different heights, and half of them filled themselves with `bg-background`
 * -- the *page* colour. On a card in the light theme that reads as a grey box
 * where a white one belongs, and in dark mode it is near-black against a
 * lifted card. `bg-field` is the token that means "you can type here".
 *
 * Two sizes, because the app genuinely has two: a dense 32px control for
 * filter rows and builder panels, and a 40px one for forms you fill in.
 */

type Opts = {
  /** "sm" is 32px, for filter rows and dense panels. "md" (default) is 40px. */
  size?: "sm" | "md";
  /** A textarea: grows instead of taking a fixed height. */
  multiline?: boolean;
  /**
   * No border and the card's own fill -- the search box at the top of a list,
   * where a bordered box beside the view chips is one outline too many.
   */
  plain?: boolean;
  className?: string;
};

export function control({ size = "md", multiline, plain, className }: Opts = {}) {
  return cn(
    "rounded-md text-body ring-offset-background",
    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    // The error state comes free: pass aria-invalid and the border turns.
    "aria-[invalid=true]:border-destructive",
    plain ? "bg-card" : "border border-input bg-field",
    multiline ? "min-h-20 px-3 py-2" : size === "sm" ? "h-8 px-2" : "h-10 px-3 py-2",
    className,
  );
}
