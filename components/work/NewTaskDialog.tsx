"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { createListTask } from "@/actions/work-tree";

/**
 * Adding a task to this list without leaving the page.
 *
 * A name is all ClickUp needs, and all its own inline add asks for; the other
 * two are here because a task added from a screen that cannot yet edit fields
 * would otherwise arrive with no description and no date and have to be
 * finished in ClickUp anyway.
 *
 * It lands assigned to whoever added it, and the list refreshes rather than
 * navigating -- you carry on reading the list you were reading.
 */
export function NewTaskDialog({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* Kept apart from the field error: "ClickUp 401" is not something the person
   * typed wrong, and putting it under the name would read as if it were. */
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function reset() {
    setTitle(""); setDescription(""); setDue(""); setError(null); setFailed(null);
  }

  function submit() {
    if (!title.trim()) {
      setError("Give the task a name.");
      return;
    }
    setError(null);
    setFailed(null);
    startSave(async () => {
      const result = await createListTask({
        listClickupId: listId,
        title,
        description,
        due: due || undefined,
      });
      if (!result.ok) {
        setFailed(`Not created: ${result.error}`);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New task</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New task in {listName}</DialogTitle></DialogHeader>

        <div className="grid gap-2">
          {failed && <p className="text-body text-destructive">{failed}</p>}
          <Field
            label="Name"
            hint="What the task is, as you would say it out loud."
            error={error}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={error ? true : undefined}
              placeholder="Send the revised quote"
              autoFocus
            />
          </Field>
          <Field label="Description" hint="Optional.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>
          <Field label="Due" hint="Optional.">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
