import type { PropsWithChildren } from "react";

export function PaperShell({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`paper-shell ${className}`.trim()}>{children}</section>;
}
