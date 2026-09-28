"use client";

import { createContext, useContext } from "react";

export const LinkModeContext = createContext<"path" | "hash">("path");

export function PathLinks({ children }: { children: React.ReactNode }) {
  return <LinkModeContext.Provider value="path">{children}</LinkModeContext.Provider>;
}

export function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const mode = useContext(LinkModeContext);
  const target = mode === "hash" ? `#${href}` : href;
  return (
    <a href={target} className={className}>
      {children}
    </a>
  );
}
