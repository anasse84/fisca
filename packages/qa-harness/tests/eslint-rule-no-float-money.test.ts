import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, expect, it } from 'vitest';
import { isMoneyIdentifierName, noFloatMoneyRule } from '../src/eslint-rule-no-float-money.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
});

describe('isMoneyIdentifierName (convention de nommage)', () => {
  it.each([
    'Cents', 'cents', 'CENTS', 'totalCents', 'total_cents', 'TOTAL_CENTS', 'vatRateBps', 'vat_rate_bps', 'Bps', 'bps',
    'qtyMilli', 'qty_milli', 'Milli', 'rateMicro', 'rate_micro', 'Micro', 'Centimes', 'centimes', 'totalCentimes', 'total_centimes',
  ])('reconnaît %s', (name) => {
    expect(isMoneyIdentifierName(name)).toBe(true);
  });

  it.each(['percents', 'recents', 'centimesToDisplay', 'total', 'microservice', 'bpsRate', 'milliseconds', 'index', 'centsToDisplay'])(
    'ignore %s',
    (name) => {
      expect(isMoneyIdentifierName(name)).toBe(false);
    },
  );
});

ruleTester.run('no-float-money', noFloatMoneyRule, {
  valid: [
    // Division passant par la primitive entière (ERRATA D-09).
    { code: 'const share = divRoundHalfUpBigInt(BigInt(totalCents) * BigInt(rateBps), 10000n);' },
    { code: 'const vat = applyBps(amountCents, vatRateBps);' },
    // Identifiants sans unité monétaire : la division reste libre.
    { code: 'const ratio = width / height;' },
    { code: 'const half = pageCount / 2;' },
    // Un identifiant monétaire sans division ni parseFloat.
    { code: 'const sum = a_cents + b_cents; const scaled = rate_bps * 3;' },
    // Mots qui se terminent par les lettres sans être une unité.
    { code: 'const share = percents / 4;' },
    // parseInt et Number.parseInt sont des entiers.
    { code: 'const n = parseInt(raw, 10); const m = Number.parseInt(totalCents_text, 10);' },
    // parseFloat sur un texte sans unité monétaire.
    { code: 'const w = parseFloat(widthText);' },
    // Division dans un argument d'appel ignorée si les opérandes ne sont pas monétaires.
    { code: 'const mid = Math.floor((lo + hi) / 2);' },
    // Division dont l'opérande monétaire est dans un appel opaque : le résultat de l'appel n'est pas lu.
    { code: 'const r = computeSomething(totalCents) / 3;' },
    // Variable annotée Centimes mais jamais divisée ; division par la primitive entière.
    { code: 'const ht: Centimes = x; const vat = applyBps(ht, rate);' },
    { code: 'const ht = centimes(5); const share = divRoundHalfUpBigInt(BigInt(ht) * BigInt(rate), 10000n);' },
    // Liaison masquée : le `ht` de la fonction n'est pas celui, typé, du module.
    { code: 'const ht = centimes(5); function f(ht: number) { return ht / 2; }' },
    // Arrondi d'une division sans signal monétaire.
    { code: 'const mid = Math.round(width / height);' },
  ],
  invalid: [
    {
      code: 'const share = total_cents / 3;',
      errors: [{ messageId: 'floatDivision', data: { name: 'total_cents' } }],
    },
    {
      code: 'const share = totalCents / 100;',
      errors: [{ messageId: 'floatDivision', data: { name: 'totalCents' } }],
    },
    {
      code: 'const rate = 100 / vatRateBps;',
      errors: [{ messageId: 'floatDivision', data: { name: 'vatRateBps' } }],
    },
    {
      code: 'const vat = (net_cents * rate_bps) / 10000;',
      errors: [{ messageId: 'floatDivision', data: { name: 'net_cents' } }],
    },
    {
      code: 'const vat = Math.round(invoice.totalCents / 100);',
      errors: [{ messageId: 'floatRounding', data: { name: 'totalCents' } }],
    },
    // Cas de l'auditeur : nom sans unité, type Centimes en paramètre.
    {
      code: 'function vatOf(ht: Centimes, rate: Bps) { return Math.round((ht * rate) / 10000); }',
      errors: [{ messageId: 'floatRounding', data: { name: 'ht' } }],
    },
    {
      code: 'function vatOf(ht: Centimes, rate: Bps) { return (ht * rate) / 10000; }',
      errors: [{ messageId: 'floatDivision', data: { name: 'ht' } }],
    },
    {
      code: 'const ht = centimes(1000); const vat = Math.floor(ht / 3);',
      errors: [{ messageId: 'floatRounding', data: { name: 'ht' } }],
    },
    {
      code: 'const ht: Centimes = source; const half = ht / 2;',
      errors: [{ messageId: 'floatDivision', data: { name: 'ht' } }],
    },
    {
      code: 'const rate = bps(1400); const pct = 100 * rate / 10000;',
      errors: [{ messageId: 'floatDivision', data: { name: 'rate' } }],
    },
    {
      code: 'const ht = micro(5) as Micro; const x = Math.ceil(ht / 7);',
      errors: [{ messageId: 'floatRounding', data: { name: 'ht' } }],
    },
    {
      code: 'const ttc = Math.trunc(Math.round(a * totalCents) / 100);',
      errors: [{ messageId: 'floatRounding', data: { name: 'totalCents' } }],
    },
    // Division dont l'opérande, imbriquée dans des appels et des produits, porte l'unité.
    {
      code: 'const x = (Math.max(1, qty) * Math.abs(unit_milli)) / 1000;',
      errors: [{ messageId: 'floatDivision', data: { name: 'unit_milli' } }],
    },
    {
      code: 'const x = amount.ht * 2 / 3; interface Row { ht: Centimes }',
      errors: [{ messageId: 'floatDivision', data: { name: 'ht' } }],
    },
    {
      code: 'const x = applyBps(a, b) / 3;',
      errors: [{ messageId: 'floatDivision', data: { name: 'applyBps' } }],
    },
    {
      code: 'const x = centimes(5) / 3;',
      errors: [{ messageId: 'floatDivision', data: { name: 'centimes' } }],
    },
    {
      code: 'const total_centimes = 3; const x = total_centimes / 2;',
      errors: [{ messageId: 'floatDivision', data: { name: 'total_centimes' } }],
    },
    {
      code: 'const q = qtyMilli / 1000;',
      errors: [{ messageId: 'floatDivision', data: { name: 'qtyMilli' } }],
    },
    {
      code: 'const fx = rateMicro / 1000000;',
      errors: [{ messageId: 'floatDivision', data: { name: 'rateMicro' } }],
    },
    {
      code: 'let amountCents = 100; amountCents /= 3;',
      errors: [{ messageId: 'floatDivision', data: { name: 'amountCents' } }],
    },
    {
      code: 'const x = Number(amountCents) / 100;',
      errors: [{ messageId: 'floatDivision', data: { name: 'amountCents' } }],
    },
    {
      code: 'const x = BigInt(amountCents) / 3n;',
      errors: [{ messageId: 'floatDivision', data: { name: 'amountCents' } }],
    },
    {
      code: 'const x = (amountCents as number) / 3;',
      errors: [{ messageId: 'floatDivision', data: { name: 'amountCents' } }],
    },
    {
      code: 'const amount = parseFloat(price_cents);',
      errors: [{ messageId: 'floatParse', data: { name: 'price_cents' } }],
    },
    {
      code: 'const amount = Number.parseFloat(row.rateBps);',
      errors: [{ messageId: 'floatParse', data: { name: 'rateBps' } }],
    },
    {
      code: 'const amount = parseFloat(String(totalCents));',
      errors: [{ messageId: 'floatParse', data: { name: 'totalCents' } }],
    },
  ],
});
