/* eslint-disable no-console */
import { runBacktest } from '@crossbar/bots';

const args = process.argv.slice(2);
let N = 200;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--markets' && args[i + 1]) N = Number(args[i + 1]);
}

console.log(`Running simulation with N=${N} events (seed=42).`);
const summary = runBacktest(N, 42);

const rows = summary.results.map((r) => ({
  bot: r.bot,
  n: r.predictions,
  acc: r.predictions > 0 ? `${(r.accuracy * 100).toFixed(1)}%` : '—',
  brier: r.predictions > 0 ? r.brierScore.toFixed(4) : '—',
  pnl_avg:
    r.predictions > 0
      ? `$${(r.pnlCents / r.predictions / 100).toFixed(2)}`
      : '—',
  pnl_total: `$${(r.pnlCents / 100).toFixed(2)}`,
}));

console.log('');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log(`  Synthetic-outcome backtest · ${summary.events} events`);
console.log('═══════════════════════════════════════════════════════════════════════════');
console.table(rows);
console.log('');
console.log('  Brier: lower is better. 0 = perfect, 0.25 = coin flip.');
console.log('');

for (const r of summary.results) {
  if (r.predictions === 0) continue;
  console.log(`  Calibration · ${r.bot}`);
  for (const c of r.calibration) {
    const bar = '█'.repeat(Math.max(1, Math.round(c.count / 5)));
    const dPredicted = `${c.predicted}%`.padStart(4);
    const dActual = `${c.actual}%`.padStart(4);
    const dN = String(c.count).padStart(4);
    const tone =
      Math.abs(c.predicted - c.actual) < 8
        ? '✓'
        : Math.abs(c.predicted - c.actual) < 20
          ? '~'
          : '✗';
    console.log(`    bin ${dPredicted} → actual ${dActual}  (n=${dN}) ${tone}  ${bar}`);
  }
  console.log('');
}
