import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { StatsBar } from "./components/StatsBar";
import { KanbanBoard } from "./components/KanbanBoard";
import { ListView } from "./components/ListView";
import { TimelineView } from "./components/TimelineView";
import { TaskDialog } from "./components/TaskDialog";
import { EmptyState } from "./components/EmptyState";
import { useBoardData, type ViewMode } from "./hooks/useBoardData";
import { Loader2 } from "lucide-react";
import type { Task } from "./types";

function App() {
  const [view, setView] = useState<ViewMode>("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isLoading, error, moveTask, createTask } = useBoardData();

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setDialogOpen(true);
  };

  const selectedAssignee = selectedTask
    ? data.agents.find((a) => a.id === selectedTask.assigneeId)
    : undefined;
  const selectedCreator = selectedTask
    ? data.agents.find((a) => a.id === selectedTask.createdBy)
    : undefined;

  return (
    <div className="flex h-screen bg-[var(--color-surface)]">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          boardName={data.board.name}
          view={view}
          onViewChange={setView}
          onNewTask={() => {
            // Placeholder until backend mutation is wired
            setSelectedTask(null);
            setDialogOpen(true);
          }}
        />

        <StatsBar
          tasks={data.tasks}
          activities={data.activities}
          agents={data.agents}
        />

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2
              className="h-8 w-8 animate-spin text-[var(--color-accent)]"
              aria-hidden="true"
            />
            <span className="sr-only">Loading board</span>
          </div>
        ) : error ? (
          <EmptyState
            variant="error"
            title="Failed to load board"
            description={error.message}
            actionLabel="Try again"
            onAction={() => window.location.reload()}
          />
        ) : data.tasks.length === 0 ? (
          <EmptyState
            title="No tasks on this board"
            description="Create a task to start tracking work with your agents."
            actionLabel="Create task"
            onAction={() => setDialogOpen(true)}
          />
        ) : view === "board" ? (
          <KanbanBoard
            board={data.board}
            tasks={data.tasks}
            agents={data.agents}
            onTaskClick={handleTaskClick}
            onMoveTask={moveTask}
          />
        ) : view === "list" ? (
          <ListView
            tasks={data.tasks}
            agents={data.agents}
            onTaskClick={handleTaskClick}
          />
        ) : (
          <TimelineView
            tasks={data.tasks}
            agents={data.agents}
            onTaskClick={handleTaskClick}
          />
        )}
      </main>

      <TaskDialog
        task={selectedTask}
        assignee={selectedAssignee}
        creator={selectedCreator}
        agents={data.agents}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreateTask={(draft) => {
          createTask(draft);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}

export default App;
