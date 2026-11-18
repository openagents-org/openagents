'use client';

import { ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';

const SI = 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons';
const SENSENOVA = 'https://avatars.githubusercontent.com/u/215225587';
const SKILL_LOGOS: Record<string, { name: string; logo: string }> = {
  'claude-api': { name: 'Claude API', logo: `${SI}/anthropic.svg` },
  'openai-sdk': { name: 'OpenAI SDK', logo: `${SI}/openai.svg` },
  'langchain': { name: 'LangChain', logo: `${SI}/langchain.svg` },
  'mcp-builder': { name: 'MCP Builder', logo: `${SI}/anthropic.svg` },
  'skill-creator': { name: 'Skill Creator', logo: `${SI}/anthropic.svg` },
  'ai-sdk': { name: 'Vercel AI SDK', logo: `${SI}/vercel.svg` },
  'nextjs': { name: 'Next.js', logo: `${SI}/nextdotjs.svg` },
  'angular': { name: 'Angular', logo: `${SI}/angular.svg` },
  'vue': { name: 'Vue.js', logo: `${SI}/vuedotjs.svg` },
  'svelte': { name: 'Svelte', logo: `${SI}/svelte.svg` },
  'tailwindcss': { name: 'Tailwind CSS', logo: `${SI}/tailwindcss.svg` },
  'frontend-design': { name: 'Frontend Design', logo: `${SI}/anthropic.svg` },
  'fastapi': { name: 'FastAPI', logo: `${SI}/fastapi.svg` },
  'django': { name: 'Django', logo: `${SI}/django.svg` },
  'graphql': { name: 'GraphQL', logo: `${SI}/graphql.svg` },
  'postgresql': { name: 'PostgreSQL', logo: `${SI}/postgresql.svg` },
  'mongodb': { name: 'MongoDB', logo: `${SI}/mongodb.svg` },
  'redis': { name: 'Redis', logo: `${SI}/redis.svg` },
  'prisma': { name: 'Prisma', logo: `${SI}/prisma.svg` },
  'supabase': { name: 'Supabase', logo: `${SI}/supabase.svg` },
  'firebase': { name: 'Firebase', logo: `${SI}/firebase.svg` },
  'github-actions': { name: 'GitHub Actions', logo: `${SI}/githubactions.svg` },
  'sentry': { name: 'Sentry', logo: `${SI}/sentry.svg` },
  'jest': { name: 'Jest', logo: `${SI}/jest.svg` },
  'pytest': { name: 'pytest', logo: `${SI}/pytest.svg` },
  'cypress': { name: 'Cypress', logo: `${SI}/cypress.svg` },
  'stripe': { name: 'Stripe', logo: `${SI}/stripe.svg` },
  'notion': { name: 'Notion', logo: `${SI}/notion.svg` },
  'jira': { name: 'Jira', logo: `${SI}/jira.svg` },
  'shopify': { name: 'Shopify', logo: `${SI}/shopify.svg` },
  'zapier': { name: 'Zapier', logo: `${SI}/zapier.svg` },
  'docx': { name: 'Word Documents', logo: `${SI}/microsoftword.svg` },
  'xlsx': { name: 'Spreadsheets', logo: `${SI}/microsoftexcel.svg` },
  'pptx': { name: 'Presentations', logo: `${SI}/microsoftpowerpoint.svg` },
  'pdf': { name: 'PDF Processing', logo: `${SI}/adobeacrobatreader.svg` },
  'sn-deep-research': { name: 'SenseNova Deep Research', logo: SENSENOVA },
  'sn-infographic': { name: 'SenseNova Infographic', logo: SENSENOVA },
  'sn-ppt-entry': { name: 'SenseNova PPT', logo: SENSENOVA },
  'sn-da-excel-workflow': { name: 'SenseNova Excel Analysis', logo: SENSENOVA },
  'sn-image-base': { name: 'SenseNova Image Gen', logo: SENSENOVA },
  'sn-md-to-html-report': { name: 'SenseNova HTML Report', logo: SENSENOVA },
};

const skillSource = (skillId: string) =>
  `https://github.com/${skillId.includes('-') ? 'TerminalSkills/skills/tree/main/skills/' : 'anthropics/skills/tree/main/skills/'}${skillId}`;

/** The skills installed on the agent, each linking to its source. */
export function InstalledSkillsCard({ agent }: { agent: WorkspaceAgent }) {
  const t = useT();
  const installed: string[] = (agent.enabledSkills as Record<string, unknown>)?.installed as string[] || [];
  if (installed.length === 0) return null;
  return (
    <Card size="sm" className="gap-0 overflow-visible rounded-none border-b bg-transparent py-5 ring-0">
      <CardHeader className="flex items-center gap-1.5 px-0 pb-3 pt-0">
        <Sparkles className="size-3 text-warning" />
        <span className="text-sm font-medium">{t('agents.installedSkills')}</span>
        <span className="ml-auto text-xs text-muted-foreground">{installed.length}</span>
      </CardHeader>
      <CardContent className="px-1.5 py-1.5">
        <ItemGroup className="gap-0">
          {installed.map((skillId) => {
            const info = SKILL_LOGOS[skillId];
            return (
              <Item key={skillId} size="xs">
                <ItemMedia className="size-6 rounded bg-muted/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {info ? <img src={info.logo} alt="" className="size-3.5 object-contain dark:invert" /> : <Sparkles className="size-3 text-muted-foreground" />}
                </ItemMedia>
                <ItemContent><ItemTitle className="truncate">{info?.name || skillId}</ItemTitle></ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground" asChild>
                    <a href={skillSource(skillId)} target="_blank" rel="noopener noreferrer" aria-label={info?.name || skillId}>
                      <ExternalLink />
                    </a>
                  </Button>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
