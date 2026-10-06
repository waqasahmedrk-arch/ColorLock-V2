import Inbox from "./Inbox";

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const { user } = await searchParams;
  return <Inbox initialUser={user ?? null} />;
}
