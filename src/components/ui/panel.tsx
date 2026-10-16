"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

type PanelAccent = "assistants" | "skills" | "plugins" | "knowledge";

export function PanelRoot({
  accent,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { accent: PanelAccent }) {
  return (
    <div
      {...props}
      data-panel-accent={accent}
      className={cn(
        "relative flex h-full w-full min-w-0 flex-col overflow-hidden",
        className,
      )}
    />
  );
}

export function PanelIconButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      variant="bare"
      className={cn(
        "shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/50 focus-visible:ring-panel-accent/60",
        className,
      )}
    />
  );
}

export function PanelHeader({
  icon,
  title,
  subtitle,
  actions,
  onClose,
  closeLabel,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel: string;
}) {
  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-panel-accent to-panel-accent-2 text-white shadow-lg shadow-panel-accent/20"
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-bold text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onClose ? (
          <PanelIconButton aria-label={closeLabel} onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </PanelIconButton>
        ) : null}
      </div>
    </header>
  );
}

export function PanelSearch({
  id,
  name,
  label,
  placeholder,
  type = "text",
  value,
  onChange,
  children,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  type?: "text" | "search";
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl shrink-0 flex-wrap gap-3 px-4 py-6 sm:px-6">
      <div className="group relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-panel-accent/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
        <div className="relative flex items-center rounded-2xl border border-border bg-card/60 px-4 py-3 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-panel-accent/50 focus-within:ring-2 focus-within:ring-panel-accent/30 dark:bg-muted/60">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <Search
            size={20}
            className="mr-3 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={id}
            type={type}
            name={name}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            className="min-w-0 flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            value={value}
            onChange={onChange}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

export function PanelSection({
  title,
  icon,
  actions,
  muted = false,
  children,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  muted?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <h2
          className={cn(
            "flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-wider",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {icon ? (
            <span
              className="shrink-0 text-panel-accent-text"
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 truncate">{title}</span>
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PanelCard({
  as: Component = "div",
  highlighted = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "article";
  highlighted?: boolean;
}) {
  return (
    <Component
      {...props}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/40 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-panel-accent/40 dark:bg-muted/40",
        highlighted && "border-panel-accent/40",
        className,
      )}
    />
  );
}

export function PanelCardActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "absolute right-4 top-4 z-10 flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
    />
  );
}

export function PanelCardAction({
  tone = "neutral",
  className,
  ...props
}: ButtonProps & { tone?: "neutral" | "danger" | "warning" }) {
  return (
    <Button
      {...props}
      variant="bare"
      className={cn(
        "rounded-lg border border-border bg-card/90 p-1.5 shadow-sm backdrop-blur-sm transition-colors dark:bg-popover/90",
        tone === "neutral" &&
          "text-muted-foreground hover:bg-panel-accent-soft hover:text-panel-accent-text focus-visible:ring-panel-accent/60",
        tone === "danger" &&
          "text-red-600 hover:bg-red-50 focus-visible:ring-red-500/60 dark:text-red-300 dark:hover:bg-red-900/30",
        tone === "warning" &&
          "text-amber-600 hover:bg-amber-50 focus-visible:ring-amber-500/60 dark:text-amber-300 dark:hover:bg-amber-900/30",
        className,
      )}
    />
  );
}

export function PanelBadge({
  tone = "accent",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "accent" | "neutral" | "info" | "warning";
}) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        tone === "accent" && "bg-panel-accent-soft text-panel-accent-text",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "info" &&
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        tone === "warning" &&
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        className,
      )}
    />
  );
}

export function PanelCreateButton({
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <Button
      {...props}
      variant="bare"
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-lg bg-panel-accent-soft px-3 py-1.5 text-xs font-medium text-panel-accent-text transition-colors hover:bg-panel-accent/20 focus-visible:ring-panel-accent/60",
        className,
      )}
    >
      <Plus size={14} aria-hidden="true" />
      {children}
    </Button>
  );
}

export function PanelEmpty({
  children,
  action,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { action?: React.ReactNode }) {
  return (
    <div
      {...props}
      role="status"
      className={cn(
        "rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PanelLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-64 flex-col items-center justify-center gap-4 text-muted-foreground"
    >
      <Loader2
        size={32}
        className="animate-spin text-panel-accent-text"
        aria-hidden="true"
      />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function PanelPagination({
  page,
  totalPages,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  label,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  label: React.ReactNode;
}) {
  const buttonClassName =
    "rounded-lg border border-border bg-card p-2 text-foreground/85 transition-colors hover:bg-accent focus-visible:ring-panel-accent/60 dark:bg-muted";
  return (
    <div className="mt-auto flex items-center justify-center gap-4 py-6">
      <Button
        variant="bare"
        aria-label={prevLabel}
        onClick={onPrev}
        disabled={page <= 1}
        className={buttonClassName}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </Button>
      <span className="text-sm font-medium tabular-nums text-foreground/85">
        {label}
      </span>
      <Button
        variant="bare"
        aria-label={nextLabel}
        onClick={onNext}
        disabled={page >= totalPages}
        className={buttonClassName}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </div>
  );
}
