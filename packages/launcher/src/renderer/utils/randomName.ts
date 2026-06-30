// Friendly, memorable random names for newly created agents — e.g.
// "brave-otter-42". Far easier to tell apart in lists and logs than a bare
// "claude-a1b2", while staying within the [a-zA-Z0-9_-] charset the daemon
// requires for an agent name.

const ADJECTIVES = [
  "brave",
  "calm",
  "clever",
  "swift",
  "bright",
  "bold",
  "gentle",
  "keen",
  "lively",
  "lucky",
  "merry",
  "nimble",
  "quiet",
  "shiny",
  "sturdy",
  "witty",
  "cosmic",
  "amber",
  "azure",
  "crimson",
  "golden",
  "silver",
  "jade",
  "violet",
]

const ANIMALS = [
  "otter",
  "falcon",
  "panda",
  "lynx",
  "heron",
  "koala",
  "tiger",
  "fox",
  "owl",
  "wolf",
  "raven",
  "moose",
  "badger",
  "ibis",
  "gecko",
  "marmot",
  "puffin",
  "narwhal",
  "dolphin",
  "sparrow",
  "beaver",
  "bison",
  "crane",
  "robin",
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** A fresh random agent name like "swift-lynx-37". */
export function randomAgentName(): string {
  const num = Math.floor(Math.random() * 90) + 10 // 10–99
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${num}`
}
