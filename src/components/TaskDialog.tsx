import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Calendar,
  CheckCircle2,
  Clock,
  User,
  X,
  Plus,
} from "lucide-react";
import { cn, formatDate, priorityColor, formatRelativeTime } from "../lib/utils";
import type { Agent, Priority, Task, TaskStatus } from "../types";
import type { TaskDraft } from "../hooks/useBoardData";

interface TaskDialogProps {
  task: Task | null;
  assignee?: Agent;
  creator?: Agent;
  agents: Agent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTask?: (draft: TaskDraft) => void;
}

const priorities: Priority[] = ["low", "medium", "high", "urgent"];
const statuses: TaskStatus[] = ["backlog", "in-progress", "review", "done"];

export function TaskDialog({
  task,
  assignee,
  creator,
  agents,
  open,
  onOpenChange,
  onCreateTask,
}: TaskDialogProps) {
  const isCreate = task === null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !onCreateTask) return;
    onCreateTask({
      boardId: task?.boardId ?? "board-1",
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      tags,
      assigneeId: assigneeId || undefined,
      createdBy: "agent-1",
      subtasksCompleted: 0,
      subtasksTotal: 0,
      dueDate: dueDate || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        key={task?.id ?? "create"}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {isCreate ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create task</DialogTitle>
              <DialogDescription>
                Add a new task to the board. You can edit details later.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              <div className="md:col-span-2 space-y-4">
                <div>
                  <label
                    htmlFor="task-title"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Title <span aria-label="required">*</span>
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    required
                    className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="task-description"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Description
                  </label>
                  <textarea
                    id="task-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add context, acceptance criteria, or links."
                    rows={4}
                    className="w-full px-3 py-2 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="task-tags"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Tags
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="task-tags"
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Press Enter to add"
                      className="flex-1 h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={handleAddTag}
                      aria-label="Add tag"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[var(--color-surface)] text-[var(--color-ink-muted)] border border-[var(--color-border-soft)]"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="rounded-full hover:text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                            aria-label={`Remove ${tag}`}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="task-status"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Status
                  </label>
                  <select
                    id="task-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("-", " ")}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="task-priority"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Priority
                  </label>
                  <select
                    id="task-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  >
                    {priorities.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="task-assignee"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Assignee
                  </label>
                  <select
                    id="task-assignee"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.displayName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="task-due"
                    className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                  >
                    Due date
                  </label>
                  <input
                    id="task-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Create task
              </Button>
            </div>
          </form>
        ) : (
          <TaskDetail
            task={task}
            assignee={assignee}
            creator={creator}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({
  task,
  assignee,
  creator,
}: {
  task: Task;
  assignee?: Agent;
  creator?: Agent;
}) {
  const isDone = task.status === "done";

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="secondary"
            className={cn(
              "rounded-md px-1.5 py-0.5",
              priorityColor(task.priority)
            )}
          >
            {task.priority}
          </Badge>
          <span className="text-xs text-[var(--color-ink-muted)] font-mono">
            {task.id}
          </span>
        </div>
        <DialogTitle className="text-xl">{task.title}</DialogTitle>
        {task.description && (
          <DialogDescription className="text-sm leading-relaxed">
            {task.description}
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <div className="md:col-span-2 space-y-6">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Tags
            </h4>
            <div className="flex flex-wrap gap-2">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface)] text-[var(--color-ink-muted)] border border-[var(--color-border-soft)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Subtasks
            </h4>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle2
                className={cn(
                  "h-4 w-4",
                  isDone ? "text-emerald-600" : "text-[var(--color-ink-muted)]"
                )}
                aria-hidden="true"
              />
              <span className="text-[var(--color-ink)]">
                {task.subtasksCompleted} of {task.subtasksTotal} completed
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--color-border-soft)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                style={{
                  width:
                    task.subtasksTotal > 0
                      ? `${(task.subtasksCompleted / task.subtasksTotal) * 100}%`
                      : "0%",
                }}
              />
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Activity
            </h4>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Activity feed will appear here once the backend is wired.
            </p>
          </section>
        </div>

        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Status
            </h4>
            <span className="inline-flex items-center gap-2 text-sm text-[var(--color-ink)] capitalize">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    task.status === "backlog"
                      ? "#6b7a8d"
                      : task.status === "in-progress"
                      ? "#3b82f6"
                      : task.status === "review"
                      ? "#8b5cf6"
                      : "#10b981",
                }}
              />
              {task.status.replace("-", " ")}
            </span>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Assignee
            </h4>
            <div className="flex items-center gap-2">
              {assignee ? (
                <>
                  <Avatar
                    name={assignee.displayName}
                    color={assignee.color}
                    size="sm"
                  />
                  <span className="text-sm text-[var(--color-ink)]">
                    {assignee.displayName}
                  </span>
                </>
              ) : (
                <>
                  <User className="h-4 w-4 text-[var(--color-ink-muted)]" />
                  <span className="text-sm text-[var(--color-ink-muted)]">
                    Unassigned
                  </span>
                </>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Created by
            </h4>
            <div className="flex items-center gap-2">
              {creator ? (
                <>
                  <Avatar
                    name={creator.displayName}
                    color={creator.color}
                    size="sm"
                  />
                  <span className="text-sm text-[var(--color-ink)]">
                    {creator.displayName}
                  </span>
                </>
              ) : (
                <span className="text-sm text-[var(--color-ink-muted)]">
                  Unknown
                </span>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Due date
            </h4>
            <div className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
              <Calendar
                className="h-4 w-4 text-[var(--color-ink-muted)]"
                aria-hidden="true"
              />
              {task.dueDate ? formatDate(task.dueDate) : "None"}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-2">
              Updated
            </h4>
            <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {formatRelativeTime(task.updatedAt)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
