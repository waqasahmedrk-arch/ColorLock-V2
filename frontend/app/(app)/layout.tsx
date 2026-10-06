import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

// Every page in this group needs a signed-in user. proxy.ts already bounces requests
// with no cookie; this also catches expired or revoked sessions.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getSessionUser())) redirect("/login");
  return children;
}
