import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Lock, Eye, EyeOff } from "lucide-react";

interface LoginDialogProps {
  open: boolean;
  onLogin: (token: string) => Promise<void>;
}

export function LoginDialog({ open, onLogin }: LoginDialogProps) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await onLogin(token.trim());
      setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" hideClose>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <DialogTitle>Sign in to Buzz Kanban</DialogTitle>
          </div>
          <DialogDescription>
            Enter the owner token to access this board.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <label
              htmlFor="owner-token"
              className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
            >
              Owner token
            </label>
            <div className="relative">
              <input
                id="owner-token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your owner token"
                autoFocus
                required
                className="w-full h-10 px-3 pr-10 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setShowToken((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] rounded"
                aria-label={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting || !token.trim()}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
