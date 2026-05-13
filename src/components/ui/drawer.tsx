"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Lightweight, dependency-free overlay drawer (mobile sidebar). */
export function Drawer({
  open,
  onOpenChange,
  side = "left",
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute top-0 bottom-0 w-[85vw] max-w-[360px] bg-background border shadow-lg flex flex-col",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
