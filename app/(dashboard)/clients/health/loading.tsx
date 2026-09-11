import { PageSkeleton } from "@/components/ui/skeleton";

// Scores every client from several reads before the first row can render.
export default function Loading() {
  return <PageSkeleton rows={12} cols={8} identity chips={false} />;
}
