import type { SportEvent, SportId } from '@crossbar/shared';

const PATHS: Record<SportId, string> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

const STATUS_MAP: Record<string, SportEvent['status']> = {
  STATUS_SCHEDULED: 'SCHEDULED',
  STATUS_IN_PROGRESS: 'LIVE',
  STATUS_FINAL: 'FINAL',
  STATUS_POSTPONED: 'POSTPONED',
  STATUS_CANCELED: 'CANCELED',
};

export async function fetchScoreboard(sport: SportId): Promise<SportEvent[]> {
  const base = process.env.ESPN_API_BASE ?? 'https://site.api.espn.com/apis/site/v2/sports';
  const url = `${base}/${PATHS[sport]}/scoreboard`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${sport} fetch failed: ${res.status}`);
  const data = (await res.json()) as any;

  return (data.events ?? []).map((e: any): SportEvent => {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
    const statusName = e.status?.type?.name ?? 'STATUS_SCHEDULED';

    return {
      externalId: String(e.id),
      sportId: sport,
      homeTeam: home?.team?.displayName ?? 'Unknown',
      awayTeam: away?.team?.displayName ?? 'Unknown',
      startsAt: e.date,
      status: STATUS_MAP[statusName] ?? 'SCHEDULED',
      homeScore: home?.score ? Number(home.score) : undefined,
      awayScore: away?.score ? Number(away.score) : undefined,
    };
  });
}
