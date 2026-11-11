/**
 * Interfaz en partida, en HTML y CSS sobre el canvas. Los números flotantes
 * salen de una reserva fija de elementos (regla 5).
 */
import type { Game } from '../../shared/sim/game';
import type { Prompt, SimEvent } from '../../shared/sim/types';
import { formatNumber, perkName, t, weaponName, type TextKey } from './i18n';

const FLOAT_POOL = 12;

/** Color de la etiqueta de cada suero. */
const PERK_COLOR: Record<string, string> = { coraza: '#ffa040', segundoAliento: '#4fe0ff' };

/** Texto del aviso de interacción, con su precio. */
export function promptText(pr: Prompt): string {
  const cost = 'cost' in pr ? formatNumber(pr.cost) : '';
  switch (pr.kind) {
    case 'repair':
      return t('prompt.repair');
    case 'buyWeapon':
      return t('prompt.buyWeapon', { weapon: weaponName(pr.weapon), cost });
    case 'buyAmmo':
      return t('prompt.buyAmmo', { weapon: weaponName(pr.weapon), cost });
    case 'openDoor':
      return t('prompt.openDoor', { cost });
    case 'powerSwitch':
      return t('prompt.powerSwitch');
    case 'needPower':
      return t('prompt.needPower');
    case 'buyPerk':
      return t('prompt.buyPerk', { perk: perkName(pr.perk), cost });
    case 'perkFull':
      return t('prompt.perkFull');
    case 'buyContenedor':
      return t('prompt.buyContenedor', { cost });
    case 'takeWeapon':
      return t('prompt.takeWeapon', { weapon: weaponName(pr.weapon) });
    case 'forja':
      return t('prompt.forja', { weapon: weaponName(pr.weapon), cost });
    case 'takeForged':
      return t('prompt.takeForged', { weapon: weaponName(pr.weapon) });
  }
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Falta el elemento #${id}`);
  return e as T;
}

/** Vuelve a lanzar una animación CSS sobre el mismo elemento. */
function restart(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

export class Hud {
  private readonly root = el('hud');
  private readonly round = el('hud-round');
  private readonly points = el('hud-points-value');
  private readonly floats: HTMLElement[] = [];
  private nextFloat = 0;
  private readonly ammo = el('hud-ammo');
  private readonly weapon = el('hud-weapon');
  private readonly status = el('hud-status');
  private readonly prompt = el('hud-prompt');
  private readonly hitmarker = el('hud-hitmarker');
  private readonly damage = el('hud-damage');
  private readonly banner = el('hud-banner');
  private readonly hint = el('hud-hint');
  private lastHint: string | null = null;
  private readonly effects = el('hud-effects');
  private readonly perks = el('hud-perks');
  private readonly downed = el('hud-downed');
  private readonly downedTimer = el('hud-downed-timer');
  private lastPerks = '';
  private lastEffects = '';
  private lastDowned = '';
  private deniedTimer = 0;
  private last = { round: '', points: -1, ammo: '', weapon: '', status: '', prompt: '' };

  constructor() {
    const container = el('hud-floats');
    for (let i = 0; i < FLOAT_POOL; i++) {
      const f = document.createElement('div');
      f.className = 'float';
      container.appendChild(f);
      this.floats.push(f);
    }
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
  }

  reset(): void {
    this.last = { round: '', points: -1, ammo: '', weapon: '', status: '', prompt: '' };
    this.deniedTimer = 0;
    for (const f of this.floats) f.classList.remove('rise');
    this.damage.style.opacity = '0';
    this.setHint(null);
  }

  onEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'points': {
        const f = this.floats[this.nextFloat]!;
        this.nextFloat = (this.nextFloat + 1) % this.floats.length;
        f.textContent = `+${formatNumber(ev.amount)}`;
        f.style.left = `${Math.round(Math.random() * 40)}px`;
        restart(f, 'rise');
        break;
      }
      case 'hit':
        this.hitmarker.classList.toggle('kill', ev.killed);
        restart(this.hitmarker, 'show');
        break;
      case 'denied':
        this.deniedTimer = 1.2;
        break;
      case 'powerOn':
        this.showBanner(t('banner.powerOn'));
        break;
      case 'contenedorMoving':
        this.showBanner(t('banner.contenedorMoving'));
        break;
      case 'forjaReady':
        this.showBanner(t('banner.forjaReady', { weapon: weaponName(ev.weapon) }));
        break;
      case 'powerupPickup':
        this.showBanner(t(`powerup.${ev.kind}` as TextKey));
        break;
      case 'purchase':
        if (ev.what === 'perk') this.showBanner(t('banner.perk', { perk: perkName(ev.id) }));
        break;
      default:
        break;
    }
  }

  /** Aviso del tutorial, o null para ocultarlo. */
  setHint(text: string | null): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.hidden = text === null;
    // Al pasar de oculto a visible, el CSS repite su animación de entrada.
    if (text !== null) this.hint.textContent = text;
  }

  private showBanner(text: string): void {
    this.banner.textContent = text;
    restart(this.banner, 'show');
  }

  update(game: Game, dt: number): void {
    // Sueros activos.
    const perkKey = game.player.perks.join(',');
    if (perkKey !== this.lastPerks) {
      this.lastPerks = perkKey;
      this.perks.replaceChildren(
        ...game.player.perks.map((id) => {
          const span = document.createElement('span');
          span.textContent = perkName(id);
          span.style.background = PERK_COLOR[id] ?? '#ccc';
          return span;
        }),
      );
    }

    // Temporizadores de power-ups.
    const fx: string[] = [];
    for (const kind of ['bajaInstantanea', 'puntosDobles'] as const) {
      const left = game.effects[kind];
      if (left > 0) fx.push(`${left <= 5 ? '!' : ''}${t('hud.effect', { name: t(`powerup.${kind}`), seconds: Math.ceil(left) })}`);
    }
    const fxKey = fx.join('|');
    if (fxKey !== this.lastEffects) {
      this.lastEffects = fxKey;
      this.effects.replaceChildren(
        ...fx.map((line) => {
          const div = document.createElement('div');
          div.textContent = line.replace(/^!/, '');
          if (line.startsWith('!')) div.className = 'blink';
          return div;
        }),
      );
    }

    // Caído.
    const p = game.player;
    this.downed.hidden = !p.downed;
    if (p.downed) {
      const sa = game.cfg.perks.perks.segundoAliento;
      const left = sa ? sa.selfRevivesPerGame - p.selfRevivesUsed : 0;
      const text = t('downed.timer', { seconds: Math.ceil(p.downTimer), left });
      if (text !== this.lastDowned) this.downedTimer.textContent = this.lastDowned = text;
    }

    const r = game.round;

    const roundText =
      r.phase === 'break' ? `${t('hud.round', { round: r.number })} · ${t('hud.break', { seconds: Math.ceil(r.breakTimer) })}` : t('hud.round', { round: Math.max(1, r.number) });
    if (roundText !== this.last.round) this.round.textContent = this.last.round = roundText;

    if (p.points !== this.last.points) {
      this.points.textContent = formatNumber(p.points);
      this.last.points = p.points;
    }

    const slot = game.activeSlot();
    const ammo = slot ? `${slot.mag} / ${slot.reserve}` : '';
    if (ammo !== this.last.ammo) this.ammo.textContent = this.last.ammo = ammo;
    const wname = slot ? weaponName(slot.weapon) : '';
    if (wname !== this.last.weapon) this.weapon.textContent = this.last.weapon = wname;

    const status = p.reloadTimer > 0 ? t('hud.reloading') : slot && slot.mag + slot.reserve === 0 ? t('hud.noAmmo') : '';
    if (status !== this.last.status) this.status.textContent = this.last.status = status;

    this.deniedTimer = Math.max(0, this.deniedTimer - dt);
    let prompt = '';
    if (this.deniedTimer > 0) prompt = t('prompt.denied');
    else if (game.prompt) prompt = promptText(game.prompt);
    if (prompt !== this.last.prompt) {
      this.prompt.textContent = this.last.prompt = prompt;
      this.prompt.hidden = prompt === '';
      this.prompt.classList.toggle('denied', this.deniedTimer > 0);
    }

    // Borde de daño: más intenso cuanta menos vida queda.
    const missing = 1 - p.health / game.cfg.player.maxHealth;
    this.damage.style.opacity = missing > 0.01 ? String(Math.min(1, missing * 1.2)) : '0';
  }
}
