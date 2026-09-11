import { PageSkeleton } from "@/components/ui/skeleton";

// The opportunity list and its saved views.
// In the (list) group so it covers the list only. A loading file covers every
// page nested under it, and a record page should not flash a list's shape.
export default function Loading() {
  return <PageSkeleton rows={12} cols={6} />;
}
