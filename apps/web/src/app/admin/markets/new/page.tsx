'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type MarketType = 'MONEYLINE' | 'TOTAL' | 'SPREAD' | 'PLAYER_TOTAL';

const selectClass =
  'mt-2 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100';

export default function AdminCreateMarketPage(): JSX.Element {
  const router = useRouter();
  const [eventId, setEventId] = useState('');
  const [type, setType] = useState<MarketType>('MONEYLINE');
  const [line, setLine] = useState('');
  const [question, setQuestion] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [statKey, setStatKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isProp = type === 'PLAYER_TOTAL';
  // Game lines are created on scheduled events; player props need a live event
  // whose box score has been ingested (so players exist to pick from).
  const eventStatus = isProp ? 'LIVE' : 'SCHEDULED';

  const eventsQ = useQuery({
    queryKey: ['admin', 'events', eventStatus],
    queryFn: () => api.adminEvents({ status: eventStatus, limit: 100 }),
  });
  const catalogQ = useQuery({
    queryKey: ['admin', 'props', 'catalog'],
    queryFn: () => api.adminPropsCatalog(),
    enabled: isProp,
  });
  const playersQ = useQuery({
    queryKey: ['admin', 'events', eventId, 'players'],
    queryFn: () => api.adminEventPlayers(eventId),
    enabled: isProp && eventId !== '',
  });

  const selectedEvent = eventsQ.data?.find((e) => e.id === eventId);
  const sportCatalog = useMemo(
    () => (selectedEvent ? catalogQ.data?.[selectedEvent.sportId] ?? [] : []),
    [catalogQ.data, selectedEvent],
  );

  const create = useMutation({
    mutationFn: async () => {
      const body: Parameters<typeof api.adminCreateMarket>[0] = {
        eventId,
        type,
        ...(type !== 'MONEYLINE' ? { line: Number(line) } : {}),
        ...(isProp ? { playerId, statKey } : {}),
        ...(question ? { question } : {}),
      };
      return api.adminCreateMarket(body);
    },
    onSuccess: () => router.push('/admin/markets'),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unknown error'),
  });

  const formValid = isProp
    ? eventId && playerId && statKey && line
    : eventId && (type === 'MONEYLINE' || line);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Create market</h1>

      <Card className="space-y-4">
        <div>
          <CardTitle className="text-sm">Type</CardTitle>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as MarketType);
              setEventId('');
              setPlayerId('');
              setStatKey('');
              setLine('');
            }}
            className={selectClass}
          >
            <option value="MONEYLINE">Moneyline</option>
            <option value="TOTAL">Total (O/U)</option>
            <option value="SPREAD">Spread</option>
            <option value="PLAYER_TOTAL">Player prop (O/U)</option>
          </select>
        </div>

        <div>
          <CardTitle className="text-sm">Event</CardTitle>
          <CardSubtitle className="mt-1">
            {isProp
              ? 'Pick a live event whose box score has been ingested.'
              : 'Pick an existing scheduled event from the ingest.'}
          </CardSubtitle>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={selectClass}>
            <option value="">— select event —</option>
            {eventsQ.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.sportId.toUpperCase()}: {e.awayTeam} @ {e.homeTeam} (
                {new Date(e.startsAt).toLocaleString()})
              </option>
            ))}
          </select>
        </div>

        {isProp && eventId && (
          <>
            <div>
              <CardTitle className="text-sm">Player</CardTitle>
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className={selectClass}
              >
                <option value="">
                  {playersQ.isLoading
                    ? 'Loading players…'
                    : playersQ.data?.length
                      ? '— select player —'
                      : 'No players ingested for this event yet'}
                </option>
                {playersQ.data?.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.name}
                    {p.position ? ` (${p.position})` : ''} — {p.team}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <CardTitle className="text-sm">Stat</CardTitle>
              <select
                value={statKey}
                onChange={(e) => {
                  setStatKey(e.target.value);
                  const def = sportCatalog.find((c) => c.statKey === e.target.value);
                  if (def) setLine(String(def.defaultLine));
                }}
                className={selectClass}
              >
                <option value="">— select stat —</option>
                {sportCatalog.map((c) => (
                  <option key={c.statKey} value={c.statKey}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {type !== 'MONEYLINE' && (
          <div>
            <CardTitle className="text-sm">
              {type === 'TOTAL'
                ? 'Over/Under line'
                : type === 'SPREAD'
                  ? 'Spread line'
                  : 'Over/Under line'}
            </CardTitle>
            <input
              type="number"
              step="0.5"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder={type === 'SPREAD' ? '-3.5' : '47.5'}
              className={selectClass}
            />
          </div>
        )}

        <div>
          <CardTitle className="text-sm">Question (optional)</CardTitle>
          <CardSubtitle className="mt-1">Leave blank to use the default phrasing.</CardSubtitle>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will Home cover -3.5?"
            className={selectClass}
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            disabled={!formValid || create.isPending}
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
