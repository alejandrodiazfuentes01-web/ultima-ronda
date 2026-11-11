import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import es from '../locales/es.json';
import { detectLanguage, setLanguage, t } from './i18n';

describe('archivos de idioma', () => {
  it('inglés y español tienen exactamente las mismas claves', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('ningún texto está vacío', () => {
    for (const table of [en, es]) {
      for (const [key, value] of Object.entries(table)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('elige español o inglés según el navegador, e inglés por defecto', () => {
    expect(detectLanguage(['es-ES'])).toBe('es');
    expect(detectLanguage(['es-MX', 'en'])).toBe('es');
    expect(detectLanguage(['en-GB', 'es'])).toBe('en');
    expect(detectLanguage(['fr-FR', 'es'])).toBe('es');
    expect(detectLanguage(['de'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });

  it('devuelve el texto del idioma activo', () => {
    setLanguage('es');
    expect(t('game.title')).toBe(es['game.title']);
    setLanguage('en');
    expect(t('game.title')).toBe(en['game.title']);
  });
});
