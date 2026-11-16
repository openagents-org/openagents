import type { Skill } from './skill-types';

/**
 * The static catalogue: a compatibility fallback while older backends without
 * the Registry roll forward, and the source of logos/tags for upstream
 * pointers. Descriptions live in the message catalogue (`skills.catalog.<id>`).
 */
const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';

export const SKILLS: Skill[] = [
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

export function findBuiltinSkill(id: string): Skill | undefined {
  return SKILLS.find(skill => skill.id === id);
}
