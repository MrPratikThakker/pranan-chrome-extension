import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'store-assets', 'v0.8.67');
const sourceDir = path.join(outputDir, 'source');

const COLORS = {
  ink: '#09090b',
  twilight: '#0e0a1f',
  text: '#fafafa',
  muted: 'rgba(250,250,250,.58)',
  accent: '#a78bfa',
  accentBright: '#c4b5fd',
  accentDeep: '#6d28d9',
  line: 'rgba(196,181,253,.18)',
  gmailText: '#202124',
  gmailBorder: '#e3e6ea',
};

async function dataUrl(file, mime) {
  const bytes = await fs.readFile(path.join(sourceDir, file));
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

const [interFont, serifFont, serifItalicFont, monoFont, logoFull] = await Promise.all([
  dataUrl('inter-300-900-latin.woff2', 'font/woff2'),
  dataUrl('instrument-serif-400-latin.woff2', 'font/woff2'),
  dataUrl('instrument-serif-400-italic-latin.woff2', 'font/woff2'),
  dataUrl('jetbrains-mono-400-500-latin.woff2', 'font/woff2'),
  dataUrl('logo-full.svg', 'image/svg+xml'),
]);

const mark = (size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <defs><linearGradient id="g${size}" x1="0" y1="0" x2="40" y2="40"><stop stop-color="#e0d4fc"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs>
  <circle cx="20" cy="20" r="11" stroke="url(#g${size})" stroke-width="3"/><circle cx="20" cy="20" r="5" fill="url(#g${size})"/>
</svg>`;

const mic = (active = false) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>${active ? '<circle cx="19" cy="5" r="3" fill="#a78bfa"/>' : ''}</svg>`;
const arrow = () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function pageCss(width, height) {
  return `
    @font-face{font-family:Inter;src:url('${interFont}') format('woff2');font-weight:300 900}
    @font-face{font-family:Instrument Serif;src:url('${serifFont}') format('woff2');font-weight:400;font-style:normal}
    @font-face{font-family:Instrument Serif;src:url('${serifItalicFont}') format('woff2');font-weight:400;font-style:italic}
    @font-face{font-family:JetBrains Mono;src:url('${monoFont}') format('woff2');font-weight:400 500}
    *{box-sizing:border-box}html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}body{font-family:Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}
    .stage{position:relative;width:100%;height:100%;overflow:hidden;color:${COLORS.text};background:radial-gradient(700px 520px at 91% 6%,rgba(167,139,250,.18),transparent 67%),linear-gradient(145deg,${COLORS.twilight} 0%,${COLORS.ink} 64%,#08080a 100%)}
    .stage:after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,#e0d4fc,${COLORS.accent},${COLORS.accentDeep});opacity:.65}
    .grid{position:absolute;inset:0;background-image:linear-gradient(${COLORS.line} 1px,transparent 1px),linear-gradient(90deg,${COLORS.line} 1px,transparent 1px);background-size:64px 64px;opacity:.12;mask-image:linear-gradient(90deg,transparent,black 60%,black)}
    .brand{position:absolute;left:58px;top:45px;z-index:2;width:180px;height:36px}.brand img{width:180px;height:36px;object-fit:contain;object-position:left center}
    .story{position:absolute;left:58px;top:151px;width:390px;z-index:2}.label{font:500 12px/1 JetBrains Mono,monospace;letter-spacing:.14em;text-transform:uppercase;color:${COLORS.accentBright}}
    h1{margin:20px 0 0;font:400 55px/.98 Instrument Serif,Georgia,serif;letter-spacing:-.025em;color:${COLORS.text}}h1 em{font-style:italic;color:#e0d4fc}
    .lede{margin:23px 0 0;max-width:350px;font-size:16px;line-height:1.55;color:${COLORS.muted}}
    .proof{display:flex;gap:9px;margin-top:27px;flex-wrap:wrap}.proof span{font:500 10px/1 JetBrains Mono,monospace;letter-spacing:.04em;color:${COLORS.accentBright};border:1px solid rgba(196,181,253,.24);border-radius:999px;padding:8px 10px;background:rgba(167,139,250,.06)}
    .product{position:absolute;z-index:2;right:48px;top:54px;width:744px;height:692px;border:1px solid rgba(255,255,255,.12);border-radius:19px;background:#fff;box-shadow:0 36px 90px rgba(0,0,0,.36);overflow:hidden}
    .chrome{height:42px;display:flex;align-items:center;gap:7px;padding:0 16px;background:#f8f7fa;border-bottom:1px solid #ebe8ee}.chrome i{width:9px;height:9px;border-radius:50%;background:#d5d1da}.chrome .url{height:24px;flex:1;margin-left:9px;border-radius:6px;background:#eeecf1;color:#8b8790;font-size:10px;display:flex;align-items:center;padding:0 10px}
    .gmail-head{height:54px;display:flex;align-items:center;gap:17px;padding:0 20px;border-bottom:1px solid #eceff1;color:#3c4043}.gmail-g{font-weight:700}.search{height:34px;flex:1;border-radius:9px;background:#f1f3f4;color:#8b8d91;font-size:11px;display:flex;align-items:center;padding:0 14px}.avatar{width:26px;height:26px;border-radius:50%;background:#eadfff;color:#6d28d9;display:grid;place-items:center;font-weight:700;font-size:11px}
    .mail{position:relative;height:596px;background:#fff;color:${COLORS.gmailText};padding:24px 28px}.mail .subject{font-size:21px;font-weight:650}.sender{display:flex;align-items:center;gap:10px;margin-top:19px;font-size:12px}.sender .avatar{width:34px;height:34px}.sender span{display:block;color:#777;font-size:10px;margin-top:2px}.message{margin:20px 0 0 44px;max-width:550px;color:#3c4043;font-size:13px;line-height:1.55}
    .compose{position:absolute;left:28px;right:28px;bottom:21px;height:310px;border:1px solid #dfe1e5;border-radius:12px;box-shadow:0 3px 12px rgba(60,64,67,.13);overflow:hidden;background:#fff}.compose-head{height:39px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #edf0f2;color:#4a4d52;font-size:11px}.compose-head span{flex:1}.tools{height:37px;display:flex;align-items:center;gap:15px;padding:0 13px;border-bottom:1px solid #edf0f2;color:#0b6b68;font-size:10px;font-weight:650}.editor{height:151px;padding:15px;font-size:12px;line-height:1.55;color:#3c4043}
    .rail-wrap{height:39px;padding:2px 10px 3px}.rail{height:34px;display:flex;align-items:center;gap:7px;padding:0 5px 0 9px;border:1px solid ${COLORS.gmailBorder};border-radius:10px;background:#fff;color:${COLORS.gmailText};box-shadow:0 1px 2px rgba(60,64,67,.06);font-size:11px}.rail .prompt{flex:1;color:#6b7280}.rail .action{width:27px;height:27px;border-radius:8px;display:grid;place-items:center;color:#5f6368}.rail .go{color:#fff;background:#6d28d9}.rail .dismiss{width:18px;color:#9aa0a6}.footer{height:44px;display:flex;align-items:center;gap:13px;padding:5px 13px;border-top:1px solid #f0f1f2}.send{padding:8px 20px;border-radius:18px;color:#fff;background:#0b57d0;font-size:11px;font-weight:700}.footer-icons{font-size:13px;letter-spacing:7px;color:#687079}
    .panel-shell{display:grid;grid-template-columns:320px 1fr;height:650px;background:#f8f7fa}.panel{background:#fff;border-right:1px solid #e8e5ed;padding:0 14px 14px;color:#17131d}.panel-top{height:51px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #edeaf1;margin:0 -14px;padding:0 14px}.panel-top strong{font-size:13px;flex:1}.tiny-badge{font:500 9px/1 JetBrains Mono,monospace;color:#78717f;border:1px solid #e1dde7;border-radius:5px;padding:5px 7px}
    .hero-card{margin-top:13px;padding:11px;border:1px solid #eadfff;border-radius:10px;background:#fbf9ff;display:flex;gap:9px}.hero-icon{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;background:#f0e9ff;color:#6d28d9}.hero-card b{font-size:12px}.hero-card p{margin:3px 0 0;font-size:9px;color:#807989}.contact{margin-top:10px;padding:12px;border:1px solid #e6e2e9;border-radius:10px;background:#fff}.contact-row{display:flex;align-items:center;gap:9px}.contact-row .avatar{width:37px;height:37px;border-radius:9px}.contact b{display:block;font-size:13px}.contact small{color:#88818f;font-size:9px}.summary{margin-top:9px;border-radius:8px;background:#f8f7fa;padding:9px;font-size:9px;line-height:1.5;color:#625d68}.health{margin-top:8px;display:flex;align-items:center;justify-content:space-between;font-size:9px;color:#7c7582}.client{border:1px solid #a7e7ce;background:#edfff7;color:#16835e;border-radius:5px;padding:3px 6px;font-weight:650}
    .section-title{margin:11px 0 6px;font-size:9px;color:#766f7d;font-weight:600}.outcomes{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.outcome{min-height:42px;border:1px solid #e5e1e8;border-radius:6px;padding:7px;background:#fff;color:#514b58;font-size:9px;text-align:left}.outcome.active{border-color:#bba7ee;background:#faf7ff;color:#6d28d9}.prompt-box{margin-top:9px;border:1px solid #e4e0e8;border-radius:9px;padding:9px;height:82px;color:#a19ba7;font-size:10px}.prompt-bottom{display:flex;justify-content:space-between;align-items:center;margin-top:28px;color:#7c3aed}.tone-row{display:flex;gap:7px;margin-top:8px}.tone{height:35px;padding:0 8px;border:1px solid #e2dee6;border-radius:7px;background:#fff;color:#5d5764;font-size:9px}.draft{flex:1;border:0;border-radius:7px;background:#6d28d9;color:#fff;font-size:10px;font-weight:700}
    .context-canvas{padding:36px;color:#312d37}.context-canvas .quote{font:italic 30px/1.12 Instrument Serif,Georgia,serif;color:#4d3d65}.context-canvas p{margin-top:15px;font-size:12px;line-height:1.55;color:#77717d}.metric{margin-top:31px;border-top:1px solid #e4e0e8;padding-top:20px;display:flex;gap:27px}.metric strong{font:400 31px/1 Instrument Serif,serif;color:#6d28d9}.metric span{display:block;margin-top:5px;font-size:9px;color:#8b8590}
  `;
}

function shell(content, width = 1280, height = 800) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss(width,height)}</style></head><body>${content}</body></html>`;
}

function stage({ label, title, italic, lede, proof, product }) {
  return shell(`<main class="stage"><div class="grid"></div><div class="brand"><img src="${logoFull}" alt="Pranan"></div><section class="story"><div class="label">// ${label}</div><h1>${title}<br><em>${italic}</em></h1><p class="lede">${lede}</p><div class="proof">${proof.map(item => `<span>${item}</span>`).join('')}</div></section><section class="product">${product}</section></main>`);
}

function gmailFrame(inner) {
  return `<div class="chrome"><i></i><i></i><i></i><div class="url">mail.google.com</div></div><div class="gmail-head"><span class="gmail-g">Gmail</span><div class="search">Search mail</div><div class="avatar">PT</div></div>${inner}`;
}

function rail(prompt, options = {}) {
  const active = options.active ? 'style="border-color:#a78bfa;box-shadow:0 0 0 3px rgba(124,58,237,.08)"' : '';
  return `<div class="rail" ${active}>${mark(18)}<span class="prompt" ${options.value ? 'style="color:#343039"' : ''}>${prompt}</span><span class="action">${mic(options.voice)}</span><span class="action go">${arrow()}</span><span class="dismiss">×</span></div>`;
}

function composeProduct({ reply = true, editor = '', prompt = 'Reply in your voice', active = false }) {
  return gmailFrame(`<div class="mail"><div class="subject">Project proposal</div><div class="sender"><div class="avatar">AM</div><div><b>Alex Morgan</b><span>Founder, Northstar</span></div></div><div class="message">Can you confirm the scope, timing, and cost by Friday?</div><div class="compose"><div class="compose-head"><span>${reply ? 'Reply to Alex Morgan' : 'New message'}</span>⌄</div><div class="tools">Write with Breeze&nbsp;&nbsp; Templates&nbsp;&nbsp; Meetings&nbsp;&nbsp; More</div><div class="editor">${editor}</div><div class="rail-wrap">${rail(prompt,{active,value:active})}</div><div class="footer"><span class="send">Send</span><span class="footer-icons">A  ⎘  ♡</span></div></div></div>`);
}

function sidePanelProduct(mode = 'context') {
  const activeVoice = mode === 'voice';
  const prompt = activeVoice ? 'Confirm Friday and keep it concise.' : '';
  return `<div class="chrome"><i></i><i></i><i></i><div class="url">Pranan in Gmail</div></div><div class="panel-shell"><aside class="panel"><div class="panel-top">${mark(23)}<strong>Pranan</strong><span class="tiny-badge">GMAIL</span></div><div class="hero-card"><div class="hero-icon">✎</div><div><b>Reply in your voice</b><p>With context for Alex Morgan</p></div></div><div class="contact"><div class="contact-row"><div class="avatar">AM</div><div><b>Alex Morgan</b><small>Founder at Northstar</small></div></div><div class="summary">Warm client relationship. Prefers concise updates with a clear next step.</div><div class="health"><span class="client">Client</span><span>Relationship 88 / 100</span></div></div><div class="section-title">Start with an outcome</div><div class="outcomes"><button class="outcome">Acknowledge</button><button class="outcome active">Answer directly</button><button class="outcome">Clarify</button></div><div class="prompt-box" ${activeVoice ? 'style="border-color:#a78bfa;box-shadow:0 0 0 3px rgba(124,58,237,.08);color:#3f3945"' : ''}>${prompt || 'Add guidance, or draft from this thread'}<div class="prompt-bottom"><span>${mic(activeVoice)} ${activeVoice ? 'Listening…' : 'Dictate'}</span><span>↵</span></div></div><div class="tone-row"><button class="tone">Match my voice⌄</button><button class="draft">Draft reply</button></div></aside><div class="context-canvas">${mode === 'voice' ? `<div class="label" style="color:#6d28d9">// VOICE INPUT</div><div class="quote" style="margin-top:18px">Say the outcome.<br>Keep your hands on the work.</div><p>Pranan turns natural instructions into a draft while leaving the email unchanged until you choose to insert it.</p><div class="metric"><div><strong>1 tap</strong><span>to start</span></div><div><strong>0 edits</strong><span>until approved</span></div></div>` : `<div class="label" style="color:#6d28d9">// RELATIONSHIP MEMORY</div><div class="quote" style="margin-top:18px">Know the person<br>before you reply.</div><p>Relationship, communication style, and recent context stay beside the draft, where they can shape the response.</p><div class="metric"><div><strong>88</strong><span>relationship score</span></div><div><strong>Brief</strong><span>preferred length</span></div></div>`}</div></div>`;
}

const assets = [
  ['01-reply-in-your-voice.png', 1280, 800, stage({label:'REPLY IN YOUR VOICE',title:'Write where the',italic:'work already is.',lede:'Pranan appears inside Gmail when you reply. Describe the outcome and get a context-aware draft in your voice.',proof:['ALWAYS READY','ONE LINE','GMAIL NATIVE'],product:composeProduct({})})],
  ['02-voice-input.png', 1280, 800, stage({label:'VOICE INPUT',title:'Say the outcome.',italic:'Pranan writes it.',lede:'Give natural voice instructions without leaving the email. The draft stays under your control.',proof:['ONE TAP','TRANSCRIPTION','DRAFT SAFE'],product:sidePanelProduct('voice')})],
  ['03-relationship-context.png', 1280, 800, stage({label:'RELATIONSHIP CONTEXT',title:'Every reply starts',italic:'with the person.',lede:'Pranan brings relationship health, communication style, and recent context into the drafting flow.',proof:['RELATIONSHIP 88','BRIEF STYLE','RECENT CONTEXT'],product:sidePanelProduct('context')})],
  ['04-outcome-shortcuts.png', 1280, 800, stage({label:'CLEAR OUTCOMES',title:'Move the email',italic:'forward in one click.',lede:'Acknowledge, answer directly, or clarify. Each shortcut gives the reply a clear job.',proof:['ACKNOWLEDGE','ANSWER','CLARIFY'],product:sidePanelProduct('context')})],
  ['05-improve-draft.png', 1280, 800, stage({label:'IMPROVE YOUR DRAFT',title:'Make it better.',italic:'Keep it yours.',lede:'Pranan recognizes an existing draft and helps refine clarity and tone without losing your facts or signature.',proof:['FACT SAFE','TONE CONTROL','SIGNATURE SAFE'],product:composeProduct({editor:'Hi Alex,<br><br>We can confirm the scope this week and send the final timeline and cost by Friday.<br><br>Best,<br>Pratik',prompt:'Make this warmer and keep it concise',active:true})})],
];

function promoSmall() {
  const css = pageCss(440,280);
  return `<!doctype html><html><head><style>${css}.brand{left:28px;top:24px;width:126px;height:28px}.brand img{width:126px;height:28px}.mini-copy{position:absolute;left:28px;top:88px;width:350px;z-index:2;font:400 37px/.98 Instrument Serif,serif;letter-spacing:-.02em}.mini-copy em{font-style:italic;color:#e0d4fc}.mini-rail{position:absolute;z-index:2;left:28px;right:28px;bottom:27px}</style></head><body><main class="stage"><div class="grid"></div><div class="brand"><img src="${logoFull}"></div><div class="mini-copy">Your digital twin<br><em>inside Gmail.</em></div><div class="mini-rail">${rail('Reply in your voice')}</div></main></body></html>`;
}

function promoMarquee() {
  const css = pageCss(1400,560);
  return `<!doctype html><html><head><style>${css}.brand{left:66px;top:54px;width:178px}.brand img{width:178px}.hero-copy{position:absolute;left:66px;top:171px;width:500px;z-index:2}.hero-copy .label{font-size:11px}.hero-copy h1{font-size:68px}.hero-copy p{font-size:17px;line-height:1.5;color:${COLORS.muted};max-width:430px}.mock{position:absolute;z-index:2;right:55px;top:57px;width:675px;height:446px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.38);overflow:hidden}.mock .mail{height:350px;padding:20px 28px}.mock .sender{margin-top:12px}.mock .message{margin-top:10px}.mock .compose{height:190px;bottom:12px}.mock .compose-head{height:34px}.mock .tools{height:30px}.mock .editor{height:48px}.mock .footer{height:37px}</style></head><body><main class="stage"><div class="grid"></div><div class="brand"><img src="${logoFull}"></div><section class="hero-copy"><div class="label">// YOUR DIGITAL TWIN FOR EMAIL</div><h1>Every email.<br><em>In your voice.</em></h1><p>Context-aware drafting, relationship memory, and voice input, built directly into Gmail.</p></section><section class="mock">${composeProduct({})}</section></main></body></html>`;
}

assets.push(['promo-small-440x280.png', 440, 280, promoSmall()],['promo-marquee-1400x560.png', 1400, 560, promoMarquee()]);

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height, html] of assets) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outputDir, name), type: 'png' });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`Generated ${assets.length} brand-aligned assets in ${outputDir}`);
