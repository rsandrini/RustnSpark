// A wide background for each playable faction (S10.2 onboarding picker), drawn as plain SVG from
// the faction's colours and a sigil. It exists so onboarding has art from day one; the owner will
// replace the files in `public/factions/` with real illustrations, keeping the names
// (`<faction>.wide.svg`). Sibling of generate-place-art.mjs (same sky + star field treatment).
// Run: node apps/web/scripts/generate-faction-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'factions');
mkdirSync(OUT, { recursive: true });

// Keep in step with PLAYABLE_FACTIONS (onboarding.page.tsx) and the --luna/--sun/--explorers
// CSS variables (styles/index.css): same colours, so the card border and its backdrop agree.
// '_default' is the fallback for a faction key an admin adds later without its own art yet.
const FACTIONS = [
  ['luna', { main: '#4a90d9', glow: '#9cc9ff', dark: '#0c1a2b' }, 'ring'],
  ['sun', { main: '#e3b341', glow: '#ffe08a', dark: '#2a2108' }, 'flare'],
  ['explorers', { main: '#3fa66a', glow: '#9be8b8', dark: '#0a2216' }, 'compass'],
  ['_default', { main: '#8b949e', glow: '#d0d7de', dark: '#151a21' }, 'compass'],
];

function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Number(n.toFixed(1));

// Luna Authority: a station ring locked around a planet, orderly and governed.
function ring(cx, cy, s, c) {
  const parts = [];
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(s * 0.3)}" fill="none" stroke="${c.glow}" stroke-width="${f(s * 0.014)}"/>`,
  );
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(s * 0.22)}" fill="none" stroke="${c.glow}" stroke-opacity="0.5" stroke-width="${f(s * 0.008)}"/>`,
  );
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    parts.push(
      `<rect x="${f(cx + Math.cos(a) * s * 0.3 - s * 0.014)}" y="${f(cy + Math.sin(a) * s * 0.3 - s * 0.014)}" width="${f(s * 0.028)}" height="${f(s * 0.028)}" fill="${c.glow}"/>`,
    );
  }
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(s * 0.12)}" fill="${c.main}" fill-opacity="0.35"/>`,
  );
  return parts.join('');
}

// Sun Traders: a radiant burst, the mercantile flare of an open market.
function flare(cx, cy, s, c) {
  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.13)}" fill="${c.glow}"/>`);
  for (let i = 0; i < 12; i += 1) {
    const a = (i * Math.PI) / 6;
    const len = i % 2 === 0 ? s * 0.34 : s * 0.22;
    parts.push(
      `<line x1="${f(cx + Math.cos(a) * s * 0.16)}" y1="${f(cy + Math.sin(a) * s * 0.16)}" x2="${f(cx + Math.cos(a) * len)}" y2="${f(cy + Math.sin(a) * len)}" stroke="${c.main}" stroke-width="${f(s * 0.02)}" stroke-linecap="round"/>`,
    );
  }
  return parts.join('');
}

// Explorers: a compass rose, the frontier's own bearing.
function compass(cx, cy, s, c) {
  const parts = [];
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${f(s * 0.28)}" fill="none" stroke="${c.glow}" stroke-opacity="0.6" stroke-width="${f(s * 0.01)}"/>`,
  );
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2;
    const long = i % 2 === 0;
    const len = long ? s * 0.28 : s * 0.16;
    const r = long ? s * 0.05 : s * 0.03;
    parts.push(
      `<path d="M${cx},${cy} L${f(cx + Math.cos(a - 0.12) * len)},${f(cy + Math.sin(a - 0.12) * len)} L${f(cx + Math.cos(a) * (len + r))},${f(cy + Math.sin(a) * (len + r))} L${f(cx + Math.cos(a + 0.12) * len)},${f(cy + Math.sin(a + 0.12) * len)} Z" fill="${long ? c.main : c.glow}" fill-opacity="${long ? '0.85' : '0.55'}"/>`,
    );
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.035)}" fill="${c.glow}"/>`);
  return parts.join('');
}

const SIGIL = { ring, flare, compass };

function wide(faction, c, sigil, w, h) {
  const rand = rng(`faction:${faction}`);
  const s = Math.min(w, h);
  const stars = Array.from({ length: Math.round((w * h) / 2600) }, () => {
    const r = 0.5 + rand() * 1.2;
    return `<circle cx="${f(rand() * w)}" cy="${f(rand() * h)}" r="${f(r)}" fill="#fff" fill-opacity="${f(0.25 + rand() * 0.6)}"/>`;
  }).join('');
  const cx = w * 0.78;
  const cy = h * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.dark}"/><stop offset="1" stop-color="#05070c"/></linearGradient>
<radialGradient id="pl" cx="0.5" cy="0.5" r="0.75"><stop offset="0" stop-color="${c.glow}" stop-opacity="0.5"/><stop offset="0.6" stop-color="${c.main}" stop-opacity="0.25"/><stop offset="1" stop-color="${c.dark}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${stars}
<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(s * 0.42)}" fill="url(#pl)"/>
${SIGIL[sigil](f(cx), f(cy), s, c)}
</svg>
`;
}

for (const [faction, c, sigil] of FACTIONS) {
  writeFileSync(join(OUT, `${faction}.wide.svg`), wide(faction, c, sigil, 900, 260));
}
console.log(`wrote ${FACTIONS.length} files to ${OUT}`);
