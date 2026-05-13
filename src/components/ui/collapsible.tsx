"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  /** Optional id used as scroll target (anchor links from sticky nav). */
  id?: string;
  /** Optional right-aligned slot in the header (e.g. citation count). */
  trailing?: React.ReactNode;
};

export function Collapsible({
  title,
  defaultOpen = true,
  open,
  onOpenChange,
  children,
  className,
  id,
  trailing,
}: Props) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const current = isControlled ? open : internal;
  const toggle = () => {
    const next = !current;
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  };

  return (
    <section id={id} className={cn("scroll-mt-20 border-b last:border-0", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={current}
        className="w-full flex items-center justify-between gap-2 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold">
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", current ? "rotate-0" : "-rotate-90")}
          />
          {title}
        </span>
        {trailing}
      </button>
      {current && <div className="pb-4 pl-6 text-sm leading-relaxed">{children}</div>}
    </section>
  );
}
