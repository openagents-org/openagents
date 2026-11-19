const names: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  cursor: 'Cursor',
  deepseek: 'DeepSeek',
  openclaw: 'OpenClaw',
  gemini: 'Gemini',
  codebuddy: 'WorkBuddy (CodeBuddy)',
  antigravity: 'Antigravity',
  pi: 'Pi',
  kimi: 'Kimi Code',
  copilot: 'GitHub Copilot',
  cline: 'Cline',
  aider: 'Aider',
  goose: 'Goose',
  amp: 'Amp',
  codearts: 'CodeArts',
  commandcode: 'Command Code',
  openworker: 'OpenWorker',
  nanoclaw: 'NanoClaw',
  'mini-swe-agent': 'mini-SWE-agent',
  'mimo-code': 'MiMo Code',
  qoder: 'Qoder',
  'qoder-cn': 'Qoder CN',
  'qwen-code': 'Qwen Code',
  kiro: 'Kiro',
};

const registeredAgents = Object.keys(names);
const featured = ['claude', 'codex', 'opencode', 'hermes', 'cursor', 'deepseek'];

// Product names and icons from registry/index.json, bundled with the standalone frontend.
export const onboardingAgents = [
  ...featured.filter(id => registeredAgents.includes(id)),
  ...registeredAgents.filter(id => !featured.includes(id)),
].map(id => ({ id, name: names[id] ?? id, icon: id }));
