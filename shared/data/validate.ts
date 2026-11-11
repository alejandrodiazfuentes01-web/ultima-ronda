/**
 * Ayudas para validar los JSON de datos al cargarlos (regla 3).
 * Cada error dice el archivo y la ruta del valor que falla.
 */

export type Obj = Record<string, unknown>;

export class DataError extends Error {}

export function obj(raw: unknown, where: string): Obj {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DataError(`${where}: se esperaba un objeto`);
  return raw as Obj;
}

export function field(o: Obj, key: string, where: string): unknown {
  if (!(key in o)) throw new DataError(`${where}.${key}: falta`);
  return o[key];
}

export interface NumOpts {
  min?: number;
  max?: number;
  int?: boolean;
  /** true si el valor puede ser 0 cuando no se da min. Por defecto se exige > 0. */
  allowZero?: boolean;
}

export function num(o: Obj, key: string, where: string, opts: NumOpts = {}): number {
  const v = field(o, key, where);
  const path = `${where}.${key}`;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(`${path}: debe ser un número`);
  if (opts.int && !Number.isInteger(v)) throw new DataError(`${path}: debe ser entero`);
  if (opts.min !== undefined ? v < opts.min : opts.allowZero ? v < 0 : v <= 0) {
    throw new DataError(`${path}: valor ${v} demasiado bajo`);
  }
  if (opts.max !== undefined && v > opts.max) throw new DataError(`${path}: valor ${v} demasiado alto`);
  return v;
}

export function str(o: Obj, key: string, where: string, allowed?: readonly string[]): string {
  const v = field(o, key, where);
  if (typeof v !== 'string' || v === '') throw new DataError(`${where}.${key}: debe ser un texto`);
  if (allowed && !allowed.includes(v)) throw new DataError(`${where}.${key}: «${v}» no es uno de ${allowed.join(', ')}`);
  return v;
}

export function bool(o: Obj, key: string, where: string): boolean {
  const v = field(o, key, where);
  if (typeof v !== 'boolean') throw new DataError(`${where}.${key}: debe ser true o false`);
  return v;
}

export function arr(o: Obj, key: string, where: string): unknown[] {
  const v = field(o, key, where);
  if (!Array.isArray(v)) throw new DataError(`${where}.${key}: debe ser una lista`);
  return v;
}

/** Lista de exactamente `n` números (puntos, cajas, rectángulos). */
export function nums(raw: unknown, n: number, where: string): number[] {
  if (!Array.isArray(raw) || raw.length !== n || !raw.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new DataError(`${where}: se esperaban ${n} números`);
  }
  return raw as number[];
}
