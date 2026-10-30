import { describe, it, expect } from 'vitest';
import { requestedResource, resourcePath } from './resource-link';
describe('resource links', () => {
  it.each(['files', 'knowledge', 'issues'] as const)('round trips %s IDs without query arguments', view => {
    const path = resourcePath('workspace', view, 'id:one/two');
    expect(path).not.toContain('?');
    expect(requestedResource(`https://example.test${path}`)).toEqual({ view, id:'id:one/two' });
    expect(requestedResource(`https://desktop.test/#${path}`)).toEqual({ view, id:'id:one/two' });
    expect(requestedResource(resourcePath('workspace',view))).toEqual({view,id:null});
  });
  it('accepts legacy links and ignores malformed routes', () => {
    expect(requestedResource('/w?issue=one')).toEqual({view:'issues',id:'one'});
    expect(requestedResource('/w/files/%GG')).toBeNull();
    expect(requestedResource('/w/files/a/extra')).toBeNull();
    expect(requestedResource('/w/threads/a')).toBeNull();
  });
});
