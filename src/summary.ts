import type { Diagnostic, Summary, SuiteRecord, TestRecord } from './types.ts';

function countBy(tests: readonly TestRecord[], keys: (test: TestRecord) => string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const test of tests) {
    for (const key of new Set(keys(test))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function summarize(
  fileCount: number,
  suites: readonly SuiteRecord[],
  tests: readonly TestRecord[],
  diagnostics: readonly Diagnostic[],
): Summary {
  const count = (key: keyof TestRecord) => tests.filter((test) => test[key] === true).length;
  return {
    fileCount,
    suiteCount: suites.length,
    testCount: tests.length,
    activeCount: count('isActive'),
    skipCount: count('isSkipped'),
    fixmeCount: count('isFixme'),
    todoCount: count('isTodo'),
    expectedToFailCount: count('isExpectedToFail'),
    notLoadedCount: count('isNotLoaded'),
    onlyCount: count('isOnly'),
    conditionalCount: count('isConditional'),
    parallelCount: count('isParallel'),
    serialCount: count('isSerial'),
    parameterizedCount: count('isParameterized'),
    inLoopCount: count('isInLoop'),
    inConditionCount: count('isInCondition'),
    inFunctionCount: count('isInFunction'),
    typeTestCount: count('isTypeTest'),
    diagnosticCount: diagnostics.length,
    tagCounts: countBy(tests, (test) => test.tags),
    annotationCounts: countBy(tests, (test) => test.annotations.map((annotation) => annotation.type)),
  };
}
