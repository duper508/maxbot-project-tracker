import { useEffect, useMemo, useState } from "react";
import type { Agent, Board, Task, Activity } from "../types";
import { agents, board, tasks, activities } from "../data/sample-data";

export type ViewMode = "board" | "list" | "timeline";

interface BoardData {
  board: Board;
  tasks: Task[];
  agents: Agent[];
  activities: Activity[];
}

export type TaskDraft = Omit<Task, "id" | "createdAt" | "updatedAt">;

interface UseBoardDataResult {
  data: BoardData;
  isLoading: boolean;
  error: Error | null;
  moveTask: (taskId: string, newStatus: string) => void;
  createTask: (draft: TaskDraft) => Task;
}

let idCounter = 300;
function nextTaskId(): string {
  idCounter += 1;
  return `APP-${idCounter}`;
}

export function useBoardData(): UseBoardDataResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [taskList, setTaskList] = useState<Task[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setTaskList(tasks);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to load board"));
        setIsLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, []);

  const data = useMemo<BoardData>(
    () => ({
      board,
      tasks: taskList,
      agents,
      activities,
    }),
    [taskList]
  );

  const moveTask = (taskId: string, newStatus: string) => {
    setTaskList((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: newStatus as Task["status"], updatedAt: Date.now() }
          : task
      )
    );
  };

  const createTask = (draft: TaskDraft) => {
    const now = Date.now();
    const task: Task = {
      ...draft,
      id: nextTaskId(),
      createdAt: now,
      updatedAt: now,
    };
    setTaskList((prev) => [task, ...prev]);
    return task;
  };

  return { data, isLoading, error, moveTask, createTask };
}
