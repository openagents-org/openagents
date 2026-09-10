import React from 'react';

/**
 * `next/script`, for the desktop build — deliberately inert.
 *
 * Every call site is an analytics snippet loaded from a third party. The
 * desktop app must not reach out to those hosts on its own: it ships as a
 * signed binary, the pages are local files, and an outbound script tag would
 * be both a privacy surprise and a thing that fails offline.
 */
export default function Script(_props: {
  id?: string;
  src?: string;
  strategy?: string;
  children?: React.ReactNode;
  dangerouslySetInnerHTML?: { __html: string };
}): null {
  return null;
}
