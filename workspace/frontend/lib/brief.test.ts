import { describe, expect, it } from 'vitest';
import {
  briefFromApi,
  briefIsEmpty,
  briefPatchToApi,
  buildRevisionPrompt,
  diffBrief,
  isHtmlAttachment,
  ownerLabel,
  parseOpenQuestions,
} from './brief';

describe('briefIsEmpty', () => {
  it('treats a missing or blank brief as empty', () => {
    expect(briefIsEmpty(null)).toBe(true);
    expect(briefIsEmpty(briefFromApi({}, 'ch'))).toBe(true);
    expect(briefIsEmpty(briefFromApi({ open_questions: [] }, 'ch'))).toBe(true);
  });

  it('is non-empty as soon as any field is set', () => {
    expect(briefIsEmpty(briefFromApi({ objective: 'Ship it' }, 'ch'))).toBe(false);
    expect(briefIsEmpty(briefFromApi({ open_questions: ['Which region?'] }, 'ch'))).toBe(false);
    expect(briefIsEmpty(briefFromApi({ owner: 'openagents:deploy-bot' }, 'ch'))).toBe(false);
  });
});

describe('briefFromApi / briefPatchToApi', () => {
  it('maps snake_case rows and drops blank questions', () => {
    const b = briefFromApi({
      channel: 'launch', objective: 'Ship', latest_result: 'staged', next_step: 'load test',
      open_questions: ['a', '', 3, ' b '], updated_by: 'openagents:x', updated_at: '2026-09-30T00:00:00Z',
      director_email: 'Mia@Acme.test', can_edit: true,
    }, 'fallback');
    expect(b.channel).toBe('launch');
    expect(b.latestResult).toBe('staged');
    expect(b.nextStep).toBe('load test');
    expect(b.openQuestions).toEqual(['a', ' b ']);
    expect(b.directorEmail).toBe('mia@acme.test');
    expect(b.canEdit).toBe(true);
    expect(briefFromApi(null, 'ch').channel).toBe('ch');
    expect(briefFromApi({ can_edit: 'yes' }, 'ch').canEdit).toBe(false);
  });

  it('only serialises the keys present in the patch', () => {
    expect(briefPatchToApi({ latestResult: 'done' })).toEqual({ latest_result: 'done' });
    expect(briefPatchToApi({ nextStep: null, openQuestions: ['q'] })).toEqual({ next_step: null, open_questions: ['q'] });
    expect(briefPatchToApi({})).toEqual({});
  });
});

describe('diffBrief', () => {
  const current = briefFromApi({ objective: 'Ship', open_questions: ['Which region?'] }, 'ch');
  const draft = { objective: 'Ship', owner: '', latestResult: '', nextStep: '', openQuestions: 'Which region?' };

  it('is empty when nothing changed (whitespace-insensitive)', () => {
    expect(diffBrief(current, { ...draft, objective: '  Ship ' })).toEqual({});
  });

  it('reports only the changed fields and clears with null', () => {
    expect(diffBrief(current, { ...draft, objective: '', nextStep: 'Load test' })).toEqual({ objective: null, nextStep: 'Load test' });
    expect(diffBrief(current, { ...draft, openQuestions: '- Which region?\n- Who signs off?\n\n' }))
      .toEqual({ openQuestions: ['Which region?', 'Who signs off?'] });
  });

  it('parses one question per line, stripping bullets', () => {
    expect(parseOpenQuestions(' • a\n* b \n\n- c')).toEqual(['a', 'b', 'c']);
  });
});

describe('ownerLabel', () => {
  it('reads agent and human addresses', () => {
    expect(ownerLabel('openagents:deploy-bot', { 'deploy-bot': 'Deploy Bot' })).toBe('Deploy Bot');
    expect(ownerLabel('openagents:deploy-bot')).toBe('deploy-bot');
    expect(ownerLabel('human:mia@acme.test')).toBe('mia@acme.test');
    expect(ownerLabel(null)).toBe('');
  });
});

describe('HTML artifacts', () => {
  it('recognises HTML by content type or extension', () => {
    expect(isHtmlAttachment('text/html; charset=utf-8', 'x.bin')).toBe(true);
    expect(isHtmlAttachment('application/octet-stream', 'report.HTML')).toBe(true);
    expect(isHtmlAttachment('application/octet-stream', 'page.xhtml')).toBe(true);
    expect(isHtmlAttachment('text/markdown', 'notes.md')).toBe(false);
    expect(isHtmlAttachment('', 'index.htm')).toBe(true);
  });

  it('builds the revision prompt with a mention only for agent-posted files', () => {
    expect(buildRevisionPrompt('deploy-bot', 'report.html')).toBe('@deploy-bot Please revise report.html: ');
    expect(buildRevisionPrompt(null, 'report.html')).toBe('Please revise report.html: ');
    expect(buildRevisionPrompt('', '')).toBe('Please revise the file: ');
  });
});
