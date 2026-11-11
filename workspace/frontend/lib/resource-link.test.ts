import { describe, it, expect } from 'vitest';
import { issueLinkId, requestedResource, resourcePath } from './resource-link';
describe('resource links', () => {
  it.each(['files', 'knowledge', 'issues'] as const)('round trips %s IDs without query arguments', view => {
    const path = resourcePath('workspace', view, 'id:one/two');
    expect(path).not.toContain('?');
    expect(requestedResource(`https://example.test${path}`)).toEqual({ view, id:'id:one/two' });
    expect(requestedResource(`https://desktop.test/#${path}`)).toEqual({ view, id:'id:one/two' });
    expect(requestedResource(resourcePath('workspace',view))).toEqual({view,id:null});
  });
  it('links issues by number, falling back to the id', () => {
    expect(issueLinkId({ id: 'a32aca5e-adeb', number: 42 })).toBe('42');
    expect(issueLinkId({ id: 'a32aca5e-adeb', number: null })).toBe('a32aca5e-adeb');
    expect(requestedResource(resourcePath('w', 'issues', '42'))).toEqual({ view: 'issues', id: '42' });
  });
  it('accepts legacy links and ignores malformed routes', () => {
    expect(requestedResource('/w?issue=one')).toEqual({view:'issues',id:'one'});
    expect(requestedResource('/w/files/%GG')).toBeNull();
    expect(requestedResource('/w/files/a/extra')).toBeNull();
    expect(requestedResource('/w/threads/a')).toBeNull();
  });
});
