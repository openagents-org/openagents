/**
 * A SelectTrigger given its own height has to keep it. The shadcn component
 * ships the default height as `data-[size=default]:h-8`, whose attribute
 * selector outranks a caller's `h-10`, so the model/key select kept sitting
 * 8px short of the "Add key" button beside it. That was fixed once and came
 * back when the component was regenerated; this test keeps it fixed.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Select, SelectTrigger, SelectValue } from './select';

function triggerClasses(props: { className?: string; size?: 'sm' | 'default' }) {
  const html = renderToString(createElement(Select, null, createElement(SelectTrigger, props, createElement(SelectValue))));
  const match = html.match(/data-slot="select-trigger"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="select-trigger"/);
  expect(match).not.toBeNull();
  return (match![1] ?? match![2]).split(/\s+/);
}

describe('SelectTrigger height', () => {
  it('never sets a height behind a data-size selector', () => {
    for (const size of ['default', 'sm'] as const) {
      expect(triggerClasses({ size }).filter((c) => /^data-\[size=[^\]]+\]:(h|min-h|size)-/.test(c))).toEqual([]);
    }
  });

  it('defaults to h-8, or h-7 at size sm', () => {
    expect(triggerClasses({})).toContain('h-8');
    expect(triggerClasses({ size: 'sm' })).toContain('h-7');
  });

  it("lets a caller's height replace the default", () => {
    const classes = triggerClasses({ className: 'h-10 w-full' });
    expect(classes).toContain('h-10');
    expect(classes).not.toContain('h-8');
    expect(triggerClasses({ size: 'sm', className: 'h-9' })).not.toContain('h-7');
  });
});
