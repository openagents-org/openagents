import React from 'react';

/**
 * `next/image`, for the desktop build.
 *
 * Next's image component exists to serve resized, reformatted images from a
 * server. There is no server here and every asset ships inside the app, so
 * what is left of it is a plain `<img>` — the props that only describe the
 * optimiser (`priority`, `quality`, `loader`, …) are accepted and dropped so
 * call sites need no edit.
 */
export interface ImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> {
  src: string | { src: string };
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
  sizes?: string;
}

export default function Image({
  src,
  fill,
  priority: _priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  loader: _loader,
  style,
  ...props
}: ImageProps): React.JSX.Element {
  return (
    <img
      src={typeof src === 'string' ? src : src.src}
      // `fill` means "cover the positioned parent", which is a handful of CSS
      // properties rather than a feature of the optimiser.
      style={
        fill
          ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style }
          : style
      }
      {...props}
    />
  );
}
