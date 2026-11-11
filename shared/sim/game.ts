/**
 * La partida. Avanza un paso fijo de 1/60 s cada vez que se llama a step().
 * No sabe nada de gráficos ni del navegador: el cliente, el jugador automático
 * y el futuro servidor la leen igual.
 */
import type { CrowdAgent } from '@recast-navigation/core';
import { enemySpeed, type GameConfig, type WeaponConfig } from '../config';
import { aliveCap, enemyCount, enemyHealth, spawnInterval } from '../rounds';
import { SIM_DT } from './fixedStep';
import { Navigation } from './nav';
import { EYE_HEIGHT, PLAYER_RADIUS, Physics } from './physics';
import { Rng } from './rng';
import type { HitPart, PlayerInput, Prompt, SimEvent, SimOptions, Vec3 } from './types';

/** Gravedad (física, no balance). */
const GRAVITY = 9.81;
/** Alcance máximo de una bala. */
const BULLET_RANGE = 100;
/** Distancia a la que el enemigo se para frente al jugador: suma de radios. */
const CONTACT_DISTANCE = 0.7;
/** Cada cuántos pasos recalculan los enemigos su destino. */
const RETARGET_TICKS = 10;

export type EnemyPhase = 'inactive' | 'approaching' | 'tearing' | 'climbing' | 'chasing';

export interface EnemyState {
  readonly index: number;
  phase: EnemyPhase;
  health: number;
  pos: Vec3;
  prevPos: Vec3;
  yaw: number;
  /** Ventana por la que entra. */
  window: number;
  /** Temporizador del estado actual (arrancar plancha, trepar). */
  timer: number;
  attackTimer: number;
  speed: number;
  agent: CrowdAgent | null;
  spawnTick: number;
}

export interface WeaponSlot {
  weapon: string;
  mag: number;
  reserve: number;
}

export interface PlayerState {
  pos: Vec3;
  prevPos: Vec3;
  vy: number;
  yaw: number;
  pitch: number;
  health: number;
  points: number;
  alive: boolean;
  slots: Array<WeaponSlot | null>;
  current: number;
  reloadTimer: number;
  switchTimer: number;
  fireCooldown: number;
  meleeCooldown: number;
  sinceDamage: number;
  repairTimer: number;
  grounded: boolean;
  sprinting: boolean;
}

export interface WindowState {
  planks: number;
  active: boolean;
}

export interface RoundState {
  number: number;
  phase: 'waiting' | 'active' | 'break' | 'over';
  toSpawn: number;
  alive: number;
  spawnTimer: number;
  breakTimer: number;
  repairPoints: number;
  kills: number;
}

export class Game {
  readonly cfg: GameConfig;
  readonly physics: Physics;
  readonly nav: Navigation;
  readonly player: PlayerState;
  readonly enemies: EnemyState[] = [];
  readonly windows: WindowState[];
  readonly doors: Array<{ open: boolean }>;
  readonly round: RoundState;
  /** Lo que ha pasado en el último paso. Se vacía al empezar cada paso. */
  readonly events: SimEvent[] = [];
  prompt: Prompt | null = null;
  tick = 0;

  private readonly rng: Rng;
  private readonly opts: Required<SimOptions>;
  private readonly openZones = new Set<string>();
  private prev = { fire: false, jump: false, use: false, melee: false, reload: false };

  constructor(cfg: GameConfig, options: SimOptions = {}) {
    this.cfg = cfg;
    this.opts = { seed: 1, invulnerable: false, damageScale: 1, autoRounds: true, ...options };
    this.rng = new Rng(this.opts.seed);
    const map = cfg.map;
    const pool = cfg.rounds.aliveCap.max;
    const [sx, sy, sz] = map.playerStart.position;
    const start = { x: sx, y: sy, z: sz };

    this.physics = new Physics(map, pool, start);
    this.nav = new Navigation(map, pool);

    for (const z of map.zones) if (z.startsOpen) this.openZones.add(z.id);
    this.windows = map.windows.map((w) => ({ planks: map.planksPerWindow, active: this.openZones.has(w.zone) }));
    this.doors = map.doors.map(() => ({ open: false }));

    const startWeapon = this.weapon(cfg.player.startWeapon);
    const slots: Array<WeaponSlot | null> = new Array<WeaponSlot | null>(cfg.player.weaponSlots).fill(null);
    slots[0] = { weapon: startWeapon.id, mag: startWeapon.magazine, reserve: startWeapon.reserve };
    this.player = {
      pos: { ...start },
      prevPos: { ...start },
      vy: 0,
      yaw: map.playerStart.yaw,
      pitch: 0,
      health: cfg.player.maxHealth,
      points: cfg.player.startPoints,
      alive: true,
      slots,
      current: 0,
      reloadTimer: 0,
      switchTimer: 0,
      fireCooldown: 0,
      meleeCooldown: 0,
      sinceDamage: 999,
      repairTimer: 0,
      grounded: true,
      sprinting: false,
    };

    for (let i = 0; i < pool; i++) {
      this.enemies.push({
        index: i,
        phase: 'inactive',
        health: 0,
        pos: { x: 0, y: -50, z: 0 },
        prevPos: { x: 0, y: -50, z: 0 },
        yaw: 0,
        window: 0,
        timer: 0,
        attackTimer: 0,
        speed: 0,
        agent: null,
        spawnTick: 0,
      });
    }

    this.round = { number: 0, phase: 'waiting', toSpawn: 0, alive: 0, spawnTimer: 0, breakTimer: 0, repairPoints: 0, kills: 0 };
    if (this.opts.autoRounds) this.startRound(1);
  }

  // ------------------------------------------------------------------ paso

  step(input: PlayerInput): void {
    this.events.length = 0;
    if (this.round.phase === 'over') return;
    this.tick++;

    const p = this.player;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    for (const e of this.enemies) {
      e.prevPos.x = e.pos.x;
      e.prevPos.y = e.pos.y;
      e.prevPos.z = e.pos.z;
    }

    this.updatePlayer(input);
    this.updateRounds();
    this.updateEnemies();
    this.physics.step();

    this.prev.fire = input.fire;
    this.prev.jump = input.jump;
    this.prev.use = input.use;
    this.prev.melee = input.melee;
    this.prev.reload = input.reload;
  }

  // ------------------------------------------------------------------ jugador

  private updatePlayer(input: PlayerInput): void {
    const p = this.player;
    const cp = this.cfg.player;
    p.yaw = input.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));

    // Vida: se regenera tras unos segundos sin recibir daño.
    p.sinceDamage += SIM_DT;
    if (p.sinceDamage >= cp.regenDelaySeconds) p.health = Math.min(cp.maxHealth, p.health + cp.regenPerSecond * SIM_DT);

    // Movimiento.
    const slot = p.slots[p.current];
    const mobility = slot ? this.weapon(slot.weapon).mobility : 1;
    let mx = input.moveX;
    let mz = input.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    p.sprinting = input.sprint && mz > 0.1;
    const speed = (p.sprinting ? cp.sprintSpeed : cp.walkSpeed) * mobility;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    let vx = (cos * mx - sin * mz) * speed;
    let vz = (-sin * mx - cos * mz) * speed;

    // Los enemigos empujan: no se puede atravesar la horda.
    for (const e of this.enemies) {
      if (e.phase !== 'chasing') continue;
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < CONTACT_DISTANCE) {
        const push = (CONTACT_DISTANCE - d) / SIM_DT;
        vx += (dx / d) * push;
        vz += (dz / d) * push;
      }
    }

    if (p.grounded && input.jump && !this.prev.jump) p.vy = Math.sqrt(2 * GRAVITY * cp.jumpHeight);
    p.vy -= GRAVITY * SIM_DT;
    const next = this.physics.movePlayer(p.pos, { x: vx * SIM_DT, y: p.vy * SIM_DT, z: vz * SIM_DT });
    p.pos.x = next.x;
    p.pos.y = next.y;
    p.pos.z = next.z;
    p.grounded = this.physics.isGrounded();
    if (p.grounded && p.vy < 0) p.vy = 0;

    this.updateWeapons(input);
    this.updateMelee(input);
    this.updateInteraction(input);
  }

  /** Coloca al jugador en un punto del suelo (pruebas y jugador automático). */
  teleportPlayer(x: number, z: number): void {
    const p = this.player;
    p.pos = { x, y: 0, z };
    p.prevPos = { x, y: 0, z };
    p.vy = 0;
    this.physics.teleportPlayer(p.pos);
    this.physics.step();
  }

  /** Dirección de la mirada. */
  lookDir(): Vec3 {
    const { yaw, pitch } = this.player;
    return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  }

  eye(): Vec3 {
    const p = this.player.pos;
    return { x: p.x, y: p.y + EYE_HEIGHT, z: p.z };
  }

  private weapon(id: string): WeaponConfig {
    const w = this.cfg.weapons[id];
    if (!w) throw new Error(`Arma desconocida: ${id}`);
    return w;
  }

  private updateWeapons(input: PlayerInput): void {
    const p = this.player;
    // Puede quedar hasta un paso por debajo de 0: así la fracción sobrante pasa al siguiente disparo
    // y la cadencia real no se redondea a los 60 pasos por segundo.
    p.fireCooldown = Math.max(-SIM_DT, p.fireCooldown - SIM_DT);
    p.switchTimer = Math.max(0, p.switchTimer - SIM_DT);

    // Cambio de arma.
    let target = input.selectSlot;
    if (target === null && input.cycleWeapon !== 0) {
      const n = p.slots.length;
      for (let k = 1; k < n; k++) {
        const s = (p.current + input.cycleWeapon * k + n * k) % n;
        if (p.slots[s]) {
          target = s;
          break;
        }
      }
    }
    if (target !== null && target !== p.current && p.slots[target]) {
      p.current = target;
      p.switchTimer = this.cfg.player.weaponSwitchSeconds;
      p.reloadTimer = 0;
    }

    const slot = p.slots[p.current];
    if (!slot) return;
    const w = this.weapon(slot.weapon);

    // Recarga en curso.
    if (p.reloadTimer > 0) {
      p.reloadTimer -= SIM_DT;
      if (p.reloadTimer <= 0) {
        p.reloadTimer = 0;
        const take = Math.min(w.magazine - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }

    const pressed = input.fire && !this.prev.fire;
    if (input.reload && !this.prev.reload) this.startReload(slot, w);

    const wantsFire = w.fireMode === 'auto' ? input.fire : pressed;
    if (!wantsFire || p.switchTimer > 0 || p.reloadTimer > 0 || p.fireCooldown > 0) return;
    if (slot.mag <= 0) {
      if (slot.reserve > 0) this.startReload(slot, w);
      else if (pressed) this.events.push({ type: 'dryFire', weapon: w.id });
      return;
    }
    slot.mag--;
    p.fireCooldown = Math.max(p.fireCooldown, -SIM_DT) + 60 / w.rpm;
    this.events.push({ type: 'shot', weapon: w.id });
    const eye = this.eye();
    const dir = this.lookDir();
    for (let i = 0; i < w.pellets; i++) {
      const hit = this.physics.raycast(eye, dir, BULLET_RANGE);
      if (hit && hit.enemy >= 0 && hit.part) {
        const mult = hit.part === 'head' ? this.cfg.player.headMultiplier : hit.part === 'limb' ? this.cfg.player.limbMultiplier : 1;
        this.damageEnemy(hit.enemy, w.damage * mult * this.opts.damageScale, hit.part);
      }
    }
  }

  private startReload(slot: WeaponSlot, w: WeaponConfig): void {
    const p = this.player;
    if (p.reloadTimer > 0 || slot.mag >= w.magazine || slot.reserve <= 0) return;
    p.reloadTimer = w.reloadSeconds;
    this.events.push({ type: 'reloadStart', weapon: w.id });
  }

  private updateMelee(input: PlayerInput): void {
    const p = this.player;
    const m = this.cfg.player.melee;
    p.meleeCooldown = Math.max(0, p.meleeCooldown - SIM_DT);
    if (!input.melee || this.prev.melee || p.meleeCooldown > 0) return;
    p.meleeCooldown = m.cooldownSeconds;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let best = -1;
    let bestD = m.range;
    for (const e of this.enemies) {
      if (e.phase === 'inactive') continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(e.pos.y - p.pos.y) > 1.5) continue;
      if (d > 0.01 && (dx * fx + dz * fz) / d < 0.5) continue;
      best = e.index;
      bestD = d;
    }
    this.events.push({ type: 'melee', hit: best >= 0 });
    if (best >= 0) this.damageEnemy(best, m.damage * this.opts.damageScale, 'melee');
  }

  private updateInteraction(input: PlayerInput): void {
    const p = this.player;
    const map = this.cfg.map;
    const range = this.cfg.player.useRange;
    const pressed = input.use && !this.prev.use;
    let best: { d: number; act: () => void; prompt: Prompt; repair?: number } | null = null;
    const consider = (x: number, z: number, prompt: Prompt, act: () => void, repair?: number) => {
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d <= range && (!best || d < best.d)) best = repair === undefined ? { d, act, prompt } : { d, act, prompt, repair };
    };

    map.windows.forEach((w, i) => {
      const ws = this.windows[i]!;
      if (ws.active && ws.planks < map.planksPerWindow) consider(w.inside[0], w.inside[1], { kind: 'repair' }, () => {}, i);
    });
    map.wallBuys.forEach((b) => {
      const owned = p.slots.find((s) => s?.weapon === b.weapon);
      if (owned) {
        const cost = Math.round(b.cost * this.cfg.economy.ammoCostFactor);
        consider(b.anchor[0], b.anchor[1], { kind: 'buyAmmo', weapon: b.weapon, cost }, () => this.buyAmmo(owned, cost));
      } else {
        consider(b.anchor[0], b.anchor[1], { kind: 'buyWeapon', weapon: b.weapon, cost: b.cost }, () => this.buyWeapon(b.weapon, b.cost));
      }
    });
    map.doors.forEach((d, i) => {
      if (this.doors[i]!.open) return;
      for (const a of d.anchors) consider(a[0], a[1], { kind: 'openDoor', cost: d.cost }, () => this.openDoor(i));
    });

    const chosen = best as { d: number; act: () => void; prompt: Prompt; repair?: number } | null;
    this.prompt = chosen ? chosen.prompt : null;

    if (chosen?.repair !== undefined && input.use) {
      p.repairTimer += SIM_DT;
      if (p.repairTimer >= this.cfg.player.repairSecondsPerPlank) {
        p.repairTimer = 0;
        this.repairWindow(chosen.repair);
      }
    } else {
      p.repairTimer = 0;
      if (chosen && pressed) chosen.act();
    }
  }

  private repairWindow(i: number): void {
    const ws = this.windows[i]!;
    if (ws.planks >= this.cfg.map.planksPerWindow) return;
    ws.planks++;
    this.events.push({ type: 'plankRepaired', window: i });
    const eco = this.cfg.economy;
    if (this.round.repairPoints + eco.repairPlank <= eco.repairCapPerRound) {
      this.round.repairPoints += eco.repairPlank;
      this.addPoints(eco.repairPlank);
    }
  }

  /** Cobra si hay saldo. Devuelve false y avisa si no lo hay. */
  private pay(cost: number): boolean {
    if (this.player.points < cost) {
      this.events.push({ type: 'denied', cost });
      return false;
    }
    this.player.points -= cost;
    return true;
  }

  private buyWeapon(id: string, cost: number): void {
    if (!this.pay(cost)) return;
    const p = this.player;
    const w = this.weapon(id);
    let slot = p.slots.findIndex((s) => s === null);
    if (slot < 0) slot = p.current;
    p.slots[slot] = { weapon: id, mag: w.magazine, reserve: w.reserve };
    p.current = slot;
    p.switchTimer = this.cfg.player.weaponSwitchSeconds;
    p.reloadTimer = 0;
    this.events.push({ type: 'purchase', what: 'weapon', id });
  }

  private buyAmmo(slot: WeaponSlot, cost: number): void {
    const w = this.weapon(slot.weapon);
    if (slot.mag >= w.magazine && slot.reserve >= w.reserve) return;
    if (!this.pay(cost)) return;
    slot.mag = w.magazine;
    slot.reserve = w.reserve;
    this.events.push({ type: 'purchase', what: 'ammo', id: w.id });
  }

  private openDoor(i: number): void {
    const d = this.cfg.map.doors[i]!;
    if (this.doors[i]!.open || !this.pay(d.cost)) return;
    this.doors[i]!.open = true;
    this.physics.openDoor(i);
    this.openZones.add(d.opensZone);
    this.cfg.map.windows.forEach((w, wi) => {
      if (w.zone === d.opensZone) this.windows[wi]!.active = true;
    });
    this.events.push({ type: 'purchase', what: 'door', id: d.id });
  }

  private addPoints(n: number): void {
    if (n <= 0) return;
    this.player.points += n;
    this.events.push({ type: 'points', amount: n });
  }

  private hurtPlayer(): void {
    const p = this.player;
    if (!p.alive || this.opts.invulnerable) return;
    p.health = Math.max(0, p.health - this.cfg.enemies.hitDamage);
    p.sinceDamage = 0;
    this.events.push({ type: 'playerHit', health: p.health });
    if (p.health <= 0) {
      p.alive = false;
      this.round.phase = 'over';
      this.events.push({ type: 'gameOver', round: this.round.number });
    }
  }

  // ------------------------------------------------------------------ rondas

  startRound(n: number): void {
    const r = this.round;
    r.number = n;
    r.phase = 'active';
    r.toSpawn = enemyCount(n, this.cfg.rounds);
    r.spawnTimer = 0;
    r.repairPoints = 0;
    this.events.push({ type: 'roundStart', round: n });
  }

  private updateRounds(): void {
    const r = this.round;
    if (r.phase === 'break') {
      r.breakTimer -= SIM_DT;
      if (r.breakTimer <= 0) this.startRound(r.number + 1);
      return;
    }
    if (r.phase !== 'active') return;
    if (r.toSpawn > 0) {
      r.spawnTimer -= SIM_DT;
      if (r.spawnTimer <= 0 && r.alive < aliveCap(1, this.cfg.rounds)) {
        if (this.spawnEnemy()) {
          r.toSpawn--;
          r.spawnTimer = spawnInterval(r.number, this.cfg.rounds);
        }
      }
    } else if (r.alive === 0) {
      r.phase = 'break';
      r.breakTimer = this.cfg.rounds.breakSeconds;
      this.events.push({ type: 'roundEnd', round: r.number });
    }
  }

  // ------------------------------------------------------------------ enemigos

  /** Saca un enemigo de la reserva en una ventana al azar de una zona abierta. */
  spawnEnemy(windowIndex?: number): EnemyState | null {
    const e = this.enemies.find((x) => x.phase === 'inactive');
    if (!e) return null;
    let wi = windowIndex;
    if (wi === undefined) {
      const open: number[] = [];
      this.windows.forEach((w, i) => {
        if (w.active) open.push(i);
      });
      wi = open[this.rng.int(open.length)]!;
    }
    const w = this.cfg.map.windows[wi]!;
    const round = Math.max(1, this.round.number);
    e.phase = 'approaching';
    e.window = wi;
    e.health = enemyHealth(round, this.cfg.rounds);
    e.speed = enemySpeed(round, this.cfg.enemies);
    e.pos = { x: w.spawn[0], y: 0, z: w.spawn[1] };
    e.prevPos = { ...e.pos };
    e.timer = 0;
    e.attackTimer = this.cfg.enemies.attackIntervalSeconds * 0.5;
    e.spawnTick = this.tick;
    this.round.alive++;
    this.physics.setEnemy(e.index, true, e.pos);
    this.events.push({ type: 'enemySpawned', enemy: e.index });
    return e;
  }

  private damageEnemy(i: number, amount: number, part: HitPart | 'melee'): void {
    const e = this.enemies[i]!;
    if (e.phase === 'inactive') return;
    e.health -= amount;
    const hitPart: HitPart = part === 'melee' ? 'torso' : part;
    const eco = this.cfg.economy;
    if (e.health > 0) {
      this.events.push({ type: 'hit', enemy: i, part: hitPart, killed: false });
      this.addPoints(eco.hit);
      return;
    }
    this.events.push({ type: 'hit', enemy: i, part: hitPart, killed: true });
    this.addPoints(part === 'melee' ? eco.killMelee : part === 'head' ? eco.killHead : eco.killBody);
    this.removeEnemy(e);
    this.round.kills++;
  }

  private removeEnemy(e: EnemyState): void {
    if (e.agent) {
      this.nav.removeAgent(e.agent);
      e.agent = null;
    }
    e.phase = 'inactive';
    e.health = 0;
    this.round.alive--;
    this.physics.setEnemy(e.index, false);
  }

  private updateEnemies(): void {
    const ec = this.cfg.enemies;
    const map = this.cfg.map;
    const p = this.player;
    let anyAgents = false;

    for (const e of this.enemies) {
      if (e.phase === 'inactive') continue;
      const w = map.windows[e.window]!;
      const ws = this.windows[e.window]!;

      if (e.phase === 'approaching') {
        const dx = w.outside[0] - e.pos.x;
        const dz = w.outside[1] - e.pos.z;
        const d = Math.hypot(dx, dz);
        const stepLen = e.speed * SIM_DT;
        if (d <= stepLen) {
          e.pos.x = w.outside[0];
          e.pos.z = w.outside[1];
          e.phase = 'tearing';
          e.timer = ec.plankTearSeconds;
        } else {
          e.pos.x += (dx / d) * stepLen;
          e.pos.z += (dz / d) * stepLen;
          e.yaw = Math.atan2(-dx, -dz);
        }
      } else if (e.phase === 'tearing') {
        this.faceWindow(e, w.inside);
        if (ws.planks > 0) {
          e.timer -= SIM_DT;
          if (e.timer <= 0) {
            ws.planks--;
            e.timer = ec.plankTearSeconds;
            this.events.push({ type: 'plankTorn', window: e.window });
          }
        } else {
          e.phase = 'climbing';
          e.timer = ec.climbSeconds;
        }
      } else if (e.phase === 'climbing') {
        e.timer -= SIM_DT;
        const t = Math.min(1, 1 - e.timer / ec.climbSeconds);
        e.pos.x = w.outside[0] + (w.inside[0] - w.outside[0]) * t;
        e.pos.z = w.outside[1] + (w.inside[1] - w.outside[1]) * t;
        e.pos.y = Math.sin(Math.PI * t) * map.sillHeight;
        if (e.timer <= 0) {
          e.pos.y = 0;
          e.phase = 'chasing';
          e.agent = this.nav.addAgent(e.pos, e.speed);
          this.retarget(e);
          this.events.push({ type: 'enemyEntered', enemy: e.index });
        }
      } else if (e.phase === 'chasing' && e.agent) {
        anyAgents = true;
        if ((this.tick + e.index) % RETARGET_TICKS === 0) this.retarget(e);
      }

      // Ataque: si el jugador está al alcance, también a través de la ventana.
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const inRange = Math.hypot(dx, dz) <= ec.attackRange && Math.abs(p.pos.y - e.pos.y) < 1.2;
      if (inRange && e.phase !== 'climbing') {
        e.yaw = Math.atan2(-dx, -dz);
        e.attackTimer -= SIM_DT;
        if (e.attackTimer <= 0) {
          e.attackTimer = ec.attackIntervalSeconds;
          this.hurtPlayer();
          if (this.round.phase === 'over') return;
        }
      } else {
        e.attackTimer = ec.attackIntervalSeconds * 0.5;
      }
    }

    if (anyAgents) {
      this.nav.update(SIM_DT);
      for (const e of this.enemies) {
        if (e.phase !== 'chasing' || !e.agent) continue;
        const a = e.agent.position();
        const v = e.agent.velocity();
        e.pos.x = a.x;
        e.pos.z = a.z;
        e.pos.y = 0;
        if (Math.hypot(v.x, v.z) > 0.3) e.yaw = Math.atan2(-v.x, -v.z);
      }
    }

    for (const e of this.enemies) if (e.phase !== 'inactive') this.physics.setEnemy(e.index, true, e.pos);
  }

  private faceWindow(e: EnemyState, inside: [number, number]): void {
    e.yaw = Math.atan2(-(inside[0] - e.pos.x), -(inside[1] - e.pos.z));
  }

  /** El enemigo va hacia el jugador y se para al tocarlo. */
  private retarget(e: EnemyState): void {
    if (!e.agent) return;
    const p = this.player.pos;
    const dx = e.pos.x - p.x;
    const dz = e.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const off = d > 0.01 ? CONTACT_DISTANCE / d : 0;
    e.agent.requestMoveTarget(this.nav.closest({ x: p.x + dx * off, y: 0, z: p.z + dz * off }));
  }

  /** Radio del jugador, para quien dibuja. */
  static readonly playerRadius = PLAYER_RADIUS;

  free(): void {
    this.nav.free();
    this.physics.free();
  }
}
