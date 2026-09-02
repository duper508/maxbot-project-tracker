import { Inbox, SearchX, AlertTriangle, Lock } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface EmptyStateProps {
  variant?: "empty" | "search" | "error" | "auth";
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const icons = {
  empty: Inbox,
  search: SearchX,
  error: AlertTriangle,
  auth: Lock,
};

const defaults = {
  empty: {
    title: "No tasks yet",
    description: "This board is empty. Create your first task to get started.",
  },
  search: {
    title: "No matches",
    description: "Try adjusting your search or filters.",
  },
  error: {
    title: "Something went wrong",
    description: "We couldn't load the board. Try refreshing the page.",
  },
  auth: {
    title: "Sign in required",
    description: "Use the sign-in dialog to access this board.",
  },
};

export function EmptyState({
  variant = "empty",
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const Icon = icons[variant];
  const fallback = defaults[variant];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6",
        className
      )}
    >
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] mb-4">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-[var(--color-ink)] mb-1">
        {title ?? fallback.title}
      </h3>
      <p className="text-sm text-[var(--color-ink-muted)] max-w-xs mb-4">
        {description ?? fallback.description}
      </p>
      {onAction && actionLabel && (
        <Button onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}
