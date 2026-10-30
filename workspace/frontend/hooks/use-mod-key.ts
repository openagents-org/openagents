'use client';

import { useEffect, useState } from 'react';

/**
 * The modifier a shortcut hint should name: ⌘ on Apple platforms, Ctrl
 * elsewhere. The handlers already accept either key; this is only the label.
 *
 * Starts as ⌘ and settles after mount, because the server render cannot know
 * the platform and a label that differed between the two would not hydrate.
 */
export function useModKey(): '⌘' | 'Ctrl' {
  const [mod, setMod] = useState<'⌘' | 'Ctrl'>('⌘');
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod('Ctrl');
  }, []);
  return mod;
}
