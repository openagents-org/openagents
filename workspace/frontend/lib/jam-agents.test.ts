import { describe, expect, it } from 'vitest';
import { agentNameProblem, connectParagraph, GUEST_CAPABLE_TYPES, JAM_AGENT_TYPES } from './jam-agents';

describe('jam agents', () => {
  it('checks names: letters, digits, - and _, no spaces, up to 48, starting with a letter or digit', () => {
    expect(agentNameProblem('my-reviewer_2')).toBeNull();
    expect(agentNameProblem('')).toBe('empty');
    expect(agentNameProblem('my reviewer')).toBe('spaces');
    expect(agentNameProblem('rev!ew')).toBe('chars');
    expect(agentNameProblem('-reviewer')).toBe('start');
    expect(agentNameProblem('a'.repeat(49))).toBe('long');
    expect(agentNameProblem('a'.repeat(48))).toBeNull();
  });

  it('knows the runtimes and that only Claude Code takes others’ requests', () => {
    expect(JAM_AGENT_TYPES[0]).toBe('claude');
    expect(JAM_AGENT_TYPES).toContain('goose');
    expect(GUEST_CAPABLE_TYPES).toEqual(['claude']);
  });

  it('builds one paragraph to paste into a coding agent', () => {
    expect(connectParagraph(['npx a', 'npx b', 'npx c'], 'Connect an OpenAgents agent: run these commands in a terminal:'))
      .toBe('Connect an OpenAgents agent: run these commands in a terminal:\n\nnpx a\nnpx b\nnpx c');
  });
});
