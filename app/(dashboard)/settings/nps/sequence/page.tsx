import { redirect } from "next/navigation";

// The survey ladder lives with every other sequence now.
export default function NpsSequencePage() {
  redirect("/settings/sequences/nps");
}
