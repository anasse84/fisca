import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

/**
 * Règle locale `no-float-money` (ADR-03, Loi 1) : interdit l'opérateur `/` (et `/=`) ainsi que `parseFloat`
 * sur toute valeur reconnue comme monétaire. Sans règle typée, la reconnaissance repose sur trois signaux :
 * 1. le NOM : dernier mot de l'identifiant ou du membre ∈ {cents, bps, milli, micro, centimes}
 *    (`totalCents`, `total_cents`, `vatRateBps`, `qty_milli`, `rateMicro`, `Centimes`...) ;
 * 2. une DÉCLARATION lisible dans le même fichier : `const ht = centimes(...)` (constructeurs `centimes`,
 *    `bps`, `milli`, `micro`), `ht: Centimes` (variable, paramètre, propriété d'interface ou de classe),
 *    `x as Centimes` ; la liaison est résolue par le gestionnaire de portées d'ESLint (pas par le seul nom) ;
 * 3. l'APPEL d'une fonction dont le nom porte l'unité (`applyBps(...) / 3`, `centimes(x) / 3`).
 * Limite assumée (voir README) : aucune inférence de type ni suivi de flux.
 * Toute division monétaire passe par `divRoundHalfUpBigInt` (ERRATA D-09), non signalée parce que ses
 * paramètres (`numerator`, `denominator`) ne portent pas d'unité dans leur nom.
 */

const MONEY_WORDS: ReadonlySet<string> = new Set(['cents', 'bps', 'milli', 'micro', 'centimes']);
const MONEY_CONSTRUCTORS: ReadonlySet<string> = new Set(['centimes', 'bps', 'milli', 'micro']);
const MONEY_TYPE_NAMES: ReadonlySet<string> = new Set(['Centimes', 'Bps', 'Milli', 'Micro']);
const ROUNDING_METHODS: ReadonlySet<string> = new Set(['round', 'floor', 'ceil', 'trunc']);

/** Découpe un identifiant en mots : séparateurs `_` et `$`, frontières camelCase, séries de majuscules. */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Vrai si le dernier mot du nom est une unité monétaire entière (cents, bps, milli, micro, centimes). */
export function isMoneyIdentifierName(name: string): boolean {
  const words = splitWords(name);
  const last = words[words.length - 1];
  return last !== undefined && MONEY_WORDS.has(last);
}

function isMathCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  return callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Math';
}

function isTransparentCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name === 'Number' || callee.name === 'BigInt' || callee.name === 'String';
  }
  return isMathCall(node);
}

function isRoundingCall(node: TSESTree.Node): node is TSESTree.CallExpression {
  return (
    node.type === 'CallExpression' &&
    isMathCall(node) &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    ROUNDING_METHODS.has(node.callee.property.name)
  );
}

function isMoneyTypeNode(node: TSESTree.TypeNode | undefined): boolean {
  return node !== undefined && node.type === 'TSTypeReference' && node.typeName.type === 'Identifier' && MONEY_TYPE_NAMES.has(node.typeName.name);
}

function unwrapTs(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSSatisfiesExpression'
  ) {
    current = current.expression;
  }
  return current;
}

/** Vrai si l'initialisation est un constructeur monétaire ou une assertion `as Centimes`. */
function isMoneyInitializer(init: TSESTree.Node | null): boolean {
  if (init === null) {
    return false;
  }
  if ((init.type === 'TSAsExpression' || init.type === 'TSTypeAssertion' || init.type === 'TSSatisfiesExpression') && isMoneyTypeNode(init.typeAnnotation)) {
    return true;
  }
  const inner = unwrapTs(init);
  return inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && MONEY_CONSTRUCTORS.has(inner.callee.name);
}

function typeAnnotationOf(node: TSESTree.Node): TSESTree.TSTypeAnnotation | undefined {
  if (node.type === 'Identifier') {
    return node.typeAnnotation;
  }
  return undefined;
}

export type NoFloatMoneyMessageId = 'floatDivision' | 'floatRounding' | 'floatParse';

export const noFloatMoneyRule: TSESLint.RuleModule<NoFloatMoneyMessageId, []> = {
  defaultOptions: [],
  meta: {
    type: 'problem',
    docs: {
      description: 'Interdit `/` et `parseFloat` sur les montants (cents, centimes), taux (bps), quantités (milli) et cours (micro).',
    },
    schema: [],
    messages: {
      floatDivision:
        "ADR_03_FLOAT_FORBIDDEN : division `/` sur « {{name}} » (unité entière). Utiliser divRoundHalfUpBigInt ou applyBps de @fisca/shared-types.",
      floatRounding:
        "ADR_03_FLOAT_FORBIDDEN : arrondi Math.round/floor/ceil/trunc d'une division sur « {{name}} » (unité entière). Utiliser divRoundHalfUpBigInt ou applyBps de @fisca/shared-types.",
      floatParse:
        "ADR_03_FLOAT_FORBIDDEN : parseFloat sur « {{name}} » (unité entière). Lire un entier exact (ensureSafeInteger).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** Noms de propriétés déclarées `: Centimes` (interface, type littéral, classe) dans ce fichier. */
    const typedMemberNames = new Set<string>();
    const divisions: Array<TSESTree.BinaryExpression | TSESTree.AssignmentExpression> = [];
    const parseCalls: TSESTree.CallExpression[] = [];

    function isTrackedBinding(identifier: TSESTree.Identifier): boolean {
      let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(identifier);
      while (scope !== null) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined) {
          return variable.defs.some((def) => {
            if (isMoneyTypeNode(typeAnnotationOf(def.name)?.typeAnnotation)) {
              return true;
            }
            return def.node.type === 'VariableDeclarator' && isMoneyInitializer(def.node.init);
          });
        }
        scope = scope.upper;
      }
      return false;
    }

    /** Premier signal monétaire lu par l'expression (nom, déclaration suivie, appel nommé). */
    function findMoneyName(node: TSESTree.Node): string | null {
      switch (node.type) {
        case 'Identifier':
          return isMoneyIdentifierName(node.name) || isTrackedBinding(node) ? node.name : null;
        case 'MemberExpression':
          if (!node.computed) {
            if (node.property.type !== 'Identifier') {
              return null;
            }
            return isMoneyIdentifierName(node.property.name) || typedMemberNames.has(node.property.name) ? node.property.name : null;
          }
          return findMoneyName(node.object);
        case 'BinaryExpression':
        case 'LogicalExpression':
          return findMoneyName(node.left) ?? findMoneyName(node.right);
        case 'UnaryExpression':
        case 'AwaitExpression':
          return findMoneyName(node.argument);
        case 'TSAsExpression':
        case 'TSTypeAssertion':
        case 'TSSatisfiesExpression':
          return isMoneyTypeNode(node.typeAnnotation) ? 'Centimes' : findMoneyName(node.expression);
        case 'TSNonNullExpression':
        case 'ChainExpression':
          return findMoneyName(node.expression);
        case 'ConditionalExpression':
          return findMoneyName(node.consequent) ?? findMoneyName(node.alternate);
        case 'CallExpression': {
          if (isTransparentCall(node)) {
            for (const argument of node.arguments) {
              const found = findMoneyName(argument);
              if (found !== null) {
                return found;
              }
            }
            return null;
          }
          // Appel d'une fonction dont le nom porte l'unité (applyBps, centimes, getTotalCents) : son résultat est monétaire.
          const callee = node.callee;
          if (callee.type === 'Identifier' && isMoneyIdentifierName(callee.name)) {
            return callee.name;
          }
          if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && isMoneyIdentifierName(callee.property.name)) {
            return callee.property.name;
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

    /** Appel Math.round/floor/ceil/trunc dont l'argument est (à des enveloppes TypeScript près) cette division. */
    function enclosingRounding(node: TSESTree.Node): TSESTree.CallExpression | null {
      let child: TSESTree.Node = node;
      let parent = child.parent;
      while (
        parent !== undefined &&
        (parent.type === 'TSAsExpression' || parent.type === 'TSNonNullExpression' || parent.type === 'TSTypeAssertion' || parent.type === 'TSSatisfiesExpression')
      ) {
        child = parent;
        parent = child.parent;
      }
      if (parent !== undefined && isRoundingCall(parent) && parent.arguments[0] === child) {
        return parent;
      }
      return null;
    }

    function collectTypedMember(node: TSESTree.TSPropertySignature | TSESTree.PropertyDefinition): void {
      if (node.computed || node.key.type !== 'Identifier') {
        return;
      }
      if (isMoneyTypeNode(node.typeAnnotation?.typeAnnotation)) {
        typedMemberNames.add(node.key.name);
      }
    }

    return {
      TSPropertySignature: collectTypedMember,
      PropertyDefinition: collectTypedMember,
      BinaryExpression(node) {
        if (node.operator === '/') {
          divisions.push(node);
        }
      },
      AssignmentExpression(node) {
        if (node.operator === '/=') {
          divisions.push(node);
        }
      },
      CallExpression(node) {
        if (isParseFloatCall(node)) {
          parseCalls.push(node);
        }
      },
      'Program:exit'() {
        for (const node of divisions) {
          const name = findMoneyName(node.left) ?? findMoneyName(node.right);
          if (name === null) {
            continue;
          }
          const rounding = enclosingRounding(node);
          if (rounding === null) {
            context.report({ node, messageId: 'floatDivision', data: { name } });
          } else {
            context.report({ node: rounding, messageId: 'floatRounding', data: { name } });
          }
        }
        for (const node of parseCalls) {
          for (const argument of node.arguments) {
            const name = findMoneyName(argument);
            if (name !== null) {
              context.report({ node, messageId: 'floatParse', data: { name } });
              break;
            }
          }
        }
      },
    };
  },
};

export const fiscaLocalPlugin: { readonly rules: { readonly 'no-float-money': typeof noFloatMoneyRule } } = {
  rules: { 'no-float-money': noFloatMoneyRule },
};
