import { Calendar, CheckCircle2, MessageSquare, Paperclip } from "lucide-react";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { cn, formatDate, priorityColor } from "../lib/utils";
import type { Agent, Task } from "../types";

interface TaskCardProps {
  task: Task;
  assignee?: Agent;
  onClick?: () => void;
  className?: string;
}

export function TaskCard({ task, assignee, onClick, className }: TaskCardProps) {
  const isDone = task.status === "done";
  const isOverdue =
    task.dueDate && !isDone && new Date(task.dueDate) < new Date();

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.();
      }}
      className={cn(
        "group relative p-4 bg-white rounded-[--radius-card] shadow-[var(--shadow-card)] border border-[var(--color-border-soft)] cursor-pointer transition-all hover:border-[var(--color-border-strong)] hover:shadow-md",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <Badge
          variant="secondary"
          className={cn("rounded-md px-1.5 py-0.5", priorityColor(task.priority))}
        >
          {task.priority}
        </Badge>
        {assignee && (
          <Avatar
            name={assignee.displayName}
            color={assignee.color}
            size="sm"
          />
        )}
      </div>

      <h3 className="text-sm font-semibold text-[var(--color-ink)] leading-snug mb-1">
        {task.title}
      </h3>
      {task.description && (
        <p className="text-xs text-[var(--color-ink-muted)] line-clamp-2 mb-3">
          {task.description}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {task.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-surface)] text-[var(--color-ink-muted)] border border-[var(--color-border-soft)]"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between text-[var(--color-ink-muted)]">
        <div className="flex items-center gap-3 text-xs">
          {task.subtasksTotal > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                task.subtasksCompleted === task.subtasksTotal &&
                  "text-emerald-600"
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {task.subtasksCompleted}/{task.subtasksTotal}
            </span>
          )}
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                isOverdue && "text-red-600 font-medium"
              )}
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDate(task.dueDate)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            0
          </span>
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
            0
          </span>
        </div>
      </div>
    </article>
  );
}
