// Generates Emty social-preview + avatar HTML pages, each sized exactly to its
// target output. Rendered to PNG by headless Chrome (see render.sh).
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..');

const b64 = (p, mime) =>
  `data:${mime};base64,` + fs.readFileSync(p).toString('base64');

const bebas = b64(path.join(HERE, 'bebas.ttf'), 'font/ttf');
const mono = b64(path.join(HERE, 'spacemono.ttf'), 'font/ttf');
const monoBold = b64(path.join(HERE, 'spacemono-bold.ttf'), 'font/ttf');

// Only one source is needed: it is consumed as a mask, so the ink colour is
// set in CSS rather than baked into the pixels.
const logoCyanOnBlack = b64(REPO + '/frontend/src/assets/cyan_on_black.png', 'image/png');

const CYAN = '#00E5FF';
const BLACK = '#050505';

// A luminance mask made straight from the PNG would come out at ~62% alpha,
// because that is cyan's own relative luminance. This wrapper normalizes the
// mark's colour to pure white first (0.527 = 1 / (R+G+B) of the source cyan),
// so the mask is fully opaque on the strokes, fully transparent on the field,
// and still linear across the antialiased edges.
const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">
<filter id="n" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="
    .527 .527 .527 0 0
    .527 .527 .527 0 0
    .527 .527 .527 0 0
    0 0 0 1 0"/>
</filter>
<image href="${logoCyanOnBlack}" width="2000" height="2000" filter="url(#n)"/>
</svg>`;
const maskUri =
  'data:image/svg+xml;base64,' + Buffer.from(maskSvg).toString('base64');

// Shared head: embedded fonts + reset. Nothing loads off the network so the
// render is deterministic.
const head = `
<meta charset="utf-8">
<style>
  @font-face { font-family:'Bebas Neue'; src:url('${bebas}') format('truetype'); font-weight:400; }
  @font-face { font-family:'Space Mono'; src:url('${mono}') format('truetype'); font-weight:400; }
  @font-face { font-family:'Space Mono'; src:url('${monoBold}') format('truetype'); font-weight:700; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { overflow:hidden; }
  body { -webkit-font-smoothing:antialiased; }
  .stage { position:relative; overflow:hidden; }
  /* The logo PNG is used as a luminance mask, not as pixels: the cyan strokes
     become the visible area and the black field drops out. That way the mark
     is painted in whatever exact colour we ask for, over any background. */
  .mark {
    -webkit-mask-image: url('${maskUri}');
    mask-image: url('${maskUri}');
    mask-mode: luminance;
    -webkit-mask-size: contain; mask-size: contain;
    -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    -webkit-mask-position: center; mask-position: center;
  }
</style>`;

// Faint blueprint grid, matches the landing page's technical feel.
const grid = (color, step = 40) => `
  background-image:
    linear-gradient(${color} 1px, transparent 1px),
    linear-gradient(90deg, ${color} 1px, transparent 1px);
  background-size: ${step}px ${step}px;`;

const pages = {};

/* ---------------------------------------------------------------- A: dark
   Headline lockup. The default: reads at full size and still legible when
   Slack shrinks it to a 360px-wide thumbnail. */
pages['social-a-dark'] = `<!doctype html><html><head>${head}<style>
  body { width:1280px; height:640px; background:${BLACK}; }
  .stage { width:1280px; height:640px; display:flex; align-items:center;
           justify-content:center; gap:72px; padding-bottom:44px; }
  .stage::before { content:''; position:absolute; inset:0;
    ${grid('rgba(0,229,255,.055)', 40)}
    mask-image: radial-gradient(120% 90% at 35% 50%, #000 25%, transparent 75%); }
  .glow { position:absolute; width:820px; height:820px; left:-130px; top:-90px;
    background: radial-gradient(circle, rgba(0,229,255,.15), transparent 62%); }
  .mark { position:relative; width:264px; height:264px; flex:none;
          background:${CYAN}; }
  .copy { position:relative; }
  .tag { font-family:'Space Mono'; font-weight:700; font-size:19px;
         letter-spacing:.30em; color:${CYAN}; margin-bottom:22px; }
  h1 { font-family:'Bebas Neue'; font-size:150px; line-height:.86;
       letter-spacing:.012em; color:#fff; }
  h1 em { font-style:normal; color:${CYAN}; }
  .sub { font-family:'Space Mono'; font-size:23px; line-height:1.62;
         color:#8FA6B8; margin-top:30px; }
  .sub b { color:#D6E6F0; font-weight:400; }
  .rule { position:absolute; left:0; right:0; bottom:0; height:8px;
          background:linear-gradient(90deg, ${CYAN}, rgba(0,229,255,.05)); }
  .meta { position:absolute; left:0; right:0; bottom:46px; text-align:center;
          font-family:'Space Mono'; font-weight:700; font-size:16px;
          letter-spacing:.22em; color:#4E657A; }
</style></head><body><div class="stage">
  <div class="glow"></div>
  <div class="mark"></div>
  <div class="copy">
    <div class="tag">YOUR INBOX &middot; NOW</div>
    <h1>KEEP IT<br><em>EMTY</em></h1>
    <div class="sub">// reads everything<br><b>// bothers you with nothing</b></div>
  </div>
  <div class="meta">LOCAL-FIRST GMAIL TRIAGE &middot; WINDOWS &middot; MACOS</div>
  <div class="rule"></div>
</div></body></html>`;

/* ------------------------------------------------------------- B: centered
   Minimal, symmetric. Survives aggressive cropping better than anything else
   here, so it's the safe pick if the card gets letterboxed. */
pages['social-b-centered'] = `<!doctype html><html><head>${head}<style>
  body { width:1280px; height:640px; background:${BLACK}; }
  .stage { width:1280px; height:640px; display:flex; flex-direction:column;
           align-items:center; justify-content:center; }
  .stage::before { content:''; position:absolute; inset:0;
    ${grid('rgba(0,229,255,.05)', 48)}
    mask-image: radial-gradient(70% 70% at 50% 50%, #000 10%, transparent 72%); }
  .glow { position:absolute; width:900px; height:900px; left:190px; top:-230px;
    background: radial-gradient(circle, rgba(0,229,255,.13), transparent 60%); }
  .mark { position:relative; width:196px; height:196px; margin-bottom:4px;
          background:${CYAN}; }
  h1 { position:relative; font-family:'Bebas Neue'; font-size:132px;
       line-height:1; letter-spacing:.10em; color:#fff; text-indent:.10em; }
  .sub { position:relative; font-family:'Space Mono'; font-size:22px;
         letter-spacing:.06em; color:${CYAN}; margin-top:20px; }
  .meta { position:relative; font-family:'Space Mono'; font-weight:700;
          font-size:15px; letter-spacing:.24em; color:#546C80; margin-top:34px; }
  .rule { position:absolute; left:0; right:0; bottom:0; height:8px;
          background:linear-gradient(90deg, rgba(0,229,255,.05), ${CYAN}, rgba(0,229,255,.05)); }
</style></head><body><div class="stage">
  <div class="glow"></div>
  <div class="mark"></div>
  <h1>EMTY</h1>
  <div class="sub">// keep it emty</div>
  <div class="meta">LOCAL-FIRST GMAIL TRIAGE &middot; AI THAT STAYS ON YOUR MACHINE</div>
  <div class="rule"></div>
</div></body></html>`;

/* ----------------------------------------------------------------- C: cyan
   Inverted. A solid cyan block is the loudest thing in a dark-mode timeline,
   which is the whole job on launch day. */
pages['social-c-cyan'] = `<!doctype html><html><head>${head}<style>
  body { width:1280px; height:640px; background:${CYAN}; }
  .stage { width:1280px; height:640px; display:flex; align-items:center;
           justify-content:center; gap:72px; padding-bottom:44px; }
  .stage::before { content:''; position:absolute; inset:0;
    ${grid('rgba(0,0,0,.07)', 40)}
    mask-image: radial-gradient(130% 100% at 35% 50%, #000 20%, transparent 78%); }
  .mark { position:relative; width:264px; height:264px; flex:none;
          background:${BLACK}; }
  .copy { position:relative; }
  .tag { font-family:'Space Mono'; font-weight:700; font-size:19px;
         letter-spacing:.30em; color:rgba(0,0,0,.62); margin-bottom:22px; }
  h1 { font-family:'Bebas Neue'; font-size:150px; line-height:.86;
       letter-spacing:.012em; color:${BLACK}; }
  .sub { font-family:'Space Mono'; font-size:23px; line-height:1.62;
         color:rgba(0,0,0,.72); margin-top:30px; }
  .meta { position:absolute; left:0; right:0; bottom:46px; text-align:center;
          font-family:'Space Mono'; font-weight:700; font-size:16px;
          letter-spacing:.22em; color:rgba(0,0,0,.55); }
  .rule { position:absolute; left:0; right:0; bottom:0; height:8px; background:${BLACK}; }
</style></head><body><div class="stage">
  <div class="mark"></div>
  <div class="copy">
    <div class="tag">YOUR INBOX &middot; NOW</div>
    <h1>KEEP IT<br>EMTY</h1>
    <div class="sub">// reads everything<br>// bothers you with nothing</div>
  </div>
  <div class="meta">LOCAL-FIRST GMAIL TRIAGE &middot; WINDOWS &middot; MACOS</div>
  <div class="rule"></div>
</div></body></html>`;

/* -------------------------------------------------------------- avatars
   1024x1024. The mark is pulled in to ~64% so a circle crop (Twitter,
   LinkedIn) never clips the bottom bar or the diamond's right point. */
const avatar = (size, inset, bg, fg) => `<!doctype html><html><head>${head}<style>
  body { width:${size}px; height:${size}px; background:${bg}; }
  .stage { width:${size}px; height:${size}px; display:flex;
           align-items:center; justify-content:center; }
  .mark { width:${Math.round(size * inset)}px;
          height:${Math.round(size * inset)}px; background:${fg}; }
</style></head><body><div class="stage">
  <div class="mark"></div>
</div></body></html>`;

pages['avatar-dark'] = avatar(1024, 0.64, BLACK, CYAN);
pages['avatar-cyan'] = avatar(1024, 0.64, CYAN, BLACK);
// Favicon: no circle crop to survive, so the mark fills more of the tile and
// still resolves at 16px.
pages['favicon'] = avatar(256, 0.82, BLACK, CYAN);

for (const [name, html] of Object.entries(pages)) {
  fs.writeFileSync(path.join(HERE, name + '.html'), html);
  console.log('wrote', name + '.html');
}
