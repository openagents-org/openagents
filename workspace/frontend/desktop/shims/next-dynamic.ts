import { lazy, type ComponentType } from 'react';

/**
 * `next/dynamic`, for the desktop build.
 *
 * Next's version exists mainly to keep a component out of the server render;
 * with no server, what remains is React.lazy. `ssr: false` is accepted and
 * ignored for the same reason. A `loading` component is honoured by wrapping —
 * callers that pass one still get it.
 */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  _options?: { ssr?: boolean; loading?: ComponentType },
): ComponentType<P> {
  return lazy(async () => {
    const loaded = await loader();
    return 'default' in loaded ? loaded : { default: loaded };
  }) as unknown as ComponentType<P>;
}
