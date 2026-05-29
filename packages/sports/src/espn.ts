import type { PlayerStatLine, SportEvent, SportId } from '@crossbar/shared';

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
    const period = typeof e.status?.period === 'number' ? e.status.period : undefined;
    const displayClock =
      typeof e.status?.type?.shortDetail === 'string'
        ? e.status.type.shortDetail
        : typeof e.status?.displayClock === 'string'
          ? e.status.displayClock
          : undefined;
    const odds = comp?.odds?.[0];
    const spread = typeof odds?.spread === 'number' ? odds.spread : undefined;
    const overUnder = typeof odds?.overUnder === 'number' ? odds.overUnder : undefined;
    const homeMoneyLine =
      typeof odds?.homeTeamOdds?.moneyLine === 'number'
        ? odds.homeTeamOdds.moneyLine
        : undefined;
    const awayMoneyLine =
      typeof odds?.awayTeamOdds?.moneyLine === 'number'
        ? odds.awayTeamOdds.moneyLine
        : undefined;

    return {
      externalId: String(e.id),
      sportId: sport,
      homeTeam: home?.team?.displayName ?? 'Unknown',
      awayTeam: away?.team?.displayName ?? 'Unknown',
      startsAt: e.date,
      status: STATUS_MAP[statusName] ?? 'SCHEDULED',
      homeScore: home?.score ? Number(home.score) : undefined,
      awayScore: away?.score ? Number(away.score) : undefined,
      period,
      displayClock,
      homeLinescores: parseLinescores(home?.linescores),
      awayLinescores: parseLinescores(away?.linescores),
      spread,
      overUnder,
      homeMoneyLine,
      awayMoneyLine,
    };
  });
}

/**
 * Map an ESPN `linescores` array (e.g. [{ value: 7 }, { value: 3 }]) to a
 * plain number[] of per-period scores. Returns undefined when absent.
 */
export function parseLinescores(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: number[] = [];
  for (const cell of raw) {
    const v = Number((cell as any)?.value ?? (cell as any)?.displayValue);
    out.push(Number.isFinite(v) ? v : 0);
  }
  return out;
}

/**
 * Fetch per-player box-score stats for a single event from ESPN's summary
 * endpoint. Returns one normalized stat line per player (merged across all
 * stat categories — a player who appears in both "rushing" and "receiving"
 * gets one line with both). Empty array if the box score isn't published yet.
 */
export async function fetchEventPlayerStats(
  sport: SportId,
  eventExternalId: string,
): Promise<PlayerStatLine[]> {
  const base = process.env.ESPN_API_BASE ?? 'https://site.api.espn.com/apis/site/v2/sports';
  const url = `${base}/${PATHS[sport]}/summary?event=${encodeURIComponent(eventExternalId)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${sport} summary fetch failed: ${res.status}`);
  const data = (await res.json()) as any;

  return parseBoxscorePlayers(data?.boxscore?.players ?? []);
}

/**
 * Parse ESPN `boxscore.players` (one entry per team) into normalized stat
 * lines. Exported for testing — pure, no I/O.
 */
export function parseBoxscorePlayers(teams: any[]): PlayerStatLine[] {
  const byId = new Map<string, PlayerStatLine>();

  for (const team of teams ?? []) {
    const teamName: string = team?.team?.displayName ?? 'Unknown';
    for (const category of team?.statistics ?? []) {
      const keys: string[] = category?.keys ?? [];
      for (const entry of category?.athletes ?? []) {
        const athlete = entry?.athlete;
        const id = athlete?.id != null ? String(athlete.id) : undefined;
        if (!id) continue;
        const statsArr: unknown[] = entry?.stats ?? [];

        let line = byId.get(id);
        if (!line) {
          line = {
            externalId: id,
            name: athlete?.displayName ?? 'Unknown',
            team: teamName,
            position: athlete?.position?.abbreviation ?? undefined,
            stats: {},
          };
          byId.set(id, line);
        }

        for (let i = 0; i < keys.length; i++) {
          assignStat(line.stats, keys[i], statsArr[i]);
        }
      }
    }
  }

  return [...byId.values()];
}

/**
 * Assign one box-score cell. ESPN packs paired stats into a single key/value
 * (e.g. key "fieldGoalsMade-fieldGoalsAttempted", value "5-12"); split those
 * into separate numeric keys. Non-numeric cells (e.g. "20:14" minutes) are
 * dropped.
 */
function assignStat(
  stats: Record<string, number>,
  key: string | undefined,
  raw: unknown,
): void {
  if (!key || raw == null) return;
  const value = String(raw);

  const sep = key.includes('-') ? '-' : key.includes('/') ? '/' : null;
  if (sep) {
    const subKeys = key.split(sep);
    const subVals = value.split(sep);
    if (subKeys.length >= 2 && subKeys.length === subVals.length) {
      for (let i = 0; i < subKeys.length; i++) {
        const subKey = subKeys[i];
        if (!subKey) continue;
        const n = Number(subVals[i]);
        if (Number.isFinite(n)) stats[subKey] = n;
      }
      return;
    }
  }

  const n = Number(value);
  if (Number.isFinite(n)) stats[key] = n;
}
