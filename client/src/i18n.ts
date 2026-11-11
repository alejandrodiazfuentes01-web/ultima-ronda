/**
 * Textos del juego (regla 8). Ningún texto visible se escribe en el código:
 * todo sale de client/locales/<idioma>.json.
 */
import en from '../locales/en.json';
import es from '../locales/es.json';

export type TextKey = keyof typeof en;
export type Language = 'en' | 'es';

const TABLES: Record<Language, Record<TextKey, string>> = { en, es };

/** Español si el navegador lo pide; inglés en cualquier otro caso (el inglés es obligatorio en los portales). */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'es') return 'es';
    if (base === 'en') return 'en';
  }
  return 'en';
}

let current: Language = 'en';

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

/** Texto del idioma activo. Las marcas {nombre} se sustituyen por los valores dados. */
export function t(key: TextKey, vars?: Record<string, string | number>): string {
  let s = TABLES[current][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Número con separador de miles del idioma activo. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString(current === 'es' ? 'es-ES' : 'en-US');
}

/** Nombre visible de un arma, o su identificador si falta en el archivo de idioma. */
export function weaponName(id: string): string {
  const key = `weapon.${id}` as TextKey;
  return key in TABLES[current] ? t(key) : id;
}

/** Nombre visible de un suero. */
export function perkName(id: string): string {
  const key = `perk.${id}` as TextKey;
  return key in TABLES[current] ? t(key) : id;
}
