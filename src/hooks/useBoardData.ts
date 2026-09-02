import { useCallback, useEffect, useState } from "react";
import type { Agent, Board, Task, Activity } from "../types";
import {
  listBoards,
  listTasks,
  listAgents,
  listActivities,
  createTask as apiCreateTask,
  moveTask as apiMoveTask,
  updateTask as apiUpdateTask,
  login as apiLogin,
  isApiError,
} from "../lib/api";

export type ViewMode = "board" | "list" | "timeline";

interface BoardData {
  board: Board;
  tasks: Task[];
  agents: Agent[];
  activities: Activity[];
}

export type TaskDraft = Omit<
  Task,
  "id" | "createdAt" | "updatedAt" | "createdBy" | "subtasksCompleted" | "subtasksTotal"
>;

interface LoadResult {
  data: BoardData;
  error: Error | null;
  isUnauthorized: boolean;
}

interface UseBoardDataResult {
  data: BoardData;
  isLoading: boolean;
  error: Error | null;
  isUnauthorized: boolean;
  moveTask: (taskId: string, newStatus: string) => Promise<void>;
  createTask: (draft: TaskDraft) => Promise<Task>;
  updateTask: (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>) => Promise<Task>;
  login: (token: string) => Promise<void>;
}

const emptyBoard: Board = {
  id: "",
  name: "",
  slug: "",
  columns: [],
};

const emptyData: BoardData = {
  board: emptyBoard,
  tasks: [],
  agents: [],
  activities: [],
};

async function fetchBoardData(): Promise<LoadResult> {
  try {
    const boards = await listBoards();
    const currentBoard = boards[0];
    if (!currentBoard) {
      return {
        data: emptyData,
        error: new Error("No boards found"),
        isUnauthorized: false,
      };
    }

    const [tasks, agents, activities] = await Promise.all([
      listTasks(currentBoard.id),
      listAgents(),
      listActivities(),
    ]);

    return {
      data: { board: currentBoard, tasks, agents, activities },
      error: null,
      isUnauthorized: false,
    };
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      return {
        data: emptyData,
        error: new Error("Please sign in to view this board."),
        isUnauthorized: true,
      };
    }
    return {
      data: emptyData,
      error: err instanceof Error ? err : new Error("Failed to load board"),
      isUnauthorized: false,
    };
  }
}

export function useBoardData(): UseBoardDataResult {
  const [isLoading, setIsLoading] = useState(true);
  // Initial loading state is true; the effect below will flip it to false.
  const [error, setError] = useState<Error | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [data, setData] = useState<BoardData>(emptyData);

  const applyResult = useCallback((result: LoadResult) => {
    setData(result.data);
    setError(result.error);
    setIsUnauthorized(result.isUnauthorized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBoardData().then((result) => {
      if (cancelled) return;
      applyResult(result);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const load = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchBoardData();
    applyResult(result);
    setIsLoading(false);
  }, [applyResult]);

  const moveTask = useCallback(async (taskId: string, newStatus: string) => {
    setData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: newStatus as Task["status"], updatedAt: Date.now() }
          : task
      ),
    }));

    try {
      const updated = await apiMoveTask(taskId, newStatus);
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((task) =>
          task.id === taskId ? updated : task
        ),
      }));
    } catch (err) {
      await load();
      throw err;
    }
  }, [load]);

  const createTask = useCallback(async (draft: TaskDraft) => {
    const task = await apiCreateTask(draft);
    setData((prev) => ({ ...prev, tasks: [task, ...prev.tasks] }));
    return task;
  }, []);

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>) => {
      const updated = await apiUpdateTask(taskId, updates);
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((task) =>
          task.id === taskId ? updated : task
        ),
      }));
      return updated;
    },
    []
  );

  const login = useCallback(async (token: string) => {
    await apiLogin(token);
    await load();
  }, [load]);

  return {
    data,
    isLoading,
    error,
    isUnauthorized,
    moveTask,
    createTask,
    updateTask,
    login,
  };
}
