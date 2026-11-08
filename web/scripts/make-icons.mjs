// Renders the hourglass logo into PWA icons (public/*.png) with resvg.
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

// sand grains: fading in above the top, solid through the glass, fading out below the bottom
const dots = () => {
  const out = []
  for (let y = 2; y <= 44; y += 6.5) out.push(`<circle cx="${60 + Math.sin(y) * 0.6}" cy="${y}" r="2" fill="#d99a4e" opacity="${Math.min(1, (y + 4) / 30).toFixed(2)}"/>`)
  for (let y = 84; y <= 158; y += 6.5) out.push(`<circle cx="${60 + Math.sin(y * 1.7) * ((y - 84) / 18)}" cy="${y}" r="1.9" fill="#d99a4e" opacity="${Math.max(0.08, Math.min(1, (160 - y) / 30)).toFixed(2)}"/>`)
  return out.join('')
}
const hourglass = (s = 1, tx = 0, ty = 0) => `
<g transform="translate(${tx} ${ty}) scale(${s})">
  <defs>
    <clipPath id="c"><path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z"/></clipPath>
    <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c987"/><stop offset=".55" stop-color="#d99a4e"/><stop offset="1" stop-color="#b8732f"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".75"/></linearGradient>
    <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="158"><stop offset="0" stop-color="#c9843c"/><stop offset=".75" stop-color="#c9843c" stop-opacity=".9"/><stop offset="1" stop-color="#c9843c" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z" fill="#fffaf1"/>
  <g clip-path="url(#c)"><path d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill="#d99a4e"/></g>
  ${dots()}
  <path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 M 94 18 C 94 52 64 66 63.5 80 C 64 94 94 108 94 142" fill="none" stroke="#6b4a2b" stroke-width="3.4" stroke-linecap="round"/>
  <ellipse cx="60" cy="18" rx="35" ry="6" fill="none" stroke="#6b4a2b" stroke-width="4.4"/>
  <ellipse cx="60" cy="142" rx="35" ry="6" fill="none" stroke="#6b4a2b" stroke-width="4.4"/>
</g>`

const bg = (size, rounded) => `
  
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#f3e3c6"/>`

function icon(size, { rounded = true, pad = 0.16 } = {}) {
  // hourglass is 120x160; fit its height into the padded box
  const box = size * (1 - pad * 2)
  const s = box / 160
  const tx = (size - 120 * s) / 2
  const ty = (size - 160 * s) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg(size, rounded)}${hourglass(s, tx, ty)}</svg>`
}

const out = (name, svg, size) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png)
}
out('icon-192.png', icon(192, { rounded: false, pad: 0.14 }), 192)
out('icon-512.png', icon(512, { rounded: false, pad: 0.14 }), 512)
out('maskable-512.png', icon(512, { rounded: false, pad: 0.24 }), 512)
out('apple-touch-icon.png', icon(180, { rounded: false, pad: 0.15 }), 180)
writeFileSync(new URL('../public/favicon.svg', import.meta.url), icon(64, { rounded: true, pad: 0.1 }))
writeFileSync(new URL('../public/logo.svg', import.meta.url), icon(512, { rounded: true, pad: 0.14 }))
console.log('icons written')

// Android status-bar badge: a white hourglass silhouette on a TRANSPARENT background (Android masks it to one
// colour, so any opaque background would show as a filled square). Bold shapes so it still reads at 24dp.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <g fill="#fff">
    <rect x="16" y="8" width="64" height="9" rx="4.5"/>
    <rect x="16" y="79" width="64" height="9" rx="4.5"/>
    <path d="M30 31 L66 31 L48 50 Z"/>
    <circle cx="48" cy="60" r="3.2"/>
    <circle cx="48" cy="70" r="3.2"/>
  </g>
  <path d="M24 17 C24 38 44 42 44 48 C44 54 24 58 24 79 M72 17 C72 38 52 42 52 48 C52 54 72 58 72 79" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
</svg>`
writeFileSync(new URL('../public/badge-96.png', import.meta.url), new Resvg(badge, { fitTo: { mode: 'width', value: 96 }, background: 'rgba(0,0,0,0)' }).render().asPng())
console.log('badge written')
