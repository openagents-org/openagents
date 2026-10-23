import { expect, it } from 'vitest';
import { translate } from './translate';
it('resolves both nested and flat dotted catalog entries',()=>{
  const messages={'approvals.kinds.agentAccess':'Agent access',artifactPanel:{title:'Artifacts'}};
  expect(translate(messages,{},'en-US','approvals.kinds.agentAccess')).toBe('Agent access');
  expect(translate(messages,{},'en-US','artifactPanel.title')).toBe('Artifacts');
});
