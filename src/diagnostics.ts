import type { Problem } from './model.ts';
import type { SourceText } from './source.ts';
import type { Diagnostic, DiagnosticCode, DiagnosticLevel, Framework } from './types.ts';

/** `error` when tests may be missing from the output; `warning` when a value is missing or approximate. */
export const LEVELS: Record<DiagnosticCode, DiagnosticLevel> = {
  'unresolved-test-import': 'error',
  'parse-error': 'error',
  'read-error': 'error',
  'framework-mismatch': 'error',
  'unresolved-tag': 'warning',
  'unresolved-annotation': 'warning',
  'unresolved-cases': 'warning',
  'test-in-loop': 'warning',
  'dynamic-title': 'warning',
  'duplicate-title': 'warning',
  'duplicate-id': 'error',
  'internal-error': 'error',
  'invalid-chain': 'error',
  'skip-without-body': 'warning',
  'test-without-body': 'error',
  'describe-not-called': 'error',
  'async-describe': 'error',
  'nested-test': 'warning',
  'tag-without-at': 'error',
  'removed-api': 'error',
  'only-in-skipped-describe': 'warning',
  'config-may-change-state': 'warning',
  'symlink-ignored': 'warning',
  'invalid-import': 'error',
  'globals-not-enabled': 'warning',
  'unknown-framework-version': 'warning',
  'unsupported-framework-version': 'warning',
  'local-test-object': 'warning',
  'state-in-helper': 'warning',
  'unresolved-option': 'warning',
  'dynamic-reason': 'warning',
  'no-files-matched': 'warning',
  'unsupported-file': 'warning',
  'approximate-framework-version': 'warning',
};

/** Problems for which the runner refuses to load the whole file, so that none of its tests run. */
export const REJECTS_FILE: Record<Framework, ReadonlySet<DiagnosticCode>> = {
  playwright: new Set(['test-without-body', 'tag-without-at', 'invalid-chain', 'duplicate-title']),
  vitest: new Set(),
};

export function toDiagnostic(
  problem: Problem,
  relativeFilePath: string,
  source: SourceText | null,
  testId: string | null = null,
): Diagnostic {
  const position = problem.node && source ? source.position(problem.node.start) : null;
  return {
    code: problem.code,
    level: problem.level ?? LEVELS[problem.code],
    message: problem.message,
    relativeFilePath,
    lineStart: position?.line ?? null,
    columnStart: position?.column ?? null,
    testId,
    source: problem.source,
  };
}

export function fileDiagnostic(code: DiagnosticCode, relativeFilePath: string, message: string): Diagnostic {
  return toDiagnostic({ code, node: null, message, source: null }, relativeFilePath, null);
}
