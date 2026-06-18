import type { InteractionType } from './roundtable-engine';

export type QualityFailure =
  | 'mask_language'
  | 'too_generic'
  | 'weak_challenge'
  | 'missing_evidence_boundary'
  | 'missing_action';

export interface JudgeInput {
  content: string;
  interactionType: InteractionType;
  targetAgentIds: string[];
  evidenceRequest?: string;
}

export interface JudgeResult {
  pass: boolean;
  failures: QualityFailure[];
  scores: {
    personaFidelity: number;
    commercialSharpness: number;
    evidenceDiscipline: number;
    disagreementIntensity: number;
    actionability: number;
    antiMaskLanguage: number;
  };
}

function hasAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function score(condition: boolean): number {
  return condition ? 0.8 : 0.2;
}

export function judgeRoundtableOutput(input: JudgeInput): JudgeResult {
  const content = input.content.trim();
  const failures: QualityFailure[] = [];
  const hasMask = /我以|非本人观点|目标对象|作为(?:一个)?\s*AI|你的挑战成立|我接受你的挑战/.test(content);
  const hasEvidence = hasAny(content, ['证据', '未证实', '验证', '来源', '样本', '指标', '边界', '失败判据']);
  const hasAction = hasAny(content, ['下一步', '先拿', '一周', '试点', '停止', '扩大投入', '负责人', '时间窗口', '失败判据']);
  const hasChallenge = input.targetAgentIds.length > 0 || hasAny(content, ['不是', '别', '先别', '问题是', '断了', '挑战', '反对']);
  const hasCommercial = hasAny(content, ['客户', '成本', '商业', '采用', '医院', '渠道', '投入', '现金流', '资源', '规模']);
  const tooGeneric = content.length < 40 || !hasAny(content, ['证据', '客户', '成本', '采用', '资源', '指标', '风险', '验证']);

  if (hasMask) failures.push('mask_language');
  if (tooGeneric) failures.push('too_generic');
  if ((input.interactionType === 'challenge' || input.interactionType === 'evidence_request') && !hasChallenge) failures.push('weak_challenge');
  if (!hasEvidence) failures.push('missing_evidence_boundary');
  if (!hasAction) failures.push('missing_action');

  const scores = {
    personaFidelity: score(!hasMask && !tooGeneric),
    commercialSharpness: score(hasCommercial),
    evidenceDiscipline: score(hasEvidence || Boolean(input.evidenceRequest)),
    disagreementIntensity: score(hasChallenge),
    actionability: score(hasAction),
    antiMaskLanguage: hasMask ? 0 : 1,
  };

  return {
    pass: failures.length === 0,
    failures,
    scores,
  };
}
