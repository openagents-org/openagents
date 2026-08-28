// Friendly, memorable random names for newly created agents — e.g.
// "claude-brave-otter". Far easier to tell apart in lists and logs than a bare
// "claude-a1b2", while staying within the [a-zA-Z0-9_-] charset the daemon
// requires for an agent name.
//
// Names lead with the agent type so a list of agents says what each one IS
// before it says which one it is, and every entry point produces the same
// shape — the setup wizard used to hand out a fixed "my-<type>", which
// collides the moment someone adds a second agent of that type.

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

/**
 * A fresh random agent name.
 *
 * With a type: "claude-swift-lynx". Without: "swift-lynx-37" — the trailing
 * number stands in for the missing type prefix, so an unprefixed name keeps
 * the same collision odds it always had.
 *
 * The type is sanitized to the daemon's [a-zA-Z0-9_-] charset rather than
 * trusted: it comes from the registry, and one stray character would produce a
 * name the daemon rejects at create time.
 */
export function randomAgentName(agentType?: string): string {
  const prefix = (agentType || "").trim().replace(/[^a-zA-Z0-9_-]/g, "")
  if (!prefix) {
    const num = Math.floor(Math.random() * 90) + 10 // 10–99
    return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${num}`
  }
  return `${prefix}-${pick(ADJECTIVES)}-${pick(ANIMALS)}`
}
