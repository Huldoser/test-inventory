import type { BlockStatement, Node, Statement } from 'oxc-parser';
import { childNodes, isFunctionNode, unwrap } from './ast.ts';
import type { Resolved, Value } from './values.ts';

export type IteratorMethod = 'next' | 'return' | 'throw';

type Instruction =
  | { kind: 'statement' | 'finally' | 'catch'; node: Statement; scopes: readonly Node[] }
  | { kind: 'completion'; method: 'return' | 'throw'; value: Resolved }
  | { kind: 'delegate'; items: readonly Resolved[]; index: number };

interface Pending {
  instruction: Instruction;
  next: Pending | null;
  handlesThrow: boolean;
}

/** Null is a suspension at the last yield. Its next call still completes the generator. */
export type IteratorPosition = Pending | null | 'closed' | 'unknown' | 'running';
export const omitted: Resolved = { ok: true, value: undefined };
const unresolved: Resolved = { ok: false, importedFrom: null };

export interface GeneratorStep {
  position: IteratorPosition;
  outcome: 'next' | 'throw' | 'unknown';
  value: Resolved;
}

function unknownStep(): GeneratorStep {
  return { position: 'unknown', outcome: 'unknown', value: unresolved };
}

/** An expression containing a nested suspension cannot be visited atomically. Nested functions run independently. */
function suspends(node: Node): boolean {
  if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) return false;
  return node.type === 'YieldExpression' || childNodes(node).some(suspends);
}

/** Resume a synchronous generator with its lexical blocks and pending catch/finally handlers intact. */
export function stepGenerator(
  body: BlockStatement,
  position: IteratorPosition | undefined,
  method: IteratorMethod,
  argument: Resolved,
  evaluate: (node: Node, scopes: readonly Node[], read: boolean, handlesThrow: boolean) => Resolved | 'throw',
): GeneratorStep {
  if (position === 'running') return { position, outcome: 'throw', value: unresolved };
  if (position === 'unknown') return unknownStep();
  // Branches can share a suspension without copying the remaining body on every next() call.
  let stack: Pending | null = typeof position === 'object' ? position : null;
  const push = (instruction: Instruction) => {
    stack = { instruction, next: stack, handlesThrow: instruction.kind === 'catch' || !!stack?.handlesThrow };
  };
  if (position === undefined) push({ kind: 'statement', node: body, scopes: [] });
  let value = argument;
  while (stack) {
    const handlesThrow: boolean = stack.handlesThrow;
    const entry: Instruction = stack.instruction;
    stack = stack.next;
    if (entry.kind === 'completion') {
      if (method === 'next') {
        method = entry.method;
        value = entry.value;
      }
      continue;
    }
    if (entry.kind === 'catch') {
      if (method !== 'throw') continue;
      method = 'next';
    } else if (entry.kind === 'finally') {
      if (method !== 'next') push({ kind: 'completion', method, value });
      method = 'next';
    } else if (method !== 'next') continue;
    if (entry.kind === 'delegate') {
      const index = entry.index;
      if (index + 1 < entry.items.length) push({ ...entry, index: index + 1 });
      return { position: stack, outcome: 'next', value: entry.items[index] };
    }
    const { node, scopes } = entry;
    if (node.type === 'BlockStatement') {
      const inside = [...scopes, node];
      for (let i = node.body.length - 1; i >= 0; i--) push({ kind: 'statement', node: node.body[i], scopes: inside });
    } else if (node.type === 'TryStatement') {
      if (node.finalizer) push({ kind: 'finally', node: node.finalizer, scopes });
      if (node.handler) push({ kind: 'catch', node: node.handler.body, scopes: [...scopes, node.handler] });
      push({ kind: 'statement', node: node.block, scopes });
    } else if (node.type === 'IfStatement') {
      if (suspends(node.test)) return unknownStep();
      const test = evaluate(node.test, scopes, true, handlesThrow);
      if (test === 'throw') method = 'throw';
      else if (!test.ok) return unknownStep();
      else {
        const branch = test.value ? node.consequent : node.alternate;
        if (branch) push({ kind: 'statement', node: branch, scopes });
      }
    } else {
      const expression = node.type === 'ExpressionStatement' ? unwrap(node.expression) : null;
      const yieldNode = expression?.type === 'YieldExpression' ? expression : null;
      const operand = yieldNode
        ? yieldNode.argument
        : node.type === 'ReturnStatement' || node.type === 'ThrowStatement'
          ? node.argument
          : node;
      if (operand && suspends(operand)) return unknownStep();
      const result = operand ? evaluate(operand, scopes, operand !== node, handlesThrow) : omitted;
      if (result === 'throw' || node.type === 'ThrowStatement') {
        method = 'throw';
        value = result === 'throw' ? unresolved : result;
      } else if (yieldNode) {
        if (!yieldNode.delegate) return { position: stack, outcome: 'next', value: result };
        if (!result.ok) return unknownStep();
        if (typeof result.value !== 'string' && !Array.isArray(result.value)) method = 'throw';
        else {
          const items = Array.from(result.value as Iterable<Value>, (value) => ({ ok: true as const, value }));
          if (items.length) push({ kind: 'delegate', items, index: 0 });
        }
      } else if (node.type === 'ReturnStatement') {
        method = 'return';
        value = result;
      }
    }
  }
  return {
    position: 'closed',
    outcome: method === 'throw' ? 'throw' : 'next',
    value: method === 'return' ? value : omitted,
  };
}
