import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFramework, detectFrameworkVersion } from '../src/framework-version.ts';
import type { Framework } from '../src/types.ts';
import { project } from './project.ts';

describe('framework version evidence', () => {
  it.each([
    ['package-lock.json', JSON.stringify({ packages: { 'node_modules/mocha': { version: '12.0.3' } } })],
    ['package-lock.json', JSON.stringify({ dependencies: { mocha: { version: '12.0.3' } } })],
    ['pnpm-lock.yaml', 'packages:\n  mocha@12.0.3:\n    resolution: {}\n'],
    ['yarn.lock', 'unrelated@1.0.0:\n  version "1.0.0"\n"mocha@^12.0.0":\n  version "12.0.3"\n'],
    ['bun.lock', '{ "packages": { "mocha": ["mocha@12.0.3", "", {}] } }'],
  ])('identifies %s as the source of a locked runner version', (file, text) => {
    const root = project({ [file]: text });
    expect(detectFrameworkVersion(root, 'mocha', [])).toEqual({ version: '12.0.3', source: file, range: null });
  });

  it.each(['dependencies', 'devDependencies', 'peerDependencies'])(
    'reads exact and ranged prereleases in %s',
    (field) => {
      const root = project({
        'package.json': JSON.stringify({ [field]: { mocha: ' =v12.0.3-beta.12 ' } }),
      });
      expect(detectFrameworkVersion(root, 'mocha', [])).toEqual({
        version: '12.0.3-beta.12',
        source: 'package.json',
        range: null,
      });
      const ranged = project({ 'package.json': JSON.stringify({ [field]: { mocha: '12.0.3-beta.12 || 13.0.0' } }) });
      expect(detectFrameworkVersion(ranged, 'mocha', [])).toEqual({
        version: '12.0.3-beta.12',
        source: 'package.json',
        range: '12.0.3-beta.12 || 13.0.0',
      });
    },
  );

  it('chooses the shallowest declaring package that contains at least one scanned file', () => {
    const root = project({
      'deep/nested/package.json': '{"devDependencies":{"mocha":"10.8.2"}}',
      'packages/desk/package.json': '{"devDependencies":{"mocha":"12.0.3"}}',
      'packages/desk/src/orders.test.ts': '',
      'elsewhere/orders.test.ts': '',
    });
    expect(
      detectFrameworkVersion(root, 'mocha', ['packages/desk/src/orders.test.ts', 'elsewhere/orders.test.ts']),
    ).toEqual({
      version: '12.0.3',
      source: 'packages/desk/package.json',
      range: null,
    });
  });

  it.each(['.node-version', '.nvmrc'])('reports exact and major-only Node pins from %s', (file) => {
    expect(detectFrameworkVersion(project({ [file]: ' v24.14.12\n' }), 'node', [])).toEqual({
      version: '24.14.12',
      source: file,
      range: null,
    });
    expect(detectFrameworkVersion(project({ [file]: '24' }), 'node', [])).toEqual({
      version: '24.0.0',
      source: file,
      range: '24',
    });
  });

  it.each(['release-v24.14.12', 'v24.14.12-preview'])('ignores the invalid Node pin %s', (pin) => {
    const root = project({ '.nvmrc': pin, 'package.json': '{"volta":{"node":"26.2.12"}}' });
    expect(detectFrameworkVersion(root, 'node', [])).toEqual({
      version: '26.2.12',
      source: 'package.json',
      range: null,
    });
  });

  it.each(['release-24.14.12', '24.14.12-preview', 24])('ignores the invalid Volta pin %j', (node) => {
    const root = project({ 'package.json': JSON.stringify({ volta: { node }, engines: { node: '>=24.14.12' } }) });
    expect(detectFrameworkVersion(root, 'node', [])).toEqual({
      version: '24.14.12',
      source: 'package.json',
      range: '>=24.14.12',
    });
  });

  it.each(['24.14.12 || 24.14.11', '24.14.11 || 24.14.12', '24.14.12 || 24.13.99'])(
    'chooses the newest Node engine in %s',
    (node) => {
      const root = project({ 'package.json': JSON.stringify({ engines: { node } }) });
      expect(detectFrameworkVersion(root, 'node', [])).toEqual({
        version: '24.14.12',
        source: 'package.json',
        range: node,
      });
    },
  );

  it.each([
    [{ '.bun-version': ' v12.14.12\n' }, '12.14.12', '.bun-version', null],
    [{ 'package.json': '{"packageManager":"bun@12.14.12"}' }, '12.14.12', 'package.json', null],
    [{ 'package.json': '{"engines":{"bun":">=12.14.12"}}' }, '12.14.12', 'package.json', '>=12.14.12'],
    [
      { 'node_modules/bun-types/package.json': '{"version":"12.14.12"}' },
      '12.14.12',
      'node_modules/bun-types/package.json',
      null,
    ],
  ] as const)('records the source of a Bun version from %j', (files, version, source, range) => {
    expect(detectFrameworkVersion(project(files), 'bun', [])).toEqual({ version, source, range });
  });

  it.each(['release-v1.3.14', 'v1.3.14-preview'])('ignores the invalid Bun pin %s', (pin) => {
    const root = project({ '.bun-version': pin, 'package.json': '{"engines":{"bun":">=1.3.14"}}' });
    expect(detectFrameworkVersion(root, 'bun', [])).toEqual({
      version: '1.3.14',
      source: 'package.json',
      range: '>=1.3.14',
    });
  });

  it('reports a runtime pin above a nested package by its relative path', () => {
    const root = project({ '.nvmrc': '24.14.12', 'packages/orders/package.json': '{}' });
    expect(detectFrameworkVersion(path.join(root, 'packages/orders'), 'node', [])).toEqual({
      version: '24.14.12',
      source: '../../.nvmrc',
      range: null,
    });
  });
});

describe('framework config discovery', () => {
  const configs: [Framework, string, string][] = [
    ['playwright', 'playwright.config.mts', 'export default {}'],
    ['vitest', 'vitest.config.ts', 'export default {}'],
    ['jest', 'jest.config.json', '{}'],
    ['mocha', '.mocharc.jsonc', '{}'],
    ['jasmine', 'spec/support/jasmine.js', 'module.exports = {}'],
    ['cypress', 'cypress.config.cts', 'export default {}'],
    ['webdriverio', 'wdio.conf.mjs', 'export const config = {}'],
    ['node', 'node.config.json', '{}'],
    ['bun', 'bunfig.toml', '[test]\n'],
  ];

  it.each(configs)('recognizes %s from %s', (framework, file, text) => {
    expect(detectFramework(project({ [file]: text }), [])).toBe(framework);
  });

  it.each(configs)('does not mistake backup files for a %s config', (_, file, text) => {
    const root = project({ [file + '.backup']: text });
    expect(() => detectFramework(root, [])).toThrow('options.framework is needed');
  });
});
