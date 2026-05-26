'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type MarketType = 'MONEYLINE' | 'TOTAL' | 'SPREAD';

export default function AdminCreateMarketPage(): JSX.Element {
  const router = useRouter();
  const [eventId, setEventId] = useState('');
  const [type, setType] = useState<MarketType>('MONEYLINE');
  const [line, setLine] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const eventsQ = useQuery({
    queryKey: ['admin', 'events', 'SCHEDULED'],
    queryFn: () => api.adminEvents({ status: 'SCHEDULED', limit: 100 }),
  });

  const create = useMutation({
    mutationFn: async () => {
      const body: Parameters<typeof api.adminCreateMarket>[0] = {
        eventId,
        type,
        ...(type !== 'MONEYLINE' ? { line: Number(line) } : {}),
        ...(question ? { question } : {}),
      };
      return api.adminCreateMarket(body);
    },
    onSuccess: () => router.push('/admin/markets'),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Unknown error'),
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Create market</h1>

      <Card className="space-y-4">
        <div>
          <CardTitle className="text-sm">Event</CardTitle>
          <CardSubtitle className="mt-1">
            Pick an existing scheduled event from the ingest.
          </CardSubtitle>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">— select event —</option>
            {eventsQ.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.sportId.toUpperCase()}: {e.awayTeam} @ {e.homeTeam} (
                {new Date(e.startsAt).toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        <div>
          <CardTitle className="text-sm">Type</CardTitle>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MarketType)}
            className="mt-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="MONEYLINE">Moneyline</option>
            <option value="TOTAL">Total (O/U)</option>
            <option value="SPREAD">Spread</option>
          </select>
        </div>

        {type !== 'MONEYLINE' && (
          <div>
            <CardTitle className="text-sm">
              {type === 'TOTAL' ? 'Over/Under line' : 'Spread line'}
            </CardTitle>
            <input
              type="number"
              step="0.5"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder={type === 'TOTAL' ? '47.5' : '-3.5'}
              className="mt-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        )}

        <div>
          <CardTitle className="text-sm">Question (optional)</CardTitle>
          <CardSubtitle className="mt-1">
            Leave blank to use the default phrasing.
          </CardSubtitle>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will Home cover -3.5?"
            className="mt-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            disabled={!eventId || (type !== 'MONEYLINE' && !line) || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Creating…' : 'Create market'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/admin/markets')}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
