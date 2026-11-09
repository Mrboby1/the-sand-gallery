/**
 * A small, cheap falling-sand simulation for the hourglass (no physics engine).
 *
 * - A fixed population of grains: a grain that falls out of the open bottom comes back above the open top,
 *   so the amount of sand in the upper bulb (the level) stays constant on its own: an endless hourglass.
 * - Inside the glass, grains live on a grid (cellular automaton), scanned bottom-up once per step: a grain
 *   moves down if it can, otherwise diagonally down (random side, with a random "slip" chance so slopes come
 *   out irregular, around the angle of repose), otherwise it rests. Walls come from the glass shape (a Path2D
 *   of the interior). The neck only lets a grain through now and then, like a real hourglass trickle; draining
 *   there digs a crater, and the stream from above lands in the middle and builds a small hill inside it.
 * - Outside the glass grid (falling in from above, or out below the neck) grains are free particles with real
 *   gravity (vy += g each step) and a little sideways jitter; they fade in above the top and fade out below.
 * - The neck is a V that narrows to one cell (extra simulation-only walls, steeper than the angle of repose),
 *   so the bottom of the pile comes out pointy, made by the grains themselves.
 * - Fill: the pile holds a target number of grains (setTarget, 0..1 of a full bulb). Below target extra grains
 *   pour in (inflow > outflow, the hill and crater grow naturally); above it, grains that fall out are not
 *   recycled.
 * - Drawing is one tiny image (1 pixel per grain cell) scaled up with nearest-neighbour: one drawImage a frame.
 *
 * Coordinates are the hourglass SVG's viewBox units (x 0..120).
 */

export interface SimShape {
  interior: string // SVG path of the inside of the glass
  top: number // viewBox top (e.g. -38)
  height: number // viewBox height (e.g. 238)
  glassTop: number // y of the top opening
  glassBottom: number // y of the bottom opening
  neckY: number // y of the narrowest point
  level: number // initial sand level in the upper bulb
}

interface Particle { x: number; y: number; vx: number; vy: number; s: number; incoming: boolean }

const G = 0.155 // gravity, viewBox units per step² (≈ 30 steps per second)
/** Chance per step that the grain in the one-cell neck gets through: a real hourglass only trickles (~20 grains/s). */
const NECK_PASS = 0.7
const SLIP = 0.7
/** Brightness of the three grain shades: a hint of texture, not grainy. */
const SHADES = [1, 1.045, 0.96]
/** Sideways jitter of falling grains below the neck, growing with the distance fallen (the stream fans out). */
const FAN = 0.36

export class SandSim {
  readonly cell: number
  private W: number
  private H: number
  private wall: Uint8Array
  private sand: Uint8Array // 0 empty, 1..3 = grain with shade 0..2
  private free: Particle[] = []
  private rnd: () => number
  private rowTop: number
  private rowNeck: number
  private rowExit: number
  private img: ImageData | null = null
  private buf: HTMLCanvasElement | OffscreenCanvas | null = null
  private rgb: [number, number, number] = [217, 154, 78]
  /** Grid cells of a full upper bulb (from the level down to the neck). */
  private capacity = 0
  private target = 0
  private gridCount = 0
  /** Grains normally in flight (the steady stream). */
  private stream = 0

  constructor(readonly shape: SimShape, cell: number, seed = 7, fill = 1) {
    this.cell = cell
    this.W = Math.ceil(120 / cell)
    this.H = Math.ceil(shape.height / cell)
    this.wall = new Uint8Array(this.W * this.H)
    this.sand = new Uint8Array(this.W * this.H)
    let s = seed >>> 0
    this.rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    this.rowTop = Math.max(0, this.gyOf(shape.glassTop) - 2)
    this.rowNeck = this.gyOf(shape.neckY) // last row still above the neck
    this.rowExit = this.gyOf(shape.neckY + 3) // from here grains fall freely
    this.stream = Math.round(14 / cell)
    this.buildWalls()
    this.fill(fill)
  }

  /** How full the upper bulb should be, 0..1. */
  setTarget(fill: number) { this.target = Math.round(Math.max(0, Math.min(1, fill)) * this.capacity) }

  private wy(gy: number) { return this.shape.top + (gy + 0.5) * this.cell } // world y of a cell centre
  private gyOf(y: number) { return Math.floor((y - this.shape.top) / this.cell) }

  private buildWalls() {
    const { interior, glassTop, glassBottom } = this.shape
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    const path = new Path2D(interior)
    for (let gy = 0; gy < this.H; gy++) {
      const y = this.wy(gy)
      if (y < glassTop || y > glassBottom) continue // open air above and below the glass
      for (let gx = 0; gx < this.W; gx++) if (!ctx.isPointInPath(path, (gx + 0.5) * this.cell, y)) this.wall[gy * this.W + gx] = 1
    }
    // the V into the neck: 45° walls (steeper than sand rests) that end in a single-cell hole
    const { neckY } = this.shape
    const centre = Math.floor(60 / this.cell)
    for (let gy = this.gyOf(neckY - 12); gy <= this.gyOf(neckY); gy++) {
      const half = Math.max(0, Math.floor((neckY - this.wy(gy)) / this.cell))
      for (let gx = 0; gx < this.W; gx++) if (Math.abs(gx - centre) > half) this.wall[gy * this.W + gx] = 1
    }
  }

  /** Fills the bulb from the neck upwards to `fill` (0..1) of its capacity. */
  private fill(fill: number) {
    const cells: number[] = []
    for (let gy = this.rowNeck; gy >= this.gyOf(this.shape.level); gy--) {
      for (let gx = 0; gx < this.W; gx++) { const i = gy * this.W + gx; if (!this.wall[i]) cells.push(i) }
    }
    this.capacity = cells.length
    this.setTarget(fill)
    for (let k = 0; k < this.target; k++) this.sand[cells[k]] = 1 + Math.floor(this.rnd() * 3)
    this.gridCount = this.target
  }

  private empty(x: number, y: number) {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return false
    const i = y * this.W + x
    return !this.sand[i] && !this.wall[i]
  }

  private respawn(p: Particle) {
    p.x = 60 + (this.rnd() - 0.5) * 3.2
    p.y = this.shape.top + this.rnd() * 6
    p.vx = (this.rnd() - 0.5) * 0.04
    p.vy = 1 + this.rnd() * 0.4
    p.incoming = true
  }

  /** One fixed time step (~1/30 s). */
  step() {
    const { W } = this
    const bottom = this.shape.top + this.shape.height
    // grid: rows bottom-up, so a grain moves at most once per step (it only ever moves into a lower row)
    let count = 0
    for (let gy = Math.min(this.rowExit, this.H - 2); gy >= this.rowTop; gy--) {
      const ltr = this.rnd() < 0.5
      for (let k = 0; k < W; k++) {
        const gx = ltr ? k : W - 1 - k
        const i = gy * W + gx
        const v = this.sand[i]
        if (!v) continue
        count++
        if (gy >= this.rowExit) {
          // through the neck: from here it falls freely
          this.sand[i] = 0
          this.free.push({ x: (gx + 0.5) * this.cell, y: this.wy(gy), vx: (this.rnd() - 0.5) * 0.2, vy: this.cell * 0.8, s: v - 1, incoming: false })
          continue
        }
        // the neck only trickles; while the pile is below its target it lets even less through, so it builds up
        if (gy === this.rowNeck && this.rnd() > (this.gridCount < this.target ? NECK_PASS * 0.3 : NECK_PASS)) continue
        let nx = gx
        if (this.empty(gx, gy + 1)) nx = gx
        else if (this.rnd() < SLIP) {
          const d = this.rnd() < 0.5 ? -1 : 1
          if (this.empty(gx + d, gy + 1)) nx = gx + d
          else if (this.empty(gx - d, gy + 1)) nx = gx - d
          else continue
        } else continue
        this.sand[i] = 0
        this.sand[(gy + 1) * W + nx] = v
      }
    }
    this.gridCount = count
    // below the target fill: pour in extra grains (a few per step at most)
    let incoming = 0
    for (const p of this.free) if (p.incoming) incoming++
    for (let n = 0; n < 2 && count + incoming < this.target + this.stream; n++, incoming++) {
      const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, s: Math.floor(this.rnd() * 3), incoming: true }
      this.respawn(p)
      this.free.push(p)
    }
    // free particles
    const still: Particle[] = []
    for (const p of this.free) {
      const prevY = p.y
      p.vy += G
      if (!p.incoming) {
        // below the neck the stream spreads out: random sideways nudges that grow the further the grain has fallen
        const fallen = p.y - this.shape.neckY
        if (fallen > 0) p.vx += (this.rnd() - 0.5) * FAN * Math.min(1.8, 0.15 + fallen / 40)
      }
      p.x += p.vx
      p.y += p.vy
      if (p.incoming && p.y > this.shape.glassTop - 2) {
        // falling in from above: land on the first occupied cell along the way
        const gx = Math.max(0, Math.min(W - 1, Math.floor(p.x / this.cell)))
        let landed = false
        const vZone = this.gyOf(this.shape.neckY - 12) // inside the V the grain joins the grid (it cannot just drop through the hole)
        for (let gy = Math.max(0, this.gyOf(prevY)); gy <= this.gyOf(p.y) && gy < this.H; gy++) {
          if (gy >= vZone && this.empty(gx, gy)) { this.sand[gy * W + gx] = 1 + p.s; landed = true; break }
          if (!this.empty(gx, gy)) {
            let ly = gy - 1
            while (ly > 0 && !this.empty(gx, ly)) ly--
            if (ly >= 0 && this.empty(gx, ly)) this.sand[ly * W + gx] = 1 + p.s
            landed = true
            break
          }
        }
        if (landed) continue
        if (p.y > this.shape.neckY + 3) p.incoming = false // fell straight through (bulb momentarily empty)
      }
      if (!p.incoming && p.y > bottom) {
        // recycle to the top, unless the bulb is already above its target fill
        if (this.gridCount + incoming >= this.target + this.stream + 4) continue
        this.respawn(p)
        incoming++
      }
      still.push(p)
    }
    this.free = still
  }

  /** Reads the CSS colour (hex, rgb() or hsl()) into RGB by painting one pixel. */
  /** Sand colour; `frost` (0..1) blends it toward the freeze colour (a paused hourglass). */
  setColor(color: string, freeze = '#5ab4e6', frost = 0) {
    const a = rgbOf(color), b = rgbOf(freeze), k = Math.max(0, Math.min(1, frost)) * 0.55
    this.rgb = [0, 1, 2].map((i) => Math.round(a[i] * (1 - k) + b[i] * k)) as [number, number, number]
  }

  /** Draws all grains as one nearest-neighbour-scaled image. The canvas transform maps viewBox units to pixels. */
  draw(ctx: CanvasRenderingContext2D) {
    const { W, H } = this
    const { top, height, glassTop, glassBottom } = this.shape
    if (!this.img) {
      this.img = new ImageData(W, H)
      this.buf = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
    }
    const px = new Uint32Array(this.img.data.buffer)
    px.fill(0)
    const [r, g, b] = this.rgb
    const pack = (shade: number, a: number) => {
      const k = SHADES[shade]
      return (((a & 255) << 24) | (Math.min(255, Math.round(b * k)) << 16) | (Math.min(255, Math.round(g * k)) << 8) | Math.min(255, Math.round(r * k))) >>> 0 // little-endian RGBA
    }
    const solid = [pack(0, 255), pack(1, 255), pack(2, 255)]
    for (let i = 0; i < this.sand.length; i++) { const v = this.sand[i]; if (v) px[i] = solid[v - 1] }
    // free particles: fade in above the glass, fade out below it
    const fadeIn = glassTop - top, fadeOut = top + height - glassBottom
    for (const p of this.free) {
      const gx = Math.floor(p.x / this.cell), gy = this.gyOf(p.y)
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue
      let a = 1
      if (p.y < glassTop) a = Math.max(0, Math.min(1, (p.y - top) / (fadeIn * 0.7)))
      else if (p.y > glassBottom) a = Math.max(0, 1 - (p.y - glassBottom) / fadeOut)
      if (a > 0.02) px[gy * W + gx] = pack(p.s, Math.round(a * 255))
    }
    const bctx = this.buf!.getContext('2d') as CanvasRenderingContext2D
    bctx.putImageData(this.img, 0, 0)
    ctx.clearRect(0, top, 120, height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.buf as CanvasImageSource, 0, top, W * this.cell, H * this.cell)
  }

  /** Start some grains in flight so the stream exists from the first frame, then let things settle. */
  prewarm(steps: number) {
    const n = this.target ? this.stream : 0
    for (let i = 0; i < n; i++) {
      const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, s: Math.floor(this.rnd() * 3), incoming: true }
      this.respawn(p)
      p.y += (i / n) * (this.shape.glassTop - this.shape.top)
      this.free.push(p)
    }
    for (let i = 0; i < steps; i++) this.step()
  }
}

let probe: CanvasRenderingContext2D | null = null
/** Any CSS colour → [r, g, b] (painted on a 1-pixel canvas). */
function rgbOf(color: string): [number, number, number] {
  if (!probe) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    probe = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  }
  probe.fillStyle = '#d99a4e'
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const d = probe.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}
