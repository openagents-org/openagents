/* Renders App Store / Play screenshots: brand background + caption + device-framed
   product capture, at exact store pixel sizes. Run with playwright-core from the
   launcher package dir. */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EXE = process.env.CHROME_BIN;
/* setContent pages are about:blank — file:// subresources are blocked, so
   images are inlined as data URIs. */
const b64cache = {};
function dataUri(file) {
  if (!b64cache[file]) b64cache[file] = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  return b64cache[file];
}
const HOME = os.homedir();
const RAW = `${HOME}/store-assets/raw`;
const OUT = `${HOME}/store-assets/out`;
const WORDMARK = '/mnt/lustre/airvmds001lstre/zhongyuan_zhu/.conda/packages/openagents-web/frontend/public/images/logos/openagents_wordmark_pure_white.png';

const NAVY = '#0B1121';
const TEAL = '#16C79A';
const BLUE = '#2F6BFF';

/* scene key -> raw file + captions */
const SCENES = {
  hero:      { phone: 'phone-dealer-thread.png',  tablet: 'tablet-dealer-thread.png',
    en: ['Your team + AI agents,', 'one workspace'], enSub: 'Chat, delegate and track real work — together.',
    zh: ['你的团队 + AI 智能体', '同一个工作空间'], zhSub: '对话、派活、跟进，一站完成' },
  work:      { phone: 'phone-dsp-thread.png',      tablet: 'tablet-dsp-thread.png',
    en: ['Agents that do', 'real work'], enSub: 'Assign modules, run tests, fix bugs — a full engineering loop.',
    zh: ['智能体不止聊天', '还能真正干活'], zhSub: '分配模块、跑测试、修 Bug，完整研发闭环' },
  projects:  { phone: 'phone-threads-list.png',    tablet: 'tablet-projects.png',
    en: ['Every project in', 'one shared space'], enSub: 'Orders, sourcing, marketing, channels — each in its own thread.',
    zh: ['所有项目', '同一个共享空间'], zhSub: '订单、采购、营销、渠道，每件事都有自己的线程' },
  control:   { phone: 'phone-gpu-thread.png',      tablet: 'tablet-gpu-thread.png',
    en: ['Stay in control,', 'from anywhere'], enSub: 'Approve, redirect and monitor your agents on the go.',
    zh: ['随时随地', '掌控全局'], zhSub: '随手审批、调整方向、掌握进度' },
  teams:     { phone: 'phone-enterprise-thread.png', tablet: 'tablet-enterprise-thread.png',
    en: ['Built for teams —', 'startup to intranet'], enSub: 'Squads, approvals and self-hosted deployments.',
    zh: ['从小团队', '到企业内网'], zhSub: '支持私有化部署的多智能体协作平台' },
  roles:     { phone: 'phone-finance-thread.png',  tablet: 'tablet-finance-thread.png',
    en: ['An agent for', 'every role'], enSub: 'Analysis, research, compliance, writing — assembled in minutes.',
    zh: ['每个角色', '都有一个智能体'], zhSub: '分析、调研、合规、写作，几分钟组建团队' },
};
const ORDER = ['hero', 'work', 'projects', 'control', 'teams', 'roles'];

/* target sets: canvas size + layout numbers */
const TARGETS = {
  'ios-iphone': { w: 1320, h: 2868, kind: 'phone',  h1: 100, sub: 44, wordH: 52, pad: 100, devW: 1010, devTop: 700, radius: 110, border: 16 },
  'play-phone': { w: 1080, h: 1920, kind: 'phone',  h1: 76,  sub: 34, wordH: 40, pad: 76,  devW: 740,  devTop: 520, radius: 84,  border: 13 },
  'ios-ipad':   { w: 2064, h: 2752, kind: 'tablet', h1: 128, sub: 52, wordH: 62, pad: 130, devW: 1800, devTop: 1000, radius: 56,  border: 20 },
};

function pageHtml(t, scene, lang) {
  const isTablet = t.kind === 'tablet';
  const raw = path.join(RAW, isTablet ? scene.tablet : scene.phone);
  const lines = isTablet && scene[`tablet${lang === 'en' ? 'En' : 'Zh'}`]
    ? scene[`tablet${lang === 'en' ? 'En' : 'Zh'}`]
    : scene[lang];
  const sub = isTablet && scene[`tablet${lang === 'en' ? 'En' : 'Zh'}Sub`]
    ? scene[`tablet${lang === 'en' ? 'En' : 'Zh'}Sub`]
    : scene[`${lang}Sub`];
  const font = lang === 'zh'
    ? `'Noto Sans CJK SC','Noto Sans SC',sans-serif`
    : `-apple-system,'Helvetica Neue',Arial,sans-serif`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${t.w}px; height:${t.h}px; overflow:hidden; }
  body { background:${NAVY}; font-family:${font}; position:relative; }
  .glow { position:absolute; left:50%; top:${t.devTop + 300}px; transform:translateX(-50%);
    width:${t.devW * 1.5}px; height:${t.devW * 1.5}px; border-radius:50%;
    background:radial-gradient(circle, rgba(47,107,255,0.28) 0%, rgba(22,199,154,0.10) 45%, transparent 70%); }
  .dots { position:absolute; inset:0;
    background-image:radial-gradient(rgba(255,255,255,0.06) 2.2px, transparent 2.2px);
    background-size:76px 76px; }
  .head { position:absolute; left:${t.pad}px; right:${t.pad}px; top:${t.pad}px; text-align:center; }
  .wm { height:${t.wordH}px; margin-bottom:${Math.round(t.h1 * 0.7)}px; }
  h1 { color:#fff; font-size:${t.h1}px; line-height:1.16; font-weight:800; letter-spacing:-0.01em; }
  h1 .accent { color:${TEAL}; }
  .sub { color:rgba(255,255,255,0.62); font-size:${t.sub}px; line-height:1.4; margin-top:${Math.round(t.sub * 0.9)}px; font-weight:500; }
  .device { position:absolute; left:50%; transform:translateX(-50%); top:${t.devTop}px;
    width:${t.devW}px; border-radius:${t.radius}px; border:${t.border}px solid #1c2740;
    box-shadow:0 60px 160px rgba(0,0,0,0.65), 0 0 0 2px rgba(255,255,255,0.06); overflow:hidden; background:#fff; }
  .device img { display:block; width:100%; }
  .bar { position:absolute; left:0; right:0; bottom:0; height:${Math.round(t.border * 0.8)}px; background:linear-gradient(90deg, ${BLUE}, ${TEAL}); }
  </style></head><body>
    <div class="glow"></div><div class="dots"></div>
    <div class="head">
      <img class="wm" src="${dataUri(WORDMARK)}">
      <h1>${lines[0]}<br><span class="accent">${lines[1]}</span></h1>
      <div class="sub">${sub}</div>
    </div>
    <div class="device"><img src="${dataUri(raw)}"></div>
  </body></html>`;
}

function featureHtml(lang) {
  const font = lang === 'zh' ? `'Noto Sans CJK SC',sans-serif` : `-apple-system,'Helvetica Neue',Arial,sans-serif`;
  const title = lang === 'zh' ? 'AI 智能体协作平台' : 'The collaboration OS<br>for AI agents';
  const sub = lang === 'zh' ? '你的团队 + AI 智能体，同一个工作空间' : 'Your team + AI agents, one workspace';
  // constellation, kept away from edges (Play crops edges on some surfaces)
  let nodes = '';
  const cx = 800, cy = 250, pts = [];
  for (let i = 0; i < 7; i++) {
    const a = (Math.PI * 2 * i) / 7 + 0.5;
    pts.push([cx + Math.cos(a) * 120, cy + Math.sin(a) * 95]);
  }
  let lines = pts.map(([x, y]) => `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>`).join('');
  let circles = pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="11" fill="${i % 2 ? TEAL : BLUE}"/>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1024px; height:500px; overflow:hidden; }
  body { background:${NAVY}; font-family:${font}; position:relative; }
  .dots { position:absolute; inset:0; background-image:radial-gradient(rgba(255,255,255,0.06) 1.8px, transparent 1.8px); background-size:56px 56px; }
  .left { position:absolute; left:84px; top:0; bottom:0; display:flex; flex-direction:column; justify-content:center; }
  .wm { height:52px; width:auto; align-self:flex-start; margin-bottom:34px; }
  h1 { color:#fff; font-size:56px; line-height:1.15; font-weight:800; }
  .sub { color:rgba(255,255,255,0.65); font-size:24px; margin-top:18px; }
  .bar { position:absolute; left:0; right:0; bottom:0; height:10px; background:linear-gradient(90deg, ${BLUE}, ${TEAL}); }
  </style></head><body>
  <div class="dots"></div>
  <svg style="position:absolute;right:0;top:0" width="1024" height="500">${lines}${circles}
    <rect x="${cx - 26}" y="${cy - 26}" width="52" height="52" rx="10" fill="#fff"/>
    <circle cx="${cx}" cy="${cy - 5}" r="9" fill="${NAVY}"/><rect x="${cx - 13}" y="${cy + 8}" width="26" height="7" rx="3.5" fill="${NAVY}"/>
  </svg>
  <div class="left"><img class="wm" src="${dataUri(WORDMARK)}"><h1>${title}</h1><div class="sub">${sub}</div></div>
  <div class="bar"></div>
  </body></html>`;
}

(async () => {
  for (const dir of ['ios-iphone', 'ios-ipad', 'play-phone', 'play-graphics']) {
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  }
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox'] });

  for (const [tname, t] of Object.entries(TARGETS)) {
    const page = await browser.newPage({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: 1 });
    for (const lang of ['en', 'zh']) {
      for (let i = 0; i < ORDER.length; i++) {
        const scene = SCENES[ORDER[i]];
        await page.setContent(pageHtml(t, scene, lang), { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        const out = path.join(OUT, tname, `${String(i + 1).padStart(2, '0')}-${ORDER[i]}-${lang}.png`);
        await page.screenshot({ path: out });
        console.log('rendered', tname, ORDER[i], lang);
      }
    }
    await page.close();
  }

  const fg = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  for (const lang of ['en', 'zh']) {
    await fg.setContent(featureHtml(lang), { waitUntil: 'networkidle' });
    await fg.waitForTimeout(350);
    await fg.screenshot({ path: path.join(OUT, 'play-graphics', `feature-graphic-${lang}.png`) });
    console.log('rendered feature graphic', lang);
  }
  await browser.close();
  console.log('all done');
})().catch(e => { console.error(e); process.exit(1); });
