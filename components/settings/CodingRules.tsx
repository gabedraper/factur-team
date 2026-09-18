"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Lock } from "lucide-react";
import { updateCodingSettings, type CodingSettings } from "@/actions/gaib-admin";
import { Table, TBody, TR, TD } from "@/components/ui/table";

export function CodingRules({
  settings, ceiling, builtIn,
}: {
  settings: CodingSettings;
  ceiling: { files: number; lines: number };
  builtIn: { pattern: string; why: string }[];
}) {
  const [builder, setBuilder] = useState<CodingSettings["builder"]>(settings.builder);
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
        builder,
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
          aria-checked={builder === "session"}
          onClick={() => setBuilder((b) => (b === "session" ? "agent" : "session"))}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            builder === "session" ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
              builder === "session" ? "translate-x-[1.375rem]" : "translate-x-0.5"
            }`}
          />
        </button>
        <div>
          <p className="text-body font-medium">Build tickets with Gabe</p>
          <p className="text-meta text-muted-foreground">
            {builder === "session"
              ? "New tickets wait for Gabe's session. Any ticket can still be handed to the agent."
              : "New tickets go straight to the automatic builder."}
          </p>
        </div>
      </div>

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
          <p className="text-body font-medium">Ship safe fixes without review</p>
          <p className="text-meta text-muted-foreground">
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
        <p className="text-meta font-medium text-muted-foreground">
          Extra protected paths — one per line
        </p>
        <Textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={5}
          placeholder={"components/talent/**\nlib/timelines/**"}
          className="font-mono text-meta"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>Save</Button>
        {saved && <span className="text-body text-muted-foreground">Saved</span>}
        {error && <span className="text-body text-destructive">{error}</span>}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
          <Lock className="h-3 w-3" />
          Always protected — {builtIn.length} paths, editable only in code
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <Table className="text-meta">
            <TBody>
              {builtIn.map((d) => (
                <TR key={d.pattern} >
                  <TD className="font-mono">{d.pattern}</TD>
                  <TD className="text-muted-foreground">{d.why}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
      <p className="text-meta font-medium text-muted-foreground">
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
