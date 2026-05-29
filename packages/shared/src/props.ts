import type { SportId } from './constants.js';

/**
 * A prop the platform knows how to offer for a sport. `statKey` matches the
 * normalized key produced by the ESPN box-score parser and stored on
 * PlayerStat.stats. `defaultLine` is the over/under threshold used when a prop
 * market is auto-generated and we have no external book line to anchor to — the
 * order book discovers the true probability from there. Half-points avoid pushes.
 */
export interface PropDef {
  statKey: string;
  /** Display label, e.g. "Rushing Yards". */
  label: string;
  /** Lower-case noun phrase for question text, e.g. "rushing yards". */
  unit: string;
  defaultLine: number;
}

export const PROP_CATALOG: Record<SportId, PropDef[]> = {
  nfl: [
    { statKey: 'passingYards', label: 'Passing Yards', unit: 'passing yards', defaultLine: 224.5 },
    { statKey: 'rushingYards', label: 'Rushing Yards', unit: 'rushing yards', defaultLine: 45.5 },
    { statKey: 'receivingYards', label: 'Receiving Yards', unit: 'receiving yards', defaultLine: 45.5 },
    { statKey: 'receptions', label: 'Receptions', unit: 'receptions', defaultLine: 3.5 },
  ],
  nba: [
    { statKey: 'points', label: 'Points', unit: 'points', defaultLine: 15.5 },
    { statKey: 'rebounds', label: 'Rebounds', unit: 'rebounds', defaultLine: 6.5 },
    { statKey: 'assists', label: 'Assists', unit: 'assists', defaultLine: 4.5 },
    { statKey: 'threePointFieldGoalsMade', label: '3-Pointers Made', unit: '3-pointers made', defaultLine: 1.5 },
  ],
  mlb: [
    { statKey: 'hits', label: 'Hits', unit: 'hits', defaultLine: 0.5 },
    { statKey: 'totalBases', label: 'Total Bases', unit: 'total bases', defaultLine: 1.5 },
    { statKey: 'strikeouts', label: 'Strikeouts (Pitcher)', unit: 'strikeouts', defaultLine: 5.5 },
    { statKey: 'RBIs', label: 'RBIs', unit: 'RBIs', defaultLine: 0.5 },
  ],
  nhl: [
    { statKey: 'points', label: 'Points', unit: 'points', defaultLine: 0.5 },
    { statKey: 'goals', label: 'Goals', unit: 'goals', defaultLine: 0.5 },
    { statKey: 'assists', label: 'Assists', unit: 'assists', defaultLine: 0.5 },
    { statKey: 'shotsTotal', label: 'Shots on Goal', unit: 'shots on goal', defaultLine: 2.5 },
  ],
};

export function propDef(sport: SportId, statKey: string): PropDef | undefined {
  return PROP_CATALOG[sport]?.find((p) => p.statKey === statKey);
}
