import { TaskCard } from "./TaskCard";
import { cn } from "../lib/utils";
import type { Agent, Task } from "../types";

interface ListViewProps {
  tasks: Task[];
  agents: Agent[];
  onTaskClick: (task: Task) => void;
  className?: string;
}

export function ListView({ tasks, agents, onTaskClick, className }: ListViewProps) {
  const getAssignee = (task: Task) =>
    agents.find((a) => a.id === task.assigneeId);

  return (
    <div className={cn("flex-1 overflow-y-auto px-6 pb-6", className)}>
      <div className="max-w-4xl mx-auto space-y-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            assignee={getAssignee(task)}
            onClick={() => onTaskClick(task)}
          />
        ))}
      </div>
    </div>
  );
}
