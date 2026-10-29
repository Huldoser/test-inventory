import path from 'node:path';
import type { ConfigRuns, Placement, ProjectAbout } from './config-runs.ts';
import { settingAt, type ConfigFile, type Setting } from './config.ts';
import type { ModuleReader, ModuleSource, Span } from './model.ts';
import { SourceText } from './source.ts';
import type { Framework } from './types.ts';

/**
 * Something in a config the scan can't follow: where it is written, or the config and the path it names, which the
 * warning points at.
 */
export type ConfigGap = {
  message: string;
  /** Not reported, as the config reader reports it already: the tests are only marked. */
  isQuiet: boolean;
} & ({ relativeFilePath: string; source: SourceText; span: Span } | { module: ModuleSource; text: string | null });

/** What the config a file uses runs with each of its tests: modules to take whole, and what can't be followed. */
export interface RunsWith {
  /** The config the file uses, which builds on others through imports. */
  config: ModuleSource | null;
  /** Its setup files, the configs that list its project, and the files of setup projects. */
  modules: ModuleSource[];
  gaps: ConfigGap[];
}

const NOTHING: RunsWith = { config: null, modules: [], gaps: [] };

/** The keys of a config that name setup files, by framework; Vitest's are a project's own. */
const SETUP_KEYS: Record<Framework, string[][]> = {
  playwright: [['globalSetup'], ['globalTeardown']],
  vitest: [
    ['test', 'setupFiles'],
    ['test', 'globalSetup'],
  ],
};

const UNKNOWN_PROJECTS =
  "The projects that run the file can't be worked out, so dependencyHash doesn't cover their setup.";

/**
 * Finds what each file's config makes its tests run besides the file: the config itself, which brings in the configs it
 * builds on through imports, the setup files and global setup and teardown of each project that runs the file, the
 * config that lists a Vitest project, whose global setup runs too, and for Playwright the files of the setup projects
 * the file's projects depend on. Read once per config and set of projects.
 */
export class ConfigDependencies {
  private readonly framework: Framework;
  private readonly runs: ConfigRuns;
  private readonly readerFor: (fromFile: string) => ModuleReader;
  /** The files setup projects may run. */
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
    const key = `${config.file}\0${placement.projects === null}\0${names.join('\0')}`;
    let found = this.found.get(key);
    if (!found) {
      found = this.read(config, placement);
      this.found.set(key, found);
    }
    return found;
  }

  private read(config: ConfigFile, placement: Placement): RunsWith {
    const own = this.module(config.file);
    if (!own) {
      // The config reader reports a config it can't read.
      const message = "The config can't be read, so dependencyHash doesn't cover it.";
      const span = { start: 0, end: 0 };
      const gap = { relativeFilePath: config.record.relativeFilePath, source: new SourceText(''), span, message };
      return { config: null, modules: [], gaps: [{ ...gap, isQuiet: true }] };
    }
    const modules = new Set<ModuleSource>();
    const gaps: ConfigGap[] = [];
    const places = new Set<Span>();
    /** The setup files a key of `settings` names, found from `root`, as written in the config `module`. */
    const setup = (module: ModuleSource, settings: Setting, root: string, keys: string[]) => {
      const key = keys.join('.');
      const found = written(settings, keys);
      for (const item of found ? listOf(found.setting) : []) {
        if (item.kind === 'value' && typeof item.value === 'string') {
          const read = this.setupFile(root, item.value);
          if (read && !('reason' in read)) modules.add(read);
          else if (read) {
            const message = `${key} names '${item.value}', which ${read.reason}, so dependencyHash doesn't cover it.`;
            gaps.push({ module, text: item.value, message, isQuiet: false });
          }
        } else if (item.kind === 'unknown') {
          const message = `${key} can't be worked out, so dependencyHash doesn't cover the files it names.`;
          // A Vitest 3 workspace file, which the scan doesn't read, has no place in the config.
          if (!item.where) gaps.push({ module, text: null, message, isQuiet: true });
          // One gap per place, as both setup keys may come from the same spread.
          else if (!places.has(item.where.node)) {
            places.add(item.where.node);
            const { frame, node } = item.where;
            const at = { relativeFilePath: frame.relativeFilePath, source: frame.parsed.source, span: node };
            gaps.push({ ...at, message, isQuiet: (found as Written).isInherited });
          }
        }
      }
    };
    const { projects } = placement;
    if (projects === null) gaps.push({ module: own, text: null, message: UNKNOWN_PROJECTS, isQuiet: true });
    const folder = path.dirname(config.file);
    if (this.framework === 'playwright') {
      for (const keys of SETUP_KEYS.playwright) setup(own, config.settings, folder, keys);
      this.setupProjects(config, own, projects ?? [], modules, gaps);
    } else {
      // A file no project runs still runs with the config's own setup when the runner is given it.
      const running = projects?.length
        ? projects
        : [{ settings: placement.settings as Setting, root: folder, container: null }];
      // Vitest runs the global setup of the config it starts with for every project, extending it or not.
      setup(own, config.settings, folder, ['test', 'globalSetup']);
      for (const project of running) {
        for (const keys of SETUP_KEYS.vitest) setup(own, project.settings, project.root, keys);
        const { container } = project;
        const outer = container && this.module(container.file);
        if (container && outer) {
          modules.add(outer);
          setup(outer, container.settings, path.dirname(container.file), ['test', 'globalSetup']);
        }
      }
    }
    return { config: own, modules: [...modules], gaps };
  }

  /** The files of the setup projects the file's projects depend on, and the ones those depend on. */
  private setupProjects(
    config: ConfigFile,
    own: ModuleSource,
    projects: readonly ProjectAbout[],
    modules: Set<ModuleSource>,
    gaps: ConfigGap[],
  ): void {
    const names = new Set<string>();
    const pending = projects.flatMap((project) => project.dependencies);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (names.has(name)) continue;
      names.add(name);
      const project = this.runs.projectNamed(config, name);
      if (!project) {
        // The config reader reports a project it can't work out.
        const message = `The files of the setup project '${name}' can't be worked out, so dependencyHash doesn't cover them.`;
        gaps.push({ module: own, text: null, message, isQuiet: true });
        continue;
      }
      pending.push(...project.about.dependencies);
      const files = this.candidates.filter((file) => project.runs(file)).map((file) => this.module(file));
      for (const file of files.filter((item) => item !== null)) modules.add(file);
    }
  }

  /**
   * A setup file a config names, found from `root` as the runners find it; null for a name that isn't a file there,
   * which is a package, whose code is left out as installed code is.
   */
  private setupFile(root: string, file: string): ReturnType<ModuleReader> | null {
    // `path.join(__dirname, 'setup.ts')` gives an absolute path.
    const relative = path.isAbsolute(file) ? path.relative(root, file).replaceAll('\\', '/') : file;
    const isPath = /^\.\.?[\\/]/.test(relative);
    const read = this.readerFor(path.join(root, 'config'))(isPath ? relative : `./${relative}`);
    return 'reason' in read && !isPath ? null : read;
  }

  /** A file the scan reads code from, by its absolute path, as the modules a test imports are read. */
  private module(file: string): ModuleSource | null {
    const read = this.readerFor(file)(`./${path.basename(file)}`);
    return 'reason' in read ? null : read;
  }
}

interface Written {
  setting: Setting;
  isInherited: boolean;
}

/**
 * The setting under a path of keys, and whether it comes from an object around it that the scan can't work out
 * rather than from the key itself; null when the config doesn't set it.
 */
function written(setting: Setting, keys: readonly string[]): Written | null {
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
