import { describe, expect, it } from 'vitest';
import { placeTourCard } from './workspace-tour';

const card = { width: 320, height: 160 };
const viewport = { width: 1280, height: 800 };

describe('placeTourCard', () => {
  it('puts the card beside a rail control, vertically centred on it', () => {
    const pos = placeTourCard({ top: 300, left: 8, width: 40, height: 40 }, card, viewport);
    expect(pos).toEqual({ top: 240, left: 60 });
  });

  it('keeps the card inside the window near its bottom edge', () => {
    const pos = placeTourCard({ top: 760, left: 8, width: 40, height: 32 }, card, viewport);
    expect(pos.top).toBe(800 - 160 - 16);
  });

  it('puts the card above a control wider than itself, like the message box', () => {
    const pos = placeTourCard({ top: 680, left: 400, width: 860, height: 100 }, card, viewport);
    expect(pos).toEqual({ top: 680 - 12 - 160, left: 400 + 430 - 160 });
  });

  it('falls back to the left when there is no room on the right', () => {
    const pos = placeTourCard({ top: 300, left: 1200, width: 40, height: 40 }, card, viewport);
    expect(pos.left).toBe(1200 - 12 - 320);
  });
});
