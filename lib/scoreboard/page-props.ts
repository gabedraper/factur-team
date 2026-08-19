// Next 16 generates typed route helpers (PageProps<"/route">); Next 14 does
// not, so the ported scoreboard pages share this instead. searchParams is a
// plain object here rather than a promise -- awaiting it is harmless and keeps
// the pages identical to their Next 16 originals.
export type ScoreboardPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};
