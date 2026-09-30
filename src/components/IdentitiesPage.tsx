import { KeyRound, Shield, UserPlus, Users } from "lucide-react";
import type { Agent } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface IdentitiesPageProps {
  principals: Agent[];
}

function displayKind(kind: Agent["kind"]): string {
  return kind === "human" ? "Human" : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} agent`;
}

export function IdentitiesPage({ principals }: IdentitiesPageProps) {
  return (
    <section className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-ink)]">
              Identities
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
              Manage the humans and agents that can work on this board.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled title="Waiting on invite flow">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add human
            </Button>
            <Button variant="secondary" disabled title="Waiting on #17 key endpoints">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Mint key
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-soft)] bg-white p-4 shadow-[var(--shadow-card)]">
            <p className="text-sm text-[var(--color-ink-muted)]">Principals</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
              {principals.length}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-soft)] bg-white p-4 shadow-[var(--shadow-card)]">
            <p className="text-sm text-[var(--color-ink-muted)]">Humans</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
              {principals.filter((principal) => principal.kind === "human").length}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-soft)] bg-white p-4 shadow-[var(--shadow-card)]">
            <p className="text-sm text-[var(--color-ink-muted)]">Agents</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
              {principals.filter((principal) => principal.kind !== "human").length}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-border-soft)] bg-white shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border-soft)] px-4 py-3">
            <Users className="h-4 w-4 text-[var(--color-ink-muted)]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">
              Principals
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--color-surface)] text-xs uppercase text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Kind</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">External ID</th>
                  <th className="px-4 py-3 font-semibold">Keys</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-soft)]">
                {principals.map((principal) => (
                  <tr key={principal.id} className="hover:bg-[var(--color-surface)]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-ink)]">
                        {principal.displayName}
                      </div>
                      {principal.email && (
                        <div className="text-xs text-[var(--color-ink-muted)]">
                          {principal.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {displayKind(principal.kind)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={principal.role === "owner" ? "default" : "secondary"}>
                        <Shield className="h-3 w-3" aria-hidden="true" />
                        {principal.role ?? "viewer"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-muted)]">
                      {principal.status ?? "active"}
                    </td>
                    <td className="max-w-[16rem] truncate px-4 py-3 text-[var(--color-ink-muted)]">
                      {principal.externalId ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" disabled title="Waiting on #17">
                        Manage keys
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {principals.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
              No principals found.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
