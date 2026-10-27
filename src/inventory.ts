import type { FileRecords } from './records.ts';
import { summarize } from './summary.ts';
import type { ConfigRecord, Diagnostic, Framework, Inventory } from './types.ts';
import { toolVersion } from './version.ts';

export function createInventory(
  framework: Framework,
  frameworkVersion: string | null,
  fileCount: number,
  files: readonly FileRecords[],
  projectDiagnostics: readonly Diagnostic[],
  configs: ConfigRecord[],
): Inventory {
  const suites = files.flatMap((file) => file.suites);
  const tests = files.flatMap((file) => file.tests);
  const diagnostics = [...projectDiagnostics, ...files.flatMap((file) => file.diagnostics)];
  return {
    schemaVersion: 1,
    tool: { name: 'test-inventory', version: toolVersion },
    framework,
    frameworkVersion,
    summary: summarize(fileCount, suites, tests, diagnostics),
    configs,
    files: files.map((file) => file.file),
    suites,
    tests,
    diagnostics,
  };
}
