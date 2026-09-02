import { useMemo } from "react";
import { TaskCard } from "./TaskCard";
import { cn } from "../lib/utils";
import type { Agent, Board, Task } from "../types";

interface KanbanBoardProps {
  board: Board;
  tasks: Task[];
  agents: Agent[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: string, newStatus: string) => void;
  className?: string;
}

export function KanbanBoard({
  board,
  tasks,
  agents,
  onTaskClick,
  onMoveTask,
  className,
}: KanbanBoardProps) {
  const tasksByColumn = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const column of board.columns) {
      map[column.id] = tasks.filter((t) => t.status === column.id);
    }
    return map;
  }, [board.columns, tasks]);

  const getAssignee = (task: Task) =>
    agents.find((a) => a.id === task.assigneeId);

  return (
    <div
      className={cn(
        "flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6",
        className
      )}
    >
      <div className="flex h-full gap-5 min-w-[1024px]">
        {board.columns.map((column) => {
          const columnTasks = tasksByColumn[column.id] ?? [];
          return (
            <section
              key={column.id}
              className="flex flex-col w-72 min-w-[18rem] h-full"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: column.color }}
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                    {column.title}
                  </h3>
                  <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 rounded-full bg-white border border-[var(--color-border-soft)] text-[10px] font-medium text-[var(--color-ink-muted)]">
                    {columnTasks.length}
                  </span>
                </div>
              </div>

              <div
                className="flex-1 overflow-y-auto rounded-[--radius-card] bg-[var(--color-surface)] border border-[var(--color-border-soft)] p-2.5 space-y-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const taskId = e.dataTransfer.getData("text/plain");
                  if (taskId) onMoveTask(taskId, column.id);
                }}
              >
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <TaskCard
                      task={task}
                      assignee={getAssignee(task)}
                      onClick={() => onTaskClick(task)}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
