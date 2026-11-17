// Shiki highlighter for the code-block component (shadcn registry
// `use-highlighted-code`). Imports go through `shiki/dist/*` because this
// project's `moduleResolution: node10` cannot follow shiki's subpath exports.
import type * as React from "react"
import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
} from "shiki/dist/core.mjs"
import { createJavaScriptRegexEngine } from "shiki/dist/engine-javascript.mjs"

// Add the languages you need. Each one loads the first time it is used, so
// the list costs nothing until a message contains that language.
const languages = {
  bash: () => import("shiki/dist/langs/shellscript.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  diff: () => import("shiki/dist/langs/diff.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
  // Beyond the shadcn default list: what agents commonly write.
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  dart: () => import("shiki/dist/langs/dart.mjs"),
  dockerfile: () => import("shiki/dist/langs/dockerfile.mjs"),
  elixir: () => import("shiki/dist/langs/elixir.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  graphql: () => import("shiki/dist/langs/graphql.mjs"),
  haskell: () => import("shiki/dist/langs/haskell.mjs"),
  ini: () => import("shiki/dist/langs/ini.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  kotlin: () => import("shiki/dist/langs/kotlin.mjs"),
  less: () => import("shiki/dist/langs/less.mjs"),
  lua: () => import("shiki/dist/langs/lua.mjs"),
  make: () => import("shiki/dist/langs/make.mjs"),
  nginx: () => import("shiki/dist/langs/nginx.mjs"),
  "objective-c": () => import("shiki/dist/langs/objective-c.mjs"),
  perl: () => import("shiki/dist/langs/perl.mjs"),
  php: () => import("shiki/dist/langs/php.mjs"),
  powershell: () => import("shiki/dist/langs/powershell.mjs"),
  proto: () => import("shiki/dist/langs/proto.mjs"),
  r: () => import("shiki/dist/langs/r.mjs"),
  ruby: () => import("shiki/dist/langs/ruby.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  scala: () => import("shiki/dist/langs/scala.mjs"),
  scss: () => import("shiki/dist/langs/scss.mjs"),
  svelte: () => import("shiki/dist/langs/svelte.mjs"),
  swift: () => import("shiki/dist/langs/swift.mjs"),
  toml: () => import("shiki/dist/langs/toml.mjs"),
  vue: () => import("shiki/dist/langs/vue.mjs"),
  xml: () => import("shiki/dist/langs/xml.mjs"),
}

const aliases: Record<string, keyof typeof languages> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
  "c#": "csharp",
  "c++": "cpp",
  cs: "csharp",
  docker: "dockerfile",
  golang: "go",
  h: "c",
  hpp: "cpp",
  kt: "kotlin",
  makefile: "make",
  objc: "objective-c",
  ps1: "powershell",
  rb: "ruby",
  rs: "rust",
  svg: "xml",
}

let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/dist/themes/github-light.mjs"),
      import("shiki/dist/themes/github-dark.mjs"),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })

  return highlighter
}

function getLanguage(language: string) {
  const name = language.toLowerCase()

  if (name === "ansi") {
    return name
  }

  if (name in languages) {
    return name as keyof typeof languages
  }

  return aliases[name] ?? null
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language)

  if (!lang) {
    return null
  }

  const shiki = await getHighlighter()

  if (lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang])
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          grammarState: state,
        }).tokens

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens =
        lang === "ansi"
          ? code.split("\n").flatMap((line) => tokenize(line))
          : tokenize(code)

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span
              key={index}
              style={token.htmlStyle as React.CSSProperties}
              className="text-(--shiki-light) dark:text-(--shiki-dark)"
            >
              {token.content}
            </span>
          ))
        ),
        state: shiki.getLastGrammarState(tokens),
      }
    },
  }
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const highlighter = await loadHighlighter(language)

  return highlighter ? highlighter.highlight(code).lines : null
}
