import type { UserStatus } from "@/lib/admin";
import UsersView from "./UsersView";

const STATUSES: UserStatus[] = ["all", "active", "online", "blocked", "admins", "unverified"];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "all";
  return <UsersView initialStatus={status} initialQuery={sp.q ?? ""} />;
}
