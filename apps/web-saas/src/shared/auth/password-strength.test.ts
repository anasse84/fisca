import { describe, expect, it } from 'vitest';
import { assessPasswordStrength } from './password-strength.ts';

describe('indicateur de robustesse', () => {
  it('vide : niveau empty, score 0', () => {
    expect(assessPasswordStrength('')).toMatchObject({ level: 'empty', score: 0 });
  });
  it('court et monotone : faible', () => {
    expect(assessPasswordStrength('aaaa').level).toBe('weak');
    expect(assessPasswordStrength('aaaaaaaaaaaaaaaa').level).toBe('weak');
    expect(assessPasswordStrength('123456789012').level).toBe('weak');
  });
  it('12 caractères variés : moyen ou mieux, mais pas fort', () => {
    const { level } = assessPasswordStrength('Ab3dEf7hIj9k');
    expect(['fair', 'good']).toContain(level);
  });
  it('phrase longue variée : forte', () => {
    expect(assessPasswordStrength('Chaval-Bleu-Traverse-2026!').level).toBe('strong');
  });
  it('le score est monotone avec la longueur à variété égale', () => {
    const a = assessPasswordStrength('Tr0ub4dor&3x').score;
    const b = assessPasswordStrength('Tr0ub4dor&3xPlusLong-et-varié').score;
    expect(b).toBeGreaterThanOrEqual(a);
  });
  it('compte les points de code (arabe, emoji) et signale la longueur hors 12 à 128', () => {
    expect(assessPasswordStrength('كلمةالسرالطويلة١٢٣').length).toBe(18);
    expect(assessPasswordStrength('a'.repeat(11)).meetsLengthHint).toBe(false);
    expect(assessPasswordStrength('a'.repeat(12)).meetsLengthHint).toBe(true);
    expect(assessPasswordStrength('a'.repeat(129)).meetsLengthHint).toBe(false);
  });
});
