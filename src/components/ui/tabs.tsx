"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
};
const TabsCtx = React.createContext<TabsContextValue | null>(null);

function useTabs(component: string) {
  const ctx = React.useContext(TabsCtx);
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`);
  return ctx;
}

type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
};

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = React.useState<string>(defaultValue ?? "");
  const baseId = React.useId();
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;
  const setValue = React.useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v);
      onValueChange?.(v);
    },
    [isControlled, onValueChange]
  );

  return (
    <TabsCtx.Provider value={{ value: current, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center justify-start gap-1 rounded-md bg-muted/50 p-1",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  icon,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  const { value: current, setValue, baseId } = useTabs("TabsTrigger");
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-trigger-${value}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
  forceMount,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  forceMount?: boolean;
}) {
  const { value: current, baseId } = useTabs("TabsContent");
  const active = current === value;
  if (!active && !forceMount) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-trigger-${value}`}
      hidden={!active}
      className={className}
    >
      {children}
    </div>
  );
}
