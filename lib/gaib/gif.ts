/*
 * A GIF, for when words undersell it.
 *
 * Giphy, restricted to rating G. That filter is the whole reason this is safe
 * to point at a search box: Gaib picks the search terms, and an unfiltered
 * search for "disaster" or "nailed it" returns things nobody wants posted to
 * their team by the CEO's clone. G is Giphy's strictest rating.
 *
 * Off until GIPHY_API_KEY is set. The tool is not offered to the model without
 * it, so nothing half-works: no key, no GIFs, no attempts.
 */

export function gifsEnabled(): boolean {
  return Boolean(process.env.GIPHY_API_KEY);
}

export async function findGif(search: string): Promise<{ url: string; title: string } | null> {
  const key = process.env.GIPHY_API_KEY;
  if (!key || !search.trim()) return null;

  try {
    const url =
      "https://api.giphy.com/v1/gifs/search" +
      `?api_key=${encodeURIComponent(key)}` +
      `&q=${encodeURIComponent(search.trim().slice(0, 50))}` +
      "&limit=8&rating=g&lang=en&bundle=messaging_non_clips";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      data?: { title?: string; images?: { downsized?: { url?: string }; original?: { url?: string } } }[];
    };
    const hits = (body.data ?? []).filter((d) => d.images?.downsized?.url || d.images?.original?.url);
    if (!hits.length) return null;

    // One of the top few rather than always the first, so the same moment
    // does not get the same GIF every time.
    const pick = hits[Math.floor(Math.random() * Math.min(hits.length, 5))];
    return {
      // downsized: small enough to load instantly in a chat, still animated.
      url: pick.images!.downsized?.url ?? pick.images!.original!.url!,
      title: pick.title ?? search,
    };
  } catch {
    return null;
  }
}
