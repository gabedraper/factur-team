"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, Trash2, Eye, EyeOff } from "lucide-react";
import type { Agent } from "@/lib/gaib/agents";
import {
  createAgent, updateAgent, setAgentTools, setAgentRoles,
  makeDefaultAgent, deleteAgent,
} from "@/actions/gaib-admin";

type ToolInfo = { name: string; label: string; blurb: string; reads: string | null };
type Role = { id: string; name: string };

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export function AgentsHub({
  agents, roles, tools,
}: {
  agents: Agent[];
  roles: Role[];
  tools: ToolInfo[];
}) {
  const [selected, setSelected] = useState<string | null>(agents[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const agent = agents.find((a) => a.id === selected) ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work");
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <div className="space-y-2">
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => setSelected(a.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left ${
              a.id === selected ? "border-primary bg-accent" : "hover:bg-accent"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{a.name}</span>
              {a.isDefault && <Star className="h-3 w-3 shrink-0 fill-current text-amber-500" />}
              {!a.enabled && <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </div>
            {a.tagline && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.tagline}</p>
            )}
          </button>
        ))}

        <div className="flex gap-1.5 pt-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New agent"
            className="h-9"
          />
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
            disabled={pending || !newName.trim()}
            onClick={() =>
              run(async () => {
                const r = await createAgent(newName, "");
                if (r.ok) setNewName("");
                return r;
              })
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {agent ? (
        <Editor
          key={agent.id}
          agent={agent}
          roles={roles}
          tools={tools}
          pending={pending}
          run={run}
        />
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}

      {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
    </div>
  );
}

function Editor({
  agent, roles, tools, pending, run,
}: {
  agent: Agent;
  roles: Role[];
  tools: ToolInfo[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [tagline, setTagline] = useState(agent.tagline ?? "");
  const [instructions, setInstructions] = useState(agent.instructions);
  const [model, setModel] = useState(agent.model);
  const [effort, setEffort] = useState(agent.effort);
  const [held, setHeld] = useState<string[]>(agent.tools);
  const [audience, setAudience] = useState<string[]>(agent.roleIds);

  const dirty =
    name !== agent.name ||
    tagline !== (agent.tagline ?? "") ||
    instructions !== agent.instructions ||
    model !== agent.model ||
    effort !== agent.effort;

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => updateAgent(agent.id, { enabled: !agent.enabled }))}
        >
          {agent.enabled ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
          {agent.enabled ? "On" : "Off"}
        </Button>
        {!agent.isDefault && (
          <>
            <Button size="sm" variant="outline" disabled={pending}
              onClick={() => run(() => makeDefaultAgent(agent.id))}>
              <Star className="mr-1.5 h-3.5 w-3.5" />
              Make default
            </Button>
            <Button size="sm" variant="ghost" disabled={pending}
              onClick={() => run(() => deleteAgent(agent.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      <Field label="Tagline">
        <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </Field>

      <Field label="Instructions">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={16}
          className="font-mono text-xs"
        />
      </Field>

      <div className="flex flex-wrap gap-6">
        <Field label="Model">
          <div className="flex gap-1.5">
            {MODELS.map((m) => (
              <Button key={m.id} size="sm" variant={model === m.id ? "default" : "outline"}
                onClick={() => setModel(m.id)}>
                {m.label}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Effort">
          <div className="flex gap-1.5">
            {EFFORTS.map((e) => (
              <Button key={e} size="sm" variant={effort === e ? "default" : "outline"}
                onClick={() => setEffort(e)}>
                {e}
              </Button>
            ))}
          </div>
        </Field>
      </div>

      <Button
        disabled={pending || !dirty}
        onClick={() =>
          run(() => updateAgent(agent.id, { name, tagline, instructions, model, effort }))
        }
      >
        Save
      </Button>

      <Field label="Tools">
        <div className="space-y-1.5">
          {tools.map((t) => (
            <label
              key={t.name}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 hover:bg-accent"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={held.includes(t.name)}
                onChange={() => toggle(held, t.name, setHeld)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  {t.reads && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {t.reads}
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">{t.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => setAgentTools(agent.id, held))}
        >
          Save tools
        </Button>
      </Field>

      <Field label={audience.length ? "Roles" : "Roles — everyone"}>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={audience.includes(r.id) ? "default" : "outline"}
              onClick={() => toggle(audience, r.id, setAudience)}
            >
              {r.name}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => setAgentRoles(agent.id, audience))}
        >
          Save roles
        </Button>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
