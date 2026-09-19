import { describe, expect, it } from 'vitest';
import {
  imageLink,
  imageTargetSegments,
  isAbsoluteDestination,
  resolveDestination,
} from '../../src/core/paths';

describe('isAbsoluteDestination', () => {
  it.each(['/x', 'C:\\x', 'c:/x', '\\\\server\\share', ' /x'])('rejects %j on every OS', (d) => {
    expect(isAbsoluteDestination(d)).toBe(true);
  });
  it.each(['assets', '../shared/img', '', 'my images', './a'])('accepts %j', (d) => {
    expect(isAbsoluteDestination(d)).toBe(false);
  });
});

describe('resolveDestination', () => {
  const doc = { baseName: 'intro', workspaceRelativeDir: ['docs', 'guide'] };

  it.each([
    ['assets', 'assets'],
    ['', ''],
    ['../shared', '../shared'],
    ['assets/./x/../y', 'assets/y'],
    ['${documentDirName}/assets', 'assets'],
    ['assets/${documentBaseName}', 'assets/intro'],
    ['${workspaceFolder}/assets', '../../assets'],
    ['${workspaceFolder}assets', '../../assets'],
    ['${workspaceFolder}', '../..'],
    ['${workspaceFolder}/docs/guide/img', 'img'],
    ['${workspaceFolder}/docs/assets/${documentBaseName}', '../assets/intro'],
    ['${workspaceFolder}\\static\\img', '../../static/img'],
    ['${workspaceFolder}/../outside', '../../../outside'],
  ])('resolves %j to %j, relative to the document', (template, path) => {
    expect(resolveDestination(template, doc)).toEqual({ ok: true, path });
  });

  it('resolves from a document at the workspace root', () => {
    expect(
      resolveDestination('${workspaceFolder}/assets', { baseName: 'x', workspaceRelativeDir: [] }),
    ).toEqual({ ok: true, path: 'assets' });
  });

  it.each([
    ['/abs', 'absolute'],
    ['C:\\x', 'absolute'],
    ['a/${workspaceFolder}', 'misplaced-variable'],
    ['x/${documentDirName}', 'misplaced-variable'],
    ['${fileName}/x', 'unknown-variable'],
  ])('rejects %j as %s', (template, reason) => {
    expect(resolveDestination(template, doc)).toEqual({ ok: false, reason });
  });

  it('rejects ${workspaceFolder} for a document outside every workspace folder', () => {
    expect(
      resolveDestination('${workspaceFolder}/assets', {
        baseName: 'x',
        workspaceRelativeDir: undefined,
      }),
    ).toEqual({ ok: false, reason: 'no-workspace' });
  });
});

describe('imageLink', () => {
  it('joins destination and file name with /', () => {
    expect(imageLink('assets', 'image-c414cd0e.png')).toBe('assets/image-c414cd0e.png');
  });
  it('uses / even for a Windows-style destination', () => {
    expect(imageLink('media\\img\\', 'a.png')).toBe('media/img/a.png');
  });
  it('gives a bare file name for an empty destination, never a root-absolute link', () => {
    expect(imageLink('', 'a.png')).toBe('a.png');
    expect(imageLink('./', 'a.png')).toBe('a.png');
  });
  it('percent-encodes spaces but keeps .. segments', () => {
    expect(imageLink('../my images', 'a.png')).toBe('../my%20images/a.png');
  });
});

describe('imageTargetSegments', () => {
  it('returns unencoded segments for building the target URI', () => {
    expect(imageTargetSegments('../my images/', 'a.png')).toEqual(['..', 'my images', 'a.png']);
    expect(imageTargetSegments('', 'a.png')).toEqual(['a.png']);
  });
});
