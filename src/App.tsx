import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { StatsBar } from "./components/StatsBar";
import { KanbanBoard } from "./components/KanbanBoard";
import { ListView } from "./components/ListView";
import { TimelineView } from "./components/TimelineView";
import { TaskDialog } from "./components/TaskDialog";
import { EmptyState } from "./components/EmptyState";
import { LoginDialog } from "./components/LoginDialog";
import { IdentitiesPage } from "./components/IdentitiesPage";
import { useBoardData, type ViewMode } from "./hooks/useBoardData";
import { Loader2 } from "lucide-react";
import type { Task } from "./types";

type AppPage = "board" | "identities";

function App() {
  const [view, setView] = useState<ViewMode>("board");
  const [page, setPage] = useState<AppPage>("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    data,
    isLoading,
    error,
    isUnauthorized,
    moveTask,
    createTask,
    login,
    changePasswordWithTicket,
  } = useBoardData();

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
      <Sidebar activePage={page} onPageChange={setPage} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {page === "board" ? (
          <TopBar
            boardName={data.board.name || "Buzz Kanban"}
            view={view}
            onViewChange={setView}
            onNewTask={() => {
              setSelectedTask(null);
              setDialogOpen(true);
            }}
          />
        ) : (
          <header className="flex items-center justify-between gap-4 px-6 py-4 bg-white border-b border-[var(--color-border-soft)] sticky top-0 z-10">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              Identity management
            </h2>
          </header>
        )}

        {page === "board" && (
          <StatsBar
            tasks={data.tasks}
            activities={data.activities}
            agents={data.agents}
          />
        )}

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
            variant={isUnauthorized ? "auth" : "error"}
            title={isUnauthorized ? "Sign in required" : "Failed to load board"}
            description={error.message}
            actionLabel={isUnauthorized ? undefined : "Try again"}
            onAction={isUnauthorized ? undefined : () => window.location.reload()}
          />
        ) : page === "identities" ? (
          <IdentitiesPage principals={data.agents} />
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
        boardId={data.board.id}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreateTask={async (draft) => {
          await createTask(draft);
          setDialogOpen(false);
        }}
      />

      <LoginDialog
        open={isUnauthorized}
        onLogin={login}
        onChangePassword={changePasswordWithTicket}
      />
    </div>
  );
}

export default App;
