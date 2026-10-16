import { expect, it } from 'vitest';
import { nodeCommandErrorKey } from './node-command-error';

const body = (message: string) => JSON.stringify({ code: 403, message });

it('tells a taken agent name apart from a missing permission', () => {
  const taken = `API 403: ${body('This agent belongs to a different connection')}`;
  expect(nodeCommandErrorKey(taken, true)).toBe('connect.agentNameTaken');
  expect(nodeCommandErrorKey(taken)).toBe('connect.agentOnOtherConnection');
  expect(nodeCommandErrorKey(`API 403: ${body('Only the connection owner can manage its agents')}`)).toBe('connect.nodeCommandForbidden');
});
it('asks to sign in again on 401 and leaves other failures to their own message', () => {
  expect(nodeCommandErrorKey('API 401: {}')).toBe('connect.nodeCommandSignIn');
  expect(nodeCommandErrorKey('API 500: timeout after 4013ms')).toBeNull();
  expect(nodeCommandErrorKey('Network error')).toBeNull();
});
