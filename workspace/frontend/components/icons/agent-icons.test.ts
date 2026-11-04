import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ICON_NAMES } from './agent-icons';

// The list decides whether an avatar can show a type's icon, so it has to
// match the icon files: every one of them, and nothing else.
it('lists exactly the icons in public/icons/agents', () => {
  const dir = path.resolve(__dirname, '../../public/icons/agents');
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  expect([...ICON_NAMES].sort()).toEqual(files.sort());
});
