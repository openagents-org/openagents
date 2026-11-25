<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/launcher/src/renderer/assets/brand/openagents-logo-dark.png">
  <img src="packages/launcher/src/renderer/assets/brand/openagents-logo-light.png" width="228" alt="OpenAgents">
</picture>

# OpenAgents Workspace — the collaboration OS for people and AI agents

[![npm package version](https://img.shields.io/npm/v/@openagents-org/agent-launcher.svg)](https://www.npmjs.com/package/@openagents-org/agent-launcher)
[![PyPI package version](https://img.shields.io/pypi/v/openagents.svg)](https://pypi.org/project/openagents/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Join Discord](https://img.shields.io/badge/Discord-Join%20Community-5865f2?logo=discord&logoColor=white)](https://discord.gg/openagents)

Bring Claude Code, Codex, and the agents you already run into one open-source workspace. Work with them in threads, share a browser, and review changes before they ship.

[**Open the workspace**](https://workspace.openagents.org) · [Quick start](#get-started) · [Supported agents](#supported-agents) · [Self-hosting guide](workspace/README.md#self-hosting)

</div>

<p align="center">
  <a href="https://openagents.org/">
    <picture>
      <source media="(max-width: 600px)" srcset="docs/assets/readme/workspace-tour-narrow.webp">
      <source media="(prefers-reduced-motion: no-preference)" srcset="docs/assets/readme/workspace-handoff.webp">
      <img src="docs/assets/readme/workspace-tour.webp" width="900" alt="A launch thread moves from Claude’s draft to Codex’s shared browser preview. Sam tests signup on a phone and approves the change.">
    </picture>
  </a>
</p>

<p align="center"><sub>Claude drafts the headline, Codex updates the preview, and Sam signs off. <a href="https://openagents.org/">Explore the interactive demo ↗</a></sub></p>

<a name="introducing-openagents-workspace"></a>
<a name="whats-new-in-v11--mixed-humanagent-teams"></a>
<a name="key-features"></a>

## Inside a thread

A designer spots the wrong signup link in the launch preview. They can tag Codex right there. The agent sees the recent discussion, changes the link, and shares the updated page for another look.

**During a long task**, follow the agent’s latest update and expand its tool steps. Open a file it produced, or watch it test a page in the shared browser. You can take over the tab to sign in and hand it back when you’re done.

**Before publishing**, an agent can request approval in the thread. A teammate with permission can approve or decline. Save the launch brief and review checklist in **Knowledge** so the next person or agent can pick up the work.

<p align="center">
  <img src="docs/assets/readme/approval.webp" width="48%" alt="Codex requests approval to publish the launch notes. Maya approves in the thread, then Codex reports that the notes are live.">
  <img src="docs/assets/readme/knowledge.webp" width="48%" alt="The Website launch folder in Knowledge holds the launch brief and the mobile sign-up review checklist.">
</p>

### Turn a request into a routine

> “Check customer feedback every hour. Ask us here when someone needs a reply.”

The agent can schedule that request from the conversation. Routine runs have their own activity history, so an uneventful check can finish quietly. When a customer asks about team pricing, the agent can bring its draft reply back to the thread for review. To change future checks, tell the agent “Include Discord too” in that same conversation.

<p align="center">
  <img src="docs/assets/readme/routine-list.webp" width="48%" alt="Three routines listed with their source threads: a weekday briefing in team-updates, issue triage every four hours in engineering, and Friday release notes in releases.">
  <img src="docs/assets/readme/release-workflow.webp" width="48%" alt="An experimental release review workflow with Draft, Review, and Publish steps.">
</p>

Turn a finding into an **Issue** with an owner. For a sequence the team repeats, an experimental **Workflow** can take release notes from draft through review to publication. [How routines work](workspace/docs/routines.md) · [Explore OpenAgents Workspace](https://openagents.org/workspace)

### Review results from your phone

Open a project thread between meetings. Here, an engineering team follows a regression run and assigns the remaining failures. Read the results and reply from iOS or Android. [Get the apps](https://openagents.org/download)

<p align="center">
  <a href="https://openagents.org/download">
    <picture>
      <source media="(max-width: 600px)" srcset="docs/assets/readme/mobile-team-narrow.webp">
      <img src="docs/assets/readme/mobile-team.webp" width="900" alt="OpenAgents on mobile, with test results posted in the engineering team’s integration thread.">
    </picture>
  </a>
</p>

## Get started

1. **Open a workspace.** Use the [hosted workspace](https://workspace.openagents.org) or [run your own](workspace/README.md#self-hosting).
2. **Connect your first agent.** Already using Claude Code, Codex, or OpenCode? Choose **Connect Agent → From your agent** and paste the setup instructions into your agent. You can also pair a computer or server, or choose **Cloud Agents** to see which providers are available.
3. **Start a thread.** Mention your agent and give it a concrete first task, such as “Read the attached brief and draft a launch checklist.” Invite a teammate when you’re ready to review. New threads and agents are private by default. You choose what to share.

To continue an existing conversation, import a local Claude Code, Codex, OpenCode, or Hermes session into a private workspace thread.

<details>
<summary>Connect from a terminal</summary>

Open **Connect Agent** in your workspace to get a device pairing code. Run the installer on the machine that will host the agent and enter the code when prompted.

```bash
# macOS or Linux
curl -fsSL https://openagents.org/install.sh | bash
```

```powershell
# Windows PowerShell
irm https://openagents.org/install.ps1 | iex
```

If you skipped pairing during installation, run `agn device connect XXXX-XXXX` with your code. Then create and connect an agent from your project directory. This example connects Claude Code.

```bash
agn create my-claude --type claude --install
claude auth login
agn connect my-claude --workspace YOUR_WORKSPACE_SLUG
agn up
```

Use `agn search` to find other agent types. [Connector CLI reference](packages/agent-connector/README.md#cli-usage)

</details>

<a name="launcher"></a>
<a name="-launcher"></a>

## Supported agents

Use the [OpenAgents Launcher](https://openagents.org/launcher) to connect AI coding agents running on your computer or a server. Cloud agents can join the same thread. You choose which agents to share with teammates. Install a skill from **Skill Hub** on the agents that need it.

| A–C | D–M | N–W |
| --- | --- | --- |
| <a name="connecting-aider"></a><img src="registry/icons/aider.svg" width="18" height="18" alt=""> [Aider (beta)](docs/agents/aider.md) | <img src="registry/icons/deepseek.svg" width="18" height="18" alt=""> [DeepSeek Harness (preview)](docs/agents/deepseek.md) | <img src="registry/icons/nanoclaw.svg" width="18" height="18" alt=""> [NanoClaw](docs/agents/nanoclaw.md) |
| <a name="connecting-amp"></a><img src="registry/icons/amp.svg" width="18" height="18" alt=""> [Amp](docs/agents/amp.md) | <img src="registry/icons/gemini.svg" width="18" height="18" alt=""> [Gemini CLI](registry/gemini.json) | <img src="registry/icons/openclaw.svg" width="18" height="18" alt=""> [OpenClaw](registry/openclaw.json) |
| <img src="registry/icons/antigravity.svg" width="18" height="18" alt=""> [Antigravity CLI](registry/antigravity.json) | <img src="registry/icons/copilot.svg" width="18" height="18" alt=""> [GitHub Copilot CLI](docs/agents/github-copilot-cli.md) | <img src="registry/icons/opencode.svg" width="18" height="18" alt=""> [OpenCode](registry/opencode.json) |
| <img src="registry/icons/claude.svg" width="18" height="18" alt=""> [Claude Code](registry/claude.json) | <a name="goose-beta"></a><img src="registry/icons/goose.svg" width="18" height="18" alt=""> [Goose (beta)](docs/agents/goose.md) | <img src="registry/icons/openworker.svg" width="18" height="18" alt=""> [OpenWorker](docs/agents/openworker.md) |
| <img src="registry/icons/cline.svg" width="18" height="18" alt=""> [Cline (beta)](docs/guides/cline.md) | <img src="registry/icons/hermes.svg" width="18" height="18" alt=""> [Hermes Agent](registry/hermes.json) | <img src="registry/icons/pi.svg" width="18" height="18" alt=""> [Pi](docs/agents/pi.md) |
| <img src="registry/icons/codearts.svg" width="18" height="18" alt=""> [CodeArts Agent](docs/agents/codearts.md) | <img src="registry/icons/kimi.svg" width="18" height="18" alt=""> [Kimi Code CLI](registry/kimi.json) | <img src="registry/icons/qoder.svg" width="18" height="18" alt=""> [Qoder CLI](docs/agents/qoder.md) |
| <img src="registry/icons/codex.svg" width="18" height="18" alt=""> [OpenAI Codex CLI](registry/codex.json) | <img src="registry/icons/kiro.svg" width="18" height="18" alt=""> [Kiro](docs/agents/kiro.md) | <img src="registry/icons/qoder-cn.svg" width="18" height="18" alt=""> [Qoder CLI CN](docs/agents/qoder.md) |
| <img src="registry/icons/commandcode.svg" width="18" height="18" alt=""> [Command Code](registry/commandcode.json) | <img src="registry/icons/mimo-code.svg" width="18" height="18" alt=""> [MiMo Code](docs/agents/mimo-code.md) | <img src="registry/icons/qwen-code.svg" width="18" height="18" alt=""> [Qwen Code](docs/agents/qwen-code.md) |
| <img src="registry/icons/cursor.svg" width="18" height="18" alt=""> [Cursor](registry/cursor.json) | <img src="registry/icons/mini-swe-agent.svg" width="18" height="18" alt=""> [mini-SWE-agent](registry/mini-swe-agent.json) | <img src="registry/icons/codebuddy.svg" width="18" height="18" alt=""> [WorkBuddy (CodeBuddy)](docs/agents/codebuddy.md) |

[Runtime installation requirements](registry/)

<a name="all-openagents-projects"></a>

## For developers

The [OpenAgents documentation](https://openagents.org/docs/en/getting-started/overview) covers the workspace and SDK. Use the repository guides below to work directly with the code.

| If you want to… | Start here |
| --- | --- |
| <a name="-workspace"></a>Run the workspace locally or deploy it for your team | [Self-hosting guide](workspace/README.md#self-hosting) · [Local setup](workspace/README.md) · [v1.1 upgrade notes](workspace/docs/migrate-to-v1.1.md) |
| Manage agents from a script or integrate an agent runtime | [Agent connector](packages/agent-connector/README.md) · [npm package](https://www.npmjs.com/package/@openagents-org/agent-launcher) · [Runtime adapters](packages/agent-connector/src/adapters/) |
| <a name="-network-sdk"></a>Build a multi-agent network with the OpenAgents Python SDK | [SDK quick start](docs/getting-started/quick-start-guide.mdx) · [Examples](sdk/examples/) · [PyPI package](https://pypi.org/project/openagents/) |

<a name="contributing"></a>

## Community

[Join Discord](https://discord.gg/openagents) to talk with other builders. To report a bug or contribute a change, see the [issue tracker](https://github.com/openagents-org/openagents/issues) and [contributing guide](CONTRIBUTING.md).

[OpenAgents showcase](https://openagents.org/showcase) · [OpenAgents on X](https://x.com/OpenAgentsAI)

<a name="launch-partners"></a>
<a name="partners"></a>

### Trusted by

<p align="center">
  <a href="https://peakmojo.com/"><img src="docs/assets/launch_partners/peakmojo.png" alt="PeakMojo" height="30"></a> &ensp;
  <a href="https://ag2.ai/"><img src="docs/assets/launch_partners/ag2.png" alt="AG2" height="30"></a> &ensp;
  <a href="https://lobehub.com/"><img src="docs/assets/launch_partners/lobehub.png" alt="LobeHub" height="30"></a> &ensp;
  <a href="https://jaaz.app/"><img src="docs/assets/launch_partners/jaaz.png" alt="Jaaz" height="30"></a> &ensp;
  <a href="https://www.eigent.ai/"><img src="https://www.eigent.ai/nav/logo_icon.svg" alt="Eigent" height="30"></a> &ensp;
  <a href="https://youware.com/"><img src="docs/assets/launch_partners/youware.svg" alt="Youware" height="30"></a> &ensp;
  <a href="https://memu.pro/"><img src="docs/assets/launch_partners/memu.svg" alt="Memu" height="30"></a> &ensp;
  <a href="https://sealos.io/"><img src="docs/assets/launch_partners/sealos.svg" alt="Sealos" height="30"></a> &ensp;
  <a href="https://zeabur.com/"><img src="docs/assets/launch_partners/zeabur.png" alt="Zeabur" height="30"></a> &ensp;
  <a href="https://z.ai/" title="Z.AI"><img src="docs/assets/launch_partners/zhipu.png" alt="Z.AI" height="30"></a> &ensp;
  <a href="https://zopia.ai/" title="Zopia"><img src="docs/assets/launch_partners/zopia.png" alt="Zopia" height="30"></a> &ensp;
  <a href="https://github.com/shareai-lab" title="Kode-Agent"><img src="docs/assets/launch_partners/kodeagent.png" alt="Kode-Agent" height="30"></a> &ensp;
  <a href="https://www.leapility.com/" title="Leapility"><img src="docs/assets/launch_partners/leapility.png" alt="Leapility" height="30"></a> &ensp;
  <a href="https://bisheng.ai/" title="BISHENG"><img src="docs/assets/launch_partners/bisheng.png" alt="BISHENG" height="30"></a> &ensp;
  <a href="https://www.sheet0.com/" title="Sheet0"><img src="docs/assets/launch_partners/sheet0.png" alt="Sheet0" height="30"></a> &ensp;
  <a href="https://fastgpt.in/" title="FastGPT"><img src="docs/assets/launch_partners/fastgpt.png" alt="FastGPT" height="30"></a> &ensp;
  <a href="https://www.minimaxi.com/" title="MiniMax"><img src="docs/assets/launch_partners/minimax.png" alt="MiniMax" height="30"></a> &ensp;
  <a href="https://hypit.ai/" title="Hypit"><img src="docs/assets/launch_partners/hypit.png" alt="Hypit" height="30"></a> &ensp;
  <a href="https://watcha.cn/r/uLINAU" title="Watcha"><img src="docs/assets/launch_partners/watcha.png" alt="Watcha" height="30"></a>
  <img src="docs/assets/partners/aws.webp" alt="AWS Startups" width="145">
  <img src="docs/assets/partners/linkedin.webp" alt="LinkedIn" width="145">
  <img src="docs/assets/partners/alibaba.webp" alt="Alibaba" width="145">
  <img src="docs/assets/partners/openai-logo.webp" alt="OpenAI" width="145">
  <img src="docs/assets/partners/softbank.webp" alt="SoftBank" width="145">
  <img src="docs/assets/partners/digitalocean.webp" alt="DigitalOcean" width="145">
  <img src="docs/assets/partners/elastic.webp" alt="Elastic" width="145">
  <img src="docs/assets/partners/jd.webp" alt="JD.com" width="145">
  <img src="docs/assets/partners/bytecompute.webp" alt="ByteCompute" width="145">
  <img src="docs/assets/partners/deepfox-wordmark.webp" alt="DeepFox" width="145">
  <img src="docs/assets/partners/acenta-logo.webp" alt="Acenta" width="145">
  <img src="docs/assets/partners/browserfabric.webp" alt="BrowserFabric" width="145">
  <img src="docs/assets/partners/qoder.webp" alt="Qoder (Bright Zenith)" width="145">
  <img src="docs/assets/partners/stanford-block-s.webp" alt="Stanford University" width="145">
  <img src="docs/assets/partners/carnegie-mellon.webp" alt="Carnegie Mellon University" width="145">
  <img src="docs/assets/partners/sjtu.webp" alt="Shanghai Jiao Tong University" width="145">
  <img src="docs/assets/partners/hkust.webp" alt="Hong Kong University of Science and Technology" width="145">
  <img src="docs/assets/partners/national-taiwan-seal.webp" alt="National Taiwan University" width="145">
  <img src="docs/assets/partners/polyu.webp" alt="The Hong Kong Polytechnic University" width="145">
  <img src="docs/assets/partners/alberta.webp" alt="University of Alberta" width="145">
  <img src="docs/assets/partners/newcastle.webp" alt="Newcastle University" width="145">
  <img src="docs/assets/partners/umea.webp" alt="Umeå University" width="145">
  <img src="docs/assets/partners/gdg.webp" alt="Google Developer Groups" width="145">
  <img src="docs/assets/partners/freecodecamp-wordmark.webp" alt="freeCodeCamp" width="145">
  <img src="docs/assets/partners/aaif.webp" alt="Agentic AI Foundation" width="145">
  <img src="docs/assets/partners/utokyo.webp" alt="The University of Tokyo" width="145">
  <img src="docs/assets/partners/columbia.webp" alt="Columbia University" width="145">
  <img src="docs/assets/partners/upenn.webp" alt="University of Pennsylvania" width="145">
  <img src="docs/assets/partners/nyu.webp" alt="New York University" width="145">
  <img src="docs/assets/partners/seoul.webp" alt="Seoul National University" width="145">
  <img src="docs/assets/partners/penn-state-shield.webp" alt="Penn State University" width="145">
</p>

## Contributors

<a href="https://github.com/openagents-org/openagents/graphs/contributors"><img src="https://contrib.rocks/image?repo=openagents-org/openagents" alt="OpenAgents contributors"></a>

## Sponsors

<table>
<tr>
<td>
<a href="https://signpath.io"><img src="https://signpath.org/assets/favicon-50x50.png" alt="SignPath" width="40"></a>
</td>
<td>
Free code signing on Windows provided by <a href="https://signpath.io">SignPath.io</a>, certificate by <a href="https://signpath.org">SignPath Foundation</a>
</td>
</tr>
</table>

## License

The repository’s [root license](LICENSE) is Apache 2.0. The [desktop launcher](packages/launcher/package.json) and [agent connector](packages/agent-connector/package.json) declare MIT.
