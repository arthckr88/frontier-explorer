import { AppLink } from "@/components/app-link";

export function Shell({
  children,
  status,
  links,
}: {
  children: React.ReactNode;
  status: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="min-h-screen bg-[#090b0d] text-[#e7ece8]">
      <header className="sticky top-0 z-30 border-b border-[#24302a] bg-[#090b0d]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
          <AppLink href="/" className="shrink-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#3dbe7a]">Frontier</div>
            <div className="text-sm font-medium tracking-tight">Route Explorer</div>
          </AppLink>
          <nav aria-label="Primary" className="flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto text-sm text-[#8b9790] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {links.map((link) => (
              <AppLink key={link.href} href={link.href} className="shrink-0 snap-start whitespace-nowrap rounded px-2 py-1 hover:bg-[#181e24] hover:text-[#e7ece8]">
                {link.label}
              </AppLink>
            ))}
          </nav>
        </div>
        <div className="border-t border-[#24302a] px-3 py-1.5 font-mono text-[11px] text-[#8b9790] sm:px-4">{status}</div>
      </header>
      <main className="mx-auto max-w-[1440px] px-3 py-3 sm:px-4 sm:py-4">{children}</main>
    </div>
  );
}
