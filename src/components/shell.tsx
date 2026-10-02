"use client";

import { useEffect, useState } from "react";
import { AppLink } from "@/components/app-link";
import { LAST_SEARCH_KEY } from "@/static/search";

export function Shell({ children, status, links }: { children: React.ReactNode; status: string; links: { href: string; label: string }[] }) {
  const [lastSearch, setLastSearch] = useState("/");
  const primary = links.filter((link) => ["Search", "Discover", "Planner"].includes(link.label));
  const secondary = links.filter((link) => !["Search", "Discover", "Planner"].includes(link.label));
  useEffect(() => {
    function sync() { try { const url = window.sessionStorage.getItem(LAST_SEARCH_KEY); setLastSearch(url?.startsWith("/?") ? url : "/"); } catch { setLastSearch("/"); } }
    queueMicrotask(sync);
    function closeMenu() { document.querySelector("nav details")?.removeAttribute("open"); }
    window.addEventListener("frontier-search", sync);
    window.addEventListener("hashchange", closeMenu);
    window.addEventListener("popstate", closeMenu);
    return () => { window.removeEventListener("frontier-search", sync); window.removeEventListener("hashchange", closeMenu); window.removeEventListener("popstate", closeMenu); };
  }, []);
  return <div className="min-h-screen bg-[#090b0d] text-[#e7ece8]">
    <header className="sticky top-0 z-40 border-b border-[#24302a] bg-[#090b0d]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
        <AppLink href="/" className="min-w-0 text-sm font-medium tracking-tight"><span className="sm:hidden">Frontier Explorer</span><span className="hidden sm:inline">Frontier Route Explorer</span></AppLink>
        <nav aria-label="Primary" className="flex shrink-0 items-center gap-0.5 text-xs text-[#aab6ae] sm:text-sm">
          {primary.map((link) => <AppLink key={link.href} href={link.label === "Search" ? lastSearch : link.href} className="rounded px-2 py-2 hover:bg-[#181e24] hover:text-[#e7ece8]">{link.label}</AppLink>)}
          <details className="relative"><summary className="cursor-pointer rounded px-2 py-2">More</summary><div className="absolute right-0 top-full mt-1 min-w-36 rounded-md border border-[#304037] bg-[#12161b] p-1 shadow-xl">{secondary.map((link) => <AppLink key={link.href} href={link.href} className="block rounded px-3 py-2 hover:bg-[#24302a]">{link.label}</AppLink>)}</div></details>
        </nav>
      </div>
      <p className="hidden border-t border-[#24302a] px-4 py-1.5 text-[11px] text-[#8b9790] md:block">{status}</p>
    </header>
    <main className="mx-auto max-w-[1440px] px-3 py-3 sm:px-4">{children}</main>
  </div>;
}
