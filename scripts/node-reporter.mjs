// A node:test reporter for scripts/compare-runners.ts. It writes one JSON line per test, with its file, line, the
// titles of the describes and tests around it, and its status; describes are left out, as they are not records.
export default async function* compareReporter(source) {
  const titles = new Map();
  const path = [];
  for await (const { type, data } of source) {
    const at = `${data.file}:${data.line}:${data.column}:${data.nesting}`;
    if (type === 'test:start') {
      path.length = data.nesting;
      path.push(data.name);
      titles.set(at, [...path]);
    } else if ((type === 'test:pass' || type === 'test:fail') && data.details?.type === 'test') {
      const status =
        data.skip !== undefined
          ? 'skipped'
          : data.todo !== undefined
            ? 'todo'
            : data.expectFailure
              ? 'expectedToFail'
              : 'ran';
      yield `${JSON.stringify({ file: data.file, line: data.line, titles: titles.get(at) ?? [data.name], status })}\n`;
    }
  }
}
