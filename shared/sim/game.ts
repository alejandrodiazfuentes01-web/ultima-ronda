/**
 * La partida. Avanza un paso fijo de 1/60 s cada vez que se llama a step().
 * No sabe nada de gráficos ni del navegador: el cliente, el jugador automático
 * y el futuro servidor la leen igual.
 */
import type { CrowdAgent } from '@recast-navigation/core';
import { enemySpeed, type GameConfig, type PowerupKind, type WeaponConfig } from '../config';
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
/** Huecos para power-ups en el suelo a la vez. */
const PICKUP_POOL = 8;
/** Altura del pecho de un Vacío, para dibujar el arco del Arco voltaico. */
const CHEST_HEIGHT = 1.2;

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
  /** Personalidad, fijada al aparecer: anticipación, balanceo lateral y su ritmo. */
  lead: number;
  sway: number;
  swayFreq: number;
  swayPhase: number;
}

export interface WeaponSlot {
  weapon: string;
  mag: number;
  reserve: number;
  /** Mejorada en La Forja. */
  upgraded: boolean;
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
  /** Velocidad horizontal actual (con inercia). */
  vel: { x: number; z: number };
  /** Aguante para esprintar, de 0 a 1. */
  stamina: number;
  sinceSprint: number;
  /** Tiempo que falta para poder disparar tras esprintar. */
  sprintFireDelay: number;
  /** Sueros activos, por orden de compra. */
  perks: string[];
  /** Caído y levantándose solo (Segundo aliento). */
  downed: boolean;
  downTimer: number;
  selfRevivesUsed: number;
  /** Arma que se usa mientras está caído. */
  downedSlot: WeaponSlot | null;
  /** Segundos de protección que quedan tras levantarse. */
  protectTimer: number;
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
  powerupsDropped: number;
}

export interface ContenedorState {
  spot: number;
  phase: 'idle' | 'spinning' | 'offering' | 'moving';
  timer: number;
  /** Arma que sale (se decide al pagar; el cliente la descubre al acabar el giro). */
  weapon: string | null;
  uses: number;
  movesAfter: number;
}

export interface ForjaState {
  phase: 'idle' | 'working' | 'ready';
  timer: number;
  slot: WeaponSlot | null;
}

export interface PickupState {
  active: boolean;
  kind: PowerupKind;
  x: number;
  z: number;
  timer: number;
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
  readonly contenedor: ContenedorState;
  readonly forja: ForjaState = { phase: 'idle', timer: 0, slot: null };
  readonly pickups: PickupState[] = [];
  /** Segundos que quedan de cada efecto de power-up. */
  readonly effects = { bajaInstantanea: 0, puntosDobles: 0 };
  /** Lo que ha pasado en el último paso. Se vacía al empezar cada paso. */
  readonly events: SimEvent[] = [];
  power = false;
  prompt: Prompt | null = null;
  tick = 0;

  private readonly rng: Rng;
  private readonly opts: Required<SimOptions>;
  private readonly openZones = new Set<string>();
  private prev = { fire: false, jump: false, use: false, melee: false, reload: false };

  constructor(cfg: GameConfig, options: SimOptions = {}) {
    this.cfg = cfg;
    this.opts = {
      seed: 1,
      invulnerable: false,
      damageScale: 1,
      autoRounds: true,
      startRound: 1,
      startPoints: cfg.player.startPoints,
      ...options,
    };
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

    const slots: Array<WeaponSlot | null> = new Array<WeaponSlot | null>(cfg.player.weaponSlots).fill(null);
    slots[0] = this.freshSlot(cfg.player.startWeapon);
    this.player = {
      pos: { ...start },
      prevPos: { ...start },
      vy: 0,
      yaw: map.playerStart.yaw,
      pitch: 0,
      health: cfg.player.maxHealth,
      points: this.opts.startPoints,
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
      vel: { x: 0, z: 0 },
      stamina: 1,
      sinceSprint: 999,
      sprintFireDelay: 0,
      perks: [],
      downed: false,
      downTimer: 0,
      selfRevivesUsed: 0,
      downedSlot: null,
      protectTimer: 0,
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
        lead: 0,
        sway: 0,
        swayFreq: 0,
        swayPhase: 0,
      });
    }
    for (let i = 0; i < PICKUP_POOL; i++) this.pickups.push({ active: false, kind: 'municionCompleta', x: 0, z: 0, timer: 0 });

    this.contenedor = { spot: 0, phase: 'idle', timer: 0, weapon: null, uses: 0, movesAfter: this.rollMovesAfter() };

    this.round = { number: 0, phase: 'waiting', toSpawn: 0, alive: 0, spawnTimer: 0, breakTimer: 0, repairPoints: 0, kills: 0, powerupsDropped: 0 };
    if (this.opts.autoRounds) this.startRound(Math.max(1, Math.floor(this.opts.startRound)));
  }

  // ------------------------------------------------------------------ paso

  step(input: PlayerInput): void {
    // Los eventos del arranque (empieza la ronda 1) se conservan hasta después del primer paso.
    if (this.tick > 0) this.events.length = 0;
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
    this.updateMachines();
    this.updatePowerups();
    this.updateRounds();
    this.updateEnemies();
    this.physics.step();

    this.prev.fire = input.fire;
    this.prev.jump = input.jump;
    this.prev.use = input.use;
    this.prev.melee = input.melee;
    this.prev.reload = input.reload;
  }

  // ------------------------------------------------------------------ armas: capacidades

  private weapon(id: string): WeaponConfig {
    const w = this.cfg.weapons[id];
    if (!w) throw new Error(`Arma desconocida: ${id}`);
    return w;
  }

  private freshSlot(id: string): WeaponSlot {
    const w = this.weapon(id);
    return { weapon: id, mag: w.magazine, reserve: w.reserve, upgraded: false };
  }

  /** Cargador máximo del arma, con la mejora de La Forja si la tiene. */
  magazineOf(slot: WeaponSlot): number {
    const base = this.weapon(slot.weapon).magazine;
    return slot.upgraded ? Math.round(base * this.cfg.forja.magazineMultiplier) : base;
  }

  /** Reserva máxima del arma, con la mejora de La Forja si la tiene. */
  reserveOf(slot: WeaponSlot): number {
    const base = this.weapon(slot.weapon).reserve;
    return slot.upgraded ? Math.round(base * this.cfg.forja.reserveMultiplier) : base;
  }

  private fill(slot: WeaponSlot): void {
    slot.mag = this.magazineOf(slot);
    slot.reserve = this.reserveOf(slot);
  }

  /** El arma que el jugador tiene en la mano ahora (la de caído, si está caído). */
  activeSlot(): WeaponSlot | null {
    const p = this.player;
    return p.downed ? p.downedSlot : (p.slots[p.current] ?? null);
  }

  /** Vida máxima con los sueros activos. */
  maxHealth(): number {
    let h = this.cfg.player.maxHealth;
    for (const id of this.player.perks) h *= this.cfg.perks.perks[id]?.healthMultiplier ?? 1;
    return h;
  }

  // ------------------------------------------------------------------ jugador

  private updatePlayer(input: PlayerInput): void {
    const p = this.player;
    const cp = this.cfg.player;
    p.yaw = input.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));

    p.protectTimer = Math.max(0, p.protectTimer - SIM_DT);
    if (p.downed) {
      p.downTimer -= SIM_DT;
      if (p.downTimer <= 0) this.revive();
    }

    // Vida: se regenera tras unos segundos sin recibir daño.
    p.sinceDamage += SIM_DT;
    const maxHealth = this.maxHealth();
    if (!p.downed && p.sinceDamage >= cp.regenDelaySeconds) p.health = Math.min(maxHealth, p.health + cp.regenPerSecond * SIM_DT);

    // Movimiento. Caído, se arrastra despacio.
    const slot = this.activeSlot();
    const mobility = slot ? this.weapon(slot.weapon).mobility : 1;
    let mx = input.moveX;
    let mz = input.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    // Sprint con aguante: se gasta esprintando y se recupera tras un momento sin esprintar.
    const sc = cp.sprint;
    const wantsSprint = !p.downed && input.sprint && mz > 0.1;
    const wasSprinting = p.sprinting;
    p.sprinting = wantsSprint && (wasSprinting ? p.stamina > 0 : p.stamina >= sc.minToStart);
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - SIM_DT / sc.maxSeconds);
      p.sinceSprint = 0;
      if (p.stamina === 0) this.events.push({ type: 'exhausted' });
    } else {
      p.sinceSprint += SIM_DT;
      if (p.sinceSprint >= sc.recoverDelaySeconds) p.stamina = Math.min(1, p.stamina + SIM_DT / sc.recoverSeconds);
    }
    if (wasSprinting && !p.sprinting) p.sprintFireDelay = sc.fireDelaySeconds;
    p.sprintFireDelay = Math.max(0, p.sprintFireDelay - SIM_DT);

    const speed = p.downed ? cp.crawlSpeed : (p.sprinting ? cp.sprintSpeed : cp.walkSpeed) * mobility;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const tx = (cos * mx - sin * mz) * speed;
    const tz = (-sin * mx - cos * mz) * speed;

    // Inercia: la velocidad se acerca a la deseada sin saltos.
    const dvx = tx - p.vel.x;
    const dvz = tz - p.vel.z;
    const dv = Math.hypot(dvx, dvz);
    const accelerating = Math.hypot(tx, tz) >= Math.hypot(p.vel.x, p.vel.z);
    const maxDv = (accelerating ? cp.acceleration : cp.deceleration) * SIM_DT;
    if (dv > maxDv) {
      p.vel.x += (dvx / dv) * maxDv;
      p.vel.z += (dvz / dv) * maxDv;
    } else {
      p.vel.x = tx;
      p.vel.z = tz;
    }
    let vx = p.vel.x;
    let vz = p.vel.z;

    // Los enemigos son sólidos: no se puede atravesar la horda. Si el jugador va hacia
    // un Vacío que toca, ese movimiento se anula; si se ha metido dentro, sale hacia fuera.
    for (let pass = 0; pass < 2; pass++) {
      for (const e of this.enemies) {
        if (e.phase !== 'chasing') continue;
        const dx = p.pos.x - e.pos.x;
        const dz = p.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.001 || d >= CONTACT_DISTANCE + 0.05) continue;
        const nx = dx / d;
        const nz = dz / d;
        const into = vx * nx + vz * nz;
        if (into < 0) {
          vx -= into * nx;
          vz -= into * nz;
        }
        // La velocidad guardada tampoco empuja contra el Vacío.
        const intoKept = p.vel.x * nx + p.vel.z * nz;
        if (intoKept < 0) {
          p.vel.x -= intoKept * nx;
          p.vel.z -= intoKept * nz;
        }
        if (pass === 0 && d < CONTACT_DISTANCE) {
          const push = (CONTACT_DISTANCE - d) / SIM_DT;
          vx += nx * push;
          vz += nz * push;
        }
      }
    }

    if (!p.downed && p.grounded && input.jump && !this.prev.jump) p.vy = Math.sqrt(2 * GRAVITY * cp.jumpHeight);
    // Apoyado en el suelo no se empuja contra él (el controlador ya lo mantiene pegado);
    // la gravedad actúa en el aire.
    if (!p.grounded || p.vy > 0) p.vy -= GRAVITY * SIM_DT;
    const next = this.physics.movePlayer(p.pos, { x: vx * SIM_DT, y: p.vy * SIM_DT, z: vz * SIM_DT });
    p.pos.x = next.x;
    p.pos.y = next.y;
    p.pos.z = next.z;
    const wasGrounded = p.grounded;
    const fallSpeed = -p.vy;
    p.grounded = this.physics.isGrounded();
    if (p.grounded && !wasGrounded && fallSpeed > 2) this.events.push({ type: 'landed', speed: fallSpeed });
    if (p.grounded && p.vy < 0) p.vy = 0;

    this.updateWeapons(input);
    if (!p.downed) {
      this.updateMelee(input);
      this.updateInteraction(input);
    } else {
      this.prompt = null;
    }
  }

  /** Coloca al jugador en un punto del suelo (pruebas y jugador automático). */
  teleportPlayer(x: number, z: number): void {
    const p = this.player;
    p.pos = { x, y: 0, z };
    p.prevPos = { x, y: 0, z };
    p.vy = 0;
    p.vel.x = 0;
    p.vel.z = 0;
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

  private updateWeapons(input: PlayerInput): void {
    const p = this.player;
    // Puede quedar hasta un paso por debajo de 0: así la fracción sobrante pasa al siguiente disparo
    // y la cadencia real no se redondea a los 60 pasos por segundo.
    p.fireCooldown = Math.max(-SIM_DT, p.fireCooldown - SIM_DT);
    p.switchTimer = Math.max(0, p.switchTimer - SIM_DT);

    // Cambio de arma (no mientras se está caído).
    let target = p.downed ? null : input.selectSlot;
    if (!p.downed && target === null && input.cycleWeapon !== 0) {
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

    const slot = this.activeSlot();
    if (!slot) return;
    const w = this.weapon(slot.weapon);

    // Recarga en curso.
    if (p.reloadTimer > 0) {
      p.reloadTimer -= SIM_DT;
      if (p.reloadTimer <= 0) {
        p.reloadTimer = 0;
        const take = Math.min(this.magazineOf(slot) - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }

    const pressed = input.fire && !this.prev.fire;
    if (input.reload && !this.prev.reload) this.startReload(slot, w);

    const wantsFire = w.fireMode === 'auto' ? input.fire : pressed;
    // Esprintando el arma va bajada: no se dispara hasta un instante después de parar.
    if (!wantsFire || p.switchTimer > 0 || p.reloadTimer > 0 || p.fireCooldown > 0 || p.sprinting || p.sprintFireDelay > 0) return;
    if (slot.mag <= 0) {
      if (slot.reserve > 0) this.startReload(slot, w);
      else if (pressed) this.events.push({ type: 'dryFire', weapon: w.id });
      return;
    }
    slot.mag--;
    p.fireCooldown = Math.max(p.fireCooldown, -SIM_DT) + 60 / w.rpm;
    this.events.push({ type: 'shot', weapon: w.id, upgraded: slot.upgraded });
    this.fire(w, slot.upgraded);
  }

  /** Un disparo: rayo que puede atravesar enemigos y, con el Arco voltaico, saltar entre ellos. */
  private fire(w: WeaponConfig, upgraded: boolean): void {
    const eye = this.eye();
    const dir = this.lookDir();
    const damage = w.damage * (upgraded ? this.cfg.forja.damageMultiplier : 1) * this.opts.damageScale;
    for (let i = 0; i < w.pellets; i++) {
      const hits = this.physics.raycastPierce(eye, dir, BULLET_RANGE, w.penetration);
      for (const hit of hits) {
        if (!hit.part) continue;
        const mult = hit.part === 'head' ? this.cfg.player.headMultiplier : hit.part === 'limb' ? this.cfg.player.limbMultiplier : 1;
        const first = this.enemies[hit.enemy]!;
        const from = { x: first.pos.x, y: first.pos.y + CHEST_HEIGHT, z: first.pos.z };
        this.damageEnemy(hit.enemy, damage * mult, hit.part, upgraded);
        if (w.chain) this.chainFrom(hit.enemy, from, damage, w.chain.targets - 1, w.chain.range, upgraded);
      }
    }
  }

  /** Daño en cadena: salta al enemigo más cercano que no haya recibido ya la descarga. */
  private chainFrom(first: number, start: Vec3, damage: number, jumps: number, range: number, upgraded: boolean): void {
    const hit = new Set<number>([first]);
    let from = start;
    for (let j = 0; j < jumps; j++) {
      let best = -1;
      let bestD = range;
      for (const e of this.enemies) {
        if (e.phase === 'inactive' || hit.has(e.index)) continue;
        const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
        if (d <= bestD) {
          bestD = d;
          best = e.index;
        }
      }
      if (best < 0) return;
      const e = this.enemies[best]!;
      const to = { x: e.pos.x, y: e.pos.y + CHEST_HEIGHT, z: e.pos.z };
      this.events.push({ type: 'chain', from, to });
      hit.add(best);
      this.damageEnemy(best, damage, 'torso', upgraded);
      from = to;
    }
  }

  private startReload(slot: WeaponSlot, w: WeaponConfig): void {
    const p = this.player;
    if (p.reloadTimer > 0 || slot.mag >= this.magazineOf(slot) || slot.reserve <= 0) return;
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
    if (best >= 0) this.damageEnemy(best, m.damage * this.opts.damageScale, 'melee', false);
  }

  // ------------------------------------------------------------------ interacción y compras

  private updateInteraction(input: PlayerInput): void {
    const p = this.player;
    const map = this.cfg.map;
    const range = this.cfg.player.useRange;
    const pressed = input.use && !this.prev.use;
    type Option = { d: number; act: () => void; prompt: Prompt; repair?: number };
    let best: Option | null = null;
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

    // Energía.
    if (!this.power) consider(map.powerSwitch.anchor[0], map.powerSwitch.anchor[1], { kind: 'powerSwitch' }, () => this.turnPowerOn());

    // Sueros.
    for (const st of map.perkStations) {
      const perk = this.cfg.perks.perks[st.perk]!;
      if (p.perks.includes(st.perk) || !this.perkStationOn(st.perk)) continue;
      const [x, z] = st.anchor;
      if (perk.needsPower && !this.power) consider(x, z, { kind: 'needPower' }, () => {});
      else if (p.perks.length >= this.cfg.perks.maxPerks) consider(x, z, { kind: 'perkFull' }, () => {});
      else consider(x, z, { kind: 'buyPerk', perk: st.perk, cost: perk.cost }, () => this.buyPerk(st.perk, perk.cost));
    }

    // El Contenedor.
    const box = this.contenedor;
    const spot = map.contenedorSpots[box.spot]!;
    if (box.phase === 'idle') {
      consider(spot.anchor[0], spot.anchor[1], { kind: 'buyContenedor', cost: this.cfg.contenedor.cost }, () => this.openContenedor());
    } else if (box.phase === 'offering' && box.weapon) {
      const weapon = box.weapon;
      consider(spot.anchor[0], spot.anchor[1], { kind: 'takeWeapon', weapon }, () => this.takeContenedorWeapon());
    }

    // La Forja.
    const forja = this.forja;
    const [fx, fz] = map.forja.anchor;
    const held = p.slots[p.current];
    if (forja.phase === 'ready' && forja.slot) {
      const weapon = forja.slot.weapon;
      consider(fx, fz, { kind: 'takeForged', weapon }, () => this.takeForged());
    } else if (forja.phase === 'idle') {
      if (this.cfg.forja.needsPower && !this.power) consider(fx, fz, { kind: 'needPower' }, () => {});
      else if (held && !held.upgraded) {
        consider(fx, fz, { kind: 'forja', weapon: held.weapon, cost: this.cfg.forja.cost }, () => this.startForja());
      }
    }

    const chosen = best as Option | null;
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

  /** Mete un arma en una ranura libre o, si no hay, en lugar de la que se lleva en la mano. */
  private giveWeapon(slot: WeaponSlot, prefer?: number): void {
    const p = this.player;
    let i = prefer !== undefined && p.slots[prefer] === null ? prefer : p.slots.findIndex((s) => s === null);
    if (i < 0) i = p.current;
    p.slots[i] = slot;
    p.current = i;
    p.switchTimer = this.cfg.player.weaponSwitchSeconds;
    p.reloadTimer = 0;
  }

  private buyWeapon(id: string, cost: number): void {
    if (!this.pay(cost)) return;
    this.giveWeapon(this.freshSlot(id));
    this.events.push({ type: 'purchase', what: 'weapon', id });
  }

  private buyAmmo(slot: WeaponSlot, cost: number): void {
    if (slot.mag >= this.magazineOf(slot) && slot.reserve >= this.reserveOf(slot)) return;
    if (!this.pay(cost)) return;
    this.fill(slot);
    this.events.push({ type: 'purchase', what: 'ammo', id: slot.weapon });
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

  // ------------------------------------------------------------------ energía y sueros

  private turnPowerOn(): void {
    if (this.power) return;
    this.power = true;
    this.events.push({ type: 'powerOn' });
  }

  /** Si la estación de un suero funciona. La de Segundo aliento se apaga al agotar sus usos. */
  perkStationOn(id: string): boolean {
    const perk = this.cfg.perks.perks[id];
    if (!perk) return false;
    if (perk.selfRevivesPerGame > 0 && this.player.selfRevivesUsed >= perk.selfRevivesPerGame) return false;
    return true;
  }

  private buyPerk(id: string, cost: number): void {
    const p = this.player;
    if (p.perks.includes(id) || p.perks.length >= this.cfg.perks.maxPerks) return;
    if (!this.pay(cost)) return;
    p.perks.push(id);
    this.events.push({ type: 'purchase', what: 'perk', id });
  }

  /** Suero que levanta al jugador solo, si lo tiene y le quedan usos. */
  private selfRevivePerk(): string | null {
    for (const id of this.player.perks) {
      const perk = this.cfg.perks.perks[id];
      if (perk && perk.selfRevivesPerGame > 0 && this.player.selfRevivesUsed < perk.selfRevivesPerGame) return id;
    }
    return null;
  }

  private goDown(perkId: string): void {
    const p = this.player;
    const perk = this.cfg.perks.perks[perkId]!;
    p.downed = true;
    p.downTimer = perk.selfReviveSeconds;
    p.selfRevivesUsed++;
    // Al caer se pierden todos los sueros, también el que te levanta.
    p.perks.length = 0;
    p.health = 0;
    p.reloadTimer = 0;
    p.switchTimer = 0;
    p.downedSlot = this.freshSlot(this.cfg.perks.downedWeapon);
    this.events.push({ type: 'downed', revivesLeft: perk.selfRevivesPerGame - p.selfRevivesUsed });
    for (const e of this.enemies) if (e.phase === 'chasing') this.retarget(e);
  }

  private revive(): void {
    const p = this.player;
    p.downed = false;
    p.downTimer = 0;
    p.downedSlot = null;
    p.reloadTimer = 0;
    p.health = this.maxHealth();
    p.sinceDamage = 0;
    p.protectTimer = this.cfg.perks.reviveProtectionSeconds;
    this.events.push({ type: 'revived' });
  }

  private hurtPlayer(enemy: number): void {
    const p = this.player;
    if (!p.alive || p.downed || p.protectTimer > 0 || this.opts.invulnerable) return;
    p.health = Math.max(0, p.health - this.cfg.enemies.hitDamage);
    p.sinceDamage = 0;
    this.events.push({ type: 'playerHit', health: p.health, enemy });
    if (p.health > 0) return;
    const revivePerk = this.selfRevivePerk();
    if (revivePerk) {
      this.goDown(revivePerk);
      return;
    }
    p.alive = false;
    this.round.phase = 'over';
    this.events.push({ type: 'gameOver', round: this.round.number });
  }

  // ------------------------------------------------------------------ El Contenedor y La Forja

  private rollMovesAfter(): number {
    const c = this.cfg.contenedor;
    return c.movesAfterMin + this.rng.int(c.movesAfterMax - c.movesAfterMin + 1);
  }

  private openContenedor(): void {
    const box = this.contenedor;
    if (box.phase !== 'idle' || !this.pay(this.cfg.contenedor.cost)) return;
    // Nunca sale un arma que ya se lleva.
    const owned = new Set(this.player.slots.filter((s): s is WeaponSlot => s !== null).map((s) => s.weapon));
    if (this.forja.slot) owned.add(this.forja.slot.weapon);
    const pool = this.cfg.contenedor.pool.filter((w) => !owned.has(w));
    const list = pool.length > 0 ? pool : this.cfg.contenedor.pool;
    box.weapon = list[this.rng.int(list.length)]!;
    box.phase = 'spinning';
    box.timer = this.cfg.contenedor.spinSeconds;
    box.uses++;
    this.events.push({ type: 'purchase', what: 'contenedor', id: box.weapon });
  }

  private takeContenedorWeapon(): void {
    const box = this.contenedor;
    if (box.phase !== 'offering' || !box.weapon) return;
    const weapon = box.weapon;
    this.giveWeapon(this.freshSlot(weapon));
    this.events.push({ type: 'contenedorTaken', weapon });
    this.closeContenedor();
  }

  /** Tras un uso: vuelve a esperar o, si toca, se traslada a otro hueco. */
  private closeContenedor(): void {
    const box = this.contenedor;
    box.weapon = null;
    if (box.uses >= box.movesAfter) {
      box.phase = 'moving';
      box.timer = this.cfg.contenedor.moveSeconds;
      this.events.push({ type: 'contenedorMoving' });
    } else {
      box.phase = 'idle';
    }
  }

  private startForja(): void {
    const p = this.player;
    const held = p.slots[p.current];
    if (this.forja.phase !== 'idle' || !held || held.upgraded) return;
    if (!this.pay(this.cfg.forja.cost)) return;
    // El arma se queda en la máquina; se saca la otra si la hay.
    this.forja.slot = held;
    this.forja.phase = 'working';
    this.forja.timer = this.cfg.forja.seconds;
    p.slots[p.current] = null;
    p.reloadTimer = 0;
    const other = p.slots.findIndex((s) => s !== null);
    if (other >= 0) {
      p.current = other;
      p.switchTimer = this.cfg.player.weaponSwitchSeconds;
    }
    this.events.push({ type: 'purchase', what: 'forja', id: held.weapon });
  }

  private takeForged(): void {
    const f = this.forja;
    if (f.phase !== 'ready' || !f.slot) return;
    const slot = f.slot;
    slot.upgraded = true;
    this.fill(slot);
    const empty = this.player.slots.findIndex((s) => s === null);
    this.giveWeapon(slot, empty >= 0 ? empty : undefined);
    f.slot = null;
    f.phase = 'idle';
    this.events.push({ type: 'forjaTaken', weapon: slot.weapon });
  }

  private updateMachines(): void {
    const box = this.contenedor;
    if (box.phase !== 'idle') {
      box.timer -= SIM_DT;
      if (box.timer <= 0) {
        if (box.phase === 'spinning' && box.weapon) {
          box.phase = 'offering';
          box.timer = this.cfg.contenedor.offerSeconds;
          this.events.push({ type: 'contenedorOffer', weapon: box.weapon });
        } else if (box.phase === 'offering') {
          this.closeContenedor(); // nadie la cogió: se pierde
        } else if (box.phase === 'moving') {
          const spots = this.cfg.map.contenedorSpots.length;
          box.spot = (box.spot + 1 + this.rng.int(spots - 1)) % spots;
          box.phase = 'idle';
          box.uses = 0;
          box.movesAfter = this.rollMovesAfter();
          this.events.push({ type: 'contenedorMoved', spot: box.spot });
        }
      }
    }
    const f = this.forja;
    if (f.phase === 'working') {
      f.timer -= SIM_DT;
      if (f.timer <= 0 && f.slot) {
        f.phase = 'ready';
        this.events.push({ type: 'forjaReady', weapon: f.slot.weapon });
      }
    }
  }

  // ------------------------------------------------------------------ puntos y power-ups

  private addPoints(n: number): void {
    if (n <= 0) return;
    const amount = this.effects.puntosDobles > 0 ? n * 2 : n;
    this.player.points += amount;
    this.events.push({ type: 'points', amount });
  }

  private maybeDropPowerup(at: Vec3): void {
    const pc = this.cfg.powerups;
    if (this.round.powerupsDropped >= pc.maxPerRound || pc.kinds.length === 0) return;
    if (this.rng.next() >= pc.dropChance) return;
    this.dropPowerup(pc.kinds[this.rng.int(pc.kinds.length)]!, at.x, at.z);
  }

  /** Deja un power-up en el suelo. Público para pruebas. */
  dropPowerup(kind: PowerupKind, x: number, z: number): number {
    const slot = this.pickups.findIndex((pu) => !pu.active);
    if (slot < 0) return -1;
    const pu = this.pickups[slot]!;
    pu.active = true;
    pu.kind = kind;
    pu.x = x;
    pu.z = z;
    pu.timer = this.cfg.powerups.lifetimeSeconds;
    this.round.powerupsDropped++;
    this.events.push({ type: 'powerupDrop', slot, kind });
    return slot;
  }

  private updatePowerups(): void {
    const pc = this.cfg.powerups;
    const p = this.player;
    for (const kind of ['bajaInstantanea', 'puntosDobles'] as const) {
      if (this.effects[kind] > 0) {
        this.effects[kind] = Math.max(0, this.effects[kind] - SIM_DT);
        if (this.effects[kind] === 0) this.events.push({ type: 'effectEnd', kind });
      }
    }
    this.pickups.forEach((pu, slot) => {
      if (!pu.active) return;
      pu.timer -= SIM_DT;
      if (pu.timer <= 0) {
        pu.active = false;
        this.events.push({ type: 'powerupExpired', slot });
        return;
      }
      if (Math.hypot(p.pos.x - pu.x, p.pos.z - pu.z) <= pc.pickupRadius) {
        pu.active = false;
        this.applyPowerup(pu.kind);
      }
    });
  }

  private applyPowerup(kind: PowerupKind): void {
    const pc = this.cfg.powerups;
    this.events.push({ type: 'powerupPickup', kind });
    switch (kind) {
      case 'municionCompleta':
        for (const s of this.player.slots) if (s) this.fill(s);
        if (this.player.downedSlot) this.fill(this.player.downedSlot);
        if (this.forja.slot) this.fill(this.forja.slot);
        break;
      case 'bajaInstantanea':
        this.effects.bajaInstantanea = pc.effectSeconds;
        break;
      case 'puntosDobles':
        this.effects.puntosDobles = pc.effectSeconds;
        break;
      case 'ondaExpansiva':
        // Todos los enemigos vivos caen, sin puntos por baja: solo la bonificación.
        for (const e of this.enemies) {
          if (e.phase === 'inactive') continue;
          this.events.push({ type: 'hit', enemy: e.index, part: 'torso', killed: true });
          this.removeEnemy(e);
          this.round.kills++;
        }
        this.addPoints(pc.nukePoints);
        break;
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
    r.powerupsDropped = 0;
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
    // Cada Vacío es un poco distinto: así la horda no avanza en bloque ni en fila.
    const hd = this.cfg.enemies.horde;
    e.speed = enemySpeed(round, this.cfg.enemies) * (1 + (this.rng.next() * 2 - 1) * hd.speedVariation);
    e.lead = this.rng.next() * hd.leadSecondsMax;
    e.sway = this.rng.next() * hd.swayMeters;
    e.swayFreq = 0.3 + this.rng.next() * 0.5;
    e.swayPhase = this.rng.next() * Math.PI * 2;
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

  /** Coloca un enemigo ya dentro, persiguiendo (pruebas). */
  spawnEnemyInside(x: number, z: number): EnemyState | null {
    const e = this.spawnEnemy(0);
    if (!e) return null;
    e.pos = { x, y: 0, z };
    e.prevPos = { ...e.pos };
    e.phase = 'chasing';
    e.agent = this.nav.addAgent(e.pos, e.speed, this.cfg.enemies.horde);
    this.physics.setEnemy(e.index, true, e.pos);
    return e;
  }

  private damageEnemy(i: number, amount: number, part: HitPart | 'melee', upgraded: boolean, fromWave = false): void {
    const e = this.enemies[i]!;
    if (e.phase === 'inactive') return;
    e.health -= this.effects.bajaInstantanea > 0 ? e.health : amount;
    const hitPart: HitPart = part === 'melee' ? 'torso' : part;
    const eco = this.cfg.economy;
    if (e.health > 0) {
      this.events.push({ type: 'hit', enemy: i, part: hitPart, killed: false });
      this.addPoints(eco.hit);
      return;
    }
    this.events.push({ type: 'hit', enemy: i, part: hitPart, killed: true });
    this.addPoints(part === 'melee' ? eco.killMelee : part === 'head' ? eco.killHead : eco.killBody);
    // Los power-ups solo caen dentro del edificio, donde el jugador puede cogerlos.
    const w = this.cfg.map.windows[e.window]!;
    const dropAt = e.phase === 'chasing' ? { ...e.pos } : { x: w.inside[0], y: 0, z: w.inside[1] };
    const at = { ...e.pos };
    this.removeEnemy(e);
    this.round.kills++;
    this.maybeDropPowerup(dropAt);
    if (upgraded && !fromWave) this.ashWave(at);
  }

  /** Efecto de La Forja: onda de ceniza que daña a los enemigos cercanos. No encadena otras ondas. */
  private ashWave(at: Vec3): void {
    const fw = this.cfg.forja.ashWave;
    const damage = enemyHealth(Math.max(1, this.round.number), this.cfg.rounds) * fw.roundHealthFraction;
    this.events.push({ type: 'ashWave', at });
    for (const e of this.enemies) {
      if (e.phase === 'inactive') continue;
      if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= fw.radius) this.damageEnemy(e.index, damage, 'torso', true, true);
    }
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
          e.agent = this.nav.addAgent(e.pos, e.speed, this.cfg.enemies.horde);
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
          this.hurtPlayer(e.index);
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
    if (this.player.downed) {
      // Con el jugador caído, los Vacíos se alejan: van a la ventana abierta más lejana a él,
      // para que al levantarse no esté rodeado.
      let far: [number, number] | null = null;
      let farD = -1;
      this.cfg.map.windows.forEach((w, i) => {
        if (!this.windows[i]!.active) return;
        const d = Math.hypot(w.inside[0] - p.x, w.inside[1] - p.z);
        if (d > farD) {
          farD = d;
          far = w.inside;
        }
      });
      const t = far as [number, number] | null;
      if (t) e.agent.requestMoveTarget(this.nav.closest({ x: t[0], y: 0, z: t[1] }));
      return;
    }
    const dx = e.pos.x - p.x;
    const dz = e.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const hd = this.cfg.enemies.horde;
    if (d > hd.directWithin) {
      // Lejos: cada uno a su manera. Unos van a donde el jugador va a estar (cortan el paso)
      // y todos se balancean a los lados con su propio ritmo, así que no siguen el mismo rastro.
      const v = this.player.vel;
      const t = this.tick * SIM_DT;
      const side = Math.sin(t * e.swayFreq * Math.PI * 2 + e.swayPhase) * e.sway;
      const px = -dz / d;
      const pz = dx / d;
      const tx = p.x + v.x * e.lead + px * side;
      const tz = p.z + v.z * e.lead + pz * side;
      e.agent.requestMoveTarget(this.nav.closest({ x: tx, y: 0, z: tz }));
      return;
    }
    // Cerca: directo a por el jugador, parándose al tocarlo.
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
