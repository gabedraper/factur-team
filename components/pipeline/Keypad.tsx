"use client";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** A plain phone keypad -- presses append to whatever number field the caller wires up. */
export function Keypad({ onPress }: { onPress: (digit: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onPress(k)}
          className="rounded-md border py-1.5 text-sm font-medium tabular-nums hover:bg-muted"
        >
          {k}
        </button>
      ))}
    </div>
  );
}
