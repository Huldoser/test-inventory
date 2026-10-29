import path from 'node:path';
import type { ConfigRuns, Placement } from './config-runs.ts';
import { settingAt, type ConfigFile, type Setting } from './config.ts';
import type { ModuleReader, ModuleSource, Span } from './model.ts';
import type { SourceText } from './source.ts';
import type { Framework } from './types.ts';

/** Something in a config the scan can't follow: where it is written, or the config when that isn't known. */
export type ConfigGap = {
  message: string;
  /** Not reported: the key isn't written, and what can't be worked out is the object around it, reported already. */
  isQuiet: boolean;
} & ({ relativeFilePath: string; source: SourceText; span: Span } | { module: ModuleSource });

/** What the config a file uses runs with each of its tests: modules to take whole, and what can't be followed. */
export interface RunsWith {
  /** The config the file uses, which builds on others through imports. */
  config: ModuleSource | null;
  /** Its setup files, and the files of setup projects. */
  modules: ModuleSource[];
  gaps: ConfigGap[];
}

const NOTHING: RunsWith = { config: null, modules: [], gaps: [] };

/** The setup files a config names, by framework: setting paths from the config, or `test` for Vitest's. */
const SETUP_KEYS: Record<Framework, { keys: string[]; ofProject: boolean }[]> = {
  playwright: [
    { keys: ['globalSetup'], ofProject: false },
    { keys: ['globalTeardown'], ofProject: false },
  ],
  vitest: [
    { keys: ['test', 'setupFiles'], ofProject: true },
    { keys: ['test', 'globalSetup'], ofProject: true },
  ],
};

/**
 * Finds what each file's config makes its tests run besides the file: the config itself, which brings in the configs it
 * builds on through imports, its setup files and global setup and teardown, and for Playwright the files of the setup
 * projects the file's projects depend on. Read once per config and set of projects.
 */
export class ConfigDependencies {
  private readonly framework: Framework;
  private readonly runs: ConfigRuns;
  private readonly readerFor: (fromFile: string) => ModuleReader;
  /** The files setup projects may run: every script file of the project. */
  private readonly candidates: readonly string[];
  private readonly found = new Map<string, RunsWith>();

  constructor(
    framework: Framework,
    runs: ConfigRuns,
    readerFor: (fromFile: string) => ModuleReader,
    candidates: readonly string[],
  ) {
    this.framework = framework;
    this.runs = runs;
    this.readerFor = readerFor;
    this.candidates = candidates;
  }

  of(placement: Placement): RunsWith {
    const { config } = placement;
    if (config === null) return NOTHING;
    const names = (placement.projects ?? []).map((project) => project.name);
    const key = `${config.file}\0${names.join('\0')}`;
    let found = this.found.get(key);
    if (!found) {
      found = this.read(config, placement);
      this.found.set(key, found);
    }
    return found;
  }

  private read(config: ConfigFile, placement: Placement): RunsWith {
    const modules: ModuleSource[] = [];
    const gaps: ConfigGap[] = [];
    const own = this.module(config.file);
    // The config is read when the scan finds it; one that can't be read is reported then.
    if (!own) return NOTHING;
    const folder = path.dirname(config.file);
    const resolve = (file: string, key: string) => {
      // `path.join(__dirname, 'setup.ts')` gives an absolute path.
      const relative = path.isAbsolute(file) ? `./${path.relative(folder, file).replaceAll('\\', '/')}` : file;
      const isPath = relative.startsWith('.');
      const read = this.readerFor(config.file)(isPath ? relative : `./${relative}`);
      if (!('reason' in read)) modules.push(read);
      // A name that isn't a file beside the config is a package, whose code is left out as installed code is.
      else if (isPath)
        gaps.push({
          module: own,
          message: `${key} names '${file}', which ${read.reason}, so dependencyHash doesn't cover it.`,
          isQuiet: false,
        });
    };
    const places = new Set<Span>();
    for (const { keys, ofProject } of SETUP_KEYS[this.framework]) {
      const key = keys.join('.');
      // A placement with a config has its project's settings.
      const found = written(ofProject ? (placement.settings as Setting) : config.settings, keys);
      if (found === null) continue;
      for (const item of listOf(found.setting)) {
        if (item.kind === 'value' && typeof item.value === 'string') resolve(item.value, key);
        // One gap per place, as both setup keys may come from the same spread.
        else if (item.kind === 'unknown' && item.where && !places.has(item.where.node)) {
          places.add(item.where.node);
          const { frame, node } = item.where;
          gaps.push({
            relativeFilePath: frame.relativeFilePath,
            source: frame.parsed.source,
            span: node,
            message: `${key} can't be worked out, so dependencyHash doesn't cover the files it names.`,
            isQuiet: found.isInherited,
          });
        }
      }
    }
    for (const name of this.setupProjects(config, placement)) {
      const files = this.runs.filesOfProject(config, name, this.candidates);
      if (files === null) {
        gaps.push({
          module: own,
          message: `The files of the setup project '${name}' can't be worked out, so dependencyHash doesn't cover them.`,
          isQuiet: false,
        });
        continue;
      }
      modules.push(...files.map((file) => this.module(file)).filter((module) => module !== null));
    }
    return { config: own, modules, gaps };
  }

  /** The projects that run before the file's own, as their `dependencies` name them, and the ones those depend on. */
  private setupProjects(config: ConfigFile, placement: Placement): string[] {
    const records = this.runs.projectsIn(config) ?? [];
    const names = new Set<string>();
    const pending = (placement.projects ?? []).flatMap((project) => project.dependencies);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (names.has(name)) continue;
      names.add(name);
      pending.push(...(records.find((record) => record.name === name)?.dependencies ?? []));
    }
    return [...names];
  }

  /** A file the scan reads code from, by its absolute path, as the modules a test imports are read. */
  private module(file: string): ModuleSource | null {
    const read = this.readerFor(file)(`./${path.basename(file)}`);
    return 'reason' in read ? null : read;
  }
}

/**
 * The setting under a path of keys, and whether it comes from an object around it that the scan can't work out
 * rather than from the key itself; null when the config doesn't set it.
 */
function written(setting: Setting, keys: readonly string[]): { setting: Setting; isInherited: boolean } | null {
  const found = settingAt(setting, keys);
  if (found?.kind !== 'unknown') return found && { setting: found, isInherited: false };
  // An unknown setting is set by the object around the key when the key itself isn't written there.
  const around = settingAt(setting, keys.slice(0, -1)) as Setting;
  const isWritten = around.kind === 'object' && around.keys.get(keys.at(-1) as string) === found;
  return { setting: found, isInherited: !isWritten };
}

function listOf(setting: Setting): Setting[] {
  return setting.kind === 'list' ? setting.items : [setting];
}
