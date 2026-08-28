"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Lock } from "lucide-react";
import { updateCodingSettings, type CodingSettings } from "@/actions/gaib-admin";

export function CodingRules({
  settings, ceiling, builtIn,
}: {
  settings: CodingSettings;
  ceiling: { files: number; lines: number };
  builtIn: { pattern: string; why: string }[];
}) {
  const [autoShip, setAutoShip] = useState(settings.auto_ship);
  const [maxFiles, setMaxFiles] = useState(String(settings.max_files));
  const [maxLines, setMaxLines] = useState(String(settings.max_lines));
  const [extra, setExtra] = useState(settings.extra_protected_paths.join("\n"));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save() {
    setError("");
    setSaved(false);
    start(async () => {
      const r = await updateCodingSettings({
        auto_ship: autoShip,
        max_files: Number(maxFiles) || 0,
        max_lines: Number(maxLines) || 0,
        extra_protected_paths: extra,
      });
      if (r.ok) setSaved(true);
      else setError(r.error ?? "That didn't work");
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 rounded-lg border p-4">
        <button
          role="switch"
          aria-checked={autoShip}
          onClick={() => setAutoShip((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            autoShip ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
              autoShip ? "translate-x-[1.375rem]" : "translate-x-0.5"
            }`}
          />
        </button>
        <div>
          <p className="text-sm font-medium">Ship safe fixes without review</p>
          <p className="text-xs text-muted-foreground">
            {autoShip
              ? "Safe bug fixes commit straight to main."
              : "Every fix opens a pull request."}
          </p>
        </div>
      </div>

      <div className="flex gap-6">
        <Limit label="Files" max={ceiling.files} value={maxFiles} onChange={setMaxFiles} />
        <Limit label="Lines" max={ceiling.lines} value={maxLines} onChange={setMaxLines} />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Extra protected paths — one per line
        </p>
        <Textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={5}
          placeholder={"components/talent/**\nlib/timelines/**"}
          className="font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>Save</Button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Lock className="h-3 w-3" />
          Always protected — {builtIn.length} paths, editable only in code
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <tbody>
              {builtIn.map((d) => (
                <tr key={d.pattern} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono">{d.pattern}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{d.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Limit({
  label, max, value, onChange,
}: {
  label: string;
  max: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {label} — max {max}
      </p>
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28"
      />
    </div>
  );
}
