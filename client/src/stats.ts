/**
 * Resumen de una partida para las pruebas con jugadores (GDD, «Pruebas con
 * jugadores»): cuándo compra por primera vez, cuánto dura cada ronda, puntos
 * ganados y gastados, puntería y qué le derribó. Solo se enseña con ?pruebas.
 */
import type { Game } from '../../shared/sim/game';
import { SIM_DT } from '../../shared/sim/fixedStep';
import type { SimEvent } from '../../shared/sim/types';

export interface RoundStat {
  round: number;
  seconds: number;
  kills: number;
}

export interface Purchase {
  what: string;
  id: string;
  round: number;
  seconds: number;
}

export interface Summary {
  roundReached: number;
  seconds: number;
  rounds: RoundStat[];
  earned: number;
  spent: number;
  purchases: Purchase[];
  shots: number;
  shotsThatHit: number;
  kills: number;
  headshotKills: number;
  hitsTaken: number;
  downs: number;
  /** Dónde estaba el Vacío del último golpe: dentro, en la ventana o null si nadie golpeó. */
  lastHitFrom: 'dentro' | 'ventana' | null;
  /** Zona del jugador al caer. */
  lastZone: 'vestibulo' | 'laboratorio' | null;
}

/** Límite entre zonas en x (el mismo que usa el render). */
const LAB_X = 12;

export class PlayStats {
  private readonly rounds: RoundStat[] = [];
  private readonly purchases: Purchase[] = [];
  private roundStartTick = 0;
  private roundKills = 0;
  private earned = 0;
  private spent = 0;
  private prevPoints: number | null = null;
  private shots = 0;
  private shotsThatHit = 0;
  private kills = 0;
  private headshotKills = 0;
  private hitsTaken = 0;
  private downs = 0;
  private lastHitFrom: Summary['lastHitFrom'] = null;
  private lastZone: Summary['lastZone'] = null;
  private roundReached = 0;
  private tick = 0;

  /** Llamar tras cada paso de simulación, con sus eventos. */
  onStep(game: Game): void {
    this.tick = game.tick;
    let earnedNow = 0;
    let shotNow = false;
    let hitNow = false;
    for (const ev of game.events) {
      this.onEvent(ev, game);
      if (ev.type === 'points') earnedNow += ev.amount;
      if (ev.type === 'shot') shotNow = true;
      if (ev.type === 'hit' && ev.enemy >= 0) hitNow = true;
    }
    if (shotNow && hitNow) this.shotsThatHit++;
    this.earned += earnedNow;
    const points = game.player.points;
    if (this.prevPoints !== null) {
      const drop = this.prevPoints + earnedNow - points;
      if (drop > 0) this.spent += drop;
    }
    this.prevPoints = points;
  }

  private onEvent(ev: SimEvent, game: Game): void {
    const now = game.tick * SIM_DT;
    switch (ev.type) {
      case 'roundStart':
        this.roundStartTick = game.tick;
        this.roundKills = 0;
        this.roundReached = ev.round;
        break;
      case 'roundEnd':
        this.rounds.push({ round: ev.round, seconds: Math.round((game.tick - this.roundStartTick) * SIM_DT), kills: this.roundKills });
        break;
      case 'shot':
        this.shots++;
        break;
      case 'hit':
        if (ev.killed) {
          this.kills++;
          this.roundKills++;
          if (ev.part === 'head') this.headshotKills++;
        }
        break;
      case 'purchase':
        this.purchases.push({ what: ev.what, id: ev.id, round: game.round.number, seconds: Math.round(now) });
        break;
      case 'playerHit': {
        this.hitsTaken++;
        const e = game.enemies[ev.enemy];
        this.lastHitFrom = e ? (e.phase === 'chasing' ? 'dentro' : 'ventana') : null;
        this.lastZone = game.player.pos.x < LAB_X ? 'vestibulo' : 'laboratorio';
        break;
      }
      case 'downed':
        this.downs++;
        break;
      default:
        break;
    }
  }

  summary(): Summary {
    return {
      roundReached: this.roundReached,
      seconds: Math.round(this.tick * SIM_DT),
      rounds: [...this.rounds],
      earned: this.earned,
      spent: this.spent,
      purchases: [...this.purchases],
      shots: this.shots,
      shotsThatHit: this.shotsThatHit,
      kills: this.kills,
      headshotKills: this.headshotKills,
      hitsTaken: this.hitsTaken,
      downs: this.downs,
      lastHitFrom: this.lastHitFrom,
      lastZone: this.lastZone,
    };
  }
}
