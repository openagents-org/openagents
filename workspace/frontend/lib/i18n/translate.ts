/**
 * Framework-free lookup + interpolation. Lives apart from the React provider so
 * it can also be used from plain functions (helpers, API error mapping, tests).
 */

import type { Messages } from './messages/en-US';

/** A message with plural forms; `other` is mandatory, the rest are optional. */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type Leaf = string | PluralMessage;

/**
 * Every valid dot path through the catalogue — `t('chat.send')` autocompletes
 * and a typo fails to compile.
 */
export type MessageKey<T = Messages> = {
  [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${MessageKey<T[K]>}`;
}[keyof T & string];

export type TranslateParams = Record<string, string | number>;

function isPluralMessage(value: unknown): value is PluralMessage {
  return typeof value === 'object' && value !== null && typeof (value as PluralMessage).other === 'string';
}

/** Walks a dot path, returning the leaf or `undefined` if any hop is missing. */
function resolve(tree: unknown, key: string): Leaf | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string' || isPluralMessage(node)) return node;
  return undefined;
}

/** Replaces `{placeholder}` occurrences; unknown placeholders are left as-is. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function selectPluralForm(message: PluralMessage, localeTag: string, count: number): string {
  let category: Intl.LDMLPluralRule;
  try {
    category = new Intl.PluralRules(localeTag).select(count);
  } catch {
    category = count === 1 ? 'one' : 'other';
  }
  // `zero` isn't a CLDR category for English but is a common authoring
  // convenience, so honour an explicit count of 0 when the message defines it.
  if (count === 0 && message.zero !== undefined) return message.zero;
  return message[category] ?? message.other;
}

/**
 * Resolves `key` against `messages`, falling back to `fallbackMessages` (the
 * English catalogue) and finally to the key itself, so an untranslated string
 * degrades to English rather than to a blank cell.
 */
export function translate(
  messages: unknown,
  fallbackMessages: unknown,
  localeTag: string,
  key: string,
  params?: TranslateParams,
): string {
  const message = resolve(messages, key) ?? resolve(fallbackMessages, key);
  if (message === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] Missing message for key "${key}"`);
    }
    return key;
  }

  if (typeof message === 'string') return interpolate(message, params);

  const count = typeof params?.count === 'number' ? params.count : Number(params?.count ?? Number.NaN);
  const form = Number.isNaN(count)
    ? message.other
    : selectPluralForm(message, localeTag, count);
  return interpolate(form, params);
}
