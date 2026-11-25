/** The two pre-Vitest-5 scheduling options, which the runner merges independently. */
interface Options {
  concurrent?: boolean;
  sequential?: boolean;
}

export interface VitestConcurrency extends Options {
  chainConcurrent: boolean;
  chainSequential: boolean;
}

export type ConcurrencyRules = 'chain' | 'exclusive' | 'fallback' | 'explicit';

export function concurrencyRules(version: [number, number] | null, patch = 0): ConcurrencyRules | null {
  if (!version || version[0] >= 5) return null;
  const [major, minor] = version;
  if (major < 2) return 'chain';
  if (major === 2 && (minor === 0 || (minor === 1 && patch < 3))) return 'exclusive';
  if (major === 4 && (minor > 1 || (minor === 1 && patch >= 6))) return 'explicit';
  return 'fallback';
}

/** Compute a suite's two options after applying its modifiers and the options from its parent. */
export function suiteConcurrency(parent: Options, own: VitestConcurrency, rules: ConcurrencyRules): Options {
  const parallel = own.concurrent ?? parent.concurrent;
  const sequential = own.sequential ?? parent.sequential;
  const { chainConcurrent, chainSequential } = own;
  if (rules === 'chain')
    return {
      concurrent: chainConcurrent || (!chainSequential && parallel),
      sequential: chainSequential || (!chainConcurrent && sequential),
    };
  if (rules === 'exclusive') {
    const wantsParallel = parallel === true || (chainConcurrent && !chainSequential);
    const wantsSequential = sequential === true || (chainSequential && !chainConcurrent);
    return { concurrent: wantsParallel && !wantsSequential, sequential: wantsSequential && !wantsParallel };
  }
  // From 2.1.3 a suite's explicit request beats its inherited options. Contradictory requests clear both flags.
  const wantsParallel = chainConcurrent || own.concurrent === true || own.sequential === false;
  const wantsSequential = chainSequential || own.sequential === true || own.concurrent === false;
  const useParallel = wantsParallel || (parallel && !wantsSequential);
  const useSequential = wantsSequential || (sequential && !wantsParallel);
  return { concurrent: useParallel && !useSequential, sequential: useSequential && !useParallel };
}

/** Resolve the test after its project's default and the options of its tags are known. */
export function legacyVitestParallel(
  rules: ConcurrencyRules,
  suites: readonly (VitestConcurrency | undefined)[],
  test: VitestConcurrency | undefined,
  tag: boolean | undefined,
  configured: boolean | null | undefined,
): boolean {
  if (configured === null) {
    return [false, true, undefined].every((value) => legacyVitestParallel(rules, suites, test, tag, value));
  }
  let inherited: Options = {
    concurrent: configured,
    sequential: configured === false && rules !== 'exclusive' && rules !== 'chain' ? true : undefined,
  };
  for (const suite of suites) {
    if (suite) inherited = suiteConcurrency(inherited, suite, rules);
  }
  const concurrent = test?.concurrent ?? inherited.concurrent;
  const sequential = test?.sequential ?? inherited.sequential;
  const useParallel =
    test?.chainConcurrent === true || (test?.chainSequential && concurrent !== undefined ? false : concurrent);
  const useSequential = test?.chainSequential === true || (!test?.chainConcurrent && sequential);
  const effective = useParallel ?? tag;
  const fallback = !useSequential && configured === true;
  return rules === 'explicit' ? (effective ?? fallback) : effective === true || fallback;
}
