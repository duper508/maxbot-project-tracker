import {
  LayoutGrid,
  ListTodo,
  Settings,
  Users,
  Bell,
  Search,
  Hexagon,
} from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarProps {
  className?: string;
}

const navItems = [
  { icon: LayoutGrid, label: "Boards", active: true },
  { icon: ListTodo, label: "My tasks", active: false },
  { icon: Search, label: "Search", active: false },
  { icon: Bell, label: "Activity", active: false },
  { icon: Users, label: "Agents", active: false },
  { icon: Settings, label: "Settings", active: false },
];

export function Sidebar({ className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col w-60 h-screen bg-[#15212b] text-white sticky top-0",
        className
      )}
    >
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-text)]">
          <Hexagon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-semibold text-sm leading-tight">Buzz Kanban</h1>
          <p className="text-xs text-white/50">Project tracker</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => (
          <a
            key={item.label}
            href="#"
            onClick={(e) => e.preventDefault()}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              item.active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-text)]"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            )}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </a>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-bold">
            DP
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Duper508</p>
            <p className="text-xs text-white/50 truncate">Human</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
