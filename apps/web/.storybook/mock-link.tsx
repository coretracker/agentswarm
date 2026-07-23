import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function Link({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  children?: ReactNode;
}) {
  const resolvedHref = typeof href === "string" ? href : href.pathname ?? "#";
  return (
    <a href={resolvedHref} {...props}>
      {children}
    </a>
  );
}
