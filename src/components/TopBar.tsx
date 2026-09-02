import { Plus, Search, Filter } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { ViewMode } from "../hooks/useBoardData";

interface TopBarProps {
  boardName: string;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onNewTask: () => void;
  className?: string;
}

export function TopBar({
  boardName,
  view,
  onViewChange,
  onNewTask,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 bg-white border-b border-[var(--color-border-soft)] sticky top-0 z-10",
        className
      )}
    >
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {boardName}
        </h2>
        <Tabs
          value={view}
          onValueChange={(v) => onViewChange(v as ViewMode)}
        >
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-ink-muted)]"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search tasks..."
            className="h-9 w-full sm:w-56 pl-9 pr-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
        <Button variant="secondary" size="icon" aria-label="Filter tasks">
          <Filter className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button onClick={onNewTask}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">New task</span>
          <span className="sm:hidden">Task</span>
        </Button>
      </div>
    </header>
  );
}
