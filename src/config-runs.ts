import { existsSync, readFileSync } from 'node:fs';
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
/** Vitest 3's workspace files, which list its projects in place of `test.projects`. */
const VITEST_WORKSPACES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json'].map(
  (extension) => `vitest.workspace.${extension}`,
);

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
    const expression = regexps && item.kind === 'regex' ? regExp(item.source, item.flags) : null;
    if (expression) found.push(expression);
    // An empty glob matches nothing, and picomatch refuses one.
    else if (item.kind === 'value' && typeof item.value === 'string') found.push(...(item.value ? [item.value] : []));
    else return unknownAt(item);
  }
  return found;
}

/** A regular expression; null for one that parses but Node.js refuses, such as `/a{2,1}/`. */
function regExp(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
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
  pattern: string;
  match: (text: string) => boolean;
}

/**
 * Whether a path is left out by Playwright's reading of `.gitignore` files: `recurse` is a folder a rule leaves out but
 * a later rule may bring something back from, so Playwright looks inside it.
 */
type IgnoreStatus = 'included' | 'ignored' | 'recurse';

/** A folder under a project's test folder: its status, and the rules for what is inside it. */
interface FolderState {
  status: IgnoreStatus;
  rules: IgnoreRule[];
}

/**
 * Whether a rule bringing files back may match something inside a folder, as minimatch's partial match tells
 * Playwright: a rule without a `/` matches at any depth, and one with `**` past the folder's depth too.
 */
function mayMatchInside(rule: IgnoreRule, folder: string): boolean {
  const parts = rule.pattern.replace(/^\//, '').replace(/\/$/, '').split('/');
  if (parts.length === 1) return true;
  const folders = folder.split('/');
  for (const [index, name] of folders.entries()) {
    if (parts[index] === '**') return true;
    if (index >= parts.length - 1 || !picomatch.isMatch(name, parts[index], { dot: true })) return false;
  }
  return true;
}

/** Finds the configs a file is under and decides which one runs it, as the runner started at the root would. */
export class ConfigRuns {
  private readonly configs: Configs;
  private readonly framework: Framework;
  private readonly version: [number, number] | null;
  private readonly projects = new Map<ConfigFile, Project[]>();
  private readonly ignoreRules = new Map<string, IgnoreRule[]>();
  private readonly folderStates = new Map<string, FolderState>();
  /** The Vitest configs whose projects are being found, to stop at one whose projects name itself. */
  private readonly expanding = new Set<ConfigFile>();

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
        if (isIgnored(file) || !isMatch(file)) return false;
        return gitIgnore && this.isGitIgnored(root, file) ? false : 'test';
      },
    };
  }

  /**
   * Whether `.gitignore` files in a project's test folder, and the folders below it on the way to the file, leave the
   * file out, as Playwright reads them.
   */
  private isGitIgnored(root: string, file: string): boolean {
    const folder = this.folderState(root, path.dirname(file));
    return folder.status === 'ignored' || ignoreStatus(file, folder.rules, false, folder.status) !== 'included';
  }

  /** A folder's status and the rules inside it, worked out once per project folder however many files it holds. */
  private folderState(root: string, folder: string): FolderState {
    const key = `${root}\0${folder}`;
    let state = this.folderStates.get(key);
    if (!state) {
      if (folder === root) {
        state = { status: 'included', rules: this.rulesIn(folder) };
      } else {
        const parent = this.folderState(root, path.dirname(folder));
        // Playwright doesn't look inside a folder it leaves out.
        const status =
          parent.status === 'ignored' ? 'ignored' : ignoreStatus(folder, parent.rules, true, parent.status);
        state = { status, rules: [...parent.rules, ...this.rulesIn(folder)] };
      }
      this.folderStates.set(key, state);
    }
    return state;
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
        // A lone `!` brings back nothing.
        .filter((line) => line !== '' && line !== '!' && !line.startsWith('#'))
        .map((line) => {
          const negate = line.startsWith('!');
          const pattern = negate ? line.slice(1) : line;
          // As minimatch's matchBase does, only a pattern without a slash matches the name alone, at any depth.
          const basename = !pattern.replace(/\/$/, '').includes('/');
          return { folder, negate, pattern, match: picomatch(pattern, { basename, dot: true }) };
        });
      this.ignoreRules.set(folder, rules);
    }
    return rules;
  }

  private vitestProjects(config: ConfigFile): Project[] {
    const folder = path.dirname(config.file);
    const list = settingAt(config.settings, ['test', 'projects']);
    const isVitest3 = this.version !== null && this.version[0] < 4;
    const workspace = isVitest3 ? settingAt(config.settings, ['test', 'workspace']) : null;
    if (workspace) return [this.unknownProject(config, unknownAt(workspace), 'test.workspace')];
    if (isVitest3 && VITEST_WORKSPACES.some((name) => existsSync(path.join(folder, name)))) {
      // Vitest 3 takes its projects from a workspace file, which the scan doesn't read.
      return [this.unknownProject(config, { kind: 'unknown', where: null }, 'test.projects')];
    }
    if (list === null) return [this.vitestProject(config, config.settings, folder)];
    if (list.kind !== 'list') return [this.unknownProject(config, unknownAt(list), 'test.projects')];
    this.expanding.add(config);
    const globs: string[] = [];
    const projects = list.items.flatMap((item) => {
      if (item.kind === 'value' && typeof item.value === 'string') {
        // `<rootDir>` is the config's folder, written with / as globs are.
        const pattern = item.value.replace('<rootDir>', posix(folder));
        // Vitest globs every pattern and negation together, and reads a plain path as it is.
        if (pattern.startsWith('!') || picomatch.scan(pattern).isGlob) globs.push(pattern);
        else return this.vitestPath(config, path.resolve(folder, pattern));
        return [];
      }
      return this.vitestEntry(config, item, folder);
    });
    const matches = globs.length
      ? globSync(globs, {
          cwd: folder,
          absolute: true,
          dot: true,
          onlyFiles: false,
          expandDirectories: false,
          ignore: ['**/node_modules/**'],
        })
      : [];
    projects.push(...matches.flatMap((match) => this.vitestPath(config, path.resolve(match))));
    this.expanding.delete(config);
    return projects;
  }

  /** A project written in `test.projects`, which inherits the root config as each version of Vitest decides. */
  private vitestEntry(config: ConfigFile, entry: Setting, folder: string): Project[] {
    if (entry.kind !== 'object') {
      // A function or a promise, read by running the config, or a setting of the wrong type.
      return [this.unknownProject(config, unknownAt(entry), 'test.projects')];
    }
    const extended = settingAt(entry, ['extends']);
    let base = emptySettings();
    if (extended?.kind === 'value' && typeof extended.value === 'string') {
      base = this.configs.at(path.resolve(folder, extended.value)).settings;
    } else if (extended?.kind === 'value' ? extended.value === true : this.version === null || this.version[0] >= 5) {
      base = withoutProjects(config.settings);
    }
    return [this.vitestProject(config, mergeDeep(base, entry), folder)];
  }

  /**
   * The projects of a config file or folder `test.projects` names: the config's own, also the projects it lists in
   * Vitest 5, or a project with Vitest's defaults for a folder without a config.
   */
  private vitestPath(config: ConfigFile, target: string): Project[] {
    const nested = VITEST_CONFIG.test(path.basename(target)) ? this.configs.at(target) : this.configs.inFolder(target);
    if (!nested) return [this.vitestProject(config, emptySettings(), target)];
    const isContainer = (this.version === null || this.version[0] >= 5) && !this.expanding.has(nested);
    return isContainer && settingAt(nested.settings, ['test', 'projects'])
      ? this.vitestProjects(nested)
      : [this.vitestProject(nested, nested.settings, path.dirname(nested.file))];
  }

  /** A Vitest project: its files are found from `test.dir`, else `test.root` or `root`, else its folder. */
  private vitestProject(config: ConfigFile, settings: Setting, folder: string): Project {
    let root = folder;
    let dir: string | null = null;
    let hasTestRoot = false;
    for (const key of ['test.root', 'root', 'test.dir']) {
      const setting = settingAt(settings, key.split('.'));
      if (setting === null || isUnset(setting)) continue;
      if (setting.kind !== 'value' || typeof setting.value !== 'string') {
        return this.unknownProject(config, unknownAt(setting), key);
      }
      // `test.root` wins over Vite's `root`, and `test.dir` is in the root.
      if (key === 'test.dir') dir = path.resolve(root, setting.value);
      else if (key === 'test.root' || !hasTestRoot) root = path.resolve(folder, setting.value);
      if (key === 'test.root') hasTestRoot = true;
    }
    const base = dir ?? root;
    const exclude = vitestExclude(this.version);
    const lists: [string, string[], boolean][] = [
      ['test.include', VITEST_INCLUDE, false],
      ['test.exclude', exclude, true],
      ['test.includeSource', [], false],
      ['test.typecheck.include', VITEST_TYPECHECK_INCLUDE, false],
      ['test.typecheck.exclude', exclude, true],
      ['test.benchmark.include', VITEST_BENCHMARK_INCLUDE, false],
      ['test.benchmark.exclude', exclude, true],
      ['test.benchmark.includeSource', [], false],
    ];
    const matchers: ((file: string) => boolean)[] = [];
    for (const [key, fallback, isExclude] of lists) {
      const setting = settingAt(settings, key.split('.'));
      const found = setting === null || isUnset(setting) ? fallback : patterns(setting, false);
      if (!Array.isArray(found)) return this.unknownProject(config, found, key);
      // tinyglobby, which Vitest finds files with, takes an absolute pattern as one in the folder it searches.
      const relative = (found as string[]).map((glob) =>
        path.isAbsolute(glob) ? posix(path.relative(base, glob)) : glob,
      );
      const isMatch = picomatch(relative, { dot: true });
      // An excluded folder leaves out everything in it, as the glob doesn't enter it.
      matchers.push(isExclude ? (file) => folders(file).some((part) => isMatch(part) || isMatch(`${part}/`)) : isMatch);
    }
    const [isTest, isExcluded, isSource, isTypeTest, isTypeExcluded, isBench, isBenchExcluded, isBenchSource] =
      matchers;
    const flags: boolean[] = [];
    for (const key of ['test.typecheck.enabled', 'test.typecheck.only']) {
      const setting = settingAt(settings, key.split('.'));
      if (setting?.kind === 'unknown') return this.unknownProject(config, setting, key);
      flags.push(setting?.kind === 'value' && setting.value === true);
    }
    const [checksTypes, onlyTypes] = flags;
    return {
      config,
      settings,
      unknown: null,
      runs: (file) => {
        const relative = posix(path.relative(base, file));
        const runsTests = !(checksTypes && onlyTypes);
        if (runsTests && isTest(relative) && !isExcluded(relative)) return 'test';
        if (runsTests && isSource(relative) && !isExcluded(relative) && hasInSourceTests(file)) return 'test';
        if (checksTypes && isTypeTest(relative) && !isTypeExcluded(relative)) return 'test';
        if (isBenchExcluded(relative)) return false;
        return isBench(relative) || (isBenchSource(relative) && hasInSourceTests(file)) ? 'benchmark' : false;
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

/** Playwright's status of a path under `.gitignore` rules, from the status of the folder it is in. */
function ignoreStatus(entry: string, rules: IgnoreRule[], isFolder: boolean, from: IgnoreStatus): IgnoreStatus {
  let status = from;
  for (const rule of rules) {
    if ((status === 'included') === rule.negate) continue;
    const relative = posix(path.relative(rule.folder, entry));
    const texts = [`/${relative}`, relative, ...(isFolder ? [`/${relative}/`, `${relative}/`] : [])];
    if (texts.some((text) => rule.match(text))) status = rule.negate ? 'included' : 'ignored';
    else if (isFolder && rule.negate && mayMatchInside(rule, relative)) status = 'recurse';
  }
  return status;
}

/** A relative path and the folders it is in, as `a/b/c.ts`, `a/b` and `a`. */
function folders(relative: string): string[] {
  const parts = relative.split('/');
  return parts.map((_, index) => parts.slice(0, parts.length - index).join('/'));
}
