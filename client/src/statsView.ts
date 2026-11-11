/** Texto del resumen de partida, en el idioma activo. */
import type { Summary } from './stats';
import { formatNumber, perkName, t, weaponName, type TextKey } from './i18n';

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function purchaseName(what: string, id: string): string {
  const name = what === 'perk' ? perkName(id) : weaponName(id);
  return t(`purchase.${what}` as TextKey, { id: name });
}

export function summaryText(s: Summary): string {
  const lines = [t('stats.reached', { round: s.roundReached, time: clock(s.seconds) })];
  if (s.rounds.length) {
    lines.push(t('stats.rounds', { list: s.rounds.map((r) => t('stats.roundItem', { round: r.round, seconds: r.seconds, kills: r.kills })).join(', ') }));
  }
  const first = s.purchases[0];
  lines.push(
    first ? t('stats.firstPurchase', { what: purchaseName(first.what, first.id), round: first.round, time: clock(first.seconds) }) : t('stats.noPurchase'),
  );
  if (s.purchases.length) {
    lines.push(t('stats.purchases', { list: s.purchases.map((p) => `${purchaseName(p.what, p.id)} (R${p.round})`).join(', ') }));
  }
  lines.push(t('stats.points', { earned: formatNumber(s.earned), spent: formatNumber(s.spent) }));
  const hit = s.shots ? Math.round((s.shotsThatHit / s.shots) * 100) : 0;
  const head = s.kills ? Math.round((s.headshotKills / s.kills) * 100) : 0;
  lines.push(t('stats.aim', { hit, head }));
  lines.push(t('stats.damage', { hits: s.hitsTaken, downs: s.downs }));
  if (s.lastHitFrom && s.lastZone) {
    lines.push(t('stats.lastHit', { from: t(`stats.from.${s.lastHitFrom}` as TextKey), zone: t(`zone.${s.lastZone}` as TextKey) }));
  }
  return lines.join('\n');
}
