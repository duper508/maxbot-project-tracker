import { Activity, CheckCircle2, Circle, Clock, ListTodo } from "lucide-react";
import { cn, formatRelativeTime } from "../lib/utils";
import type { Activity as ActivityItem, Agent, Task } from "../types";

interface StatsBarProps {
  tasks: Task[];
  activities: ActivityItem[];
  agents: Agent[];
  className?: string;
}

export function StatsBar({ tasks, activities, agents, className }: StatsBarProps) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in-progress").length;
  const overdue = tasks.filter(
    (t) =>
      t.dueDate && t.status !== "done" && new Date(t.dueDate) < new Date()
  ).length;

  const getAgentName = (id?: string) =>
    agents.find((a) => a.id === id)?.displayName ?? "Someone";

  const latestActivity = activities.slice(0, 3);

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 px-6 py-4 bg-white border-b border-[var(--color-border-soft)]",
        className
      )}
    >
      <div className="flex items-center gap-3 p-3 rounded-[--radius-card] bg-[var(--color-surface)] border border-[var(--color-border-soft)]">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]">
          <ListTodo className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">Total tasks</p>
          <p className="text-lg font-semibold text-[var(--color-ink)]">{total}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-[--radius-card] bg-[var(--color-surface)] border border-[var(--color-border-soft)]">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-blue-50 text-blue-700">
          <Clock className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">In progress</p>
          <p className="text-lg font-semibold text-[var(--color-ink)]">
            {inProgress}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-[--radius-card] bg-[var(--color-surface)] border border-[var(--color-border-soft)]">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">Completed</p>
          <p className="text-lg font-semibold text-[var(--color-ink)]">{done}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-[--radius-card] bg-[var(--color-surface)] border border-[var(--color-border-soft)]">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-red-50 text-red-700">
          <Circle className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">Overdue</p>
          <p className="text-lg font-semibold text-[var(--color-ink)]">
            {overdue}
          </p>
        </div>
      </div>

      <div className="lg:col-span-4 hidden md:flex items-center gap-4 text-sm text-[var(--color-ink-muted)]">
        <Activity className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium text-[var(--color-ink)]">Latest:</span>
        {latestActivity.length === 0 ? (
          <span>No recent activity</span>
        ) : (
          <ul className="flex flex-wrap gap-4">
            {latestActivity.map((act) => (
              <li key={act.id} className="truncate max-w-xs">
                {getAgentName(act.actorId)} {act.action} {act.toValue}
                <span className="ml-1 text-xs">
                  {formatRelativeTime(act.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
