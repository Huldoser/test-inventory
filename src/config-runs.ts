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
  unknownText,
} from './config.ts';
import { atLeast } from './frameworks/common.ts';
import type { RunSettings } from './model.ts';
import type { ConfigDefaults, FileConfig, TagDefinition, TagOptions, VitestTags } from './records.ts';
import type { Framework, MetaValue, ProjectRecord, SuiteRecord, TestRecord } from './types.ts';
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
type Project = { config: ConfigFile; settings: Setting; about: ProjectAbout } & (
  { runs: (file: string) => Run | false; unknown: null } | { runs: null; unknown: { setting: Unknown; key: string } }
);

/**
 * What the output says of a project: its name, the folder its test files are found from and Playwright's
 * `dependencies`. `grep` is Playwright's filter of its test titles, which start from the path in `grepRoot`.
 */
export interface ProjectAbout {
  name: string;
  testDir: string;
  dependencies: string[];
  /** The project's settings, which its setup files are read from. */
  settings: Setting;
  /** The folder its setup files are found from: Vitest's root, or the config's folder. */
  root: string;
  /** For a Vitest project from a config another config lists, the outermost one, whose global setup runs too. */
  container: ConfigFile | null;
  /** The config the project is written in. */
  config: ConfigFile;
  grep: ((title: string) => boolean) | null;
  grepRoot: string;
  defaults: ProjectDefaults;
}

/**
 * The settings a project gives its tests, as written; null when unset. Playwright's `timeout`, `retries`, `repeatEach`
 * and `fullyParallel`; Vitest's `testTimeout`, `retry`, `repeats` and `sequence.concurrent`, and the tags it defines.
 */
interface ProjectDefaults {
  timeout: Setting | null;
  retry: Setting | null;
  repeatEach: Setting | null;
  repeats: Setting | null;
  parallel: Setting | null;
  tags: VitestTags | null;
}

const NO_DEFAULTS: ProjectDefaults = {
  timeout: null,
  retry: null,
  repeatEach: null,
  repeats: null,
  parallel: null,
  tags: null,
};

/** The config a file uses, the settings of its project, and how that config runs it. */
export interface Placement {
  config: ConfigFile | null;
  settings: Setting | null;
  /** False when no config runs the file; null when there is no config, or one can't tell. */
  runs: Run | false | null;
  /** The projects of the config that run the file, which a Playwright `grep` may narrow per test; null when unknown. */
  projects: ProjectAbout[] | null;
}

const ASSUMED = 'the scan takes its files to be run';
const NOT_FOUND = "the scan can't tell which files it runs; give patterns to scan them";

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
    return isMatch(unix) || expressions.some((expression) => matches(expression, file) || matches(expression, unix));
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
  /** Whether the configs find the test files, as in a scan without patterns, rather than the patterns. */
  private readonly findsFiles: boolean;
  private readonly projects = new Map<ConfigFile, Project[]>();
  private readonly ignoreRules = new Map<string, IgnoreRule[]>();
  private readonly folderStates = new Map<string, FolderState>();
  /** The Vitest configs whose projects are being found, to stop at one whose projects name itself. */
  private readonly expanding = new Set<ConfigFile>();

  constructor(configs: Configs, framework: Framework, version: [number, number] | null, findsFiles: boolean) {
    this.configs = configs;
    this.framework = framework;
    this.version = version;
    this.findsFiles = findsFiles;
  }

  /**
   * The config a file uses, as the runner started at the root would: the outermost config at or above it that runs it,
   * with the project that does; else the outermost one whose files the scan can't work out, reported then; else the
   * nearest config.
   */
  placementOf(file: string): Placement {
    const around = this.configs.around(file);
    for (const config of around) {
      const running = this.projectsOf(config).flatMap((project) => {
        const runs = project.runs?.(file);
        return runs ? [{ project, runs }] : [];
      });
      if (running.length > 0) {
        const [{ project, runs }] = running;
        const projects = running.map((item) => item.project.about);
        return { config: project.config, settings: project.settings, runs, projects };
      }
    }
    const unknown = around.flatMap((config) => this.projectsOf(config)).find((project) => project.unknown);
    if (unknown?.unknown) {
      this.configs.reportUnknown(unknown.unknown.setting, unknown.unknown.key, this.findsFiles ? NOT_FOUND : ASSUMED);
      return { config: unknown.config, settings: unknown.settings, runs: null, projects: null };
    }
    const nearest = around.at(-1) ?? null;
    return {
      config: nearest,
      settings: nearest?.settings ?? null,
      runs: nearest ? false : null,
      projects: nearest ? [] : null,
    };
  }

  /** The projects of a config the output lists; null when the scan can't work them out. */
  projectsIn(config: ConfigFile): ProjectRecord[] | null {
    const projects = this.projectsOf(config);
    if (projects.some((project) => project.unknown)) return null;
    return projects.map(({ about }) => ({
      name: about.name,
      testDir: this.configs.relative(about.testDir),
      dependencies: about.dependencies,
    }));
  }

  /**
   * A config's project, named as the runner names it, with the files it runs; null when there is none, or the scan
   * can't tell which files it runs.
   */
  projectNamed(config: ConfigFile, name: string): { about: ProjectAbout; runs: (file: string) => unknown } | null {
    const project = this.projectsOf(config).find((item) => item.runs && item.about.name === name);
    return project ? { about: project.about, runs: project.runs as (file: string) => unknown } : null;
  }

  private projectsOf(config: ConfigFile): Project[] {
    let projects = this.projects.get(config);
    if (!projects) {
      projects = this.framework === 'playwright' ? this.playwrightProjects(config) : this.vitestProjects(config);
      this.projects.set(config, projects);
    }
    return projects;
  }

  /** Vitest's `retry`: before 4.1, which reads only a count, an object is one the scan can't work out. */
  private vitestRetry(setting: Setting | null): Setting | null {
    return setting?.kind === 'object' && !atLeast(this.version, 4, 1) ? unknownAt(setting) : setting;
  }

  /** A project whose files can't be worked out, because of `setting` under `key`: it may run any file. */
  private unknownProject(config: ConfigFile, setting: Unknown, key: string): Project {
    const about = {
      name: '',
      testDir: path.dirname(config.file),
      dependencies: [],
      settings: setting,
      root: path.dirname(config.file),
      container: null,
      config,
      grep: null,
      grepRoot: '',
      defaults: NO_DEFAULTS,
    };
    return { config, settings: setting, about, runs: null, unknown: { setting, key } };
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
    const grep = take('grep');
    const grepInvert = take('grepInvert');
    const greps: ((title: string) => boolean)[] = [];
    for (const found of [grep, grepInvert]) {
      const expressions = found ? patterns(found.setting, true) : [];
      // Playwright tests the title with regular expressions only.
      if (!Array.isArray(expressions) || expressions.some((item) => typeof item === 'string')) {
        return this.unknownProject(config, unknownAt(found?.setting as Setting), (found as Taken).key);
      }
      greps.push((title) => (expressions as RegExp[]).some((expression) => matches(expression, title)));
    }
    const [isGrepped, isInverted] = greps;
    const name = take('name');
    const dependencies = settingAt(project, ['dependencies']);
    // Playwright's root folder: the config's testDir, the start of each test's grep title.
    const configDir = settingAt(config.settings, ['testDir']);
    const about: ProjectAbout = {
      name: name?.setting.kind === 'value' && typeof name.setting.value === 'string' ? name.setting.value : '',
      testDir: root,
      dependencies: strings(dependencies),
      // A project's own keys, as `snapshotPathTemplate`; the config's apply to every project, and are read there.
      settings: project,
      root: folder,
      container: null,
      config,
      grep:
        grep || grepInvert
          ? (title) => (grep === null || isGrepped(title)) && !(grepInvert && isInverted(title))
          : null,
      grepRoot:
        configDir?.kind === 'value' && typeof configDir.value === 'string'
          ? path.resolve(folder, configDir.value)
          : folder,
      defaults: {
        timeout: take('timeout')?.setting ?? null,
        retry: take('retries')?.setting ?? null,
        repeatEach: take('repeatEach')?.setting ?? null,
        repeats: null,
        parallel: take('fullyParallel')?.setting ?? null,
        tags: null,
      },
    };
    return {
      config,
      settings: config.settings,
      about,
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
    if (list === null) return this.vitestProject(config, config.settings, folder, null);
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
    // Vitest 5 takes a project's own tags in place of those it extends.
    const ownTags = atLeast(this.version, 5, 0) ? settingAt(entry, ['test', 'tags']) : null;
    return this.vitestProject(config, mergeDeep(base, entry), folder, ownTags);
  }

  /**
   * The projects of a config file or folder `test.projects` names: the config's own, also the projects it lists in
   * Vitest 5, or a project with Vitest's defaults for a folder without a config.
   */
  private vitestPath(config: ConfigFile, target: string): Project[] {
    const nested = VITEST_CONFIG.test(path.basename(target)) ? this.configs.at(target) : this.configs.inFolder(target);
    if (!nested) return this.vitestProject(config, emptySettings(), target, null);
    const isContainer = (this.version === null || this.version[0] >= 5) && !this.expanding.has(nested);
    const projects =
      isContainer && settingAt(nested.settings, ['test', 'projects'])
        ? this.vitestProjects(nested)
        : this.vitestProject(nested, nested.settings, path.dirname(nested.file), null);
    // The outermost config lists the others, so it is set last.
    return projects.map((project) => ({ ...project, about: { ...project.about, container: config } }));
  }

  /**
   * A Vitest project: its files are found from `test.dir`, else `test.root` or `root`, else its folder. With browser
   * mode on, each of `browser.instances` is a project of its own, named as Vitest names it.
   */
  private vitestProject(config: ConfigFile, settings: Setting, folder: string, ownTags: Setting | null): Project[] {
    const project = this.vitestFiles(config, settings, folder, ownTags);
    if (project.unknown) return [project];
    const enabled = settingAt(settings, ['test', 'browser', 'enabled']);
    if (enabled?.kind === 'unknown') return [this.unknownProject(config, enabled, 'test.browser.enabled')];
    if (!(enabled?.kind === 'value' && enabled.value === true)) return [project];
    const instances = settingAt(settings, ['test', 'browser', 'instances']);
    const items = instances?.kind === 'list' ? instances.items : [];
    const browsers = items.map((item) => [settingAt(item, ['browser']), settingAt(item, ['name'])]);
    const unknown =
      browsers.flat().find((setting) => setting?.kind === 'unknown') ??
      (instances?.kind === 'unknown' ? instances : null);
    if (unknown) return [this.unknownProject(config, unknownAt(unknown), 'test.browser.instances')];
    return browsers.map(([browser, name]) => {
      const kind = browser?.kind === 'value' ? String(browser.value) : '';
      const own = name?.kind === 'value' && typeof name.value === 'string' ? name.value : null;
      const named = own ?? (project.about.name ? `${project.about.name} (${kind})` : kind);
      return { ...project, about: { ...project.about, name: named } };
    });
  }

  /** The files a Vitest project runs and its settings; `ownTags`, when set, in place of the tags in `settings`. */
  private vitestFiles(config: ConfigFile, settings: Setting, folder: string, ownTags: Setting | null): Project {
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
    const name = settingAt(settings, ['test', 'name']);
    const label = name?.kind === 'object' ? settingAt(name, ['label']) : name;
    const about: ProjectAbout = {
      name: label?.kind === 'value' && typeof label.value === 'string' ? label.value : '',
      testDir: base,
      dependencies: [],
      settings,
      root,
      container: null,
      config,
      grep: null,
      grepRoot: base,
      defaults: {
        timeout: settingAt(settings, ['test', 'testTimeout']),
        retry: this.vitestRetry(settingAt(settings, ['test', 'retry'])),
        repeatEach: null,
        // Vitest 5 added `repeats` to the config.
        repeats: atLeast(this.version, 5, 0) ? settingAt(settings, ['test', 'repeats']) : null,
        parallel: settingAt(settings, ['test', 'sequence', 'concurrent']),
        tags: vitestTags(
          ownTags ?? settingAt(settings, ['test', 'tags']),
          settingAt(settings, ['test', 'strictTags']),
          settingAt(settings, ['test', 'sequence', 'concurrent']),
          atLeast(this.version, 5, 0),
        ),
      },
    };
    return {
      config,
      settings,
      about,
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

/** Whether a regular expression matches a text, from its start whatever its `lastIndex`, as Playwright tests it. */
function matches(expression: RegExp, text: string): boolean {
  expression.lastIndex = 0;
  return expression.test(text);
}

/** The strings of a list setting, such as Playwright's `dependencies`; none for anything else. */
function strings(setting: Setting | null): string[] {
  if (setting?.kind !== 'list') return [];
  return setting.items.flatMap((item) => (item.kind === 'value' && typeof item.value === 'string' ? [item.value] : []));
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

/**
 * The projects that run a test: those that run its file, less those whose Playwright `grep` or `grepInvert` leaves its
 * title out, matched as Playwright matches it, against the project's name, the file's path from the config's root
 * folder, the titles of the describes and the test and their tags. Null when a `grep` meets a title the scan can't work
 * out.
 */
function projectsRunning(
  projects: ProjectAbout[],
  test: TestRecord,
  suites: SuiteRecord[],
  file: string,
): ProjectAbout[] | null {
  const titles = [...test.suitePath, test.title];
  const isDynamic =
    test.hasDynamicTitle || suites.some((suite) => suite.hasDynamicTitle && test.suitePath.includes(suite.title));
  // Tags written into a title are in its text already; Playwright adds the others after it.
  const tags = test.tags.filter((tag) => !titles.some((title) => title.includes(tag)));
  const running: ProjectAbout[] = [];
  for (const project of projects) {
    const { name, grep, grepRoot } = project;
    if (grep && isDynamic) return null;
    if (!grep || grep([name, path.relative(grepRoot, file), ...titles, ...tags].join(' '))) running.push(project);
  }
  return running;
}

/** A number a setting holds: undefined when unset, null when it holds something else or can't be worked out. */
function numberIn(setting: Setting | null): number | null | undefined {
  if (setting === null || isUnset(setting)) return undefined;
  return setting.kind === 'value' && typeof setting.value === 'number' ? setting.value : null;
}

/** Playwright's `retries`, or Vitest's `retry` as a count or an object with a `delay` and a `condition`. */
function retryIn(setting: Setting | null): RunSettings['retry'] | null | undefined {
  if (setting?.kind !== 'object') {
    const count = numberIn(setting);
    return typeof count === 'number' ? { count, delay: null, condition: null } : count;
  }
  const count = numberIn(settingAt(setting, ['count']));
  if (count === null) return null;
  const condition = settingAt(setting, ['condition']);
  return {
    // Vitest counts a `retry` object without a `count` as no retries.
    count: count ?? 0,
    delay: numberIn(settingAt(setting, ['delay'])) ?? null,
    condition:
      condition?.kind === 'regex'
        ? `/${condition.source}/${condition.flags}`
        : condition?.kind === 'unknown'
          ? unknownText(condition)
          : null,
  };
}

const TAG_FLAGS = ['skip', 'only', 'todo', 'fails', 'concurrent'] as const;

/** A config value as test meta: a string, number, boolean or null, or lists and objects of them; undefined otherwise. */
function metaIn(setting: Setting): MetaValue | undefined {
  if (setting.kind === 'value') return setting.value;
  if (setting.kind === 'list') {
    const items = setting.items.map(metaIn);
    return items.every((item) => item !== undefined) ? items : undefined;
  }
  if (setting.kind !== 'object' || setting.rest !== null) return undefined;
  const entries = [...setting.keys].map(([key, value]) => [key, metaIn(value)] as const);
  return entries.every(([, value]) => value !== undefined)
    ? (Object.fromEntries(entries) as Record<string, MetaValue>)
    : undefined;
}

/** A tag definition from Vitest's `test.tags`; null when the scan can't work out one of its options. */
function tagIn(setting: Setting): TagDefinition | null {
  if (setting.kind !== 'object' || setting.rest !== null) return null;
  const at = (key: string) => setting.keys.get(key) ?? null;
  const name = at('name');
  const priority = numberIn(at('priority'));
  if (name?.kind !== 'value' || typeof name.value !== 'string' || priority === null) return null;
  const options: TagOptions = { run: {} };
  for (const flag of TAG_FLAGS) {
    const value = at(flag);
    if (value?.kind !== 'value' && value !== null) return null;
    if (value && !isUnset(value)) options[flag] = Boolean(value.value);
  }
  for (const key of ['timeout', 'repeats'] as const) {
    const value = numberIn(at(key));
    if (value === null) return null;
    if (value !== undefined) options.run[key] = value;
  }
  const retry = at('retry');
  // Vitest refuses a `retry.condition` function in the config, which can't be passed to the test files.
  if (retry?.kind === 'object' && settingAt(retry, ['condition'])?.kind === 'unknown') return null;
  const count = retryIn(retry);
  if (count === null) return null;
  if (count !== undefined) options.run.retry = count;
  const meta = at('meta');
  if (meta && !isUnset(meta)) {
    const values = meta.kind === 'object' ? (metaIn(meta) as Record<string, MetaValue> | undefined) : undefined;
    if (!values) return null;
    options.meta = values;
  }
  return { name: name.value, priority: priority ?? null, options };
}

/**
 * The tags a Vitest config defines, from `test.tags` and `test.strictTags`; null when the scan can't work them out.
 * Vitest 4.1 passes a `sequence.concurrent` the config sets to every test as an option, where it wins over a tag's.
 */
function vitestTags(
  tags: Setting | null,
  strictTags: Setting | null,
  concurrent: Setting | null,
  beatsDescribes: boolean,
): VitestTags | null {
  const items = tags === null || isUnset(tags) ? [] : tags.kind === 'list' ? tags.items : null;
  const definitions = items?.map(tagIn) ?? null;
  if (definitions === null || definitions.includes(null)) return null;
  if (strictTags !== null && strictTags.kind !== 'value') return null;
  return {
    definitions: definitions as TagDefinition[],
    isStrict: Boolean(strictTags?.value ?? true),
    beatsDescribes,
    concurrentBeatsTags: !beatsDescribes && concurrent !== null && !isUnset(concurrent),
  };
}

/**
 * What the config sets for a test, from the projects that run it: a setting they all agree on, or null when they set
 * different values or one depends on a condition; null without projects.
 */
function configDefaults(projects: ProjectAbout[]): ConfigDefaults | null {
  if (projects.length === 0) return null;
  const agreed = <T>(read: (defaults: ProjectDefaults) => T | null | undefined): T | null | undefined => {
    const values = projects.map((project) => read(project.defaults));
    if (values.every((value) => value === undefined)) return undefined;
    const first = JSON.stringify(values[0]);
    return values.every((value) => value !== null && value !== undefined && JSON.stringify(value) === first)
      ? values[0]
      : null;
  };
  const agreedText = (read: (defaults: ProjectDefaults) => Setting | null): string | null => {
    const texts = projects.map(({ defaults }) => {
      const setting = read(defaults);
      return setting?.kind === 'unknown' ? unknownText(setting) : null;
    });
    return texts.every((text) => text === texts[0]) ? texts[0] : null;
  };
  return {
    timeout: agreed((defaults) => numberIn(defaults.timeout)),
    retry: agreed((defaults) => retryIn(defaults.retry)),
    repeats: agreed((defaults) => {
      if (defaults.repeatEach === null) return numberIn(defaults.repeats);
      // Playwright runs a test `repeatEach` times in all; `repeats` counts the runs after the first.
      const repeatEach = numberIn(defaults.repeatEach);
      return typeof repeatEach === 'number' ? Math.max(repeatEach - 1, 0) : repeatEach;
    }),
    timeoutText: agreedText((defaults) => defaults.timeout),
    retryText: agreedText(({ retry }) => (retry?.kind === 'object' ? settingAt(retry, ['count']) : retry)),
    repeatsText: agreedText((defaults) => defaults.repeatEach ?? defaults.repeats),
    parallel: projects.every(({ defaults }) => defaults.parallel?.kind === 'value' && defaults.parallel.value === true),
  };
}

const NO_CONFIG = { projects: null, defaults: null };

/** Projects the scan can't work out may set any run setting. */
const UNKNOWN_DEFAULTS: ConfigDefaults = {
  timeout: null,
  retry: null,
  repeats: null,
  timeoutText: null,
  retryText: null,
  repeatsText: null,
  parallel: false,
};

/**
 * What the config a file uses gives it: Playwright's `forbidOnly`, read from the top level only, as Playwright reads
 * it, and for each test, the projects that run it and what they set; null without a config.
 */
export function fileConfig(
  placement: Placement,
  framework: Framework,
  version: [number, number] | null,
  file: string,
): FileConfig | null {
  const { config, projects } = placement;
  if (config === null) {
    // Without a config, Vitest defines no tags and keeps strictTags on.
    const tags = vitestTags(null, null, null, atLeast(version, 5, 0));
    return framework === 'vitest' ? { forbidOnly: false, forTest: () => NO_CONFIG, tags } : null;
  }
  const forbidOnly = framework === 'playwright' ? settingAt(config.settings, ['forbidOnly']) : null;
  return {
    forbidOnly:
      forbidOnly?.kind === 'unknown'
        ? (unknownText(forbidOnly) ?? false)
        : forbidOnly?.kind === 'value' && forbidOnly.value === true,
    forTest(test, suites) {
      if (projects === null) return { projects: null, defaults: UNKNOWN_DEFAULTS };
      const running = projectsRunning(projects, test, suites, file);
      // A grep the scan can't match leaves the projects that run the file, which may still agree.
      return { projects: running?.map(({ name }) => name) ?? null, defaults: configDefaults(running ?? projects) };
    },
    tags: agreedTags(projects),
  };
}

/** The tags the projects that run a file define, when they all define the same; null otherwise. */
function agreedTags(projects: ProjectAbout[] | null): VitestTags | null {
  const [first, ...others] = (projects ?? []).map(({ defaults }) => defaults.tags);
  const text = JSON.stringify(first ?? null);
  return first && others.every((tags) => JSON.stringify(tags) === text) ? first : null;
}
