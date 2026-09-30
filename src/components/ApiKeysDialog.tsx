import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clipboard, KeyRound, Loader2, Trash2 } from "lucide-react";
import type { Agent, ApiKey } from "../types";
import {
  createAgentApiKey,
  listAgentApiKeys,
  revokeAgentApiKey,
  isApiError,
} from "../lib/api";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Badge } from "./ui/badge";

interface ApiKeysDialogProps {
  principal: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function ApiKeysDialog({ principal, open, onOpenChange }: ApiKeysDialogProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const isHuman = principal?.kind === "human";
  const activeKeys = useMemo(
    () => keys.filter((key) => !key.revokedAt),
    [keys]
  );

  const resetDialogState = () => {
    setToken(null);
    setCopied(false);
    setError(null);
    setName("");
  };

  useEffect(() => {
    if (!open || !principal) return;

    let cancelled = false;
    const loadKeys = async () => {
      setIsLoading(true);
      try {
        const data = await listAgentApiKeys(principal.id);
        if (!cancelled) setKeys(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load API keys");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadKeys();

    return () => {
      cancelled = true;
    };
  }, [open, principal]);

  if (!principal) return null;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isHuman) return;

    setIsCreating(true);
    setError(null);
    setToken(null);
    setCopied(false);
    try {
      const created = await createAgentApiKey(principal.id, name.trim());
      setKeys((current) => [created.apiKey, ...current]);
      setToken(created.token);
      setName("");
    } catch (err) {
      if (isApiError(err) && err.status === 400 && isHuman) {
        setError("API keys are only available for agent identities.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to create API key");
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleRevoke = async (key: ApiKey) => {
    setRevokingId(key.id);
    setError(null);
    try {
      await revokeAgentApiKey(principal.id, key.id);
      setKeys((current) =>
        current.map((item) =>
          item.id === key.id ? { ...item, revokedAt: Date.now() } : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetDialogState();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <DialogTitle>API keys for {principal.displayName}</DialogTitle>
          </div>
          <DialogDescription>
            Mint agent credentials, copy the token once, and revoke keys that should no longer work.
          </DialogDescription>
        </DialogHeader>

        {isHuman && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Human identities do not get API keys. Create or select an agent identity
              before minting a token.
            </p>
          </div>
        )}

        <form onSubmit={handleCreate} className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-3">
          <label
            htmlFor="api-key-name"
            className="block text-xs font-semibold uppercase text-[var(--color-ink-muted)]"
          >
            New key name
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Production agent"
              disabled={isHuman || isCreating}
              className="h-9 flex-1 rounded-[--radius-button] border border-[var(--color-border-soft)] bg-white px-3 text-sm placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button type="submit" disabled={isHuman || isCreating || !name.trim()}>
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              Create key
            </Button>
          </div>
        </form>

        {token && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Copy this token now.</p>
                <p className="mt-1 text-emerald-900">
                  It will not be shown again after this dialog closes.
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <code className="mt-3 block overflow-x-auto rounded-md bg-white px-3 py-2 font-mono text-xs text-[var(--color-ink)]">
              {token}
            </code>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-[var(--color-border-soft)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">Existing keys</h3>
            <Badge variant="secondary">{activeKeys.length} active</Badge>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-[var(--color-ink-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading keys
            </div>
          ) : keys.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
              No API keys yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-[var(--color-surface)] text-xs uppercase text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Prefix</th>
                    <th className="px-3 py-2 font-semibold">Last used</th>
                    <th className="px-3 py-2 font-semibold">Created</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-soft)]">
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td className="px-3 py-2 font-medium text-[var(--color-ink)]">
                        {key.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-ink-muted)]">
                        {key.prefix}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                        {formatDate(key.lastUsedAt)}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                        {formatDate(key.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={key.revokedAt ? "outline" : "default"}>
                          {key.revokedAt ? "Revoked" : "Active"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(key.revokedAt) || revokingId === key.id}
                          onClick={() => handleRevoke(key)}
                        >
                          {revokingId === key.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
