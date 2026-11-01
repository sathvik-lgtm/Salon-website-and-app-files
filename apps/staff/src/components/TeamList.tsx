'use client';

import { buttonClasses } from '@salon/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { TeamMember } from '../server/data';
import { errorText, getJson, postJson } from '../lib/api-client';
import { ROLE_LABEL } from '../lib/format';

/**
 * The team and the temporary-password reset. There is no email in this system, so a reset shows the
 * new password ONCE, to the person resetting, who tells their colleague. The colleague must choose
 * their own password at their next sign-in.
 */
export function TeamList() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['team'],
    queryFn: ({ signal }) => getJson<{ team: TeamMember[] }>('/admin/api/team', signal),
  });
  const [asking, setAsking] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useMutation({
    mutationFn: (member: TeamMember) =>
      postJson<{ password: string }>(`/admin/api/team/${member.id}/temporary-password`, {}).then(
        (r) => ({
          name: member.name,
          password: r.password,
        }),
      ),
    onSuccess: (result) => {
      setAsking(null);
      setCopied(false);
      setRevealed(result);
      void queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: () => setAsking(null),
  });

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl">Team</h1>
      <p className="mt-2 text-muted">
        Forgotten a password? Set a temporary one here and tell them. They choose their own when
        they next sign in.
      </p>

      {revealed && (
        <div role="alert" className="mt-6 rounded-card border border-accent bg-accent-soft p-5">
          <h2 className="font-display text-xl">Temporary password for {revealed.name}</h2>
          <p
            className="mt-3 select-all rounded-lg bg-surface px-4 py-3 font-mono text-2xl tracking-wider"
            data-testid="temporary-password"
          >
            {revealed.password}
          </p>
          <p className="mt-3 text-sm">
            <strong>This is shown only once.</strong> Tell {revealed.name} to sign in with it, then
            choose their own password. If you lose it, set another.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonClasses()}
              onClick={() => {
                void navigator.clipboard?.writeText(revealed.password).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy password'}
            </button>
            <button
              type="button"
              className={buttonClasses({ variant: 'secondary' })}
              onClick={() => setRevealed(null)}
            >
              Done, hide it
            </button>
          </div>
        </div>
      )}

      {reset.isError && (
        <p
          role="alert"
          className="mt-4 rounded-card border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        >
          {errorText(reset.error)}
        </p>
      )}

      {query.isPending && <p className="mt-6 text-muted">Loading the team…</p>}
      {query.isError && (
        <p role="alert" className="mt-6 text-red-900">
          {errorText(query.error)}
        </p>
      )}
      {query.isSuccess && (
        <div className="relative mt-6 overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Staff</caption>
            <thead className="border-b border-line">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Role
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Branch
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.data.team.map((m) => (
                <tr key={m.id}>
                  <th scope="row" className="px-4 py-3 font-medium">
                    {m.name}
                    <span className="block text-xs font-normal text-muted">{m.email}</span>
                  </th>
                  <td className="px-4 py-3">{ROLE_LABEL[m.role] ?? m.role}</td>
                  <td className="px-4 py-3">{m.branchName}</td>
                  <td className="px-4 py-3">
                    {!m.active
                      ? 'Deactivated'
                      : m.mustChangePassword
                        ? 'Must choose a new password'
                        : 'Active'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.canReset &&
                      (asking === m.id ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-2">
                          <span className="font-medium">Set a new temporary password?</span>
                          <button
                            type="button"
                            autoFocus
                            disabled={reset.isPending}
                            onClick={() => reset.mutate(m)}
                            className="min-h-11 rounded-full bg-accent px-4 font-medium text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
                          >
                            Yes, set it
                          </button>
                          <button
                            type="button"
                            onClick={() => setAsking(null)}
                            className="min-h-11 rounded-full border border-line px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAsking(m.id)}
                          className="min-h-11 rounded-full border border-line px-4 font-medium hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          Set temporary password<span className="sr-only"> for {m.name}</span>
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
