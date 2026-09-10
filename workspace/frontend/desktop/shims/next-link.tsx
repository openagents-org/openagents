import React from 'react';

import { useRouter } from '../router';

/**
 * `next/link`, for the desktop build.
 *
 * An anchor that routes instead of navigating: a real navigation would leave
 * the app's own page for a file: URL that does not exist. Modified clicks and
 * anything not left-button are left to the browser, so "open in new window"
 * and the like behave as the platform expects.
 */
export default function Link({
  href,
  children,
  onClick,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): React.JSX.Element {
  const router = useRouter();
  return (
    <a
      href={`#${href.startsWith('/') ? href : `/${href}`}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.push(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
