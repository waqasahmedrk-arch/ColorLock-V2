import SecurityView from "./SecurityView";

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <SecurityView initialTab={tab === "failed" || tab === "audit" ? tab : "events"} />;
}
