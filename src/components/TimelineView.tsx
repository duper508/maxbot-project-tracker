import { TaskCard } from "./TaskCard";
import { cn } from "../lib/utils";
import type { Agent, Task } from "../types";

interface TimelineViewProps {
  tasks: Task[];
  agents: Agent[];
  onTaskClick: (task: Task) => void;
  className?: string;
}

export function TimelineView({
  tasks,
  agents,
  onTaskClick,
  className,
}: TimelineViewProps) {
  const getAssignee = (task: Task) =>
    agents.find((a) => a.id === task.assigneeId);

  const grouped = tasks.reduce<Record<string, Task[]>>((acc, task) => {
    const key = task.dueDate ?? "No due date";
    acc[key] = acc[key] ?? [];
    acc[key].push(task);
    return acc;
  }, {});

  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "No due date") return 1;
    if (b === "No due date") return -1;
    return new Date(a).getTime() - new Date(b).getTime();
  });

  return (
    <div className={cn("flex-1 overflow-y-auto px-6 pb-6", className)}>
      <div className="max-w-3xl mx-auto space-y-8">
        {sortedKeys.map((date) => (
          <section key={date}>
            <h3 className="sticky top-0 text-sm font-semibold text-[var(--color-ink)] mb-3 px-1">
              {date === "No due date" ? date : new Date(date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </h3>
            <div className="space-y-3">
              {grouped[date].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={getAssignee(task)}
                  onClick={() => onTaskClick(task)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
