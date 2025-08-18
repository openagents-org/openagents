/// <reference types="react-scripts" />

declare module 'react' {
  export = React;
  export function useState<T>(initialState: T | (() => T)): [T, (newState: T | ((prevState: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<any>): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: ReadonlyArray<any>): T;
  export function useRef<T>(initialValue: T | null): { current: T | null };
}

declare module 'react/jsx-runtime' {
  export default {} as any;
  export const jsx: any;
  export const jsxs: any;
}

declare namespace React {
  interface FC<P = {}> {
    (props: P): React.ReactElement | null;
  }
  type ReactElement = any;
  type ChangeEvent<T = Element> = {
    target: T;
    preventDefault(): void;
  }
  type KeyboardEvent<T = Element> = {
    key: string;
    shiftKey: boolean;
    preventDefault(): void;
  }
  type ReactNode = ReactElement | string | number | boolean | null | undefined | ReactNodeArray;
  interface ReactNodeArray extends Array<ReactNode> {}
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'uuid' {
  export function v4(): string;
} 