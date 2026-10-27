import { readFileSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { globSync } from 'tinyglobby';
import {
  mergeDeep,
  settingAt,
  type ConfigFile,
  type Configs,
  type ObjectSetting,
  type Setting,
  type Unknown,
} from './config.ts';
import type { Framework } from './types.ts';
import {
  VITEST_BENCHMARK_INCLUDE,
  VITEST_INCLUDE,
  VITEST_TYPECHECK_INCLUDE,
  vitestExclude,
} from './vitest-defaults.ts';

const PLAYWRIGHT_TEST_MATCH = '**/*.@(spec|test).?(c|m)[jt]s?(x)';
/** A file Vitest takes as a project config, by name. */
const VITEST_CONFIG = /^(vitest|vite)(\..*)?\.config\./;

/** A setting read for a project, and the key to name it by when the scan can't work it out. */
interface Taken {
  setting: Setting;
  key: string;
}

/** What makes a file run: as a test, or as a Vitest benchmark, which plain `vitest` doesn't run. */
type Run = 'test' | 'benchmark';

/**
 * A set of test files: one Playwright or Vitest project, with the settings that apply to its tests. `runs` says how it
 * runs a file, or false; it is null when a file setting can't be worked out, which `unknown` names, so that the project
 * may run any file.
 */
type Project = { config: ConfigFile; settings: Setting } & (
  { runs: (file: string) => Run | false; unknown: null } | { runs: null; unknown: { setting: Unknown; key: string } }
);

/** The config a file uses, the settings of its project, and how that config runs it. */
export interface Placement {
  config: ConfigFile | null;
  settings: Setting | null;
  /** False when no config runs the file; null when there is no config, or one can't tell. */
  runs: Run | false | null;
}

const ASSUMED = 'the scan takes its files to be run';

function emptySettings(): Setting {
  return { kind: 'object', keys: new Map(), rest: null };
}

/**
 * The globs, and the regular expressions when `regexps` allows them, of a setting such as `testMatch` or `include`;
 * the first item the scan can't use when there is one.
 */
function patterns(setting: Setting, regexps: boolean): (string | RegExp)[] | Unknown {
  const items = setting.kind === 'list' ? setting.items : [setting];
  const found: (string | RegExp)[] = [];
  for (const item of items) {
    if (regexps && item.kind === 'regex') found.push(new RegExp(item.source, item.flags));
    else if (item.kind === 'value' && typeof item.value === 'string') found.push(item.value);
    else return unknownAt(item);
  }
  return found;
}

function posix(file: string): string {
  return file.split(path.sep).join('/');
}

/** A path inside a folder, not the folder itself or a path outside it. */
function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Playwright's file matcher: a regular expression is tried on the absolute path, and a glob, with `**\/` put in front
 * unless it starts with it, matches the absolute path in any case.
 */
function playwrightMatcher(list: (string | RegExp)[]): (file: string) => boolean {
  const expressions = list.filter((item) => item instanceof RegExp);
  const globs = list
    .filter((item) => typeof item === 'string')
    .map((glob) => (glob.startsWith('**/') ? glob : `**/${glob}`));
  const isMatch = picomatch(globs, { nocase: true, dot: true });
  return (file) => {
    const unix = posix(file);
    return (
      isMatch(unix) ||
      expressions.some((expression) =>
        [file, unix].some((text) => {
          expression.lastIndex = 0;
          return expression.test(text);
        }),
      )
    );
  };
}

/** A rule of a `.gitignore` file, read as Playwright reads it. */
interface IgnoreRule {
  folder: string;
  negate: boolean;
  match: (text: string) => boolean;
}

/** Finds the configs a file is under and decides which one runs it, as the runner started at the root would. */
export class ConfigRuns {
  private readonly configs: Configs;
  private readonly framework: Framework;
  private readonly version: [number, number] | null;
  private readonly projects = new Map<ConfigFile, Project[]>();
  private readonly ignoreRules = new Map<string, IgnoreRule[]>();

  constructor(configs: Configs, framework: Framework, version: [number, number] | null) {
    this.configs = configs;
    this.framework = framework;
    this.version = version;
  }

  /**
   * The config a file uses, as the runner started at the root would: the outermost config at or above it that runs it,
   * with the project that does; else the outermost one whose files the scan can't work out, reported then; else the
   * nearest config.
   */
  placementOf(file: string): Placement {
    const around = this.configs.around(file);
    const projects = around.flatMap((config) => this.projectsOf(config));
    for (const project of projects) {
      const runs = project.runs?.(file);
      if (runs) return { config: project.config, settings: project.settings, runs };
    }
    const unknown = projects.find((project) => project.unknown);
    if (unknown?.unknown) {
      this.configs.reportUnknown(unknown.unknown.setting, unknown.unknown.key, ASSUMED);
      return { config: unknown.config, settings: unknown.settings, runs: null };
    }
    const nearest = around.at(-1) ?? null;
    return { config: nearest, settings: nearest?.settings ?? null, runs: nearest ? false : null };
  }

  private projectsOf(config: ConfigFile): Project[] {
    let projects = this.projects.get(config);
    if (!projects) {
      projects = this.framework === 'playwright' ? this.playwrightProjects(config) : this.vitestProjects(config);
      this.projects.set(config, projects);
    }
    return projects;
  }

  /** A project whose files can't be worked out, because of `setting` under `key`: it may run any file. */
  private unknownProject(config: ConfigFile, setting: Unknown, key: string): Project {
    return { config, settings: setting, runs: null, unknown: { setting, key } };
  }

  private playwrightProjects(config: ConfigFile): Project[] {
    const list = settingAt(config.settings, ['projects']);
    if (list?.kind === 'unknown') return [this.unknownProject(config, list, 'projects')];
    const items = list?.kind === 'list' ? list.items : [emptySettings()];
    return items.map((project) => this.playwrightProject(config, project));
  }

  /** A Playwright project: its own settings, else the config's, else Playwright's defaults. */
  private playwrightProject(config: ConfigFile, project: Setting): Project {
    if (project.kind === 'unknown') return this.unknownProject(config, project, 'projects');
    const take = (key: string): Taken | null => {
      for (const [setting, name] of [
        [settingAt(project, [key]), `projects ${key}`],
        [settingAt(config.settings, [key]), key],
      ] as const) {
        if (setting && !isUnset(setting)) return { setting, key: name };
      }
      return null;
    };
    const folder = path.dirname(config.file);
    const testDir = take('testDir');
    const testMatch = take('testMatch');
    const testIgnore = take('testIgnore');
    const respectGitIgnore = take('respectGitIgnore');
    const match = testMatch ? patterns(testMatch.setting, true) : [PLAYWRIGHT_TEST_MATCH];
    if (!Array.isArray(match)) return this.unknownProject(config, match, (testMatch as Taken).key);
    const ignore = testIgnore ? patterns(testIgnore.setting, true) : [];
    if (!Array.isArray(ignore)) return this.unknownProject(config, ignore, (testIgnore as Taken).key);
    let root = folder;
    if (testDir) {
      const { setting, key } = testDir;
      if (setting.kind !== 'value' || typeof setting.value !== 'string') {
        return this.unknownProject(config, unknownAt(setting), key);
      }
      root = path.resolve(folder, setting.value);
    }
    // Playwright reads .gitignore files only when no testDir is set, unless told otherwise.
    let gitIgnore = testDir === null;
    if (respectGitIgnore) {
      const { setting, key } = respectGitIgnore;
      if (setting.kind !== 'value') return this.unknownProject(config, unknownAt(setting), key);
      gitIgnore = setting.value === true;
    }
    const isMatch = playwrightMatcher(match);
    const isIgnored = playwrightMatcher(ignore);
    return {
      config,
      settings: config.settings,
      unknown: null,
      runs: (file) => {
        if (!isInside(root, file)) return false;
        if (gitIgnore && this.isGitIgnored(root, file)) return false;
        return !isIgnored(file) && isMatch(file) ? 'test' : false;
      },
    };
  }

  /**
   * Whether `.gitignore` files in a project's test folder, and the folders below it on the way to the file, leave the
   * file out, as Playwright reads them: a folder they leave out is not entered.
   */
  private isGitIgnored(root: string, file: string): boolean {
    const parts = path.relative(root, file).split(path.sep);
    let rules: IgnoreRule[] = [];
    let ignored = false;
    let folder = root;
    for (const [index, part] of parts.entries()) {
      rules = [...rules, ...this.rulesIn(folder)];
      const entry = path.join(folder, part);
      const isFolder = index < parts.length - 1;
      for (const rule of rules) {
        if (ignored !== rule.negate) continue;
        const relative = posix(path.relative(rule.folder, entry));
        const texts = [`/${relative}`, relative, ...(isFolder ? [`/${relative}/`, `${relative}/`] : [])];
        if (texts.some((text) => rule.match(text))) ignored = !rule.negate;
      }
      if (ignored) return true;
      folder = entry;
    }
    return false;
  }

  private rulesIn(folder: string): IgnoreRule[] {
    let rules = this.ignoreRules.get(folder);
    if (!rules) {
      let text = '';
      try {
        text = readFileSync(path.join(folder, '.gitignore'), 'utf8');
      } catch {
        // A folder without a .gitignore, or one the scan can't read, ignores nothing.
      }
      rules = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => {
          const negate = line.startsWith('!');
          const match = picomatch(negate ? line.slice(1) : line, { basename: true, dot: true });
          return { folder, negate, match };
        });
      this.ignoreRules.set(folder, rules);
    }
    return rules;
  }

  private vitestProjects(config: ConfigFile): Project[] {
    const folder = path.dirname(config.file);
    const list = settingAt(config.settings, ['test', 'projects']);
    if (list === null) return [this.vitestProject(config, config.settings, folder)];
    if (list.kind !== 'list') return [this.unknownProject(config, unknownAt(list), 'test.projects')];
    return list.items.flatMap((item) => this.vitestEntry(config, item, folder));
  }

  /** The projects one entry of `test.projects` stands for: a project written in the config, or config files and folders. */
  private vitestEntry(config: ConfigFile, entry: Setting, folder: string): Project[] {
    if (entry.kind === 'object') {
      const extended = settingAt(entry, ['extends']);
      const inherits =
        extended?.kind === 'value' && typeof extended.value === 'boolean'
          ? extended.value
          : extended === null && (this.version === null || this.version[0] >= 5);
      const base = inherits ? withoutProjects(config.settings) : emptySettings();
      return [this.vitestProject(config, mergeDeep(base, entry), folder)];
    }
    if (entry.kind !== 'value' || typeof entry.value !== 'string') {
      // A function or a promise, read by running the config, or a setting of the wrong type.
      return [this.unknownProject(config, unknownAt(entry), 'test.projects')];
    }
    const pattern = entry.value.replace('<rootDir>', folder);
    const matches = picomatch.scan(pattern).isGlob
      ? globSync(pattern, {
          cwd: folder,
          absolute: true,
          dot: true,
          onlyFiles: false,
          expandDirectories: false,
          ignore: ['**/node_modules/**'],
        })
      : [path.resolve(folder, pattern)];
    return matches.flatMap((match) => {
      const configFile = VITEST_CONFIG.test(path.basename(match)) ? match : null;
      const nested = configFile ? this.configs.at(configFile) : this.configs.inFolder(match);
      // A folder without a config of its own is a project with Vitest's defaults, rooted there.
      return nested
        ? [this.vitestProject(nested, nested.settings, path.dirname(nested.file))]
        : [this.vitestProject(config, emptySettings(), match)];
    });
  }

  /** A Vitest project: its files are found from `test.dir`, else `test.root` or `root`, else its folder. */
  private vitestProject(config: ConfigFile, settings: Setting, folder: string): Project {
    const exclude = vitestExclude(this.version);
    const lists: [string, string[]][] = [
      ['test.include', VITEST_INCLUDE],
      ['test.exclude', exclude],
      ['test.includeSource', []],
      ['test.typecheck.include', VITEST_TYPECHECK_INCLUDE],
      ['test.typecheck.exclude', exclude],
      ['test.benchmark.include', VITEST_BENCHMARK_INCLUDE],
      ['test.benchmark.exclude', exclude],
    ];
    const matchers: ((file: string) => boolean)[] = [];
    for (const [key, fallback] of lists) {
      const setting = settingAt(settings, key.split('.'));
      const found = setting === null || isUnset(setting) ? fallback : patterns(setting, false);
      if (!Array.isArray(found)) return this.unknownProject(config, found, key);
      matchers.push(picomatch(found as string[], { dot: true }));
    }
    const [isTest, isExcluded, isSource, isTypeTest, isTypeExcluded, isBench, isBenchExcluded] = matchers;
    let dir = folder;
    for (const [key, base] of [
      ['test.root', folder],
      ['root', folder],
      ['test.dir', null],
    ] as const) {
      const setting = settingAt(settings, key.split('.'));
      if (setting === null || isUnset(setting)) continue;
      if (setting.kind !== 'value' || typeof setting.value !== 'string') {
        return this.unknownProject(config, unknownAt(setting), key);
      }
      // `test.root` wins over Vite's `root`, and `test.dir` is in the root.
      if (key !== 'root' || dir === folder) dir = path.resolve(base ?? dir, setting.value);
    }
    const typecheck = settingAt(settings, ['test', 'typecheck', 'enabled']);
    const checksTypes = typecheck?.kind === 'value' && typecheck.value === true;
    return {
      config,
      settings,
      unknown: null,
      runs: (file) => {
        const relative = posix(path.relative(dir, file));
        if (isTest(relative) && !isExcluded(relative)) return 'test';
        if (isSource(relative) && !isExcluded(relative) && hasInSourceTests(file)) return 'test';
        if (checksTypes && isTypeTest(relative) && !isTypeExcluded(relative)) return 'test';
        return isBench(relative) && !isBenchExcluded(relative) ? 'benchmark' : false;
      },
    };
  }
}

/** A setting written as `undefined`, which the runners take as not set. */
function isUnset(setting: Setting): boolean {
  return setting.kind === 'value' && setting.value === undefined;
}

/** Whether a file holds in-source tests, which Vitest runs from `includeSource`; a file it can't read holds none. */
function hasInSourceTests(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').includes('import.meta.vitest');
  } catch {
    return false;
  }
}

/** A setting as one the scan can't use, where it is written; one that isn't unknown has no place to point at. */
function unknownAt(setting: Setting): Unknown {
  return setting.kind === 'unknown' ? setting : { kind: 'unknown', where: null };
}

/** A config's settings without `test.projects`, as an inline project inherits them; both are known objects. */
function withoutProjects(settings: Setting): Setting {
  const root = settings as ObjectSetting;
  const test = root.keys.get('test') as ObjectSetting;
  const keys = new Map(test.keys);
  keys.delete('projects');
  return { ...root, keys: new Map([...root.keys, ['test', { ...test, keys }]]) };
}
