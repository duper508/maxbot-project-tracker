import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Lock, Eye, EyeOff, Mail } from "lucide-react";

interface LoginDialogProps {
  open: boolean;
  onLogin: (credentials: { email: string; password: string }) => Promise<
    { mustChangePassword: false } | { mustChangePassword: true; ticket: string; email: string }
  >;
  onChangePassword: (
    ticket: string,
    newPassword: string,
    email: string
  ) => Promise<void>;
}

export function LoginDialog({ open, onLogin, onChangePassword }: LoginDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [ticketEmail, setTicketEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const needsPasswordChange = Boolean(ticket);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsPasswordChange) {
      if (!ticket || newPassword.length < 12) return;

      setError(null);
      setIsSubmitting(true);
      try {
        await onChangePassword(ticket, newPassword, ticketEmail);
        setPassword("");
        setNewPassword("");
        setTicket(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Password update failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!email.trim() || !password) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onLogin({ email: email.trim(), password });
      if (result.mustChangePassword) {
        setTicket(result.ticket);
        setTicketEmail(result.email);
        setPassword("");
        return;
      }
      setPassword("");
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
              {needsPasswordChange ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Mail className="h-4 w-4" aria-hidden="true" />
              )}
            </div>
            <DialogTitle>
              {needsPasswordChange ? "Set a new password" : "Sign in to Buzz Kanban"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {needsPasswordChange
              ? "This account needs a new password before the board can open."
              : "Use your email and password to access this board."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {needsPasswordChange ? (
            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 12 characters"
                autoFocus
                minLength={12}
                required
                className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                  className="w-full h-10 px-3 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    className="w-full h-10 px-3 pr-10 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] rounded"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {needsPasswordChange && (
            <div className="rounded-md border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
              After this, the board will open with your new password.
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={
              isSubmitting ||
              (needsPasswordChange ? newPassword.length < 12 : !email.trim() || !password)
            }
          >
            {isSubmitting
              ? needsPasswordChange
                ? "Updating..."
                : "Signing in..."
              : needsPasswordChange
                ? "Update password"
                : "Sign in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
