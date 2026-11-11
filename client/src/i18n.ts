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

export function t(key: TextKey): string {
  return TABLES[current][key];
}
