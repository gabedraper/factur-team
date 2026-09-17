import { redirect } from "next/navigation";

/* Moved to the tool's card under Integrations. */
export default function Moved() {
  redirect("/integrations/quickbooks");
}
