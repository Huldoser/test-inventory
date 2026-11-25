import type { BlockStatement, Expression, Node, Statement, YieldExpression } from 'oxc-parser';
import { childNodes, isFunctionNode, unwrap } from './ast.ts';
import { usesRightOperand, type Resolved, type Value } from './values.ts';

export type IteratorMethod = 'next' | 'return' | 'throw';

type Instruction =
  | { kind: 'statement' | 'finally' | 'catch'; node: Statement; scopes: readonly Node[] }
  | { kind: 'completion'; method: 'return' | 'throw'; value: Resolved }
  | { kind: 'forward'; iterator: Resolved; receive?: YieldExpression }
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

type Evaluation = Resolved | 'throw' | 'unknown' | { receive: YieldExpression; value: Resolved };

function completed(result: Evaluation): result is Resolved {
  return typeof result === 'object' && 'ok' in result;
}

const yielding = new WeakMap<Node, boolean>();

/** A nested function has its own suspensions, even when it shares the enclosing generator's lexical scope. */
function suspends(node: Node): boolean {
  const known = yielding.get(node);
  if (known !== undefined) return known;
  const result =
    node.type === 'YieldExpression' ||
    (node.type !== 'FunctionDeclaration' && !isFunctionNode(node) && childNodes(node).some(suspends));
  yielding.set(node, result);
  return result;
}

/** Completed operands survive a pause. On resumption only the selected, unfinished operands can run. */
function resumeExpression(
  expression: Expression,
  operands: Map<Node, Resolved>,
  evaluate: (node: Expression) => Resolved | 'throw',
  enterCall: (name: string) => void,
): Evaluation {
  function read(input: Expression): Evaluation {
    const node = unwrap(input);
    const known = operands.get(node);
    if (known) return known;
    const result = suspends(node) ? resume(node) : evaluate(node);
    if (completed(result)) operands.set(node, result);
    return result;
  }

  function resume(node: Expression): Evaluation {
    if (node.type === 'YieldExpression') {
      const value = node.argument ? read(node.argument) : omitted;
      return completed(value) ? { receive: node, value } : value;
    }
    if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
      const control = read(node.type === 'ConditionalExpression' ? node.test : node.left);
      if (!completed(control)) return control;
      if (!control.ok && !control.truthy) return 'unknown';
      const value = control.ok ? control.value : true;
      if (node.type === 'ConditionalExpression') return read(value ? node.consequent : node.alternate);
      return usesRightOperand(node.operator, value) ? read(node.right) : control;
    }
    let parts;
    if (node.type === 'CallExpression' && !node.optional && node.callee.type === 'Identifier') {
      enterCall(node.callee.name);
      parts = node.arguments;
    } else if (node.type === 'BinaryExpression') parts = [node.left, node.right];
    else if (node.type === 'TemplateLiteral') parts = node.expressions;
    else if (node.type === 'UnaryExpression') parts = [node.argument];
    else return 'unknown';

    // The ordinary evaluator can finish the suffix, including a spread after the last suspension.
    const last = parts.findLastIndex(suspends);
    for (let i = 0; i <= last; i++) {
      const part = parts[i];
      if (part.type === 'SpreadElement' || part.type === 'PrivateIdentifier') return 'unknown';
      const value = read(part);
      if (!completed(value)) return value;
    }
    return evaluate(node);
  }
  return read(expression);
}

interface GeneratorEnvironment {
  operands: Map<Node, Resolved>;
  evaluate: (node: Node, scopes: readonly Node[], read: boolean, handlesThrow: boolean) => Resolved | 'throw';
  enterCall: (name: string, scopes: readonly Node[]) => void;
  iteratorOf: (operand: Expression, scopes: readonly Node[]) => Resolved | undefined;
  resumeDelegate: (iterator: Resolved, method: IteratorMethod, value: Resolved, handlesThrow: boolean) => GeneratorStep;
  spreadDelegate?: (operand: Expression, scopes: readonly Node[]) => GeneratorStep['outcome'];
}

/** Resume a synchronous generator with its lexical blocks and pending catch/finally handlers intact. */
export function stepGenerator(
  body: BlockStatement,
  position: IteratorPosition | undefined,
  method: IteratorMethod,
  argument: Resolved,
  { operands, evaluate, enterCall, iteratorOf, resumeDelegate, spreadDelegate }: GeneratorEnvironment,
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
    if (entry.kind === 'forward') {
      const step = resumeDelegate(entry.iterator, method, value, handlesThrow);
      if (step.outcome === 'unknown') return unknownStep();
      value = step.value;
      if (step.outcome === 'throw') method = 'throw';
      else if (step.position !== 'closed') {
        push(entry);
        return { position: { stack, operands }, outcome: 'next', value };
      } else if (method !== 'return') {
        method = 'next';
        if (entry.receive) operands.set(entry.receive, value);
      }
      continue;
    }
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
      let yieldNode = expression?.type === 'YieldExpression' ? expression : null;
      let receive: YieldExpression | undefined;
      const operand = yieldNode
        ? yieldNode.argument
        : node.type === 'ReturnStatement' || node.type === 'ThrowStatement'
          ? node.argument
          : node.type === 'IfStatement'
            ? node.test
            : node;
      let result: Evaluation;
      if (operand && suspends(operand)) {
        const declaration =
          node.type === 'VariableDeclaration' && node.declarations.length === 1 && node.declarations[0];
        const input =
          operand !== node
            ? (operand as Expression)
            : (expression ?? (declaration && declaration.id.type === 'Identifier' && declaration.init));
        if (!input) return unknownStep();
        result = resumeExpression(
          input,
          operands,
          (part) => evaluate(part, scopes, true, handlesThrow),
          (name) => {
            enterCall(name, scopes);
          },
        );
        if (result === 'unknown') return unknownStep();
        if (typeof result === 'object' && 'receive' in result) {
          push(entry);
          receive = yieldNode = result.receive;
          result = result.value;
        }
      } else result = operand ? evaluate(operand, scopes, operand !== node, handlesThrow) : omitted;
      if (result === 'throw') {
        method = 'throw';
        value = unresolved;
      } else if (yieldNode) {
        if (!yieldNode.delegate) return { position: { stack, operands, receive }, outcome: 'next', value: result };
        const iterable = yieldNode.argument as Expression;
        const iterator = iteratorOf(iterable, scopes);
        if (iterator) {
          push({ kind: 'forward', iterator, receive });
          value = omitted;
          continue;
        }
        // Built-in string and array iterators finish with an undefined value.
        if (receive) operands.set(receive, omitted);
        if (spreadDelegate) {
          const outcome = spreadDelegate(iterable, scopes);
          if (outcome === 'unknown') return unknownStep();
          method = outcome;
          continue;
        }
        if (!result.ok) return unknownStep();
        if (typeof result.value !== 'string' && !Array.isArray(result.value)) method = 'throw';
        else {
          const items = Array.from(result.value as Iterable<Value>, (value) => ({ ok: true as const, value }));
          if (items.length) push({ kind: 'delegate', items, index: 0 });
        }
      } else if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
        method = node.type === 'ReturnStatement' ? 'return' : 'throw';
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
    value: method === 'next' ? omitted : value,
  };
}
