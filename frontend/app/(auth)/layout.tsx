import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import "./auth.css";

// Already signed in: skip the auth pages and go straight to the results.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/");
  return children;
}
