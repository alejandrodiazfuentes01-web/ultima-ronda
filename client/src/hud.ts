/**
 * Interfaz en partida, en HTML y CSS sobre el canvas. Los números flotantes
 * salen de una reserva fija de elementos (regla 5).
 */
import type { Game } from '../../shared/sim/game';
import type { Prompt, SimEvent } from '../../shared/sim/types';
import { formatNumber, perkName, t, weaponName } from './i18n';

const FLOAT_POOL = 12;

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
      default:
        break;
    }
  }

  update(game: Game, dt: number): void {
    const p = game.player;
    const r = game.round;

    const roundText =
      r.phase === 'break' ? `${t('hud.round', { round: r.number })} · ${t('hud.break', { seconds: Math.ceil(r.breakTimer) })}` : t('hud.round', { round: Math.max(1, r.number) });
    if (roundText !== this.last.round) this.round.textContent = this.last.round = roundText;

    if (p.points !== this.last.points) {
      this.points.textContent = formatNumber(p.points);
      this.last.points = p.points;
    }

    const slot = p.slots[p.current];
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
