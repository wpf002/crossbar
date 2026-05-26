'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminEventDetailPage({
  params,
}: {
  params: { id: string };
}): JSX.Element {
  const router = useRouter();
  const { id } = params;
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Event detail isn't exposed publicly, so we reuse adminEvents and find it.
  const eventsQ = useQuery({
    queryKey: ['admin', 'events', 'ALL'],
    queryFn: () => api.adminEvents({ limit: 500 }),
  });
  const event = eventsQ.data?.find((e) => e.id === id);

  const finalize = useMutation({
    mutationFn: () =>
      api.adminFinalizeEvent(id, {
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
      }),
    onSuccess: () => router.push('/admin/events'),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Unknown error'),
  });

  if (eventsQ.isLoading) return <div className="h-32 animate-pulse rounded-lg bg-slate-900/40" />;
  if (!event) return <div className="text-sm text-slate-400">Event not found.</div>;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <button
        type="button"
        onClick={() => router.push('/admin/events')}
        className="text-xs text-slate-500 hover:text-slate-200"
      >
        ← All events
      </button>

      <Card>
        <CardTitle>
          {event.awayTeam} @ {event.homeTeam}
        </CardTitle>
        <CardSubtitle className="mt-1">
          {event.sportId.toUpperCase()} · {new Date(event.startsAt).toLocaleString()} · {event.status}
        </CardSubtitle>
      </Card>

      <Card className="space-y-4">
        <CardTitle className="text-sm">Finalize</CardTitle>
        <CardSubtitle>
          Sets the event status to FINAL with these scores and triggers resolution
          for all OPEN/CLOSED markets attached to it.
        </CardSubtitle>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {event.homeTeam} (home)
            </div>
            <input
              type="number"
              min={0}
              value={homeScore}
              onChange={(e) => setHomeScore(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {event.awayTeam} (away)
            </div>
            <input
              type="number"
              min={0}
              value={awayScore}
              onChange={(e) => setAwayScore(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {confirming ? (
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setError(null);
                finalize.mutate();
              }}
              disabled={finalize.isPending}
            >
              {finalize.isPending ? 'Finalizing…' : 'Confirm finalize'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => setConfirming(true)}
            disabled={!homeScore || !awayScore}
          >
            Finalize event
          </Button>
        )}
      </Card>
    </div>
  );
}
