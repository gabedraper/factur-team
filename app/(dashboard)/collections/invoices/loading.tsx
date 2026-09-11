import { PageSkeleton } from "@/components/ui/skeleton";

// Reads 180 days of QuickBooks invoices and balances before rendering.
export default function Loading() {
  return <PageSkeleton rows={12} cols={9} chips={false} stats={4} />;
}
