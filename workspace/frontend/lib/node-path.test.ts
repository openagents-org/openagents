import { describe, expect, it } from 'vitest';
import { joinNodePath } from './node-path';

describe('joinNodePath', () => {
  it('preserves Windows separators and drive roots', () => {
    expect(joinNodePath('D:\\', 'work')).toBe('D:\\work');
    expect(joinNodePath('D:\\work', 'project')).toBe('D:\\work\\project');
  });

  it('preserves POSIX separators and roots', () => {
    expect(joinNodePath('/', 'home')).toBe('/home');
    expect(joinNodePath('/home', 'project')).toBe('/home/project');
  });
});
