import { redirect } from "next/navigation";

/** Moved out from behind the admin gate: everyone can see team progress. */
export default function AdminProgressRedirect() {
  redirect("/progress");
}
