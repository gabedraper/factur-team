export function FilterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 border-t border-neutral-900 pt-4 text-xs leading-relaxed text-neutral-600">
      {children}
    </div>
  );
}
