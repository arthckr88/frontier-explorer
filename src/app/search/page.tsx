import HomePage from "@/app/page";

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string; stops?: string }>;
}) {
  return <HomePage searchParams={searchParams} />;
}
