import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  ACTIVE: "text-[#3dbe7a] border-[#3dbe7a]/40",
  UPCOMING: "text-[#3ec6d4] border-[#3ec6d4]/40",
  ANNOUNCED: "text-[#7eb6ff] border-[#7eb6ff]/40",
  SEASONAL: "text-[#6aa6ff] border-[#6aa6ff]/40",
  ENDING_SOON: "text-[#e2a84a] border-[#e2a84a]/40",
  POSSIBLY_ENDING: "text-[#e07a3d] border-[#e07a3d]/40",
  STALE: "text-[#e07a3d] border-[#e07a3d]/40",
  PAUSED: "text-[#8b939c] border-[#8b939c]/40",
  ENDED: "text-[#8b939c] border-[#8b939c]/40",
  UNKNOWN: "text-[#8b939c] border-[#8b939c]/40",
  HIGH: "text-[#3dbe7a] border-[#3dbe7a]/40",
  MEDIUM: "text-[#e2a84a] border-[#e2a84a]/40",
  LOW: "text-[#e07a3d] border-[#e07a3d]/40",
  CONFLICTING: "text-[#e07a3d] border-[#e07a3d]/40",
};

export function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide", COLOR[value] ?? COLOR.UNKNOWN)}>
      {statusLabel(value)}
    </span>
  );
}
