import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Hardcoded skill catalog with categories
// ---------------------------------------------------------------------------

const SKILL_CATALOG: Record<string, { category: string; categoryIcon: string; description: string }> = {
  // 🧠 AI & Reasoning
  'claude-api': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Build, debug, and optimize Claude API / Anthropic SDK apps with prompt caching' },
  'coding-agent': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Code generation and refactoring agent powered by LLMs' },
  'gemini': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Integrate with Google Gemini models for multimodal AI tasks' },
  'openai-image-gen': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Generate images using OpenAI DALL-E and GPT-Image models' },
  'openai-whisper': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Transcribe audio to text using OpenAI Whisper locally' },
  'openai-whisper-api': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Transcribe audio via the OpenAI Whisper API' },
  'oracle': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Deep reasoning and analysis for complex problems' },
  'sdk-quiz-generator': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Generate quizzes from SDK documentation automatically' },
  'mcp-builder': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Create MCP servers that enable LLMs to interact with external services' },
  'skill-creator': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Create, modify, and benchmark agent skills with eval-driven iteration' },
  'find-skills': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Discover and install skills from the SkillHub registry' },
  'dispatching-parallel-agents': { category: 'AI & Reasoning', categoryIcon: '🧠', description: 'Orchestrate multiple agents running in parallel for complex tasks' },

  // 🎨 Design & UI
  'frontend-design': { category: 'Design & UI', categoryIcon: '🎨', description: 'Create distinctive, production-grade UIs that avoid generic AI aesthetics' },
  'huashu-design': { category: 'Design & UI', categoryIcon: '🎨', description: 'High-fidelity prototypes, interactive demos, and design exploration' },
  'baseline-ui': { category: 'Design & UI', categoryIcon: '🎨', description: 'Build accessible, consistent UI components from a design baseline' },
  'design-md': { category: 'Design & UI', categoryIcon: '🎨', description: 'Design documentation and specifications in Markdown format' },
  'design-motion-principles': { category: 'Design & UI', categoryIcon: '🎨', description: 'Apply motion design principles for fluid, purposeful animations' },
  'design-taste-frontend': { category: 'Design & UI', categoryIcon: '🎨', description: 'Frontend design taste — typography, spacing, color, hierarchy' },
  'emil-design-eng': { category: 'Design & UI', categoryIcon: '🎨', description: 'UI polish, component design, and animation decisions for great software feel' },
  'icon-retrieval': { category: 'Design & UI', categoryIcon: '🎨', description: 'Find and retrieve icons from popular icon libraries' },
  'theme-factory': { category: 'Design & UI', categoryIcon: '🎨', description: 'Generate and customize theme configurations for design systems' },
  'canvas-design': { category: 'Design & UI', categoryIcon: '🎨', description: 'Create visual designs using HTML5 Canvas' },
  'web-design-guidelines': { category: 'Design & UI', categoryIcon: '🎨', description: 'Best practices for web layout, accessibility, and responsive design' },
  'infographic-creator': { category: 'Design & UI', categoryIcon: '🎨', description: 'Create data-driven infographics and visual storytelling' },

  // ⚙️ Dev Tools
  'github': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'GitHub operations — PRs, issues, actions, and repository management' },
  'tmux': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Terminal multiplexer session management and automation' },
  'systematic-debugging': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Structured approach to debugging complex issues' },
  'subagent-driven-development': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Delegate development tasks to specialized sub-agents' },
  'executing-plans': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Execute structured development plans step-by-step' },
  'writing-plans': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Create structured plans for complex development tasks' },
  'using-git-worktrees': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Manage parallel development branches with git worktrees' },
  'merge-pr': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Merge pull requests with proper review and checks' },
  'prepare-pr': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Prepare pull requests with proper descriptions and metadata' },
  'review-pr': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Review pull requests for quality, security, and best practices' },
  'receiving-code-review': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Process and apply code review feedback effectively' },
  'requesting-code-review': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Request code reviews with proper context and scope' },
  'finishing-a-development-branch': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Clean up and finalize development branches for merge' },
  'create-cli': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Scaffold and build command-line interface applications' },
  'opencli-explorer': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Explore CLI tools and discover their capabilities' },
  'opencli-oneshot': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Execute one-shot CLI operations efficiently' },
  'opencli-operate': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Operate and automate CLI workflows' },
  'opencli-usage': { category: 'Dev Tools', categoryIcon: '⚙️', description: 'Learn and display CLI tool usage patterns' },

  // 📄 Docs & Content
  'docx': { category: 'Docs & Content', categoryIcon: '📄', description: 'Create, read, and edit Word documents with formatting' },
  'xlsx': { category: 'Docs & Content', categoryIcon: '📄', description: 'Read, write, and format spreadsheets with formulas and charts' },
  'pptx': { category: 'Docs & Content', categoryIcon: '📄', description: 'Create and edit presentation slide decks' },
  'pdf': { category: 'Docs & Content', categoryIcon: '📄', description: 'Read, merge, split, and process PDF documents' },
  'doc-coauthoring': { category: 'Docs & Content', categoryIcon: '📄', description: 'Structured workflow for co-authoring documents and specs' },
  'summarize': { category: 'Docs & Content', categoryIcon: '📄', description: 'Summarize long documents, articles, and text content' },
  'writing-skills': { category: 'Docs & Content', categoryIcon: '📄', description: 'Professional writing assistance for various formats' },
  'markdown-converter': { category: 'Docs & Content', categoryIcon: '📄', description: 'Convert between Markdown and other document formats' },
  'nano-pdf': { category: 'Docs & Content', categoryIcon: '📄', description: 'Lightweight PDF generation and manipulation' },

  // 🔗 Integration & Automation
  'slack': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Slack messaging, channels, and workspace automation' },
  'slack-gif-creator': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Create and share GIFs in Slack conversations' },
  'notion': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Notion API — databases, pages, blocks, and search' },
  'trello': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Trello board, list, and card management' },
  'apple-notes': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Read, create, and manage Apple Notes' },
  'apple-reminders': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Manage Apple Reminders lists and tasks' },
  'bear-notes': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Bear note-taking app integration' },
  'obsidian': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Obsidian vault management and knowledge graph' },
  'flomo': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Quick note capture to Flomo' },
  'wecom-doc': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'WeCom (WeChat Work) document collaboration' },
  'weread-skills': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'WeRead book highlights and notes sync' },
  'things-mac': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Things 3 task management on macOS' },
  'blucli': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Bluesky social network CLI operations' },
  'himalaya': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'Email client for CLI — IMAP/SMTP operations' },
  'imsg': { category: 'Integration & Automation', categoryIcon: '🔗', description: 'iMessage sending and reading on macOS' },

  // 🎬 Media & Creative
  'video-frames': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Extract and analyze frames from video files' },
  'video-transcript-downloader': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Download transcripts from video platforms' },
  'gifgrep': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Search and find GIFs by content and text' },
  'camsnap': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Capture photos from connected cameras' },
  'peekaboo': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Screenshot and screen capture utility' },
  'remotion-best-practices': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Best practices for Remotion video generation' },
  'web-shader-extractor': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Extract and analyze WebGL shaders from web pages' },
  'narrative-text-visualization': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Visualize narrative text as animated graphics' },
  'algorithmic-art': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Generate art using algorithms and creative coding' },
  'seedance-prompt-en': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Generate dance video prompts (English)' },
  'seedance-prompt-zh': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Generate dance video prompts (Chinese)' },
  'dreamina-cli': { category: 'Media & Creative', categoryIcon: '🎬', description: 'Dreamina AI image generation CLI' },

  // 🌐 Web & Search
  'web-access': { category: 'Web & Search', categoryIcon: '🌐', description: 'Access and fetch web page content' },
  'brave-search': { category: 'Web & Search', categoryIcon: '🌐', description: 'Web search powered by Brave Search API' },
  'agent-browser': { category: 'Web & Search', categoryIcon: '🌐', description: 'Automated browser agent for web interaction' },
  'blogwatcher': { category: 'Web & Search', categoryIcon: '🌐', description: 'Monitor blogs and RSS feeds for updates' },
  'web-artifacts-builder': { category: 'Web & Search', categoryIcon: '🌐', description: 'Build interactive web artifacts and widgets' },

  // 📊 Data & Analysis
  'akshare-stock': { category: 'Data & Analysis', categoryIcon: '📊', description: 'Chinese stock market data via AKShare' },
  'chart-visualization': { category: 'Data & Analysis', categoryIcon: '📊', description: 'Create charts and data visualizations' },
  'model-usage': { category: 'Data & Analysis', categoryIcon: '📊', description: 'Track and analyze AI model usage statistics' },
  'fitness-analyzer': { category: 'Data & Analysis', categoryIcon: '📊', description: 'Analyze fitness and workout data trends' },

  // 🛠️ Engineering Practices
  'test-driven-development': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Write tests first, then implement — TDD workflow' },
  'verification-before-completion': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Verify changes work before claiming completion' },
  'webapp-testing': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Test web apps with Playwright — screenshots and verification' },
  'wcag-audit-patterns': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'WCAG accessibility audit patterns and checklists' },
  'fixing-accessibility': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Fix accessibility issues — ARIA, focus, contrast' },
  'fixing-metadata': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Fix SEO and social metadata for web pages' },
  'fixing-motion-performance': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Optimize animation and motion performance' },
  'swiftui-liquid-glass': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'SwiftUI liquid glass material effects' },
  'swiftui-performance-audit': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Audit and optimize SwiftUI view performance' },
  'swiftui-view-refactor': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Refactor SwiftUI views for clarity and reuse' },
  'swift-concurrency-expert': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Swift async/await, actors, and structured concurrency' },
  'native-app-performance': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Profile and optimize native application performance' },
  'instruments-profiling': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Use Xcode Instruments for profiling and diagnostics' },
  'vercel-react-best-practices': { category: 'Engineering Practices', categoryIcon: '🛠️', description: 'Vercel deployment and React optimization patterns' },

  // 🏠 Life & Productivity
  'fitness-coach': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Personalized fitness coaching and workout plans' },
  'weather': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Get weather forecasts and conditions' },
  'google-maps': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Google Maps directions, places, and geocoding' },
  'local-places': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Find local restaurants, shops, and services nearby' },
  'goplaces': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Travel planning and place recommendations' },
  'distance-calculator': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Calculate distances and travel times between locations' },
  'healthcheck': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Health monitoring and wellness tracking' },
  'voice-call': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Make and manage voice calls' },
  'bird': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Bird identification and nature observation' },
  'songsee': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Music recognition and song identification' },
  'spotify-player': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Control Spotify playback and manage playlists' },
  'sherpa-onnx-tts': { category: 'Life & Productivity', categoryIcon: '🏠', description: 'Text-to-speech with Sherpa-ONNX models' },

  // 🔧 System & CLI
  'eightctl': { category: 'System & CLI', categoryIcon: '🔧', description: '1Password CLI integration and secret management' },
  'ordercli': { category: 'System & CLI', categoryIcon: '🔧', description: 'Order and delivery tracking CLI' },
  'wacli': { category: 'System & CLI', categoryIcon: '🔧', description: 'WhatsApp CLI messaging interface' },
  'nano-banana-pro': { category: 'System & CLI', categoryIcon: '🔧', description: 'Nano Banana Pro device management' },
  'openhue': { category: 'System & CLI', categoryIcon: '🔧', description: 'Philips Hue smart lighting control' },
  'device-agent': { category: 'System & CLI', categoryIcon: '🔧', description: 'Mobile device automation and management' },
  'domain-dns-ops': { category: 'System & CLI', categoryIcon: '🔧', description: 'DNS record management and domain operations' },
  'session-logs': { category: 'System & CLI', categoryIcon: '🔧', description: 'Session logging and activity tracking' },
  'internal-comms': { category: 'System & CLI', categoryIcon: '🔧', description: 'Internal communication tools and messaging' },
  'deepchat-settings': { category: 'System & CLI', categoryIcon: '🔧', description: 'DeepChat configuration and settings management' },
  'omc-reference': { category: 'System & CLI', categoryIcon: '🔧', description: 'Oh-My-ClaudeCode reference and documentation' },
  'clawhub': { category: 'System & CLI', categoryIcon: '🔧', description: 'ClawHub skill marketplace client' },
  'clawdbot-security-check': { category: 'System & CLI', categoryIcon: '🔧', description: 'Security checks for Clawdbot configurations' },
  'gog': { category: 'System & CLI', categoryIcon: '🔧', description: 'GOG game library management' },
  'jmcomic': { category: 'System & CLI', categoryIcon: '🔧', description: 'JMComic downloader and reader' },
  'media-downloader': { category: 'System & CLI', categoryIcon: '🔧', description: 'Download media from various platforms' },
  'refly': { category: 'System & CLI', categoryIcon: '🔧', description: 'Refly AI workspace integration' },
  'sag': { category: 'System & CLI', categoryIcon: '🔧', description: 'System administration and management' },
  'sonoscli': { category: 'System & CLI', categoryIcon: '🔧', description: 'Sonos speaker control and automation' },
};

// Skills that exist on disk but aren't in our catalog
const UNCATEGORIZED_DEFAULTS = { category: 'Other', categoryIcon: '📦', description: '' };

const SKILLS_DIR = path.join(process.env.HOME || '/Users/tonyye', '.claude', 'skills');

function formatName(slug: string): string {
  return slug
    .replace(/\.md$/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function GET() {
  try {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

    const skills = entries.map(entry => {
      const slug = entry.name.replace(/\.md$/, '');
      const catalogEntry = SKILL_CATALOG[slug] || UNCATEGORIZED_DEFAULTS;

      // Try to read SKILL.md for description if not in catalog
      let description = catalogEntry.description;
      if (!description) {
        const skillDir = path.join(SKILLS_DIR, entry.name);
        const mdPath = entry.isDirectory()
          ? path.join(skillDir, 'SKILL.md')
          : skillDir;
        try {
          if (fs.existsSync(mdPath)) {
            const content = fs.readFileSync(mdPath, 'utf-8');
            const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
            description = firstLine?.trim().slice(0, 120) || '';
          }
        } catch {
          // ignore read errors
        }
      }

      return {
        slug,
        name: formatName(slug),
        description,
        category: catalogEntry.category,
        categoryIcon: catalogEntry.categoryIcon,
        exists: true,
      };
    });

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read local skills', details: String(error) },
      { status: 500 }
    );
  }
}
