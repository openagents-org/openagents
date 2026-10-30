/** Render welcome imagery from the shared Workspace bundle, never copied UI.
 * Run after `npm run build:workspace` in packages/launcher.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { previewFixture } from './workspace-preview/fixture.mjs';

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.resolve(launcher, '../../workspace/frontend/dist-desktop');
const output = path.join(launcher, 'src/renderer/pages/welcome/assets');
if (!fs.existsSync(path.join(bundle, 'index.html'))) throw Error('Build the desktop Workspace bundle first.');
fs.mkdirSync(output, { recursive: true });
let fixture = previewFixture('en');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/v1/')) {
    if (url.pathname === '/v1/events/stream') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write(': preview\n\n'); return; }
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ data:fixture.response(url,req.method) })); return;
  }
  const file = path.resolve(bundle, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(bundle + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404);res.end();return; }
  res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://localhost:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless:true });
  for (const locale of ['en','zh']) {
    fixture = previewFixture(locale);
    for (const theme of ['light','dark']) {
      const context = await browser.newContext({viewport:{width:1120,height:780}, deviceScaleFactor:2, colorScheme:theme, locale:locale==='zh'?'zh-CN':'en-US'});
      // Block every external request, including analytics. All content is synthetic.
      await context.route('**/*', route=>new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(({theme,locale})=>{
        window.__OA_API_URL__ = location.origin;
        localStorage.setItem('theme',theme);
        localStorage.setItem('oa_locale',locale === 'zh'?'zh-CN':'en-US');
        document.cookie = `oa_locale=${locale === 'zh'?'zh-CN':'en-US'};path=/`;
        localStorage.setItem('oa_workspace_session',JSON.stringify({token:'preview-only',email:'alex@example.invalid',displayName:'Alex',expiresAt:Math.floor(Date.now()/1000)+3600}));
      },{theme,locale});
      const page = await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${origin}/#/preview?token=preview-only`);
      await page.getByRole('heading',{name:fixture.copy.threads[0],exact:true}).waitFor();
      await page.getByText(fixture.copy.codex.split('\n\n')[1],{exact:true}).waitFor();
      await page.evaluate(()=>document.fonts.ready);
      if (errors.length) throw Error(errors.join('\n'));
      await page.screenshot({path:path.join(output,`workspace-${locale}-${theme}.png`),animations:'disabled'});
      console.log(`Rendered ${locale} ${theme} preview from shared Workspace components.`);
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
