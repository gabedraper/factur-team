import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's own names. Left alone it reads the
 * app's type tokens as colours -- `text-meta` looks like `text-red-500` to it
 * -- so cn("text-meta", "text-muted-foreground") silently dropped the size,
 * and every hint, error line and caption built that way rendered at the
 * inherited size instead of 12px. It also could not tell that `p-card` and
 * `p-0` conflict, so an override on a Surface won or lost by stylesheet order.
 * These are the tokens from tailwind.config.ts; add a new one here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["page-title", "section-title", "body", "meta"] }],
      shadow: [{ shadow: ["raised", "overlay", "modal"] }],
    },
    theme: {
      spacing: ["section", "card", "card-tight", "cell-x", "cell-y"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
