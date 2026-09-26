// First set of art for the places of the sector: an ICON, a SQUARE and a WIDE background for each,
// drawn as plain SVG from the place's type and faction. It exists so every screen has art from day
// one; the owner will replace the files in `public/places/` with real illustrations, keeping the
// names (`<place id>.icon.svg|square.svg|wide.svg`, or any file type: the component only needs the
// URL). Run: node apps/web/scripts/generate-place-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'places');
mkdirSync(OUT, { recursive: true });

const PLACES = [
  ['cair', 'outpost', 'explorers'],
  ['ceres', 'port', 'luna'],
  ['drift', 'scrap_field', 'pirates'],
  ['echo', 'relay', 'sun'],
  ['gate', 'junction', 'sun'],
  ['hedus', 'garrison', 'sun'],
  ['marsa', 'port', 'sun'],
  ['rennick', 'outpost', 'explorers'],
  ['spur', 'frontier', 'explorers'],
  ['tycho', 'shipyard', 'luna'],
  ['veil', 'dead_zone', 'pirates'],
  ['vesta', 'outpost', 'luna'],
  ['_default', 'outpost', 'neutral'],
];

const FACTION = {
  luna: { main: '#4a90d9', glow: '#9cc9ff', dark: '#0c1a2b' },
  sun: { main: '#e3b341', glow: '#ffe08a', dark: '#2a2108' },
  explorers: { main: '#3fa66a', glow: '#9be8b8', dark: '#0a2216' },
  pirates: { main: '#c23b3b', glow: '#ff9c8f', dark: '#2b0c0c' },
  neutral: { main: '#8b949e', glow: '#d0d7de', dark: '#151a21' },
};

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

function structure(type, cx, cy, s, c, rand) {
  const parts = [];
  const line = (extra = '') => `fill="none" stroke="${c.glow}" ${extra}`;
  switch (type) {
    case 'port': {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.26)}" ${line(`stroke-width="${f(s * 0.035)}"`)}/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.09)}" fill="${c.main}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
      for (let i = 0; i < 6; i += 1) {
        const a = (i * Math.PI) / 3;
        parts.push(`<line x1="${f(cx + Math.cos(a) * s * 0.09)}" y1="${f(cy + Math.sin(a) * s * 0.09)}" x2="${f(cx + Math.cos(a) * s * 0.26)}" y2="${f(cy + Math.sin(a) * s * 0.26)}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
        parts.push(`<rect x="${f(cx + Math.cos(a) * s * 0.29 - s * 0.018)}" y="${f(cy + Math.sin(a) * s * 0.29 - s * 0.018)}" width="${f(s * 0.036)}" height="${f(s * 0.036)}" fill="${c.glow}"/>`);
      }
      break;
    }
    case 'shipyard': {
      parts.push(`<path d="M${f(cx - s * 0.32)},${f(cy + s * 0.14)} L${f(cx - s * 0.32)},${f(cy - s * 0.18)} L${f(cx + s * 0.32)},${f(cy - s * 0.18)} L${f(cx + s * 0.32)},${f(cy + s * 0.14)}" ${line(`stroke-width="${f(s * 0.022)}"`)}/>`);
      for (let i = 1; i < 6; i += 1) {
        parts.push(`<line x1="${f(cx - s * 0.32 + (i * s * 0.64) / 6)}" y1="${f(cy - s * 0.18)}" x2="${f(cx - s * 0.32 + (i * s * 0.64) / 6)}" y2="${f(cy + s * 0.14)}" stroke="${c.glow}" stroke-opacity="0.5" stroke-width="${f(s * 0.01)}"/>`);
      }
      parts.push(`<path d="M${f(cx - s * 0.22)},${f(cy + s * 0.06)} L${f(cx + s * 0.2)},${f(cy - s * 0.02)} L${f(cx + s * 0.26)},${f(cy + s * 0.06)} L${f(cx + s * 0.2)},${f(cy + s * 0.14)} L${f(cx - s * 0.22)},${f(cy + s * 0.12)} Z" fill="${c.main}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
      break;
    }
    case 'junction': {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.3)}" ${line(`stroke-width="${f(s * 0.04)}"`)}/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.2)}" ${line(`stroke-width="${f(s * 0.014)}" stroke-opacity="0.6"`)}/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.12)}" fill="${c.main}" fill-opacity="0.25"/>`);
      for (let i = 0; i < 4; i += 1) {
        const a = (i * Math.PI) / 2 + 0.4;
        parts.push(`<rect x="${f(cx + Math.cos(a) * s * 0.3 - s * 0.03)}" y="${f(cy + Math.sin(a) * s * 0.3 - s * 0.03)}" width="${f(s * 0.06)}" height="${f(s * 0.06)}" fill="${c.glow}"/>`);
      }
      break;
    }
    case 'relay': {
      parts.push(`<path d="M${f(cx - s * 0.24)},${f(cy - s * 0.08)} Q${cx},${f(cy + s * 0.22)} ${f(cx + s * 0.24)},${f(cy - s * 0.08)}" ${line(`stroke-width="${f(s * 0.03)}"`)}/>`);
      parts.push(`<line x1="${cx}" y1="${f(cy + s * 0.08)}" x2="${cx}" y2="${f(cy + s * 0.3)}" stroke="${c.glow}" stroke-width="${f(s * 0.03)}"/>`);
      parts.push(`<line x1="${cx}" y1="${f(cy - s * 0.02)}" x2="${f(cx + s * 0.1)}" y2="${f(cy - s * 0.26)}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
      parts.push(`<circle cx="${f(cx + s * 0.1)}" cy="${f(cy - s * 0.26)}" r="${f(s * 0.02)}" fill="${c.glow}"/>`);
      break;
    }
    case 'garrison': {
      for (let i = 0; i < 4; i += 1) {
        const w = s * (0.1 + rand() * 0.06);
        const h = s * (0.14 + rand() * 0.14);
        const x = cx - s * 0.28 + i * s * 0.15;
        parts.push(`<rect x="${f(x)}" y="${f(cy + s * 0.12 - h)}" width="${f(w)}" height="${f(h)}" fill="${c.main}" stroke="${c.glow}" stroke-width="${f(s * 0.01)}"/>`);
        parts.push(`<path d="M${f(x)},${f(cy + s * 0.12 - h)} L${f(x + w / 2)},${f(cy + s * 0.12 - h - s * 0.05)} L${f(x + w)},${f(cy + s * 0.12 - h)} Z" fill="${c.glow}"/>`);
      }
      parts.push(`<line x1="${f(cx - s * 0.3)}" y1="${f(cy + s * 0.12)}" x2="${f(cx + s * 0.34)}" y2="${f(cy + s * 0.12)}" stroke="${c.glow}" stroke-width="${f(s * 0.02)}"/>`);
      break;
    }
    case 'frontier': {
      parts.push(`<ellipse cx="${cx}" cy="${f(cy + s * 0.16)}" rx="${f(s * 0.2)}" ry="${f(s * 0.07)}" fill="#2b2f36" stroke="${c.glow}" stroke-opacity="0.5"/>`);
      parts.push(`<line x1="${cx}" y1="${f(cy + s * 0.14)}" x2="${cx}" y2="${f(cy - s * 0.2)}" stroke="${c.glow}" stroke-width="${f(s * 0.018)}"/>`);
      parts.push(`<circle cx="${cx}" cy="${f(cy - s * 0.22)}" r="${f(s * 0.05)}" fill="${c.glow}"/>`);
      parts.push(`<circle cx="${cx}" cy="${f(cy - s * 0.22)}" r="${f(s * 0.12)}" fill="${c.glow}" fill-opacity="0.18"/>`);
      break;
    }
    case 'scrap_field': {
      for (let i = 0; i < 9; i += 1) {
        const x = cx + (rand() - 0.5) * s * 0.7;
        const y = cy + (rand() - 0.5) * s * 0.42;
        const r = s * (0.03 + rand() * 0.07);
        const pts = Array.from({ length: 7 }, (_, k) => {
          const a = (k / 7) * Math.PI * 2;
          const rr = r * (0.7 + rand() * 0.5);
          return `${f(x + Math.cos(a) * rr)},${f(y + Math.sin(a) * rr)}`;
        }).join(' ');
        parts.push(`<polygon points="${pts}" fill="#3a3f47" stroke="${c.glow}" stroke-opacity="0.45" stroke-width="${f(s * 0.006)}"/>`);
      }
      parts.push(`<path d="M${f(cx - s * 0.12)},${f(cy + s * 0.05)} l${f(s * 0.16)},${f(-s * 0.04)} l${f(s * 0.05)},${f(s * 0.06)} l${f(-s * 0.14)},${f(s * 0.05)} Z" fill="${c.main}" fill-opacity="0.7"/>`);
      break;
    }
    case 'dead_zone': {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(s * 0.22)}" fill="#14181e" stroke="${c.main}" stroke-opacity="0.6" stroke-width="${f(s * 0.012)}"/>`);
      parts.push(`<path d="M${f(cx - s * 0.08)},${f(cy - s * 0.2)} L${f(cx + s * 0.02)},${f(cy - s * 0.02)} L${f(cx - s * 0.06)},${f(cy + s * 0.08)} L${f(cx + s * 0.1)},${f(cy + s * 0.2)}" fill="none" stroke="${c.glow}" stroke-opacity="0.7" stroke-width="${f(s * 0.012)}"/>`);
      for (let i = 0; i < 5; i += 1) {
        parts.push(`<rect x="${f(cx + (rand() - 0.5) * s * 0.7)}" y="${f(cy + (rand() - 0.5) * s * 0.5)}" width="${f(s * 0.04)}" height="${f(s * 0.02)}" fill="#2b2f36" stroke="${c.main}" stroke-opacity="0.6" transform="rotate(${f(rand() * 180)} ${cx} ${cy})"/>`);
      }
      break;
    }
    default: {
      // outpost
      parts.push(`<ellipse cx="${cx}" cy="${f(cy + s * 0.16)}" rx="${f(s * 0.26)}" ry="${f(s * 0.09)}" fill="#2b2f36" stroke="${c.glow}" stroke-opacity="0.5"/>`);
      parts.push(`<path d="M${f(cx - s * 0.16)},${f(cy + s * 0.1)} a${f(s * 0.1)},${f(s * 0.1)} 0 0 1 ${f(s * 0.2)},0 Z" fill="${c.main}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
      parts.push(`<path d="M${f(cx + s * 0.06)},${f(cy + s * 0.1)} a${f(s * 0.07)},${f(s * 0.07)} 0 0 1 ${f(s * 0.14)},0 Z" fill="${c.main}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
      parts.push(`<line x1="${f(cx - s * 0.06)}" y1="${f(cy + s * 0.0)}" x2="${f(cx - s * 0.06)}" y2="${f(cy - s * 0.18)}" stroke="${c.glow}" stroke-width="${f(s * 0.012)}"/>`);
    }
  }
  return parts.join('');
}

function scene(id, type, faction, w, h) {
  const c = FACTION[faction] ?? FACTION.neutral;
  const rand = rng(`${id}:${type}`);
  const s = Math.min(w, h);
  const stars = Array.from({ length: Math.round((w * h) / 2600) }, () => {
    const r = 0.5 + rand() * 1.2;
    return `<circle cx="${f(rand() * w)}" cy="${f(rand() * h)}" r="${f(r)}" fill="#fff" fill-opacity="${f(0.25 + rand() * 0.6)}"/>`;
  }).join('');
  const planetX = w * (w > h ? 0.8 : 0.72);
  const planetY = h * 0.72;
  const planetR = s * 0.42;
  const structX = w * (w > h ? 0.42 : 0.44);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05070c"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>
<radialGradient id="pl" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${c.glow}" stop-opacity="0.85"/><stop offset="0.55" stop-color="${c.main}" stop-opacity="0.55"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${stars}
<circle cx="${f(planetX)}" cy="${f(planetY)}" r="${f(planetR)}" fill="url(#pl)"/>
${structure(type, f(structX), f(h * 0.46), s, c, rand)}
</svg>
`;
}

function icon(id, type, faction) {
  const c = FACTION[faction] ?? FACTION.neutral;
  const rand = rng(`icon:${id}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
<circle cx="32" cy="32" r="30" fill="${c.dark}" stroke="${c.main}" stroke-width="3"/>
${structure(type, 32, 32, 64, c, rand)}
</svg>
`;
}

for (const [id, type, faction] of PLACES) {
  writeFileSync(join(OUT, `${id}.icon.svg`), icon(id, type, faction));
  writeFileSync(join(OUT, `${id}.square.svg`), scene(id, type, faction, 320, 320));
  writeFileSync(join(OUT, `${id}.wide.svg`), scene(id, type, faction, 1200, 300));
}
console.log(`wrote ${PLACES.length * 3} files to ${OUT}`);
