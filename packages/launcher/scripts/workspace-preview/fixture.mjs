// Synthetic content for images rendered from the actual Workspace app.
// No real account, API token, conversation, or remote service is used.
export function previewFixture(locale) {
  const zh = locale === 'zh';
  const now = Date.now();
  const copy = zh ? {
    workspace: '设计工作室', threads: ['网站发布', '客户调研', '本周计划'],
    request: '@Claude @Codex 帮我准备周五的网站发布。Claude 负责文案，Codex 检查实现。',
    claude: '首页文案已经更新，重点放在我们能为用户解决的问题上。\n\n**文案已准备好**\n- 更简洁的标题和介绍\n- 更清楚的产品价值\n- 一致的行动按钮文案',
    codex: '页面已经更新，移动端布局和注册流程也检查过了。\n\n预览已就绪，可以开始审核。',
    previews: ['预览已就绪，可以开始审核。', '整理了 8 条关键反馈。', '三个优先事项已经排好。'],
  } : {
    workspace: 'Design studio', threads: ['Website launch', 'Customer research', 'This week'],
    request: '@Claude @Codex Let’s get the website ready for Friday. Claude, refine the copy. Codex, check the implementation.',
    claude: 'I’ve updated the homepage copy to focus on what people can do with the product.\n\n**Ready for review**\n- A clearer headline and introduction\n- Three concise product benefits\n- Consistent calls to action',
    codex: 'The page is updated. I’ve checked the mobile layout and sign-up flow.\n\nThe preview is ready for your review.',
    previews: ['The preview is ready for your review.', 'I found 8 recurring themes in the feedback.', 'Three priorities, ready to work through.'],
  };
  const agents = ['claude', 'codex'].map(name => ({
    address: `openagents:${name}`, display_name: name === 'claude' ? 'Claude' : 'Codex',
    role: 'member', status: 'online', agent_type: name, server_host: 'This Computer',
    working_dir: null, description: name === 'claude' ? 'Writing, research, and clear communication.' : 'Implementation, testing, and code review.', enabled_skills: {}, model: null,
    last_heartbeat_at: new Date(now).toISOString(), joined_at: new Date(now - 86400000).toISOString(),
  }));
  const channels = copy.threads.map((title, i) => ({
    address: `channel/preview-${i}`, title, master: null, participants: ['claude', 'codex'],
    created_at: now - 86400000, last_event_at: now - i * 3600000, status: 'active', starred: i === 0,
  }));
  const event = (i, source, content) => ({
    id: `preview-message-${i}`, type: 'workspace.message.posted', source,
    target: 'channel/preview-0', timestamp: now - (3 - i) * 60000,
    payload: { content, sender_name: source.startsWith('human:') ? 'Alex' : source.slice(11), sender_id: source.slice(source.indexOf(':') + 1), mentions: i === 0 ? ['claude','codex'] : [] },
    metadata: {}, visibility: 'channel',
  });
  const messages = [event(0, 'human:alex@example.invalid', copy.request), event(1, 'openagents:claude', copy.claude), event(2, 'openagents:codex', copy.codex)];
  const workspace = { workspaceId:'preview', slug:'preview', name:copy.workspace, creatorEmail:'alex@example.invalid', requireLogin:false, settings:{}, browserfabricApiKey:null, status:'active', createdAt:new Date(now).toISOString(), lastActivityAt:new Date(now).toISOString(), agents:[] };
  return {
    copy,
    response(url, method) {
      const p = url.pathname;
      if (p.includes('/campaign')) return { enabled:false };
      if (p === '/v1/account/workspaces') return [{...workspace, token:'preview-only', role:'owner'}];
      if (p === '/v1/workspaces/preview') return workspace;
      if (p.endsWith('/me')) return { email:'alex@example.invalid', displayName:'Alex', authenticated:true, role:'owner', effectiveRole:'owner', tokenAccess:true };
      if (p.endsWith('/team')) return [{ email:'alex@example.invalid', displayName:'Alex', avatarUrl:null, role:'owner' }];
      if (p === '/v1/discover') return { agents, channels, mods:[], resources:[] };
      if (p === '/v1/events/latest-per-channel') return { channels:Object.fromEntries(channels.map((c,i)=>[c.address.slice(8), event(i,'openagents:codex',copy.previews[i])])) };
      if (p === '/v1/events/conversations') return { conversations:[] };
      if (p === '/v1/events' && method === 'POST') return { id:'preview-presence', timestamp:now, metadata:{} };
      if (p === '/v1/events') {
        const rows = url.searchParams.get('type') === 'workspace.user' || url.searchParams.has('after') ? [] : messages;
        return { events:url.searchParams.get('sort') === 'desc' ? [...rows].reverse() : rows, has_more:false, oldest_id:rows[0]?.id ?? null, newest_id:rows.at(-1)?.id ?? null };
      }
      if (p === '/v1/account/profile') return { email:'alex@example.invalid',displayName:'Alex',avatarUrl:null,welcomeSeen:true };
      if (p === '/v1/agent-catalog') return [];
      return { files:[], entries:[], tabs:[], contexts:[], todos:[], tasks:[], workflows:[], routines:[], notifications:[], unreadCount:0, total:0, channels:{}, nodes:[] };
    },
  };
}
