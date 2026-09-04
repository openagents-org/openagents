'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Search, ExternalLink, Star, ArrowRight, Check, Plus, Loader2, AlertCircle, Upload, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceCustomSkill } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DetailHeader } from '@/components/layout/app-header';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { useT, type MessageKey, type TranslateFn } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Skill data
// ---------------------------------------------------------------------------

interface Skill {
  id: string;
  name: string;
  /**
   * Only custom (uploaded) skills carry their description inline — it's user
   * data. Catalogue descriptions live in the message catalogue under
   * `skills.catalog.<id>` and are resolved by {@link useSkillDescription}.
   */
  description?: string;
  category: string;
  tags: string[];
  // Catalog skills carry logo + GitHub source; custom (uploaded) skills don't.
  logo?: string;
  sourceRepo?: string;
  sourcePath?: string;
  author?: string;
  featured?: boolean;
  // Custom (workspace_file) skills — uploaded .md/.zip packages.
  sourceType?: 'catalog' | 'workspace_file';
  fileId?: string;
  filename?: string;
  contentType?: string;
  packageType?: 'md' | 'zip';
}

const CUSTOM_SKILL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Map a backend custom skill into the local Skill shape used by the UI. */
function customSkillToSkill(c: WorkspaceCustomSkill): Skill {
  return {
    id: c.id,
    name: c.name,
    description: c.description || '',
    category: 'custom',
    tags: c.tags || [],
    author: c.author || 'Workspace user',
    sourceType: 'workspace_file',
    fileId: c.fileId,
    filename: c.filename,
    contentType: c.contentType,
    packageType: c.packageType,
  };
}

function deriveSkillId(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return (
    stem.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 64) ||
    'custom-skill'
  );
}

/** Pull the human-readable message out of an API error like `API 400: {json}`. */
function extractErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const brace = msg.indexOf('{');
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(brace));
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return msg;
}

const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';

const SKILLS: Skill[] = [
  // AI & ML
  { id: 'claude-api', name: 'Claude API', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['sdk', 'llm', 'caching'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/claude-api', author: 'Anthropic', featured: true },
  { id: 'openai-sdk', name: 'OpenAI SDK', category: 'ai-ml', logo: `${SI}/openai.svg`, tags: ['gpt', 'embeddings', 'vision'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/openai-sdk', author: 'Community' },
  { id: 'langchain', name: 'LangChain', category: 'ai-ml', logo: `${SI}/langchain.svg`, tags: ['rag', 'agents', 'chains'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/langchain', author: 'Community' },
  { id: 'mcp-builder', name: 'MCP Builder', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['mcp', 'tools', 'protocol'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/mcp-builder', author: 'Anthropic', featured: true },
  { id: 'skill-creator', name: 'Skill Creator', category: 'ai-ml', logo: `${SI}/anthropic.svg`, tags: ['meta', 'evals', 'authoring'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/skill-creator', author: 'Anthropic' },
  { id: 'ai-sdk', name: 'Vercel AI SDK', category: 'ai-ml', logo: `${SI}/vercel.svg`, tags: ['streaming', 'react', 'rag'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ai-sdk', author: 'Community' },
  { id: 'hypit', name: 'Hypit', category: 'ai-ml', logo: 'https://avatars.githubusercontent.com/u/274059971', tags: ['video', 'svml', 'authoring'], sourceRepo: 'hypit-ai/hypit', sourcePath: 'skills/hypit', author: 'Hypit' },
  // Frontend
  { id: 'nextjs', name: 'Next.js', category: 'frontend', logo: `${SI}/nextdotjs.svg`, tags: ['react', 'ssr', 'app-router'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/nextjs', author: 'Community', featured: true },
  { id: 'angular', name: 'Angular', category: 'frontend', logo: `${SI}/angular.svg`, tags: ['typescript', 'spa', 'rxjs'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/angular', author: 'Community' },
  { id: 'vue', name: 'Vue.js', category: 'frontend', logo: `${SI}/vuedotjs.svg`, tags: ['composition-api', 'reactive', 'sfc'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/vue', author: 'Community' },
  { id: 'svelte', name: 'Svelte', category: 'frontend', logo: `${SI}/svelte.svg`, tags: ['compiler', 'runes', 'sveltekit'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/svelte', author: 'Community' },
  { id: 'tailwindcss', name: 'Tailwind CSS', category: 'frontend', logo: `${SI}/tailwindcss.svg`, tags: ['css', 'utility', 'responsive'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/tailwindcss', author: 'Community' },
  { id: 'frontend-design', name: 'Frontend Design', category: 'frontend', logo: `${SI}/anthropic.svg`, tags: ['ui', 'design', 'creative'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/frontend-design', author: 'Anthropic', featured: true },
  { id: 'accessibility-auditor', name: 'Accessibility Auditor', category: 'frontend', logo: `${SI}/w3c.svg`, tags: ['wcag', 'a11y', 'audit'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/accessibility-auditor', author: 'Community' },
  // Backend
  { id: 'fastapi', name: 'FastAPI', category: 'backend', logo: `${SI}/fastapi.svg`, tags: ['python', 'async', 'pydantic'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/fastapi', author: 'Community' },
  { id: 'django', name: 'Django', category: 'backend', logo: `${SI}/django.svg`, tags: ['python', 'orm', 'admin'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/django', author: 'Community' },
  { id: 'flask', name: 'Flask', category: 'backend', logo: `${SI}/flask.svg`, tags: ['python', 'micro', 'jinja'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/flask', author: 'Community' },
  { id: 'graphql', name: 'GraphQL', category: 'backend', logo: `${SI}/graphql.svg`, tags: ['api', 'schema', 'federation'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/graphql', author: 'Community' },
  { id: 'grpc', name: 'gRPC', category: 'backend', logo: `${SI}/google.svg`, tags: ['rpc', 'protobuf', 'streaming'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/grpc', author: 'Community' },
  { id: 'rest-api', name: 'REST API Design', category: 'backend', logo: `${SI}/openapiinitiative.svg`, tags: ['rest', 'openapi', 'crud'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rest-api', author: 'Community' },
  { id: 'celery', name: 'Celery', category: 'backend', logo: `${SI}/celery.svg`, tags: ['python', 'queue', 'workers'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/celery', author: 'Community' },
  { id: 'rabbitmq', name: 'RabbitMQ', category: 'backend', logo: `${SI}/rabbitmq.svg`, tags: ['messaging', 'amqp', 'queue'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rabbitmq', author: 'Community' },
  { id: 'kafka', name: 'Apache Kafka', category: 'backend', logo: `${SI}/apachekafka.svg`, tags: ['streaming', 'events', 'pubsub'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/kafka', author: 'Community' },
  { id: 'rate-limiter', name: 'Rate Limiter', category: 'backend', logo: `${SI}/cloudflare.svg`, tags: ['security', 'throttle', 'redis'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/rate-limiter', author: 'Community' },
  // Database
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', logo: `${SI}/postgresql.svg`, tags: ['sql', 'jsonb', 'rls'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/postgresql', author: 'Community', featured: true },
  { id: 'mongodb', name: 'MongoDB', category: 'database', logo: `${SI}/mongodb.svg`, tags: ['nosql', 'aggregation', 'vector'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/mongodb', author: 'Community' },
  { id: 'redis', name: 'Redis', category: 'database', logo: `${SI}/redis.svg`, tags: ['cache', 'pubsub', 'streams'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/redis', author: 'Community' },
  { id: 'prisma', name: 'Prisma', category: 'database', logo: `${SI}/prisma.svg`, tags: ['orm', 'typescript', 'migrations'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/prisma', author: 'Community' },
  { id: 'supabase', name: 'Supabase', category: 'database', logo: `${SI}/supabase.svg`, tags: ['auth', 'realtime', 'storage'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/supabase', author: 'Community' },
  { id: 'firebase', name: 'Firebase', category: 'database', logo: `${SI}/firebase.svg`, tags: ['firestore', 'auth', 'functions'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/firebase', author: 'Community' },
  // DevOps
  { id: 'github-actions', name: 'GitHub Actions', category: 'devops', logo: `${SI}/githubactions.svg`, tags: ['ci-cd', 'automation', 'workflows'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/github-actions', author: 'Community', featured: true },
  { id: 'ansible', name: 'Ansible', category: 'devops', logo: `${SI}/ansible.svg`, tags: ['automation', 'playbooks', 'vault'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ansible', author: 'Community' },
  { id: 'nginx', name: 'Nginx', category: 'devops', logo: `${SI}/nginx.svg`, tags: ['proxy', 'tls', 'load-balancer'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/nginx', author: 'Community' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'devops', logo: `${SI}/cloudflare.svg`, tags: ['cdn', 'dns', 'workers'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/cloudflare', author: 'Community' },
  { id: 'sentry', name: 'Sentry', category: 'devops', logo: `${SI}/sentry.svg`, tags: ['monitoring', 'errors', 'apm'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sentry', author: 'Community' },
  { id: 'datadog', name: 'Datadog', category: 'devops', logo: `${SI}/datadog.svg`, tags: ['monitoring', 'metrics', 'logs'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/datadog', author: 'Community' },
  // Testing & Security
  { id: 'jest', name: 'Jest', category: 'testing', logo: `${SI}/jest.svg`, tags: ['unit-test', 'mocking', 'coverage'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/jest', author: 'Community' },
  { id: 'pytest', name: 'pytest', category: 'testing', logo: `${SI}/pytest.svg`, tags: ['python', 'fixtures', 'tdd'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/pytest', author: 'Community' },
  { id: 'cypress', name: 'Cypress', category: 'testing', logo: `${SI}/cypress.svg`, tags: ['e2e', 'browser', 'ci'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/cypress', author: 'Community' },
  { id: 'webapp-testing', name: 'Webapp Testing', category: 'testing', logo: `${SI}/playwright.svg`, tags: ['playwright', 'screenshots', 'verification'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/webapp-testing', author: 'Anthropic' },
  { id: 'ab-test-setup', name: 'A/B Testing', category: 'testing', logo: `${SI}/googleoptimize.svg`, tags: ['experiment', 'hypothesis', 'variants'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/ab-test-setup', author: 'Community' },
  { id: 'security-audit', name: 'Security Audit', category: 'security', logo: `${SI}/owasp.svg`, tags: ['owasp', 'vulnerabilities', 'cve'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/security-audit', author: 'Community' },
  // Integrations
  { id: 'airtable', name: 'Airtable', category: 'integrations', logo: `${SI}/airtable.svg`, tags: ['api', 'database', 'webhooks'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/airtable', author: 'Community' },
  { id: 'notion', name: 'Notion', category: 'integrations', logo: `${SI}/notion.svg`, tags: ['api', 'workspace', 'pages'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/notion', author: 'Community' },
  { id: 'jira', name: 'Jira', category: 'integrations', logo: `${SI}/jira.svg`, tags: ['issues', 'sprints', 'agile'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/jira', author: 'Community' },
  { id: 'linear', name: 'Linear', category: 'integrations', logo: `${SI}/linear.svg`, tags: ['issues', 'cycles', 'graphql'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/linear', author: 'Community' },
  { id: 'stripe', name: 'Stripe Payments', category: 'integrations', logo: `${SI}/stripe.svg`, tags: ['payments', 'subscriptions', 'webhooks'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/stripe', author: 'Community' },
  { id: 'twilio', name: 'Twilio', category: 'integrations', logo: `${SI}/twilio.svg`, tags: ['sms', 'voice', '2fa'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/twilio', author: 'Community' },
  { id: 'sendgrid', name: 'SendGrid', category: 'integrations', logo: `${SI}/sendgrid.svg`, tags: ['email', 'templates', 'deliverability'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sendgrid', author: 'Community' },
  { id: 'shopify', name: 'Shopify', category: 'integrations', logo: `${SI}/shopify.svg`, tags: ['ecommerce', 'liquid', 'headless'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/shopify', author: 'Community' },
  { id: 'wordpress', name: 'WordPress', category: 'integrations', logo: `${SI}/wordpress.svg`, tags: ['cms', 'gutenberg', 'plugins'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/wordpress', author: 'Community' },
  { id: 'woocommerce', name: 'WooCommerce', category: 'integrations', logo: `${SI}/woocommerce.svg`, tags: ['ecommerce', 'wordpress', 'payments'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/woocommerce', author: 'Community' },
  { id: 'contentful', name: 'Contentful', category: 'integrations', logo: `${SI}/contentful.svg`, tags: ['cms', 'headless', 'i18n'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/contentful', author: 'Community' },
  { id: 'sanity', name: 'Sanity', category: 'integrations', logo: `${SI}/sanity.svg`, tags: ['cms', 'groq', 'structured'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/sanity', author: 'Community' },
  { id: 'zapier', name: 'Zapier', category: 'integrations', logo: `${SI}/zapier.svg`, tags: ['automation', 'nocode', 'integrations'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/zapier', author: 'Community' },
  { id: 'analytics-tracking', name: 'Analytics Tracking', category: 'integrations', logo: `${SI}/googleanalytics.svg`, tags: ['ga4', 'tracking', 'gtm'], sourceRepo: 'TerminalSkills/skills', sourcePath: 'skills/analytics-tracking', author: 'Community' },
  // Documents
  { id: 'docx', name: 'Word Documents', category: 'documents', logo: `${SI}/microsoftword.svg`, tags: ['word', 'docx', 'formatting'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/docx', author: 'Anthropic' },
  { id: 'xlsx', name: 'Spreadsheets', category: 'documents', logo: `${SI}/microsoftexcel.svg`, tags: ['excel', 'formulas', 'charts'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/xlsx', author: 'Anthropic' },
  { id: 'pptx', name: 'Presentations', category: 'documents', logo: `${SI}/microsoftpowerpoint.svg`, tags: ['slides', 'presentations', 'templates'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/pptx', author: 'Anthropic' },
  { id: 'pdf', name: 'PDF Processing', category: 'documents', logo: `${SI}/adobeacrobatreader.svg`, tags: ['pdf', 'ocr', 'merge'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/pdf', author: 'Anthropic' },
  { id: 'doc-coauthoring', name: 'Doc Co-Authoring', category: 'documents', logo: `${SI}/anthropic.svg`, tags: ['writing', 'specs', 'collaboration'], sourceRepo: 'anthropics/skills', sourcePath: 'skills/doc-coauthoring', author: 'Anthropic' },
  // SenseNova Skills
  { id: 'sn-deep-research', name: 'SenseNova Deep Research', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['research', 'report', 'evidence'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-deep-research', author: 'SenseNova', featured: true },
  { id: 'sn-infographic', name: 'SenseNova Infographic', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['infographic', 'visual', 'design'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-infographic', author: 'SenseNova' },
  { id: 'sn-ppt-entry', name: 'SenseNova PPT', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['ppt', 'slides', 'creative'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-ppt-entry', author: 'SenseNova' },
  { id: 'sn-da-excel-workflow', name: 'SenseNova Excel Analysis', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['excel', 'data-analysis', 'pivot'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-da-excel-workflow', author: 'SenseNova' },
  { id: 'sn-image-base', name: 'SenseNova Image Gen', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['image-gen', 'vlm', 'vision'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-image-base', author: 'SenseNova' },
  { id: 'sn-md-to-html-report', name: 'SenseNova HTML Report', category: 'sensenova', logo: 'https://avatars.githubusercontent.com/u/215225587', tags: ['markdown', 'html', 'report'], sourceRepo: 'OpenSenseNova/SenseNova-Skills', sourcePath: 'skills/sn-md-to-html-report', author: 'SenseNova' },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'all', icon: '🔥' },
  { id: 'ai-ml', icon: '🧠' },
  { id: 'frontend', icon: '🎨' },
  { id: 'backend', icon: '⚙️' },
  { id: 'database', icon: '🗄️' },
  { id: 'devops', icon: '🚀' },
  { id: 'testing', icon: '🧪' },
  { id: 'security', icon: '🔒' },
  { id: 'integrations', icon: '🔗' },
  { id: 'documents', icon: '📄' },
  { id: 'sensenova', icon: '🌟' },
  { id: 'custom', icon: '📦' },
] as const;

/** Label for a category id, e.g. `ai-ml` → "AI & ML" / "AI 与机器学习". */
function categoryLabel(t: TranslateFn, id: string): string {
  return t(`skills.categories.${id}` as MessageKey);
}

/**
 * A skill's description in the active language.
 *
 * Uploaded skills keep whatever the uploader typed; catalogue skills read from
 * `skills.catalog.<id>`, which is why the SKILLS array carries no prose.
 */
function skillDescription(t: TranslateFn, skill: Skill): string {
  if (skill.sourceType === 'workspace_file') return skill.description ?? '';
  return t(`skills.catalog.${skill.id}` as MessageKey);
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

// Explicit column counts per breakpoint rather than `auto-fill,minmax(…)`:
// auto-fill keeps packing columns as the viewport grows, so a 27" display ended
// up with nine ~260px cards per row. Stepping the count by breakpoint holds each
// card around 340-390px wide at every size.
const GRID_CLASS =
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 2xl:gap-5 min-[2100px]:grid-cols-6';

function SkillCard({ skill, onSelect }: { skill: Skill; onSelect: (s: Skill) => void }) {
  const t = useT();
  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-5 transition-all duration-150 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      <div className="flex items-start gap-3.5">
        {/* Logo */}
        <div className="size-11 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          {skill.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={skill.logo} alt="" className="h-5.5 w-5.5 object-contain dark:invert" />
          ) : (
            <Package className="h-5.5 w-5.5 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + badge */}
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold leading-tight truncate">{skill.name}</h3>
            {skill.author === 'Anthropic' && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase">
                {t('skills.official')}
              </span>
            )}
          </div>
          {/* Description */}
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-1">
            {skillDescription(t, skill)}
          </p>
        </div>
      </div>

      {/* Tags — aligned with the text column, past the logo */}
      <div className="flex flex-wrap gap-1.5 mt-3 ml-14.5">
        {skill.tags.map(tag => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {tag}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 ml-14.5">
        <span className="text-[10px] text-muted-foreground">
          {skill.sourceRepo ? skill.sourceRepo.split('/')[0] : (skill.author || t('skills.customSource'))}
        </span>
        <span className="text-[11px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          {t('skills.view')} <ArrowRight className="size-3" />
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skill Detail
// ---------------------------------------------------------------------------

function SkillDetail({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const isCustom = skill.sourceType === 'workspace_file';
  const ghUrl = skill.sourceRepo
    ? `https://github.com/${skill.sourceRepo}/tree/main/${skill.sourcePath}`
    : '';
  const { agents, refreshWorkspace } = useWorkspace();
  const t = useT();
  const [installing, setInstalling] = useState<string | null>(null);

  const handleInstall = useCallback(async (agentName: string) => {
    setInstalling(agentName);
    try {
      await workspaceApi.installSkill(agentName, skill.id);
      // The request only queues the install; the launcher installs the skill
      // and reports back. Server `skill_status` (installing → installed/failed)
      // drives the badge from here, picked up by discovery polling.
      await refreshWorkspace();
      toast.success(t('skills.installStarted', { skill: skill.name, agent: agentName }));
    } catch (e) {
      // Surface the backend message — e.g. a custom skill whose uploaded file
      // was deleted returns "…please re-upload the skill." rather than a
      // generic failure the user can't act on.
      toast.error(extractErrorMessage(e) || t('skills.installFailed'));
    } finally {
      setInstalling(null);
    }
  }, [skill, refreshWorkspace, t]);

  const handleUninstall = useCallback(async (agentName: string) => {
    setInstalling(agentName);
    try {
      await workspaceApi.uninstallSkill(agentName, skill.id);
      await refreshWorkspace();
      toast.success(t('skills.removed', { skill: skill.name, agent: agentName }));
    } catch {
      toast.error(t('skills.removeFailed'));
    } finally {
      setInstalling(null);
    }
  }, [skill, refreshWorkspace, t]);

  // Resolve the install state for this skill on a given agent. Prefer the
  // richer skill_status map (installing/installed/failed) the launcher reports
  // back; fall back to the legacy `installed` list for older backends.
  // If a skill has been "installing" for longer than STALE_INSTALL_MS, treat
  // it as failed so the user can retry instead of seeing a permanent spinner.
  const STALE_INSTALL_MS = 2 * 60 * 1000; // 2 minutes
  const getSkillState = (agentName: string): 'installing' | 'installed' | 'failed' | null => {
    const agent = agents.find(a => a.agentName === agentName);
    const skills = (agent?.enabledSkills as Record<string, unknown>) || {};
    const statusMap = (skills.skill_status as Record<string, { state?: string; updated_at?: number }>) || {};
    const entry = statusMap[skill.id];
    if (entry?.state === 'installing') {
      if (entry.updated_at && Date.now() - entry.updated_at > STALE_INSTALL_MS) {
        return 'failed';
      }
      return 'installing';
    }
    if (entry?.state === 'failed' || entry?.state === 'installed') {
      return entry.state;
    }
    const installed = (skills.installed as string[]) || [];
    return installed.includes(skill.id) ? 'installed' : null;
  };

  const onlineAgents = agents.filter(a => a.status === 'online');

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="space-y-3 px-7 pt-7 pb-2">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
              {skill.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={skill.logo} alt="" className="h-7 w-7 object-contain dark:invert" />
              ) : (
                <Package className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">{skill.name}</DialogTitle>
                {skill.author === 'Anthropic' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase">{t('skills.official')}</span>
                )}
              </div>
              <DialogDescription className="text-[15px] leading-relaxed">
                {skillDescription(t, skill)}
              </DialogDescription>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map(tag => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-3 px-7 py-2">
          {/* Add to Agent */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
            <div className="text-[11px] font-semibold text-primary uppercase tracking-wider mb-2.5">{t('skills.addToAgent')}</div>
            {onlineAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('skills.noOnlineAgents')}</p>
            ) : (
              <div className="space-y-1.5">
                {onlineAgents.map(agent => {
                  const serverState = getSkillState(agent.agentName);
                  // Optimistic local state wins until the next discovery refresh
                  // confirms the launcher's reported status.
                  const pending = installing === agent.agentName;
                  const state = pending ? 'installing' : serverState;

                  if (state === 'installed') {
                    return (
                      <div key={agent.agentName} className="flex items-center gap-2.5 rounded-md bg-background border border-border px-3.5 py-2.5">
                        <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                        <span className="flex-1 text-sm font-medium truncate">{agentLabel(agent)}</span>
                        <button
                          onClick={() => handleUninstall(agent.agentName)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-red-500/10 hover:text-red-600 transition-colors"
                        >
                          <Check className="size-3" />
                          {t('skills.installed')}
                        </button>
                      </div>
                    );
                  }
                  if (state === 'installing') {
                    return (
                      <div key={agent.agentName} className="flex items-center gap-2.5 rounded-md bg-background border border-border px-3.5 py-2.5">
                        <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                        <span className="flex-1 text-sm font-medium truncate">{agentLabel(agent)}</span>
                        <button
                          disabled
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted text-muted-foreground disabled:opacity-70"
                        >
                          <Loader2 className="size-3 animate-spin" />
                          {t('skills.installing')}
                        </button>
                      </div>
                    );
                  }
                  if (state === 'failed') {
                    return (
                      <div key={agent.agentName} className="flex items-center gap-2.5 rounded-md bg-background border border-red-500/30 px-3.5 py-2.5">
                        <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                        <span className="flex-1 text-sm font-medium truncate">{agentLabel(agent)}</span>
                        <button
                          onClick={() => handleInstall(agent.agentName)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
                          title={t('skills.failedRetryHint')}
                        >
                          <AlertCircle className="size-3" />
                          {t('skills.failedRetry')}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={agent.agentName} className="flex items-center gap-2.5 rounded-md bg-background border border-border px-3.5 py-2.5">
                      <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                      <span className="flex-1 text-sm font-medium truncate">{agentLabel(agent)}</span>
                      <button
                        onClick={() => handleInstall(agent.agentName)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Plus className="size-3" />
                        {t('skills.add')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t('skills.category')}</div>
              <div className="text-sm font-medium">{categoryLabel(t, skill.category)}</div>
            </div>
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t('skills.author')}</div>
              <div className="text-sm font-medium">{skill.author || t('skills.customAuthor')}</div>
            </div>
          </div>

          {/* Custom (uploaded) skills show the uploaded package instead of a
              GitHub source / CLI install command. */}
          {isCustom ? (
            <div className="rounded-lg border border-border p-3.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{t('skills.uploadedPackage')}</div>
              <div className="flex items-center gap-2">
                <Package className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{skill.filename || `${skill.id}.${skill.packageType || 'md'}`}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase shrink-0">
                  {skill.packageType || 'md'}
                </span>
              </div>
            </div>
          ) : (
            <>
              {skill.sourceRepo && (
                <div className="rounded-lg border border-border p-3.5">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{t('skills.source')}</div>
                  <a href={ghUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1.5">
                    {skill.sourceRepo}/{skill.sourcePath} <ExternalLink className="size-3" />
                  </a>
                </div>
              )}

              {skill.sourceRepo && (
                <div className="rounded-lg border border-border p-3.5 bg-muted/30">
                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('skills.cliInstall')}</div>
                  <code className="text-xs font-mono block bg-background rounded-md p-3 border border-border select-all break-all">
                    npx @anthropic-ai/skills install {skill.sourceRepo}/{skill.sourcePath}
                  </code>
                </div>
              )}
            </>
          )}

          <div className="rounded-lg border border-border p-3.5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('skills.compatibleWith')}</div>
            <div className="flex flex-wrap gap-1.5">
              {['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode', 'VS Code', 'Roo Code'].map(a => (
                <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{a}</span>
              ))}
              <span className="text-[11px] text-muted-foreground self-center">{t('skills.moreCompatible')}</span>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="px-7 pt-7 pb-7 sm:space-x-3">
          <Button variant="outline" className="min-w-24" onClick={onClose}>
            {t('common.close')}
          </Button>
          {!isCustom && ghUrl && (
            <Button asChild className="min-w-24">
              <a href={ghUrl} target="_blank" rel="noopener noreferrer">
                {t('skills.viewOnGitHub')} <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function SkillsView() {
  const { workspace } = useWorkspace();
  const t = useT();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [customSkills, setCustomSkills] = useState<Skill[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Load this workspace's custom skills once the workspace (and hence the
  // configured API client) is ready.
  const workspaceId = workspace?.workspaceId;
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    workspaceApi.getCustomSkills()
      .then(list => { if (!cancelled) setCustomSkills(list.map(customSkillToSkill)); })
      .catch(() => { /* non-fatal: just show the catalog */ });
    return () => { cancelled = true; };
  }, [workspaceId]);

  const handleUploaded = useCallback((created: WorkspaceCustomSkill) => {
    const skill = customSkillToSkill(created);
    setCustomSkills(prev => [skill, ...prev.filter(s => s.id !== skill.id)]);
    setActiveCategory('custom');
  }, []);

  const allSkills = useMemo(() => [...SKILLS, ...customSkills], [customSkills]);

  const filtered = useMemo(() => {
    let result = allSkills;
    if (activeCategory !== 'all') result = result.filter(s => s.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        skillDescription(t, s).toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) || s.tags.some(tag => tag.includes(q))
      );
    }
    return result;
  }, [search, activeCategory, allSkills, t]);

  const featured = useMemo(() => SKILLS.filter(s => s.featured), []);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: allSkills.length };
    for (const s of allSkills) c[s.category] = (c[s.category] || 0) + 1;
    return c;
  }, [allSkills]);

  return (
    <div className="h-full flex flex-col">
      {/* Header — title (with the catalogue size) plus search and upload. The
          count describes the catalogue, not the actions, so it belongs beside
          the title, the way the thread list carries its unread count. */}
      <DetailHeader
        // Without this the desktop shell falls back to its own plain "Skill Hub"
        // text and this title — icon and count included — is never rendered.
        titleInHeader
        title={<>
          <h2 className="text-sm font-semibold">{t('skills.title')}</h2>
          <Badge variant="outline" size="sm" shape="circle">
            {allSkills.length}
          </Badge>
        </>}
      >
        <div className="flex items-center gap-2">
          {/* Search only ever needs room for a skill name, not the page width */}
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              type="text"
              placeholder={t('skills.searchPlaceholder')}
              aria-label={t('skills.searchLabel')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 w-48 pl-8 text-xs lg:w-56"
            />
          </div>
          <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="size-3.5" />
            <span className="hidden sm:inline">{t('skills.uploadCustom')}</span>
          </Button>
        </div>
      </DetailHeader>

      {/* Filters */}
      <div className="shrink-0 px-5 py-2 border-b border-border space-y-2 md:space-y-0">
        {/* Narrow screens keep the search here — the mobile header has no room */}
        <div className="relative md:hidden">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('skills.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Category grid */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-xs">{cat.icon}</span>
              <span>{categoryLabel(t, cat.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Search className="size-8 opacity-30" />
            <p className="text-sm">{t('skills.noMatches')}</p>
            <button onClick={() => { setSearch(''); setActiveCategory('all'); }} className="text-xs text-primary hover:underline">{t('skills.clearFilters')}</button>
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {/* Featured — only when showing all */}
            {activeCategory === 'all' && !search && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Star className="size-3.5 text-amber-500 fill-amber-500" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('skills.featured')}</h3>
                </div>
                <div className={GRID_CLASS}>
                  {featured.map(skill => (
                    <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                  ))}
                </div>
              </div>
            )}

            {/* All skills */}
            <div>
              {activeCategory === 'all' && !search && (
                <div className="flex items-center gap-2 mb-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('skills.all')}</h3>
                  <span className="text-[10px] text-muted-foreground">({categoryCounts.all})</span>
                </div>
              )}
              <div className={GRID_CLASS}>
                {filtered.map(skill => (
                  <SkillCard key={skill.id} skill={skill} onSelect={setSelectedSkill} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedSkill && <SkillDetail skill={selectedSkill} onClose={() => setSelectedSkill(null)} />}
      <UploadSkillDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={handleUploaded} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload custom skill dialog
// ---------------------------------------------------------------------------

function UploadSkillDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (skill: WorkspaceCustomSkill) => void;
}) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null); setId(''); setName(''); setDescription('');
    setError(null); setSubmitting(false);
  }, []);

  const onPickFile = (f: File | null) => {
    setError(null);
    setFile(f);
    if (f) {
      setId(deriveSkillId(f.name));
      setName(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const ext = file ? file.name.toLowerCase().slice(file.name.lastIndexOf('.')) : '';
  const extOk = ext === '.md' || ext === '.zip';
  const idValid = CUSTOM_SKILL_ID_RE.test(id);
  const canSubmit = !!file && extOk && idValid && !submitting;

  const submit = async () => {
    if (!file) { setError(t('skills.uploadNoFile')); return; }
    if (!extOk) { setError(t('skills.uploadExtError')); return; }
    if (!idValid) { setError(t('skills.uploadIdErrorLong')); return; }
    setSubmitting(true);
    setError(null);
    try {
      const created = await workspaceApi.uploadCustomSkill(file, {
        id: id.trim(),
        name: name.trim() || id.trim(),
        description: description.trim(),
      });
      toast.success(t('skills.uploadSuccess', { name: created.name }));
      onUploaded(created);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('skills.uploadTitle')}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3 py-1">
          {/* File picker */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('skills.uploadPackageLabel')}
            </label>
            <label className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors">
              <Upload className="size-4 text-muted-foreground shrink-0" />
              <span className="text-xs truncate flex-1">
                {file ? file.name : t('skills.uploadChooseFile')}
              </span>
              {file && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                type="file"
                accept=".md,.zip"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
            </label>
            {file && !extOk && (
              <p className="mt-1 text-[11px] text-red-500">{t('skills.uploadExtError')}</p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('skills.uploadZipHint')}
            </p>
          </div>

          {/* Skill id */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('skills.uploadIdLabel')}</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t('skills.uploadIdPlaceholder')}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {id !== '' && !idValid && (
              <p className="mt-1 text-[11px] text-red-500">
                {t('skills.uploadIdError')}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('skills.uploadNameLabel')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('skills.uploadNamePlaceholder')}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('skills.uploadDescriptionLabel')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t('skills.uploadDescriptionPlaceholder')}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg bg-muted/50 border border-input focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
              <AlertCircle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {submitting ? t('skills.uploading') : t('skills.uploadSubmit')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
