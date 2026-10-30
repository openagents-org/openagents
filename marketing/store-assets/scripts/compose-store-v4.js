/* v4 store screenshots — every scene gets its own visual identity:
   per-scene accent + background tint, tilted device, floating stat/agent
   cards echoing the real thread content, mascot on the hero. */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EXE = process.env.CHROME_BIN;
const b64cache = {};
function dataUri(file) {
  if (!b64cache[file]) b64cache[file] = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  return b64cache[file];
}
const HOME = os.homedir();
const RAW = `${HOME}/store-assets/raw`;
const OUT = `${HOME}/store-assets/out`;
const WEB = '/mnt/lustre/airvmds001lstre/zhongyuan_zhu/.conda/packages/openagents-web/frontend/public/images';
const WORDMARK = `${WEB}/logos/openagents_wordmark_pure_white.png`;
const MASCOT = `${WEB}/mascot.png`;

const NAVY = '#0B1121';

/* floating card builders */
const card = (html, style) => ({ kind: 'white', html, style });
const chip = (html, style) => ({ kind: 'dark', html, style });
const avatar = (color, letter) => `<span class="av" style="background:${color}">${letter}</span>`;
const dot = (c = '#22c55e') => `<span class="dot" style="background:${c}"></span>`;

const SCENES = {
  hero: {
    raw: 'phone-dealer-thread.png', accent: '#16C79A', accent2: '#2F6BFF', tilt: -5, mascot: true,
    en: ['Your team + AI agents,', 'one workspace'], enSub: 'Chat, delegate and track real work — together.',
    zh: ['你的团队 + AI 智能体', '同一个工作空间'], zhSub: '对话、派活、跟进，一站完成',
    cards: (L) => [
      card(`${avatar('#8B5CF6', 'O')}<div><b>order-tracker</b><span>${dot()}${L ? '运行中 · 每日检查' : 'working · daily check'}</span></div>`, 'top:26%; left:-2%; transform:rotate(-6deg)'),
      card(`${avatar('#16C79A', 'S')}<div><b>sourcing-agent</b><span>${dot()}${L ? '报价对比已完成' : 'quote comparison ready'}</span></div>`, 'top:38%; right:-3%; transform:rotate(4deg)'),
      chip(`🕗 ${L ? 'Routine · 每天 08:00 自动运行' : 'Routine · runs daily at 08:00'}`, 'top:56%; left:-1%; transform:rotate(-3deg)'),
    ],
  },
  work: {
    raw: 'phone-dsp-thread.png', accent: '#F59E0B', accent2: '#EF4444', tilt: 4,
    en: ['Agents that do', 'real work'], enSub: 'Assign modules, run tests, fix bugs — a full engineering loop.',
    zh: ['智能体不止聊天', '还能真正干活'], zhSub: '分配模块、跑测试、修 Bug，完整研发闭环',
    cards: (L) => [
      card(`<div class="big">✅ 227/230</div><div class="cap">${L ? '回归测试通过' : 'regression tests passing'}</div>`, 'top:27%; right:-3%; transform:rotate(5deg)'),
      chip(`<code>toolchain-linker@a41f2c9</code>`, 'top:47%; left:-2%; transform:rotate(-4deg)'),
      chip(`${L ? '1 个主控 · 4 个开发智能体' : '1 master · 4 worker agents'}`, 'top:62%; right:0%; transform:rotate(3deg)'),
    ],
  },
  projects: {
    raw: 'phone-threads-list.png', accent: '#8B5CF6', accent2: '#2F6BFF', tilt: -4,
    en: ['Every project in', 'one shared space'], enSub: 'Orders, sourcing, marketing, channels — each in its own thread.',
    zh: ['所有项目', '同一个共享空间'], zhSub: '订单、采购、营销、渠道，每件事都有自己的线程',
    cards: (L) => [
      card(`📦 <b>${L ? '供应商报价 — Q3' : 'Supplier quotes — Q3'}</b>`, 'top:30%; right:-2%; transform:rotate(4deg)'),
      card(`📣 <b>${L ? '营销内容' : 'Marketing content'}</b>`, 'top:41%; right:-5%; transform:rotate(7deg)'),
      card(`🗺️ <b>${L ? '经销商地图与渠道' : 'Dealer map & channels'}</b>`, 'top:52%; right:-1%; transform:rotate(2deg)'),
    ],
  },
  control: {
    raw: 'phone-gpu-thread.png', accent: '#2F6BFF', accent2: '#16C79A', tilt: 4,
    en: ['Stay in control,', 'from anywhere'], enSub: 'Approve, redirect and monitor your agents on the go.',
    zh: ['随时随地', '掌控全局'], zhSub: '随手审批、调整方向、掌握进度',
    cards: (L) => [
      card(`<div class="big">▶</div><div><b>${L ? 'NanoSAM 蒸馏已启动' : 'NanoSAM distillation launched'}</b><span>${L ? 'GPU2+3 · 日志流式输出' : 'GPU2+3 · logs streaming'}</span></div>`, 'top:28%; left:-3%; transform:rotate(-5deg)'),
      chip(`${L ? 'GPU3 已停止 ✓ 算力已释放' : 'GPU3 stopped ✓ compute freed'}`, 'top:50%; right:-2%; transform:rotate(4deg)'),
      chip(`${L ? '你的批准 → 智能体执行' : 'you approve → agents execute'}`, 'top:63%; left:0%; transform:rotate(-3deg)'),
    ],
  },
  teams: {
    raw: 'phone-enterprise-thread.png', accent: '#22c55e', accent2: '#2F6BFF', tilt: -4,
    en: ['Built for teams —', 'startup to intranet'], enSub: 'Squads, approvals and self-hosted deployments.',
    zh: ['从小团队', '到企业内网'], zhSub: '支持私有化部署的多智能体协作平台',
    cards: (L) => [
      card(`<div class="big">41/41</div><div class="cap">${L ? '测试通过 · 审批发布' : 'tests passing · release approved'}</div>`, 'top:27%; right:-3%; transform:rotate(5deg)'),
      chip(`${dot()}${L ? '9 个智能体在线' : '9 agents online'}`, 'top:48%; left:-2%; transform:rotate(-4deg)'),
      chip(`🔒 ${L ? '私有化 · 企业内网部署' : 'self-hosted · intranet deploys'}`, 'top:61%; right:-1%; transform:rotate(3deg)'),
    ],
  },
  roles: {
    raw: 'phone-finance-thread.png', accent: '#F43F5E', accent2: '#8B5CF6', tilt: 4,
    en: ['An agent for', 'every role'], enSub: 'Analysis, research, compliance, writing — assembled in minutes.',
    zh: ['每个角色', '都有一个智能体'], zhSub: '分析、调研、合规、写作，几分钟组建团队',
    cards: (L) => [
      card(`${avatar('#8B5CF6', 'F')}<div><b>fin-analyst</b><span>${L ? '收入情景建模' : 'revenue scenarios'}</span></div>`, 'top:24%; left:-3%; transform:rotate(-6deg)'),
      card(`${avatar('#2F6BFF', 'L')}<div><b>legal-compliance</b><span>${L ? 'ADGM 合规研究' : 'ADGM regulations'}</span></div>`, 'top:36%; right:-4%; transform:rotate(5deg)'),
      card(`${avatar('#16C79A', 'W')}<div><b>writer</b><span>${L ? '商业计划书 v9' : 'business plan v9'}</span></div>`, 'top:49%; left:-1%; transform:rotate(-3deg)'),
    ],
  },
};
const ORDER = ['hero', 'work', 'projects', 'control', 'teams', 'roles'];

const TARGETS = {
  'ios-iphone': { w: 1320, h: 2868, s: 1.0 },
  'play-phone': { w: 1080, h: 1920, s: 0.72 },
};

function pageHtml(t, scene, lang) {
  const L = lang === 'zh';
  const raw = path.join(RAW, scene.raw);
  const lines = scene[lang];
  const sub = scene[`${lang}Sub`];
  const font = L ? `'Noto Sans CJK SC','Noto Sans SC',sans-serif` : `-apple-system,'Helvetica Neue',Arial,sans-serif`;
  const s = t.s;                       // scale factor vs the 1320-wide master design
  const px = (v) => Math.round(v * s); // master-design px -> target px

  const devW = px(920);
  const devTop = px(760);
  const cards = scene.cards(L).map((c) => {
    const cls = c.kind === 'white' ? 'fcard' : 'fchip';
    return `<div class="${cls}" style="${c.style}">${c.html}</div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${t.w}px; height:${t.h}px; overflow:hidden; }
  body { font-family:${font}; position:relative;
    background:
      radial-gradient(${px(1250)}px at 18% 10%, ${scene.accent}30, transparent 62%),
      radial-gradient(${px(1100)}px at 86% 72%, ${scene.accent2}2e, transparent 64%),
      ${NAVY}; }
  .dots { position:absolute; inset:0;
    background-image:radial-gradient(rgba(255,255,255,0.07) ${px(2.2)}px, transparent ${px(2.2)}px);
    background-size:${px(76)}px ${px(76)}px; }
  .head { position:absolute; left:${px(90)}px; right:${px(90)}px; top:${px(96)}px; text-align:center; z-index:3; }
  .wm { height:${px(52)}px; margin-bottom:${px(64)}px; }
  h1 { color:#fff; font-size:${px(104)}px; line-height:1.14; font-weight:800; letter-spacing:-0.015em;
    text-shadow:0 ${px(6)}px ${px(30)}px rgba(0,0,0,.45); }
  h1 .accent { color:${scene.accent}; }
  .sub { color:rgba(255,255,255,0.66); font-size:${px(44)}px; line-height:1.4; margin-top:${px(38)}px; font-weight:500; }
  .stage { position:absolute; left:50%; top:${devTop}px; transform:translateX(-50%); width:${devW}px; z-index:1; }
  .device { transform:rotate(${scene.tilt}deg); border-radius:${px(104)}px; border:${px(15)}px solid #1c2740;
    box-shadow:0 ${px(70)}px ${px(180)}px rgba(0,0,0,0.7), 0 0 0 ${px(2)}px rgba(255,255,255,0.07);
    overflow:hidden; background:#fff; }
  .device img { display:block; width:100%; }
  .mascot { position:absolute; left:${px(-190)}px; bottom:${px(-40)}px; height:${px(560)}px; z-index:2;
    filter:drop-shadow(0 ${px(20)}px ${px(40)}px rgba(0,0,0,.5)); }
  .fcard, .fchip { position:absolute; z-index:4; display:flex; align-items:center; gap:${px(18)}px;
    border-radius:${px(22)}px; white-space:nowrap; }
  .fcard { background:#fff; color:#0f172a; padding:${px(26)}px ${px(34)}px;
    border:${px(4)}px solid #0A0A0A; box-shadow:${px(12)}px ${px(12)}px 0 rgba(0,0,0,0.55);
    font-size:${px(34)}px; font-weight:700; }
  .fcard b { font-size:${px(36)}px; display:block; }
  .fcard span { display:flex; align-items:center; gap:${px(10)}px; font-size:${px(28)}px; font-weight:600; color:#64748b; margin-top:${px(4)}px; }
  .fcard .big { font-size:${px(58)}px; font-weight:800; color:${scene.accent}; -webkit-text-stroke:${px(1)}px rgba(0,0,0,.2); }
  .fcard .cap { font-size:${px(28)}px; color:#475569; font-weight:700; margin-left:${px(6)}px; }
  .fchip { background:rgba(15,23,42,0.92); color:#e2e8f0; padding:${px(20)}px ${px(30)}px;
    border:${px(2.5)}px solid rgba(255,255,255,0.22); box-shadow:0 ${px(16)}px ${px(40)}px rgba(0,0,0,0.5);
    font-size:${px(30)}px; font-weight:700; backdrop-filter:blur(4px); }
  .fchip code { font-family:ui-monospace,Menlo,monospace; font-size:${px(28)}px; color:#93c5fd; }
  .av { width:${px(56)}px; height:${px(56)}px; border-radius:50%; color:#fff; font-weight:800; font-size:${px(30)}px;
    display:flex; align-items:center; justify-content:center; border:${px(3)}px solid #0A0A0A; flex:none; }
  .dot { width:${px(16)}px; height:${px(16)}px; border-radius:50%; display:inline-block; }
  .bar { position:absolute; left:0; right:0; bottom:0; height:${px(14)}px; z-index:5;
    background:linear-gradient(90deg, ${scene.accent}, ${scene.accent2}); }
  </style></head><body>
    <div class="dots"></div>
    <div class="head">
      <img class="wm" src="${dataUri(WORDMARK)}">
      <h1>${lines[0]}<br><span class="accent">${lines[1]}</span></h1>
      <div class="sub">${sub}</div>
    </div>
    <div class="stage">
      <div class="device"><img src="${dataUri(raw)}"></div>
      ${cards}
      ${scene.mascot ? `<img class="mascot" src="${dataUri(MASCOT)}">` : ''}
    </div>
    <div class="bar"></div>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox'] });
  for (const [tname, t] of Object.entries(TARGETS)) {
    fs.mkdirSync(path.join(OUT, tname), { recursive: true });
    const page = await browser.newPage({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 1 });
    for (const lang of ['en', 'zh']) {
      for (let i = 0; i < ORDER.length; i++) {
        const scene = SCENES[ORDER[i]];
        await page.setContent(pageHtml(t, scene, lang), { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(OUT, tname, `${String(i + 1).padStart(2, '0')}-${ORDER[i]}-${lang}.png`) });
        console.log('rendered', tname, ORDER[i], lang);
      }
    }
    await page.close();
  }
  await browser.close();
  console.log('v4 done');
})().catch(e => { console.error(e); process.exit(1); });
