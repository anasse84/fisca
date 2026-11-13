import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

/**
 * Règle locale `no-float-money` (ADR-03, Loi 1) : interdit l'opérateur `/` (et `/=`) ainsi que `parseFloat`
 * sur tout identifiant dont le dernier mot est cents, bps, milli ou micro (casse indifférente :
 * `totalCents`, `total_cents`, `TOTAL_CENTS`, `vatRateBps`, `qty_milli`, `rateMicro`...).
 * Toute division monétaire passe par `divRoundHalfUpBigInt` (ERRATA D-09), qui n'est pas signalée
 * parce que ses paramètres (`numerator`, `denominator`) ne portent pas d'unité dans leur nom.
 */

const MONEY_WORDS: ReadonlySet<string> = new Set(['cents', 'bps', 'milli', 'micro']);

/** Découpe un identifiant en mots : séparateurs `_` et `$`, frontières camelCase, séries de majuscules. */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Vrai si le dernier mot du nom est une unité monétaire entière (cents, bps, milli, micro). */
export function isMoneyIdentifierName(name: string): boolean {
  const words = splitWords(name);
  const last = words[words.length - 1];
  return last !== undefined && MONEY_WORDS.has(last);
}

const TRANSPARENT_CALLEES: ReadonlySet<string> = new Set(['Number', 'BigInt', 'String']);

function isTransparentCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return TRANSPARENT_CALLEES.has(callee.name);
  }
  return callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Math';
}

/** Premier identifiant monétaire lu par l'expression, sans entrer dans un appel dont le résultat est opaque. */
function findMoneyName(node: TSESTree.Node): string | null {
  switch (node.type) {
    case 'Identifier':
      return isMoneyIdentifierName(node.name) ? node.name : null;
    case 'MemberExpression':
      if (!node.computed) {
        return node.property.type === 'Identifier' && isMoneyIdentifierName(node.property.name) ? node.property.name : null;
      }
      return findMoneyName(node.object);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return findMoneyName(node.left) ?? findMoneyName(node.right);
    case 'UnaryExpression':
    case 'AwaitExpression':
      return findMoneyName(node.argument);
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
    case 'TSSatisfiesExpression':
      return findMoneyName(node.expression);
    case 'ChainExpression':
      return findMoneyName(node.expression);
    case 'ConditionalExpression':
      return findMoneyName(node.consequent) ?? findMoneyName(node.alternate);
    case 'CallExpression': {
      if (!isTransparentCall(node)) {
        return null;
      }
      for (const argument of node.arguments) {
        const found = findMoneyName(argument);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function isParseFloatCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name === 'parseFloat';
  }
  return callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'parseFloat';
}

export type NoFloatMoneyMessageId = 'floatDivision' | 'floatParse';

export const noFloatMoneyRule: TSESLint.RuleModule<NoFloatMoneyMessageId, []> = {
  defaultOptions: [],
  meta: {
    type: 'problem',
    docs: {
      description: 'Interdit `/` et `parseFloat` sur les montants (cents), taux (bps), quantités (milli) et cours (micro).',
    },
    schema: [],
    messages: {
      floatDivision:
        "ADR_03_FLOAT_FORBIDDEN : division `/` sur « {{name}} » (unité entière). Utiliser divRoundHalfUpBigInt ou applyBps de @fisca/shared-types.",
      floatParse:
        "ADR_03_FLOAT_FORBIDDEN : parseFloat sur « {{name}} » (unité entière). Lire un entier exact (ensureSafeInteger).",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '/') {
          return;
        }
        const name = findMoneyName(node.left) ?? findMoneyName(node.right);
        if (name !== null) {
          context.report({ node, messageId: 'floatDivision', data: { name } });
        }
      },
      AssignmentExpression(node) {
        if (node.operator !== '/=') {
          return;
        }
        const name = findMoneyName(node.left) ?? findMoneyName(node.right);
        if (name !== null) {
          context.report({ node, messageId: 'floatDivision', data: { name } });
        }
      },
      CallExpression(node) {
        if (!isParseFloatCall(node)) {
          return;
        }
        for (const argument of node.arguments) {
          const name = findMoneyName(argument);
          if (name !== null) {
            context.report({ node, messageId: 'floatParse', data: { name } });
            return;
          }
        }
      },
    };
  },
};

export const fiscaLocalPlugin: { readonly rules: { readonly 'no-float-money': typeof noFloatMoneyRule } } = {
  rules: { 'no-float-money': noFloatMoneyRule },
};
