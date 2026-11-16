import { describe, expect, it } from 'vitest';
import { briefFromApi, buildRevisionPrompt, isHtmlAttachment } from './brief';

describe('briefFromApi', () => {
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
