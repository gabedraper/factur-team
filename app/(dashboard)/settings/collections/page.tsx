import { redirect } from "next/navigation";

// The collections ladder lives with every other sequence now.
export default function CollectionsSequencePage() {
  redirect("/settings/sequences/collections");
}
