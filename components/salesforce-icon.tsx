/**
 * Marks a link that leaves the app for Salesforce.
 *
 * A cloud in Salesforce's blue rather than a traced copy of their logo: it
 * reads as "this opens Salesforce" at 12px, which is the whole job, without
 * passing someone else's trademark off as artwork of ours.
 */
export function SalesforceIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 18"
      aria-hidden
      focusable="false"
      className={`inline-block h-[0.85em] w-auto shrink-0 align-[-0.1em] ${className}`}
      fill="#00A1E0"
    >
      <path d="M9.6 2.2a4.3 4.3 0 0 1 6.5 1 5.2 5.2 0 0 1 7.4 4.7 5.2 5.2 0 0 1-5.2 5.2H6.3A5.1 5.1 0 0 1 1.2 8a5.1 5.1 0 0 1 3.4-4.8 4.3 4.3 0 0 1 5-1Z" />
    </svg>
  );
}
