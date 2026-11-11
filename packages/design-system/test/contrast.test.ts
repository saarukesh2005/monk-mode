import { describe, expect, it } from 'vitest';
import { ACCENTS, contrastRatio, resolveTheme, THEMES } from '../src';

describe('design tokens', () => {
  for (const t of THEMES) {
    it(`${t.name}: body and secondary text meet WCAG AA`, () => {
      expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${t.name}: accents are legible as UI elements (3:1)`, () => {
      for (const a of ACCENTS) {
        const color = t.scheme === 'dark' ? a.dark : a.light;
        expect(contrastRatio(color, t.surface)).toBeGreaterThanOrEqual(3);
      }
    });
  }
  it('falls back to a matching scheme', () => {
    expect(resolveTheme('light', 'graphite', true).scheme).toBe('light');
    expect(resolveTheme('system', 'paper', true).id).toBe('graphite');
    expect(resolveTheme('system', 'midnight', true).id).toBe('midnight');
  });
});
