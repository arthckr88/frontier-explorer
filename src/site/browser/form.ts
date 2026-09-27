const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function bookingDisplayDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Date must be YYYY-MM-DD. Received ${iso}.`);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) throw new Error(`Date must be YYYY-MM-DD. Received ${iso}.`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

export function parseBrowserArgs(argv: string[]): { queries: Array<{ origin: string; destination: string; date: string }>; force: boolean; queue: boolean } {
  const force = argv.includes("--force");
  const queue = argv.includes("--queue");
  if (queue) {
    const queries = valuesAfter(argv, "--search").map((value) => {
      const [origin, destination, date] = value.split(",");
      return checkedQuery(origin ?? "", destination ?? "", date ?? "");
    });
    if (queries.length === 0) throw new Error("Pass --search ORIGIN,DESTINATION,YYYY-MM-DD.");
    return { queries, force, queue };
  }
  const origin = valueAfter(argv, "--origin");
  const destination = valueAfter(argv, "--destination");
  const date = valueAfter(argv, "--date");
  if (!origin || !destination || !date) throw new Error("Pass --origin, --destination, and --date.");
  return { queries: [checkedQuery(origin, destination, date)], force, queue };
}

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) values.push(argv[index + 1] ?? "");
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function checkedQuery(origin: string, destination: string, date: string): { origin: string; destination: string; date: string } {
  const from = origin.toUpperCase();
  const to = destination.toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Origin and destination are IATA codes. Date is YYYY-MM-DD.");
  }
  return { origin: from, destination: to, date };
}
