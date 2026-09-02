import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function priorityColor(priority: string): string {
  switch (priority) {
    case "low":
      return "bg-slate-100 text-slate-600";
    case "medium":
      return "bg-amber-100 text-amber-700";
    case "high":
      return "bg-red-100 text-red-700";
    case "urgent":
      return "bg-red-200 text-red-900";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "backlog":
      return "bg-slate-400";
    case "in-progress":
      return "bg-blue-500";
    case "review":
      return "bg-violet-500";
    case "done":
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}
