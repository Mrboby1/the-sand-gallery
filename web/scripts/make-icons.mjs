// Renders the hourglass logo into PWA icons (public/*.png) with resvg.
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

const hourglass = (s = 1, tx = 0, ty = 0) => `
<g transform="translate(${tx} ${ty}) scale(${s})">
  <defs>
    <clipPath id="c"><path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z"/></clipPath>
    <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c987"/><stop offset=".55" stop-color="#d99a4e"/><stop offset="1" stop-color="#b8732f"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity=".75"/></linearGradient>
    <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="158"><stop offset="0" stop-color="#c9843c"/><stop offset=".75" stop-color="#c9843c" stop-opacity=".9"/><stop offset="1" stop-color="#c9843c" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 L 94 142 C 94 108 64 94 63.5 80 C 64 66 94 52 94 18 Z" fill="url(#glass)"/>
  <g clip-path="url(#c)"><path d="M 0 38 Q 60 62 120 38 L 120 84 L 0 84 Z" fill="url(#sand)"/></g>
  <line x1="60" y1="0" x2="60" y2="46" stroke="#d99a4e" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 4"/>
  <line x1="60" y1="62" x2="60" y2="156" stroke="url(#fade)" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 4"/>
  <path d="M 26 18 C 26 52 56 66 56.5 80 C 56 94 26 108 26 142 M 94 18 C 94 52 64 66 63.5 80 C 64 94 94 108 94 142" fill="none" stroke="#6b4a2b" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M 33 26 C 33 46 44 58 51 66" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="60" cy="18" rx="35" ry="6" fill="none" stroke="#6b4a2b" stroke-width="4.4"/>
  <ellipse cx="60" cy="142" rx="35" ry="6" fill="none" stroke="#6b4a2b" stroke-width="4.4"/>
</g>`

const bg = (size, rounded) => `
  <defs><radialGradient id="bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#fbeed6"/><stop offset=".7" stop-color="#f0d9b2"/><stop offset="1" stop-color="#e3c18c"/></radialGradient></defs>
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="url(#bg)"/>`

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
