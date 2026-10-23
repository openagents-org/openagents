// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { hasTruncatedLabel } from './utils';

function row(scrollWidth: number, clientWidth: number): HTMLElement {
  const root = document.createElement('button');
  const label = document.createElement('span');
  label.setAttribute('data-truncatable', '');
  Object.defineProperty(label, 'scrollWidth', { value: scrollWidth });
  Object.defineProperty(label, 'clientWidth', { value: clientWidth });
  root.appendChild(label);
  return root;
}

describe('hasTruncatedLabel', () => {
  it('is true only when the label is wider than the room it has', () => {
    expect(hasTruncatedLabel(row(180, 120))).toBe(true);
    expect(hasTruncatedLabel(row(120, 120))).toBe(false);
  });

  it('is false without a marked label or a root', () => {
    expect(hasTruncatedLabel(document.createElement('button'))).toBe(false);
    expect(hasTruncatedLabel(null)).toBe(false);
  });
});
