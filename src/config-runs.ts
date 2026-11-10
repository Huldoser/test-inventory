import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { nodeTestCommands, scriptsRunBy } from './node-scripts.ts';
import { durationOf, type MochaInterface } from './frameworks/mocha.ts';
import type { WebdriverIOFramework } from './frameworks/webdriverio.ts';
import type { RunSettings } from './model.ts';
import type { ImportMap } from './resolve.ts';
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
/** Jest's default `testMatch` before 30.0, and from 30.0, which also matches `.mjs`, `.cjs`, `.mts` and `.cts`. */
const JEST_TEST_MATCH = {
  29: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
  30: ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
};
/** The extensions a file a Jest `projects` glob matches needs to be read as a config. */
const JEST_CONFIG_EXTENSIONS = ['.js', '.ts', '.mjs', '.mts', '.cjs', '.cts', '.json'];
/** Jest's default `moduleFileExtensions` before 30.0; 30.0 adds `mts` and `cts`. */
const JEST_EXTENSIONS = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'node'];
/** Presets that leave Jest's choice of test files as it is, so the scan needs nothing from them. */
const NEUTRAL_PRESETS = /^(ts-jest(\/.*)?|jest-puppeteer)$/;
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
  /** Whether the runner runs the project without `--project`, as Playwright's `default` decides; null when unknown. */
  runsByDefault: boolean | null;
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
  /** The tags Playwright's config `tag` gives every test; null when the scan can't work them out. */
  tags: string[] | null;
}

/** The files `bun test` runs, and what its config sets for them; see `bunFilesOf`. */
interface BunFiles {
  /** Why Bun refuses the config and runs no test; null when it takes it. */
  refused: string | null;
  about: ProjectAbout;
  concurrent: ProjectAbout;
  isConcurrent: (file: string) => boolean;
  runs: (file: string) => boolean;
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
  /** The project Jest runs with when no config is found up to the root. */
  private jestDefaults: Project | null = null;
  private mochaDefaults: Project | null = null;
  private nodeRuns: ((file: string) => boolean) | null = null;
  private bunFiles: BunFiles | null = null;
  /** The Vitest configs whose projects are being found, with their names, to stop at one whose projects name itself. */
  private readonly expanding = new Map<ConfigFile, string>();

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
    const placement = this.place(file);
    return { ...placement, tags: this.configTags(placement.config) };
  }

  private place(file: string): Omit<Placement, 'tags'> {
    if (this.framework === 'mocha') return this.placeMocha(file);
    if (this.framework === 'jasmine') return this.placeJasmine(file);
    if (this.framework === 'cypress') return this.placeCypress(file);
    if (this.framework === 'webdriverio') return this.placeWebdriverIO(file);
    if (this.framework === 'node') return this.placeNode(file);
    if (this.framework === 'bun') return this.placeBun(file);
    // Jest started at the root reads the config there only, and the others through its `projects`.
    const rootConfig = this.framework === 'jest' ? this.configs.inFolder(this.configs.root) : null;
    const around = this.framework !== 'jest' ? this.configs.around(file) : rootConfig ? [rootConfig] : [];
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
    if (nearest === null && this.framework === 'jest') {
      // Jest then reads a package.json above the root, taken to have no `jest` key: its defaults apply from the root.
      this.jestDefaults ??= this.jestProject(this.noConfig(), emptySettings(), this.configs.root, emptySettings());
      const runs = this.jestDefaults.runs as (file: string) => Run | false;
      return { config: null, settings: null, runs: runs(file), projects: null };
    }
    return {
      config: nearest,
      settings: nearest?.settings ?? null,
      runs: nearest ? false : null,
      projects: nearest ? [] : null,
    };
  }

  /**
   * Playwright's config `tag`, from 1.57, which it gives every test before its own tags; null when the scan can't work
   * it out. That is reported where the config writes `tag`; a config whose settings come from code the scan can't
   * follow is reported there already, as its projects can't be worked out either.
   */
  private configTags(config: ConfigFile | null): string[] | null {
    if (config === null || this.framework !== 'playwright' || !atLeast(this.version, 1, 57)) return [];
    const setting = settingAt(config.settings, ['tag']);
    if (setting === null || isUnset(setting)) return [];
    const tags: string[] = [];
    for (const item of setting.kind === 'list' ? setting.items : [setting]) {
      if (item.kind !== 'value' || typeof item.value !== 'string') {
        if (config.settings.kind === 'object' && config.settings.keys.has('tag')) {
          this.configs.reportUnknown(unknownAt(item), 'tag', "the tests' tags leave it out");
        }
        return null;
      }
      tags.push(item.value);
    }
    return tags;
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

  /** Mocha runs one set of files, from the config it starts with, or its defaults without one. */
  private placeMocha(file: string): Omit<Placement, 'tags'> {
    const config = this.configs.mochaConfig();
    const project = config
      ? this.projectsOf(config)[0]
      : (this.mochaDefaults ??= this.mochaProject(this.noConfig(), emptySettings()));
    if (project.unknown) {
      this.configs.reportUnknown(project.unknown.setting, project.unknown.key, this.findsFiles ? NOT_FOUND : ASSUMED);
      return { config, settings: project.settings, runs: null, projects: null };
    }
    const runs = project.runs(file);
    if (!config) return { config: null, settings: null, runs, projects: null };
    return { config, settings: project.settings, runs, projects: runs ? [project.about] : [] };
  }

  /**
   * The files Mocha runs, as it looks them up from the root, the folder it starts in, wherever its config is: each
   * `spec` entry a glob, a file, a file without its extension, or a folder whose files with one of the `extension`s it
   * takes, also in folders below with `recursive`, less those `ignore` matches; and the `file` entries, loaded first.
   * With globs, every file they match, less `ignore`. A timeout may be written as `'2s'`.
   */
  private mochaProject(config: ConfigFile, settings: Setting): Project {
    const folder = this.configs.root;
    const lists: Record<string, string[]> = {};
    for (const [key, fallback] of [
      ['spec', ['./test']],
      ['extension', ['js', 'cjs', 'mjs']],
      ['ignore', []],
      ['file', []],
    ] as const) {
      const setting = settingAt(settings, [key]) ?? (key === 'ignore' ? settingAt(settings, ['exclude']) : null);
      const found = setting === null || isUnset(setting) ? [...fallback] : patterns(setting, false);
      if (!Array.isArray(found)) return this.unknownProject(config, found, key);
      lists[key] = (found as string[]).map((item) => (key === 'extension' ? item.replace(/^\./, '') : item));
    }
    const recursiveSetting = settingAt(settings, ['recursive']);
    if (recursiveSetting?.kind === 'unknown') return this.unknownProject(config, recursiveSetting, 'recursive');
    const recursive = recursiveSetting?.kind === 'value' && recursiveSetting.value === true;
    const extensions = lists.extension;
    // Mocha matches `ignore` against the path as its lookup finds it, without `./`, so a pattern starting with `./`
    // matches nothing; picomatch would drop the `./` and match.
    const ignored = lists.ignore.map((glob) => (glob.startsWith('./') ? () => false : picomatch(posix(glob))));
    const specs = lists.spec.map((spec) => mochaSpec(folder, spec, extensions, recursive));
    // A `file` entry is loaded as written, before the specs, and `ignore` doesn't apply to it.
    const loaded = new Set(lists.file.map((entry) => path.resolve(folder, entry)));
    const duration = (key: 'timeout' | 'retries') => {
      const setting = settingAt(settings, [key]);
      const value = setting?.kind === 'value' ? durationOf(setting.value, key) : null;
      return value === null ? setting : { kind: 'value' as const, value };
    };
    const about: ProjectAbout = {
      name: '',
      testDir: folder,
      dependencies: [],
      settings,
      root: folder,
      container: null,
      config,
      grep: null,
      grepRoot: folder,
      runsByDefault: true,
      defaults: { ...NO_DEFAULTS, timeout: duration('timeout'), retry: duration('retries') },
    };
    return {
      config,
      settings,
      about,
      unknown: null,
      runs: (file) => {
        const relative = posix(path.relative(folder, file));
        if (loaded.has(file)) return 'test';
        // A project's scripts often give Mocha the spec on its command line, which no config shows, so with globs the
        // scan takes each file they match as run, less `ignore`.
        if (this.findsFiles && !specs.some((spec) => spec(file))) return false;
        return ignored.some((isMatch) => isMatch(relative)) ? false : 'test';
      },
    };
  }

  /**
   * Jasmine runs one set of files, from its config. Without one it runs none, unless it is given files: Karma and
   * Angular projects give it theirs from their own configs, which the scan doesn't read, so their globs decide.
   */
  private placeJasmine(file: string): Omit<Placement, 'tags'> {
    const config = this.configs.jasmineConfig();
    if (!config) return { config: null, settings: null, runs: this.findsFiles ? false : 'test', projects: null };
    const [project] = this.projectsOf(config);
    if (project.unknown) {
      this.configs.reportUnknown(project.unknown.setting, project.unknown.key, this.findsFiles ? NOT_FOUND : ASSUMED);
      return { config, settings: project.settings, runs: null, projects: null };
    }
    const runs = project.runs(file);
    return { config, settings: project.settings, runs, projects: runs ? [project.about] : [] };
  }

  /**
   * The files Jasmine runs: those under `spec_dir`, from the root, that a `spec_files` glob matches, less those a glob
   * starting with `!` matches. With globs, every file they match, as files given to Jasmine replace `spec_files`.
   */
  private jasmineProject(config: ConfigFile): Project {
    const folder = this.configs.root;
    const settings = config.settings;
    const dirSetting = settingAt(settings, ['spec_dir']);
    if (dirSetting?.kind === 'unknown') return this.unknownProject(config, dirSetting, 'spec_dir');
    const specDir = dirSetting?.kind === 'value' && typeof dirSetting.value === 'string' ? dirSetting.value : '';
    const filesSetting = settingAt(settings, ['spec_files']);
    const found = filesSetting === null || isUnset(filesSetting) ? [] : patterns(filesSetting, false);
    if (!Array.isArray(found)) return this.unknownProject(config, found, 'spec_files');
    const globs = (found as string[]).map((glob) => ({ exclude: glob.startsWith('!'), glob: glob.replace(/^!/, '') }));
    const matcher = (exclude: boolean) => {
      const list = globs.filter((item) => item.exclude === exclude).map((item) => posix(path.join(specDir, item.glob)));
      return list.length > 0 ? picomatch(list) : () => false;
    };
    const [included, excluded] = [matcher(false), matcher(true)];
    const about: ProjectAbout = {
      name: '',
      testDir: path.resolve(folder, specDir),
      dependencies: [],
      settings,
      root: folder,
      container: null,
      config,
      grep: null,
      grepRoot: folder,
      runsByDefault: true,
      defaults: NO_DEFAULTS,
    };
    return {
      config,
      settings,
      about,
      unknown: null,
      runs: (file) => {
        // Files given to Jasmine replace `spec_files`, its `!` globs included.
        if (!this.findsFiles) return 'test';
        const relative = posix(path.relative(folder, file));
        return included(relative) && !excluded(relative) ? 'test' : false;
      },
    };
  }

  /**
   * Cypress runs a file in its e2e project, or in its component project when the config sets up component testing.
   * Without a config it runs nothing, unless it is given files.
   */
  private placeCypress(file: string): Omit<Placement, 'tags'> {
    const config = this.configs.rootConfig();
    if (!config) return { config: null, settings: null, runs: this.findsFiles ? false : 'test', projects: null };
    const projects = this.projectsOf(config);
    const unknown = projects.find((project) => project.unknown);
    if (unknown?.unknown) {
      this.configs.reportUnknown(unknown.unknown.setting, unknown.unknown.key, this.findsFiles ? NOT_FOUND : ASSUMED);
      return { config, settings: unknown.settings, runs: null, projects: null };
    }
    // Cypress runs a file given to it only when its testing type's `specPattern` takes the file too.
    const running = projects.filter((project) => project.runs?.(file));
    return {
      config,
      settings: config.settings,
      runs: running.length > 0 ? 'test' : false,
      projects: running.map((project) => project.about),
    };
  }

  /**
   * Cypress's testing types as projects: `e2e`, and `component` when the config has it. Each runs the files under the
   * config's folder that its `specPattern` matches, dot files left out, without those its `excludeSpecPattern` matches,
   * dot files included, and those in `node_modules` unless a `specPattern` names it; component testing also leaves out
   * the files e2e's `specPattern` matches. `cypress run` matches each pattern against the whole path, as globby does.
   */
  private cypressProjects(config: ConfigFile): Project[] {
    const folder = path.dirname(config.file);
    const types: ['e2e' | 'component', string[], string[]][] = [
      ['e2e', ['cypress/e2e/**/*.cy.{js,jsx,ts,tsx}'], ['*.hot-update.js']],
    ];
    if (settingAt(config.settings, ['component']) !== null) {
      types.push(['component', ['**/*.cy.{js,jsx,ts,tsx}'], ['**/__snapshots__/*', '**/__image_snapshots__/*']]);
    }
    // Cypress takes a pattern written from the config's folder as one relative to it.
    const relative = (glob: string) => posix(glob.startsWith(folder + path.sep) ? path.relative(folder, glob) : glob);
    const projects: Project[] = [];
    let e2eSpecs: string[] = [];
    for (const [type, defaultSpecs, defaultExcludes] of types) {
      const lists: string[][] = [];
      for (const [key, fallback] of [
        ['specPattern', defaultSpecs],
        ['excludeSpecPattern', defaultExcludes],
      ] as const) {
        const setting = settingAt(config.settings, [type, key]);
        const found = setting === null || isUnset(setting) ? fallback : patterns(setting, false);
        if (!Array.isArray(found)) return [this.unknownProject(config, found, `${type}.${key}`)];
        lists.push(found as string[]);
      }
      const [specs, excludes] = lists;
      if (type === 'e2e') e2eSpecs = specs;
      // globby takes a `!` pattern among the specs as files to leave out, and a folder as every file below it; the
      // excludes are fast-glob's `ignore`, which drops a `!` and skips everything in a folder it matches.
      const below = (glob: string) => [glob, `${glob.replace(/\/+$/, '')}/**`];
      const isFolder = (glob: string) =>
        !picomatch.scan(glob).isGlob && statSync(path.resolve(folder, glob), { throwIfNoEntry: false })?.isDirectory();
      const isSpec = picomatch(
        specs
          .filter((glob) => !glob.startsWith('!'))
          .map(relative)
          .flatMap((glob) => (isFolder(glob) ? below(glob) : [glob])),
      );
      const excluded = [...excludes, ...(type === 'component' ? e2eSpecs : [])]
        .map((glob) => relative(glob.replace(/^!/, '')))
        .flatMap(below);
      excluded.push(...specs.filter((glob) => glob.startsWith('!')).flatMap((glob) => below(relative(glob.slice(1)))));
      if (!specs.some((glob) => glob.includes('node_modules'))) excluded.push('**/node_modules/**');
      const isExcluded = picomatch(excluded, { dot: true });
      const retry = settingAt(config.settings, [type, 'retries']) ?? settingAt(config.settings, ['retries']);
      const written = retry?.kind === 'object' ? settingAt(retry, ['runMode']) : retry;
      // Cypress takes `null` as no retries set.
      const runMode = written?.kind === 'value' && written.value === null ? null : written;
      const about: ProjectAbout = {
        name: type,
        testDir: folder,
        dependencies: [],
        settings: config.settings,
        root: folder,
        container: null,
        config,
        grep: null,
        grepRoot: folder,
        runsByDefault: true,
        defaults: { ...NO_DEFAULTS, retry: runMode },
      };
      projects.push({
        config,
        settings: config.settings,
        about,
        unknown: null,
        runs: (file) => {
          const from = posix(path.relative(folder, file));
          return isSpec(from) && !isExcluded(from) ? 'test' : false;
        },
      });
    }
    return projects;
  }

  /** `bun test` runs the files of `bunFilesOf`, with the settings of the `bunfig.toml` in the root, when there is one. */
  private placeBun(file: string): Omit<Placement, 'tags'> {
    const config = this.configs.rootConfig();
    if (!this.bunFiles) {
      this.bunFiles = this.bunFilesOf(config);
      if (this.bunFiles.refused) this.configs.reportConfig(config as ConfigFile, this.bunFiles.refused);
    }
    const found = this.bunFiles;
    const runs = found.refused === null && (!this.findsFiles || found.runs(file)) ? 'test' : false;
    if (!config) return { config: null, settings: null, runs, projects: null };
    const projects = runs ? [found.isConcurrent(file) ? found.concurrent : found.about] : [];
    return { config, settings: config.settings, runs, projects };
  }

  /**
   * The files `bun test` runs: those under `[test] root`, the root by default, whose name without its extension ends
   * with `.test`, `_test`, `.spec` or `_spec`, with a JavaScript or TypeScript extension, outside dot folders and
   * `node_modules`, and from Bun 1.3.11 outside the folders and files a `pathIgnorePatterns` glob matches. `[test] retry`
   * applies to every test, and the tests of the files a `concurrentTestGlob` glob matches run at once.
   */
  private bunFilesOf(config: ConfigFile | null): BunFiles {
    const folder = this.configs.root;
    const settings = config?.settings ?? emptySettings();
    // Bun reads a string or a list of them, and ignores a `root` of another type.
    const read = (key: string): string[] | null => {
      const setting = settingAt(settings, ['test', key]);
      if (setting === null) return [];
      const found = patterns(setting, false);
      return Array.isArray(found) ? (found as string[]) : null;
    };
    const roots = read('root') ?? [];
    // Bun 1.2 reads neither `pathIgnorePatterns` nor `retry`. It reads the first from 1.3.11, and the version holds no
    // patch to tell 1.3.10 from it, so all of 1.3 reads it.
    const readsFrom13 = atLeast(this.version, 1, 3);
    const ignored = readsFrom13 ? read('pathIgnorePatterns') : [];
    const concurrent = read('concurrentTestGlob');
    const wrong = ignored === null ? 'pathIgnorePatterns' : concurrent === null ? 'concurrentTestGlob' : null;
    const refused =
      wrong &&
      `The config's test.${wrong} is not a string or a list of strings, so Bun refuses the config and runs no test.`;
    const testRoot = path.resolve(folder, roots[0] ?? '.');
    const isIgnored = picomatch(ignored ?? []);
    const isConcurrent = picomatch(concurrent ?? []);
    const about = (parallel: boolean): ProjectAbout => ({
      name: '',
      testDir: testRoot,
      dependencies: [],
      settings,
      root: folder,
      container: null,
      config: config as ConfigFile,
      grep: null,
      grepRoot: folder,
      runsByDefault: true,
      defaults: {
        ...NO_DEFAULTS,
        retry: readsFrom13 ? settingAt(settings, ['test', 'retry']) : null,
        parallel: parallel ? { kind: 'value', value: true } : null,
      },
    });
    return {
      refused,
      about: about(false),
      concurrent: about(true),
      // Bun 1.4.4 matches the glob against the file's whole path.
      isConcurrent: (file) => isConcurrent(posix(file)),
      runs: (file) => {
        if (!isInside(testRoot, file)) return false;
        const relative = posix(path.relative(folder, file));
        const parts = relative.split('/');
        if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return false;
        if (parts.some((_, index) => isIgnored(parts.slice(0, index + 1).join('/')))) return false;
        return /(\.test|_test|\.spec|_spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i.test(relative);
      },
    };
  }

  /** `node --test` runs the files its arguments name, or without any, those its default patterns match; see `nodeFiles`. */
  private placeNode(file: string): Omit<Placement, 'tags'> {
    if (!this.findsFiles) return { config: null, settings: null, runs: 'test', projects: null };
    this.nodeRuns ??= this.nodeFiles();
    const runs = this.nodeRuns(posix(path.relative(this.configs.root, file)));
    return { config: null, settings: null, runs: runs ? 'test' : false, projects: null };
  }

  /**
   * The files `node --test` runs from the root, outside dot folders and `node_modules`: those the arguments of the
   * `test` script and the scripts it runs give, or the first script that runs it, each a glob or a path, and from
   * Node.js 26.8 a folder for the default patterns inside it; without arguments, the default patterns. They take
   * TypeScript files too from Node.js 22.18, which strips types by default.
   */
  private nodeFiles(): (relative: string) => boolean {
    const extensions = stripsTypes(this.version) ? 'cjs,mjs,js,cts,mts,ts' : 'cjs,mjs,js';
    const defaults = ['**/*.test', '**/*-test', '**/*_test', '**/test-*', '**/test', '**/test/**/*'].map(
      (glob) => `${glob}.{${extensions}}`,
    );
    const searchesFolders = atLeast(this.version, 26, 8);
    const commands = nodeTestArguments(path.join(this.configs.root, 'package.json'));
    // Each command runs the files it gives, or without any, those the default patterns match.
    const globs = (commands.length > 0 ? commands : [[]]).flatMap((files) =>
      files.length === 0
        ? defaults
        : files.flatMap((argument) => {
            const folder = path.resolve(this.configs.root, argument);
            if (!searchesFolders || !existsSync(folder) || !statSync(folder).isDirectory()) return [argument];
            return defaults.map((glob) => `${argument.replace(/\/+$/, '')}/${glob}`);
          }),
    );
    const isMatch = picomatch(globs.map((glob) => path.posix.normalize(posix(glob))));
    return (relative) => isMatch(relative) && !relative.split('/').includes('node_modules');
  }

  /** WebdriverIO runs the files of the config in the root; without one, it runs nothing, unless it is given files. */
  private placeWebdriverIO(file: string): Omit<Placement, 'tags'> {
    const config = this.configs.rootConfig();
    if (!config) return { config: null, settings: null, runs: this.findsFiles ? false : 'test', projects: null };
    const [project] = this.projectsOf(config);
    if (project.unknown) {
      this.configs.reportUnknown(project.unknown.setting, project.unknown.key, this.findsFiles ? NOT_FOUND : ASSUMED);
      return { config, settings: project.settings, runs: null, projects: null };
    }
    const runs = project.runs(file);
    return { config, settings: project.settings, runs, projects: runs ? [project.about] : [] };
  }

  /**
   * The files `wdio` runs: those under `rootDir`, the config's folder by default, that a `specs` glob matches, also in
   * the nested lists that group files into one worker, less those `exclude` leaves out. A capability's own `specs` replace the config's for it, and its `exclude` adds to the config's. Globs leave out
   * dot files and folders, and one without a `/` matches a file's name at any depth. When every `exclude` entry holds a
   * `/`, `\` or `*`, they are globs too; otherwise each one leaves out every file whose URL contains it. Files given
   * with `--spec` replace `specs`, so scanned with globs, every file they match counts as run, less the excludes. The
   * config's `mochaOpts.timeout` and `retries`, or `jasmineOpts.defaultTimeoutInterval`, apply to every test.
   */
  private webdriverioProject(config: ConfigFile): Project {
    const { settings } = config;
    const writtenRoot = settingAt(settings, ['rootDir']);
    if (
      writtenRoot !== null &&
      !isUnset(writtenRoot) &&
      !(writtenRoot.kind === 'value' && typeof writtenRoot.value === 'string')
    ) {
      return this.unknownProject(config, unknownAt(writtenRoot), 'rootDir');
    }
    // The config's `rootDir`, from the folder `wdio` starts in, replaces the config's folder.
    const folder =
      writtenRoot?.kind === 'value' && typeof writtenRoot.value === 'string'
        ? path.resolve(this.configs.root, writtenRoot.value)
        : path.dirname(config.file);
    const globs = (owner: Setting, keys: string[]): string[] | Unknown | null => {
      const setting = keys.map((key) => settingAt(owner, [key])).find((item) => item !== null && !isUnset(item));
      if (!setting) return null;
      // A single glob is taken as a list of one; a nested list groups files into one worker.
      const items =
        setting.kind === 'list'
          ? setting.items.flatMap((item) => (item.kind === 'list' ? item.items : [item]))
          : [setting];
      const found = patterns({ kind: 'list', items }, false);
      return Array.isArray(found) ? (found as string[]) : found;
    };
    // WebdriverIO globs each pattern with `/` for `\`, from `rootDir`.
    const fromRoot = (glob: string) => {
      const slashed = glob.replaceAll('\\', '/');
      return path.posix.normalize(path.isAbsolute(slashed) ? posix(path.relative(folder, slashed)) : slashed);
    };
    // As glob's matchBase does, a pattern without a slash matches at any depth, outside dot folders too; the slash of
    // `./` counts. A pattern that starts with `!` matches no file in glob.
    const matcher = (list: string[]) =>
      picomatch(
        list
          .filter((glob) => !glob.startsWith('!'))
          .map((glob) => (/[/\\]/.test(glob) ? fromRoot(glob) : `**/${fromRoot(glob)}`)),
      );
    const specs = globs(settings, ['specs']) ?? [];
    if (!Array.isArray(specs)) return this.unknownProject(config, specs, 'specs');
    const written = globs(settings, ['exclude']) ?? [];
    if (!Array.isArray(written)) return this.unknownProject(config, written, 'exclude');
    const excludes = written.filter((item) => !isSuiteName(settings, item));
    const isGlob = excludes.every((item) => /[/\\*]/.test(item));
    const isPathExcluded = matcher(excludes);
    const isExcluded = (file: string, relative: string) =>
      isGlob ? isPathExcluded(relative) : excludes.some((item) => pathToFileURL(file).href.includes(item));
    // Each capability may set its own specs, which replace the config's, and excludes, added to the config's, inside
    // `alwaysMatch` when it has one. WebdriverIO 10 reads only `wdio:specs` and `wdio:exclude`.
    const capabilities = settingAt(settings, ['capabilities']);
    const [specKeys, excludeKeys] = atLeast(this.version, 10, 0)
      ? [['wdio:specs'], ['wdio:exclude']]
      : [
          ['specs', 'wdio:specs'],
          ['exclude', 'wdio:exclude'],
        ];
    const runs: { isSpec: (relative: string) => boolean; isExcluded: (relative: string) => boolean }[] = [];
    for (const capability of capabilities?.kind === 'list' && capabilities.items.length > 0
      ? capabilities.items
      : [emptySettings()]) {
      const options = settingAt(capability, ['alwaysMatch']) ?? capability;
      const own = globs(options, specKeys);
      if (own !== null && !Array.isArray(own)) return this.unknownProject(config, own, 'capabilities.specs');
      const exclude = globs(options, excludeKeys) ?? [];
      if (!Array.isArray(exclude)) return this.unknownProject(config, exclude, 'capabilities.exclude');
      runs.push({ isSpec: matcher(own ?? specs), isExcluded: matcher(exclude) });
    }
    const framework = settingAt(settings, ['framework']);
    const isJasmine = framework?.kind === 'value' && framework.value === 'jasmine';
    const options = settingAt(settings, [isJasmine ? 'jasmineOpts' : 'mochaOpts']) ?? emptySettings();
    const duration = (key: 'timeout' | 'retries') => {
      const setting = settingAt(options, [key]);
      const value = setting?.kind === 'value' ? durationOf(setting.value, key) : null;
      return value === null ? setting : { kind: 'value' as const, value };
    };
    // A `defaultTimeoutInterval` of 0 replaces WebdriverIO's default, and its Jasmine adapter then takes 60 seconds.
    const interval = settingAt(options, ['defaultTimeoutInterval']);
    const jasmineTimeout =
      interval?.kind === 'value' && interval.value === 0 ? { kind: 'value' as const, value: 60_000 } : interval;
    const about: ProjectAbout = {
      name: '',
      testDir: folder,
      dependencies: [],
      settings,
      root: folder,
      container: null,
      config,
      grep: null,
      grepRoot: folder,
      runsByDefault: true,
      defaults: isJasmine
        ? { ...NO_DEFAULTS, timeout: jasmineTimeout }
        : { ...NO_DEFAULTS, timeout: duration('timeout'), retry: duration('retries') },
    };
    return {
      config,
      settings,
      about,
      unknown: null,
      runs: (file) => {
        const relative = posix(path.relative(folder, file));
        if (isExcluded(file, relative)) return false;
        // Files given with `--spec` replace every capability's specs.
        const running = runs.some((run) => (!this.findsFiles || run.isSpec(relative)) && !run.isExcluded(relative));
        return running ? 'test' : false;
      },
    };
  }

  private projectsOf(config: ConfigFile): Project[] {
    let projects = this.projects.get(config);
    if (!projects) {
      if (this.framework === 'playwright') projects = this.playwrightProjects(config);
      else if (this.framework === 'jest') projects = this.jestProjects(config);
      else if (this.framework === 'mocha') projects = [this.mochaProject(config, config.settings)];
      else if (this.framework === 'jasmine') projects = [this.jasmineProject(config)];
      else if (this.framework === 'cypress') projects = this.cypressProjects(config);
      else if (this.framework === 'webdriverio') projects = [this.webdriverioProject(config)];
      else projects = this.vitestProjects(config);
      this.projects.set(config, projects);
    }
    return projects;
  }

  /** Vitest's `retry`: before 4.1, which reads only a count, an object is one the scan can't work out. */
  private vitestRetry(config: ConfigFile, setting: Setting | null): Setting | null {
    if (setting?.kind !== 'object' || atLeast(this.version, 4, 1)) return setting;
    const message = "The config's test.retry is an object, which Vitest reads from 4.1; before, it runs no test.";
    this.configs.reportSetting(setting, config, 'test.retry', message);
    return unknownAt(setting);
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
      runsByDefault: true,
      defaults: NO_DEFAULTS,
    };
    return { config, settings: setting, about, runs: null, unknown: { setting, key } };
  }

  private playwrightProjects(config: ConfigFile): Project[] {
    const list = settingAt(config.settings, ['projects']);
    if (list?.kind === 'unknown') return [this.unknownProject(config, list, 'projects')];
    const items = list?.kind === 'list' ? list.items : [emptySettings()];
    const running = this.runsByDefault(config, items);
    return items.map((project) => this.playwrightProject(config, project, running.get(project) as boolean | null));
  }

  /**
   * Whether Playwright runs each project without `--project`: from 1.64, not with `default: false`, unless a project it
   * runs lists it in `dependencies` or `teardown`, directly or through others. Null when the scan can't tell.
   */
  private runsByDefault(config: ConfigFile, projects: Setting[]): Map<Setting, boolean | null> {
    const isRead = atLeast(this.version, 1, 64);
    const runs = new Map<Setting, boolean | null>(projects.map((project) => [project, !isRead]));
    const names = projects.map((project) => playwrightName(config, project));
    const visit = (project: Setting, value: true | null) => {
      const current = runs.get(project);
      if (current === true || current === value) return;
      runs.set(project, value);
      const teardown = settingAt(project, ['teardown']);
      const dependencies = settingAt(project, ['dependencies']);
      const needed = strings(dependencies);
      if (teardown?.kind === 'value' && typeof teardown.value === 'string') needed.push(teardown.value);
      // A list the scan can't work out may name any project, which then may run.
      const unknowns = [teardown, dependencies, ...(dependencies?.kind === 'list' ? dependencies.items : [])].filter(
        (setting) => setting?.kind === 'unknown',
      );
      for (const unknown of unknowns) {
        this.configs.reportUnknown(
          unknown,
          'projects dependencies',
          "the scan can't tell which projects run the tests",
        );
      }
      for (const [index, other] of projects.entries()) {
        if (needed.includes(names[index])) visit(other, value);
        else if (unknowns.length > 0) visit(other, null);
      }
    };
    // The projects that surely run go first, so that what they pull in is sure to run too.
    for (const value of isRead ? ([true, null] as const) : []) {
      for (const project of projects) {
        const setting = settingAt(project, ['default']);
        const seed = setting?.kind === 'unknown' ? null : !(setting?.kind === 'value' && setting.value === false);
        if (seed !== value) continue;
        if (seed === null && project.kind !== 'unknown') {
          this.configs.reportUnknown(
            setting as Unknown,
            'projects default',
            "the scan can't tell which projects run the tests",
          );
        }
        visit(project, value);
      }
    }
    return runs;
  }

  /** The name of a project a Vitest config lists, with a warning when its `test.name` can't be worked out. */
  private listedName(settings: Setting, fallback: string, container: string | null): string {
    const name = settingAt(settings, ['test', 'name']);
    const label = name?.kind === 'object' ? settingAt(name, ['label']) : name;
    // Only a name written in a config the scan reads; a config it can't read is reported as a whole.
    const holder = name?.kind === 'object' ? name : settingAt(settings, ['test']);
    const isWritten = holder?.kind === 'object' && [...holder.keys.values()].includes(label as Setting);
    if (label?.kind === 'unknown' && isWritten) {
      this.configs.reportUnknown(label, 'test.name', 'the project is named after its folder or its place in the list');
    }
    return vitestName(settings, fallback, container);
  }

  /** A Playwright project: its own settings, else the config's, else Playwright's defaults. */
  private playwrightProject(config: ConfigFile, project: Setting, runsByDefault: boolean | null): Project {
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
    const dependencies = settingAt(project, ['dependencies']);
    // Playwright's root folder: the config's testDir, the start of each test's grep title.
    const configDir = settingAt(config.settings, ['testDir']);
    const about: ProjectAbout = {
      name: playwrightName(config, project),
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
      runsByDefault,
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
        if (runsByDefault === false || !isInside(root, file)) return false;
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

  /** A config for the defaults of a runner started where no config is found. */
  private noConfig(): ConfigFile {
    const file = path.join(this.configs.root, 'package.json');
    return { file, record: { relativeFilePath: 'package.json', extends: [] }, settings: emptySettings() };
  }

  /**
   * Jest's projects: the config itself, or the entries of its `projects`. A path or glob there names a folder, whose
   * config is the one Jest finds from it, or a config file; an object is a project whose `rootDir` defaults to the
   * config's folder. The config's own test files then count only when an entry names its folder.
   */
  private jestProjects(config: ConfigFile): Project[] {
    const folder = path.dirname(config.file);
    const list = settingAt(config.settings, ['projects']);
    const isEmpty = list?.kind === 'list' && list.items.length === 0;
    if (list === null || isUnset(list) || isEmpty) {
      return [this.jestProject(config, config.settings, folder, config.settings)];
    }
    if (list.kind !== 'list') return [this.unknownProject(config, unknownAt(list), 'projects')];
    const rootDir = jestRootDir(config.settings, folder);
    if (typeof rootDir !== 'string') return [this.unknownProject(config, rootDir, 'rootDir')];
    return list.items.flatMap((item) => {
      if (item.kind === 'object') return [this.jestProject(config, item, folder, config.settings)];
      if (item.kind !== 'value' || typeof item.value !== 'string') {
        return [this.unknownProject(config, unknownAt(item), 'projects')];
      }
      const entry = replaceRootDir(rootDir, item.value);
      // Jest globs from where it is started, with `\` as a separator on Windows, and keeps an entry that matches nothing
      // as a path.
      const pattern = posix(path.isAbsolute(entry) ? path.relative(this.configs.root, entry) : entry);
      const matches = picomatch.scan(pattern).isGlob
        ? globSync(pattern, { cwd: this.configs.root, absolute: true, onlyFiles: false, expandDirectories: false })
        : [];
      // Jest leaves out a matched file it can't require, such as a README.
      const requirable = matches.filter(
        (match) =>
          statSync(match).isDirectory() || JEST_CONFIG_EXTENSIONS.some((extension) => match.endsWith(extension)),
      );
      const targets = matches.length > 0 ? requirable : [path.resolve(this.configs.root, entry)];
      // Jest fails on an entry that names nothing, so it adds no project here.
      return targets.sort().flatMap((target) => {
        if (!existsSync(target)) return [];
        const isFile = statSync(target).isFile();
        const nested = isFile ? this.configs.at(target) : this.configs.projectConfig(target);
        if (!nested || nested === config) return [this.jestProject(config, config.settings, folder, config.settings)];
        return [this.jestProject(nested, nested.settings, path.dirname(nested.file), config.settings)];
      });
    });
  }

  /**
   * The files a Jest project runs, as Jest's SearchSource picks them: under one of `roots`, with an extension in
   * `moduleFileExtensions`, not left out by `modulePathIgnorePatterns`, matching `testMatch` or `testRegex`, and not
   * `testPathIgnorePatterns`. Paths and patterns are matched with `/`, and `<rootDir>` stands for `rootDir`. `global`
   * is the config Jest is started with, whose `testTimeout` applies to every project in Jest 29.
   */
  private jestProject(config: ConfigFile, written: Setting, folder: string, global: Setting): Project {
    const rootDir = jestRootDir(written, folder);
    if (typeof rootDir !== 'string') return this.unknownProject(config, rootDir, 'rootDir');
    const { settings, refusal: presetRefusal } = this.withPreset(written, rootDir);
    const isJest30 = this.version === null || this.version[0] >= 30;
    const lists: Record<string, string[] | RegExp[]> = {};
    const defaults: [string, string[]][] = [
      ['roots', ['<rootDir>']],
      ['testMatch', isJest30 ? JEST_TEST_MATCH[30] : JEST_TEST_MATCH[29]],
      ['testRegex', []],
      ['testPathIgnorePatterns', ['/node_modules/']],
      ['modulePathIgnorePatterns', []],
      ['moduleFileExtensions', isJest30 ? [...JEST_EXTENSIONS, 'mts', 'cts'] : JEST_EXTENSIONS],
    ];
    for (const [key, fallback] of defaults) {
      const setting = settingAt(settings, [key]);
      const found = isJestSet(setting) ? patterns(setting, key === 'testRegex') : fallback;
      // A list of paths left out only takes files away, so the entries the scan can read are still a good guess.
      if (!Array.isArray(found) && key.endsWith('IgnorePatterns')) {
        this.configs.reportUnknown(found, key, 'the scan may list test files that Jest leaves out');
        const items = setting?.kind === 'list' ? setting.items : [];
        lists[key] = items.flatMap((item) =>
          item.kind === 'value' && typeof item.value === 'string' ? [item.value] : [],
        );
        continue;
      }
      if (!Array.isArray(found)) return this.unknownProject(config, found, key);
      lists[key] = found as string[];
    }
    const testRegex = (lists.testRegex as (string | RegExp)[]).map((item) =>
      typeof item === 'string' ? regExp(item, '') : item,
    );
    const invalid = (lists.testRegex as (string | RegExp)[]).find((_, index) => testRegex[index] === null);
    const testMatchSetting = settingAt(settings, ['testMatch']);
    let refusal: string | null = presetRefusal;
    if (invalid !== undefined) {
      refusal ??= `The config's testRegex '${String(invalid)}' is not a regular expression, so Jest fails to start.`;
    } else if (testRegex.length > 0 && isJestSet(testMatchSetting)) {
      refusal ??= 'The config sets both testMatch and testRegex, which Jest refuses, so it runs no tests.';
    }
    const roots = (lists.roots as string[])
      .map((item) => replaceRootDir(rootDir, item))
      .map((root) => path.resolve(rootDir, root));
    const escaped = posix(rootDir).replaceAll(/([!()*?[\\\]{}])/g, '\\$1');
    const testMatch =
      testRegex.length > 0 ? [] : (lists.testMatch as string[]).map((glob) => posix(replaceRootDir(escaped, glob)));
    const isTestMatch = jestGlobs(testMatch);
    // A pattern is a regular expression, in which Jest replaces every `<rootDir>`; escapes stay as written.
    const joined = (key: string) => {
      const items = (lists[key] as string[]).map((item) => item.replaceAll('<rootDir>', posix(rootDir)));
      if (items.length === 0) return null;
      const expression = regExp(items.join('|'), '');
      refusal ??= expression ? null : `The config's ${key} is not a regular expression, so Jest fails to start.`;
      return expression;
    };
    const ignored = joined('testPathIgnorePatterns');
    const moduleIgnored = joined('modulePathIgnorePatterns');
    if (refusal) this.configs.reportConfig(config, refusal);
    const extensions = new Set(lists.moduleFileExtensions as string[]);
    const preset = settingAt(written, ['preset']);
    const isPackage = preset?.kind === 'value' && typeof preset.value === 'string' && !isLocalPreset(preset.value);
    if (isPackage && !NEUTRAL_PRESETS.test(String(preset.value))) {
      const message = `The config's preset '${preset.value}' is a package the scan doesn't read, and it may set which files are tests; the scan takes Jest's defaults for what the config doesn't set.`;
      if (testMatchSetting === null && testRegex.length === 0) this.configs.reportConfig(config, message);
    }
    const displayName = settingAt(settings, ['displayName']);
    const named = displayName?.kind === 'object' ? settingAt(displayName, ['name']) : displayName;
    const name = named?.kind === 'value' && typeof named.value === 'string' ? named.value : '';
    const about: ProjectAbout = {
      name,
      testDir: rootDir,
      dependencies: [],
      settings,
      root: rootDir,
      container: null,
      config,
      grep: null,
      grepRoot: rootDir,
      runsByDefault: true,
      defaults: {
        // A project's own testTimeout counts from Jest 30; before, only the config Jest is started with sets it.
        timeout: (isJest30 ? settingAt(settings, ['testTimeout']) : null) ?? settingAt(global, ['testTimeout']),
        retry: null,
        repeatEach: null,
        repeats: null,
        parallel: null,
        tags: null,
      },
    };
    return {
      config,
      settings,
      about,
      unknown: null,
      runs: (file) => {
        const unix = posix(file);
        if (refusal || !extensions.has(path.extname(file).slice(1))) return false;
        if (!roots.some((root) => isInside(root, file)) || moduleIgnored?.test(unix)) return false;
        if (testMatch.length > 0 && !isTestMatch(unix)) return false;
        if (ignored?.test(unix)) return false;
        return testRegex.length === 0 || testRegex.some((expression) => matches(expression as RegExp, unix))
          ? 'test'
          : false;
      },
    };
  }

  /**
   * The projects of a Vitest config, the one the runner starts with or, in Vitest 5, a config another lists, whose name
   * then goes around the names of its projects.
   */
  /**
   * A project's settings over those of its `preset` when that is a local file, as `'../../jest.preset.js'`, which Jest
   * finds from `rootDir`: the project's own settings win, as Jest merges them. A preset that is a package isn't read.
   */
  private withPreset(settings: Setting, rootDir: string): { settings: Setting; refusal: string | null } {
    const preset = settingAt(settings, ['preset']);
    if (preset?.kind !== 'value' || typeof preset.value !== 'string' || !isLocalPreset(preset.value))
      return { settings, refusal: null };
    const target = path.resolve(rootDir, replaceRootDir(rootDir, preset.value));
    const file = ['', '.js', '.json', '.cjs'].map((extension) => target + extension).find(isFileAt);
    if (!file) {
      return {
        settings,
        refusal: `The config's preset '${preset.value}' doesn't exist, so Jest fails to start.`,
      };
    }
    const base = this.configs.at(file).settings;
    if (base.kind !== 'object' || settings.kind !== 'object') return { settings, refusal: null };
    return { settings: { ...settings, keys: new Map([...base.keys, ...settings.keys]) }, refusal: null };
  }

  private vitestProjects(config: ConfigFile, container: string | null = null): Project[] {
    const folder = path.dirname(config.file);
    const list = settingAt(config.settings, ['test', 'projects']);
    const isVitest3 = this.version !== null && this.version[0] < 4;
    const workspace = isVitest3 ? settingAt(config.settings, ['test', 'workspace']) : null;
    if (workspace) return [this.unknownProject(config, unknownAt(workspace), 'test.workspace')];
    if (isVitest3 && VITEST_WORKSPACES.some((name) => existsSync(path.join(folder, name)))) {
      // Vitest 3 takes its projects from a workspace file, which the scan doesn't read.
      return [this.unknownProject(config, { kind: 'unknown', where: null }, 'test.projects')];
    }
    const name = container ?? vitestName(config.settings, '', null);
    if (list === null) return this.vitestProject(config, config.settings, folder, null, name);
    if (list.kind !== 'list') return [this.unknownProject(config, unknownAt(list), 'test.projects')];
    this.expanding.set(config, name);
    const globs: string[] = [];
    // Vitest names an inline project without a name after its place among the entries that aren't paths.
    let index = 0;
    const projects = list.items.flatMap((item) => {
      if (item.kind === 'value' && typeof item.value === 'string') {
        // `<rootDir>` is the config's folder, written with / as globs are.
        const pattern = item.value.replace('<rootDir>', posix(folder));
        // Vitest globs every pattern and negation together, and reads a plain path as it is.
        if (pattern.startsWith('!') || picomatch.scan(pattern).isGlob) globs.push(pattern);
        else return this.vitestPath(config, path.resolve(folder, pattern), container);
        return [];
      }
      return this.vitestEntry(config, item, folder, String(index++), container);
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
    projects.push(...matches.flatMap((match) => this.vitestPath(config, path.resolve(match), container)));
    this.expanding.delete(config);
    return projects;
  }

  /**
   * A project written in `test.projects`, which inherits the root config as each version of Vitest decides, named
   * after `index` when it has no name of its own.
   */
  private vitestEntry(
    config: ConfigFile,
    entry: Setting,
    folder: string,
    index: string,
    container: string | null,
  ): Project[] {
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
    const isVitest5 = atLeast(this.version, 5, 0);
    // Vitest 5 takes a project's own tags in place of those it extends, and doesn't pass on the name.
    const ownTags = isVitest5 ? settingAt(entry, ['test', 'tags']) : null;
    const settings = mergeDeep(base, entry);
    const name = this.listedName(isVitest5 ? entry : settings, index, container);
    const root = this.inlineRoot(config, entry, folder);
    if (typeof root !== 'string') return [this.unknownProject(config, root.setting, root.key)];
    return this.vitestProject(config, settings, root, ownTags, name, true);
  }

  /**
   * The folder an inline project runs from. Without a root of its own, every version runs it from the config's root;
   * Vitest 5 also resolves its own root from there, where older versions resolve it from the config's folder.
   */
  private inlineRoot(config: ConfigFile, entry: Setting, folder: string): string | { setting: Unknown; key: string } {
    const parent = writtenRoot(config.settings);
    const parentRoot = typeof parent === 'string' ? path.resolve(folder, parent) : (parent ?? folder);
    const own = writtenRoot(entry);
    if (own === null) return parentRoot;
    if (typeof own !== 'string') return own;
    if (!atLeast(this.version, 5, 0)) return path.resolve(folder, own);
    return typeof parentRoot === 'string' ? path.resolve(parentRoot, own) : parentRoot;
  }

  /**
   * The projects of a config file or folder `test.projects` names: the config's own, also the projects it lists in
   * Vitest 5, or a project with Vitest's defaults for a folder without a config. Without a name, a project is named
   * after the package.json in its folder, else the folder.
   */
  private vitestPath(config: ConfigFile, target: string, container: string | null): Project[] {
    const nested = VITEST_CONFIG.test(path.basename(target)) ? this.configs.at(target) : this.configs.inFolder(target);
    const folder = nested ? path.dirname(nested.file) : target;
    // A config that lists itself also runs as a project, under its own name.
    const listing = nested && this.expanding.get(nested);
    const fallback = packageName(folder) ?? path.basename(folder);
    const name = listing ?? this.listedName(nested?.settings ?? emptySettings(), fallback, container);
    if (!nested) return this.vitestProject(config, emptySettings(), target, null, name);
    const isContainer = (this.version === null || this.version[0] >= 5) && listing === undefined;
    const projects =
      isContainer && settingAt(nested.settings, ['test', 'projects'])
        ? this.vitestProjects(nested, name)
        : this.vitestProject(nested, nested.settings, folder, null, name);
    // The outermost config lists the others, so it is set last.
    return projects.map((project) => ({ ...project, about: { ...project.about, container: config } }));
  }

  /**
   * A Vitest project, with the name Vitest gives it: its files are found from `test.dir`, else `test.root` or `root`,
   * else its folder; with `isRoot`, `folder` is its root already. With browser mode on, each of `browser.instances` is
   * a project of its own, named as Vitest names it.
   */
  private vitestProject(
    config: ConfigFile,
    settings: Setting,
    folder: string,
    ownTags: Setting | null,
    name: string,
    isRoot = false,
  ): Project[] {
    const project = this.vitestFiles(config, settings, folder, ownTags, name, isRoot);
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
  private vitestFiles(
    config: ConfigFile,
    settings: Setting,
    folder: string,
    ownTags: Setting | null,
    name: string,
    isRoot: boolean,
  ): Project {
    let root = folder;
    let dir: string | null = null;
    let hasTestRoot = false;
    for (const key of isRoot ? ['test.dir'] : ['test.root', 'root', 'test.dir']) {
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
    const about: ProjectAbout = {
      name,
      testDir: base,
      dependencies: [],
      settings,
      root,
      container: null,
      config,
      grep: null,
      grepRoot: base,
      runsByDefault: true,
      defaults: {
        timeout: settingAt(settings, ['test', 'testTimeout']),
        retry: this.vitestRetry(config, settingAt(settings, ['test', 'retry'])),
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

/** A Playwright project's name: its own, else the config's, else empty. */
function playwrightName(config: ConfigFile, project: Setting): string {
  for (const setting of [settingAt(project, ['name']), settingAt(config.settings, ['name'])]) {
    if (setting && !isUnset(setting)) {
      return setting.kind === 'value' && typeof setting.value === 'string' ? setting.value : '';
    }
  }
  return '';
}

/** The strings of a list setting, such as Playwright's `dependencies`; none for anything else. */
/**
 * A Vitest project's name: its `test.name`, or the name's `label`, else `fallback`; in Vitest 5, inside the name of the
 * config that lists it, as `web (unit)`.
 */
function vitestName(settings: Setting, fallback: string, container: string | null): string {
  const name = settingAt(settings, ['test', 'name']);
  const label = name?.kind === 'object' ? settingAt(name, ['label']) : name;
  const own = (label?.kind === 'value' && typeof label.value === 'string' && label.value) || fallback;
  return container === null ? own : `${container} (${own})`;
}

function strings(setting: Setting | null): string[] {
  if (setting?.kind !== 'list') return [];
  return setting.items.flatMap((item) => (item.kind === 'value' && typeof item.value === 'string' ? [item.value] : []));
}

/** The `name` of the package.json in a folder; null without one, or when it has none. */
function packageName(folder: string): string | null {
  try {
    const { name } = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof name === 'string' && name !== '' ? name : null;
  } catch {
    return null;
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

/**
 * The root a config sets, `test.root` over Vite's `root`, as written; null when it sets none, and the setting and its
 * key when it can't be worked out.
 */
function writtenRoot(settings: Setting): string | null | { setting: Unknown; key: string } {
  for (const key of ['test.root', 'root']) {
    const setting = settingAt(settings, key.split('.'));
    if (setting === null || isUnset(setting)) continue;
    if (setting.kind !== 'value' || typeof setting.value !== 'string') return { setting: unknownAt(setting), key };
    return setting.value;
  }
  return null;
}

/** A config's settings without `test.projects`, as an inline project inherits them; both are known objects. */
/**
 * Whether Mocha's lookup of one `spec` entry finds a file: an entry with glob characters is a glob, which takes any
 * file it matches; otherwise a file, the entry with one of the extensions added, or a folder, whose files with one of
 * the extensions it takes, without hidden ones, and those of folders below with `recursive`.
 */
function mochaSpec(folder: string, spec: string, extensions: string[], recursive: boolean): (file: string) => boolean {
  const target = path.resolve(folder, spec);
  if (picomatch.scan(posix(spec)).isGlob) {
    // An absolute glob, as `path.join(__dirname, 'test', '**', '*.spec.js')` builds it, is taken from the folder.
    const written = path.isAbsolute(spec) ? path.relative(folder, spec) : spec;
    const isMatch = picomatch(posix(written).replace(/^\.\//, ''));
    return (file) => isMatch(posix(path.relative(folder, file)));
  }
  const stat = statSync(target, { throwIfNoEntry: false });
  if (stat?.isFile()) return (file) => file === target;
  if (!stat?.isDirectory()) return (file) => extensions.some((extension) => file === `${target}.${extension}`);
  return (file) => {
    if (!isInside(target, file) || path.basename(file).startsWith('.')) return false;
    if (!recursive && path.dirname(file) !== target) return false;
    // An extension may have several parts, as `spec.js`.
    return extensions.some((extension) => file.endsWith(`.${extension}`));
  };
}

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
 * out, or the test is in a project the scan can't tell runs.
 */
function projectsRunning(
  projects: ProjectAbout[],
  test: TestRecord,
  suites: SuiteRecord[],
  file: string,
  configTags: string[] | null,
): ProjectAbout[] | null {
  const titles = [...test.suitePath, test.title];
  const isDynamic =
    test.hasDynamicTitle ||
    configTags === null ||
    suites.some((suite) => suite.hasDynamicTitle && test.suitePath.includes(suite.title));
  // Tags written into a title are in its text already; Playwright adds the config's after the file, the others after it.
  const tags = test.tags.filter((tag) => !configTags?.includes(tag) && !titles.some((title) => title.includes(tag)));
  const running: ProjectAbout[] = [];
  for (const project of projects) {
    const { name, grep, grepRoot } = project;
    if (grep && isDynamic) return null;
    const text = [name, path.relative(grepRoot, file), ...(configTags ?? []), ...titles, ...tags].join(' ');
    if (grep && !grep(text)) continue;
    if (project.runsByDefault === null) return null;
    running.push(project);
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
 * What the config a file uses gives it: Playwright's `forbidOnly`, Vitest's per-project `allowOnly`, and for each test,
 * the projects that run it and what they set; null without a config.
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
    const forbidOnly = onlyRule(framework, null);
    return framework === 'vitest' ? { forbidOnly, forTest: () => NO_CONFIG, tags, configTags: [] } : null;
  }
  return {
    forbidOnly: projectOnlyRule(framework, config.settings, projects),
    forTest(test, suites) {
      if (projects === null) return { projects: null, defaults: UNKNOWN_DEFAULTS };
      const running = projectsRunning(projects, test, suites, file, placement.tags);
      // A grep the scan can't match leaves the projects that run the file, which may still agree.
      return {
        projects: running?.map(({ name }) => name) ?? null,
        defaults: configDefaults(running ?? projects),
        forbidOnly: projectOnlyRule(framework, config.settings, running ?? projects),
      };
    },
    tags: agreedTags(projects),
    configTags: placement.tags ?? [],
  };
}

function projectOnlyRule(
  framework: Framework,
  settings: Setting,
  projects: ProjectAbout[] | null,
): FileConfig['forbidOnly'] {
  if (framework !== 'vitest' || projects === null || projects.length === 0) return onlyRule(framework, settings);
  const rules = projects.map((project) => onlyRule(framework, project.settings));
  const first = rules[0];
  if (rules.every((rule) => JSON.stringify(rule) === JSON.stringify(first))) return first;
  return {
    message: 'The projects disagree on allowOnly; this .only fails in the projects that disable it.',
    isSure: false,
  };
}

/**
 * Why a `.only` fails: with Playwright's `forbidOnly` or Mocha's `forbid-only`, the run, before any test; with Vitest's
 * `allowOnly` off, the test itself, which Vitest marks failed instead of running it (checked in 3.2.4, 4.1.12 and
 * 5.1.0). `allowOnly` is off by default when `process.env.CI` is set. Null when nothing fails.
 */
function onlyRule(framework: Framework, settings: Setting | null): FileConfig['forbidOnly'] {
  if (framework === 'playwright' || framework === 'mocha') {
    // Mocha takes its options in kebab case or camel case.
    const [name, keys] =
      framework === 'mocha' ? ['forbid-only', ['forbid-only', 'forbidOnly']] : ['forbidOnly', ['forbidOnly']];
    const forbid = settings && keys.map((key) => settingAt(settings, [key])).find((setting) => setting !== null);
    const condition = forbid?.kind === 'unknown' ? unknownText(forbid) : null;
    if (condition) {
      const message = `The config sets ${name} when ${condition}, so then this .only fails the run before any test runs.`;
      return { message, isSure: false };
    }
    if (forbid?.kind !== 'value' || forbid.value !== true) return null;
    return { message: `The config sets ${name}, so this .only fails the run before any test runs.`, isSure: true };
  }
  if (framework !== 'vitest') return null;
  const allow = settings && settingAt(settings, ['test', 'allowOnly']);
  const effect = 'Vitest fails this .only test instead of running it';
  if (allow === null || isUnset(allow)) {
    return {
      message: `Vitest's allowOnly is off when process.env.CI is set, as in CI, and then ${effect}.`,
      isSure: false,
    };
  }
  const condition = allow.kind === 'unknown' ? unknownText(allow) : null;
  if (condition) {
    return { message: `The config sets allowOnly to ${condition}; when that is false, ${effect}.`, isSure: false };
  }
  // An object or a list is true, as is any value but `false` and the other falsy ones.
  if (allow.kind !== 'value' || allow.value) return null;
  return { message: `The config sets allowOnly to ${String(allow.value)}, so ${effect}.`, isSure: true };
}

/** The tags the projects that run a file define, when they all define the same; null otherwise. */
function agreedTags(projects: ProjectAbout[] | null): VitestTags | null {
  const [first, ...others] = (projects ?? []).map(({ defaults }) => defaults.tags);
  const text = JSON.stringify(first ?? null);
  return first && others.every((tags) => JSON.stringify(tags) === text) ? first : null;
}

/**
 * Jest's `rootDir`: the config's folder, or the folder the config sets, from its folder, where an inline project's
 * `<rootDir>` is the config's folder too; unknown when it can't tell.
 */
function jestRootDir(settings: Setting, folder: string): string | Unknown {
  const setting = settingAt(settings, ['rootDir']);
  if (setting === null || isUnset(setting)) return folder;
  return setting.kind === 'value' && typeof setting.value === 'string'
    ? path.resolve(folder, replaceRootDir(folder, setting.value))
    : unknownAt(setting);
}

/** Jest's `replaceRootDirInPath`: `<rootDir>` at the start of a path stands for the project's `rootDir`. */
function replaceRootDir(rootDir: string, item: string): string {
  return item.startsWith('<rootDir>') ? path.join(rootDir, item.slice('<rootDir>'.length)) : item;
}

/**
 * Jest's `globsToMatcher`: a path matches a glob that isn't negated and no negated glob leaves it out, or, when every
 * glob is negated, none leaves it out. Globs match the absolute path, dot files too.
 */
function jestGlobs(globs: string[]): (file: string) => boolean {
  const matchers = globs.map((glob) => {
    const isMatch = picomatch(glob, { dot: true }, true);
    return { isMatch, negated: isMatch.state.negated || Boolean(isMatch.state.negatedExtglob) };
  });
  return (file) => {
    let kept: boolean | undefined;
    for (const { isMatch, negated } of matchers) {
      const matched = isMatch(file);
      if (!matched && negated) kept = false;
      else if (matched && !negated) kept = true;
    }
    return matchers.every(({ negated }) => negated) ? kept !== false : kept === true;
  };
}

/** Whether a Jest setting is given: `null` and `undefined` leave Jest's default, as a `testMatch: null` beside `testRegex`. */
function isJestSet(setting: Setting | null): setting is Setting {
  return setting !== null && !isUnset(setting) && !(setting.kind === 'value' && setting.value === null);
}

/** A Jest preset written as a path, which Jest reads from the project, rather than a package's name. */
function isLocalPreset(preset: string): boolean {
  return /^(\.{1,2}\/|\/|<rootDir>)/.test(preset);
}

function isFileAt(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

/**
 * The interface Mocha's `ui` gives a file's tests: BDD by default, or TDD. Another one, QUnit, exports or a package,
 * declares tests in a way the scan doesn't read, which is reported on the config, and the file is read as BDD.
 */
export function mochaInterface(placement: Placement, configs: Configs): MochaInterface {
  const { config } = placement;
  const ui = config ? settingAt(config.settings, ['ui']) : null;
  if (ui === null || isUnset(ui)) return 'bdd';
  if (ui.kind !== 'value') {
    configs.reportUnknown(unknownAt(ui), 'ui', "the scan reads the tests as Mocha's default, BDD");
    return 'bdd';
  }
  if (ui.value === 'bdd' || ui.value === 'tdd') return ui.value;
  const message = `The config's ui '${String(ui.value)}' is an interface the scan doesn't read, so it reads the tests as Mocha's default, BDD.`;
  configs.reportConfig(config as ConfigFile, message);
  return 'bdd';
}

/**
 * Whether an `exclude` entry names one of the config's `suites` rather than files: WebdriverIO leaves that suite out of
 * a `--suite` run, and takes it as no exclusion otherwise.
 */
function isSuiteName(settings: Setting, item: string): boolean {
  if (/[/\\*?]/.test(item) || /\.(js|ts|mjs|cjs|es6|feature)$/i.test(item)) return false;
  const suites = settingAt(settings, ['suites']);
  return suites?.kind === 'object' && suites.keys.has(item);
}

/** The interface WebdriverIO's `mochaOpts.ui` gives a file's tests, read as Mocha's `ui`. */
export function webdriverioInterface(placement: Placement, configs: Configs): MochaInterface | undefined {
  if (placement.config === null || webdriverioFramework(placement, null) === 'jasmine') return 'bdd';
  const options = settingAt(placement.config.settings, ['mochaOpts']);
  return mochaInterface(
    { ...placement, config: { ...placement.config, settings: options ?? emptySettings() } },
    configs,
  );
}

/**
 * The framework a WebdriverIO config runs the specs with: Mocha by default, or Jasmine. Cucumber runs feature files,
 * which the scan doesn't read; that and a value the scan can't work out are reported on the config when `configs` is
 * given, and the files are read as Mocha's.
 */
export function webdriverioFramework(placement: Placement, configs: Configs | null): WebdriverIOFramework {
  const { config } = placement;
  const framework = config ? settingAt(config.settings, ['framework']) : null;
  if (framework === null || isUnset(framework)) return 'mocha';
  if (framework.kind === 'value' && (framework.value === 'mocha' || framework.value === 'jasmine'))
    return framework.value;
  if (framework.kind !== 'value') {
    configs?.reportUnknown(
      unknownAt(framework),
      'framework',
      "the scan reads the tests as WebdriverIO's default, Mocha's",
    );
  } else {
    const message = `The config's framework '${String(framework.value)}' is one the scan doesn't read, so it reads the tests as WebdriverIO's default, Mocha's.`;
    configs?.reportConfig(config as ConfigFile, message);
  }
  return 'mocha';
}

/**
 * How the config a file runs with maps its imports, for its dependencies: Vite's `resolve.alias` and Vitest's
 * `test.alias`, from the project and from the config file, and Jest's `moduleNameMapper`, `modulePaths` and
 * `moduleDirectories` other than `node_modules`, with `<rootDir>` in them. Null for the other runners, without a
 * config, or when it maps nothing.
 */
export function importMap(placement: Placement, framework: Framework): ImportMap | null {
  const { config, settings } = placement;
  if (!config || !settings) return null;
  // The files of a project share its map, so the modules they import are read once.
  if (!importMaps.has(settings)) importMaps.set(settings, readImportMap(config, settings, placement, framework));
  return importMaps.get(settings) ?? null;
}

const importMaps = new WeakMap<Setting, ImportMap | null>();

function readImportMap(
  config: ConfigFile,
  settings: Setting,
  placement: Placement,
  framework: Framework,
): ImportMap | null {
  const map: ImportMap = { aliases: [], paths: [], directories: [], root: null };
  if (framework === 'vitest') {
    map.root = placement.projects?.[0]?.root ?? path.dirname(config.file);
    const sources = settings === config.settings ? [settings] : [settings, config.settings];
    for (const source of sources) {
      for (const key of [
        ['test', 'alias'],
        ['resolve', 'alias'],
      ]) {
        const parent = settingAt(source, key.slice(0, -1));
        if (parent?.kind === 'object') map.aliases.push(...viteAliases(parent.keys.get('alias') ?? null));
      }
    }
  } else if (framework === 'jest') {
    const rootDir = placement.projects?.[0]?.root ?? path.dirname(config.file);
    const mapper = settingAt(settings, ['moduleNameMapper']);
    for (const [pattern, target] of mapper?.kind === 'object' ? mapper.keys : []) {
      const replacements = (target.kind === 'list' ? strings(target) : stringOf(target)).map((item) =>
        replaceRootDir(rootDir, item),
      );
      const find = regExp(pattern, '');
      if (find) map.aliases.push({ find, replacements, replacesName: true });
    }
    if (mapper?.kind === 'unknown') map.aliases.push({ find: /./, replacements: [], replacesName: true });
    map.paths = strings(settingAt(settings, ['modulePaths'])).map((item) =>
      path.resolve(rootDir, replaceRootDir(rootDir, item)),
    );
    // A `<rootDir>` entry of moduleDirectories is a folder, as a modulePaths entry is, not a name to look for.
    for (const item of strings(settingAt(settings, ['moduleDirectories']))) {
      const directory = replaceRootDir(rootDir, item);
      if (path.isAbsolute(directory)) map.paths.push(directory);
      else if (directory !== 'node_modules') map.directories.push(directory);
    }
  }
  return map.aliases.length + map.paths.length + map.directories.length > 0 ? map : null;
}

/**
 * Vite's aliases: an object of names and their replacements, or a list of `{ find, replacement }`, where `find` is a
 * name or a regex. An unreadable replacement keeps its match, so its imports are marked unfollowed.
 */
function viteAliases(setting: Setting | null): ImportMap['aliases'] {
  if (setting?.kind === 'object') {
    const aliases: ImportMap['aliases'] = [...setting.keys].map(([find, target]) => ({
      find,
      replacements: stringOf(target),
      replacesName: false,
    }));
    if (setting.rest) aliases.push({ find: /./, replacements: [], replacesName: false });
    return aliases;
  }
  if (setting?.kind === 'unknown') return [{ find: /./, replacements: [], replacesName: false }];
  if (setting?.kind !== 'list') return [];
  return setting.items.flatMap((item) => {
    const find = settingAt(item, ['find']);
    if (find?.kind === 'unknown') return [{ find: /./, replacements: [], replacesName: false }];
    const replacements = stringOf(settingAt(item, ['replacement']));
    const name = find?.kind === 'value' && typeof find.value === 'string' ? find.value : null;
    const pattern = find?.kind === 'regex' ? regExp(find.source, find.flags) : null;
    const written = name ?? pattern;
    return written !== null ? [{ find: written, replacements, replacesName: false }] : [];
  });
}

/** A setting's string as a list of one; empty for anything else. */
function stringOf(setting: Setting | null): string[] {
  return setting?.kind === 'value' && typeof setting.value === 'string' ? [setting.value] : [];
}

/** Whether a Node.js version runs TypeScript files without a flag: from 22.18 on the 22 line, and from 23.6. */
function stripsTypes(version: [number, number] | null): boolean {
  if (version === null) return true;
  const [major, minor] = version;
  return major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
}

/**
 * The `node --test` commands of the `test` script and the scripts it runs, or else of the first script that runs one,
 * each as the files it gives; none when no script runs it or there is no package.json.
 */
export function nodeTestArguments(manifest: string, setups = false): string[][] {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return [];
  }
  const read = (script: string) => nodeTestCommands(script, setups);
  const fromTest = scriptsRunBy(scripts, 'test').flatMap(read);
  if (fromTest.length > 0) return fromTest;
  const others = Object.values(scripts).filter((script) => typeof script === 'string');
  return others.map(read).find((commands) => commands.length > 0) ?? [];
}
