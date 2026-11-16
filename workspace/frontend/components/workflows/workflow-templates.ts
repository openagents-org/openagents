import type { Workflow } from '@/lib/types';
import type { TranslateFn } from '@/lib/i18n';

export type TemplateStarter = { name: string; description: string; steps: Workflow['steps'] };

/** One-click starters. Agents are intentionally left unpicked — the builder
 * opens prefilled and the user chooses who does what, which doubles as a
 * guided tour of steps and gates. */
export function useTemplates(t: TranslateFn): { key: string; loop: boolean; tpl: TemplateStarter }[] {
  const agent = { kind: 'agent' as const, agent: null };
  return [
    {
      key: 'draftReview',
      loop: true,
      tpl: {
        name: t('workflows.tpl.draftReview.name'),
        description: t('workflows.tpl.draftReview.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.draftReview.s1Name'), instruction: t('workflows.tpl.draftReview.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.draftReview.s2Name'), instruction: t('workflows.tpl.draftReview.s2Inst'), assignee: { ...agent },
            gate: { condition: t('workflows.tpl.draftReview.gate'), target: 'step-1' } },
        ],
      },
    },
    {
      key: 'codeTestFix',
      loop: true,
      tpl: {
        name: t('workflows.tpl.codeTestFix.name'),
        description: t('workflows.tpl.codeTestFix.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.codeTestFix.s1Name'), instruction: t('workflows.tpl.codeTestFix.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.codeTestFix.s2Name'), instruction: t('workflows.tpl.codeTestFix.s2Inst'), assignee: { ...agent },
            gate: { condition: t('workflows.tpl.codeTestFix.gate'), target: 'step-1' } },
        ],
      },
    },
    {
      key: 'researchApprove',
      loop: false,
      tpl: {
        name: t('workflows.tpl.researchApprove.name'),
        description: t('workflows.tpl.researchApprove.desc'),
        steps: [
          { id: 'step-1', name: t('workflows.tpl.researchApprove.s1Name'), instruction: t('workflows.tpl.researchApprove.s1Inst'), assignee: { ...agent } },
          { id: 'step-2', name: t('workflows.tpl.researchApprove.s2Name'), instruction: t('workflows.tpl.researchApprove.s2Inst'), assignee: { ...agent } },
          { id: 'step-3', name: t('workflows.tpl.researchApprove.s3Name'), instruction: t('workflows.tpl.researchApprove.s3Inst'), assignee: { kind: 'human', human: null } },
        ],
      },
    },
  ];
}
