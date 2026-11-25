import type { BlockStatement, Expression, Node, Statement, YieldExpression } from 'oxc-parser';
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

interface Suspension {
  stack: Pending | null;
  operands: ReadonlyMap<Node, Resolved>;
  receive?: YieldExpression;
}

export type IteratorPosition = Suspension | 'closed' | 'unknown' | 'running';
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
function suspends(node: Node, operands: ReadonlyMap<Node, Resolved>): boolean {
  if (operands.has(node) || node.type === 'FunctionDeclaration' || isFunctionNode(node)) return false;
  return node.type === 'YieldExpression' || childNodes(node).some((child) => suspends(child, operands));
}

/** Only split expressions whose operand order is known. Earlier call arguments run before the suspension. */
function nextYield(
  node: Node,
  operands: ReadonlyMap<Node, Resolved>,
  prefix: (Expression | string)[],
): YieldExpression | undefined {
  if (node.type === 'VariableDeclaration') {
    const [declaration] = node.declarations;
    if (node.declarations.length === 1 && declaration.id.type === 'Identifier' && declaration.init)
      return nextYield(unwrap(declaration.init), operands, prefix);
  } else if (node.type === 'ExpressionStatement') {
    return nextYield(unwrap(node.expression), operands, prefix);
  } else if (node.type === 'YieldExpression' && !node.delegate) {
    return node.argument && suspends(node.argument, operands)
      ? nextYield(unwrap(node.argument), operands, prefix)
      : node;
  } else if (node.type === 'CallExpression' && !node.optional && node.callee.type === 'Identifier') {
    prefix.push(node.callee.name);
    for (const arg of node.arguments) {
      if (arg.type === 'SpreadElement') break;
      if (suspends(arg, operands)) return nextYield(unwrap(arg), operands, prefix);
      if (!operands.has(unwrap(arg))) prefix.push(unwrap(arg));
    }
  }
}

/** Resume a synchronous generator with its lexical blocks and pending catch/finally handlers intact. */
export function stepGenerator(
  body: BlockStatement,
  position: IteratorPosition | undefined,
  method: IteratorMethod,
  argument: Resolved,
  operands: Map<Node, Resolved>,
  evaluate: (node: Node, scopes: readonly Node[], read: boolean, handlesThrow: boolean) => Resolved | 'throw',
  enterCall: (name: string, scopes: readonly Node[]) => void,
): GeneratorStep {
  if (position === 'running') return { position, outcome: 'throw', value: unresolved };
  if (position === 'unknown') return unknownStep();
  // Branches can share a suspension without copying the remaining body on every next() call.
  let stack: Pending | null = typeof position === 'object' ? position.stack : null;
  if (typeof position === 'object' && position.receive && method === 'next') operands.set(position.receive, argument);
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
      return { position: { stack, operands }, outcome: 'next', value: entry.items[index] };
    }
    const { node, scopes } = entry;
    if (node.type === 'BlockStatement') {
      const inside = [...scopes, node];
      for (let i = node.body.length - 1; i >= 0; i--) push({ kind: 'statement', node: node.body[i], scopes: inside });
    } else if (node.type === 'TryStatement') {
      if (node.finalizer) push({ kind: 'finally', node: node.finalizer, scopes });
      if (node.handler) push({ kind: 'catch', node: node.handler.body, scopes: [...scopes, node.handler] });
      push({ kind: 'statement', node: node.block, scopes });
    } else {
      const expression = node.type === 'ExpressionStatement' ? unwrap(node.expression) : null;
      const yieldNode = expression?.type === 'YieldExpression' ? expression : null;
      const operand = yieldNode
        ? yieldNode.argument
        : node.type === 'ReturnStatement' || node.type === 'ThrowStatement'
          ? node.argument
          : node.type === 'IfStatement'
            ? node.test
            : node;
      if (operand && suspends(operand, operands)) {
        const prefix: (Expression | string)[] = [];
        const receive = nextYield(operand, operands, prefix);
        if (!receive) return unknownStep();
        for (const earlier of prefix) {
          if (typeof earlier === 'string') {
            enterCall(earlier, scopes);
            continue;
          }
          const result = evaluate(earlier, scopes, true, handlesThrow);
          if (result === 'throw') {
            method = 'throw';
            break;
          }
          operands.set(earlier, result);
        }
        if (method === 'throw') continue;
        const result = receive.argument ? evaluate(receive.argument, scopes, true, handlesThrow) : omitted;
        if (result === 'throw') {
          method = 'throw';
          continue;
        }
        push(entry);
        return { position: { stack, operands, receive }, outcome: 'next', value: result };
      }
      const result = operand ? evaluate(operand, scopes, operand !== node, handlesThrow) : omitted;
      if (result === 'throw' || node.type === 'ThrowStatement') {
        method = 'throw';
        value = result === 'throw' ? unresolved : result;
      } else if (yieldNode) {
        if (!yieldNode.delegate) return { position: { stack, operands }, outcome: 'next', value: result };
        if (!result.ok) return unknownStep();
        if (typeof result.value !== 'string' && !Array.isArray(result.value)) method = 'throw';
        else {
          const items = Array.from(result.value as Iterable<Value>, (value) => ({ ok: true as const, value }));
          if (items.length) push({ kind: 'delegate', items, index: 0 });
        }
      } else if (node.type === 'ReturnStatement') {
        method = 'return';
        value = result;
      } else if (node.type === 'IfStatement') {
        if (!result.ok) return unknownStep();
        const branch = result.value ? node.consequent : node.alternate;
        if (branch) push({ kind: 'statement', node: branch, scopes });
      }
    }
  }
  return {
    position: 'closed',
    outcome: method === 'throw' ? 'throw' : 'next',
    value: method === 'return' ? value : omitted,
  };
}
