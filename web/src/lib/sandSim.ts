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
/** Chance per step that a grain at the neck gets through: a real hourglass only trickles (~30 grains/s here). */
const NECK_PASS = 0.22
const SLIP = 0.7
/** Brightness of the three grain shades (subtle variation). */
const SHADES = [1, 1.09, 0.92]

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

  constructor(readonly shape: SimShape, cell: number, seed = 7) {
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
    this.buildWalls()
    this.fill()
  }

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
  }

  private fill() {
    for (let gy = this.gyOf(this.shape.level); gy <= this.rowNeck; gy++) {
      for (let gx = 0; gx < this.W; gx++) {
        const i = gy * this.W + gx
        if (!this.wall[i]) this.sand[i] = 1 + Math.floor(this.rnd() * 3)
      }
    }
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
    for (let gy = Math.min(this.rowExit, this.H - 2); gy >= this.rowTop; gy--) {
      const ltr = this.rnd() < 0.5
      for (let k = 0; k < W; k++) {
        const gx = ltr ? k : W - 1 - k
        const i = gy * W + gx
        const v = this.sand[i]
        if (!v) continue
        if (gy >= this.rowExit) {
          // through the neck: from here it falls freely
          this.sand[i] = 0
          this.free.push({ x: (gx + 0.5) * this.cell, y: this.wy(gy), vx: (this.rnd() - 0.5) * 0.12, vy: this.cell * 0.8, s: v - 1, incoming: false })
          continue
        }
        if (gy === this.rowNeck && this.rnd() > NECK_PASS) continue // the neck only trickles
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
    // free particles
    const still: Particle[] = []
    for (const p of this.free) {
      const prevY = p.y
      p.vy += G
      p.x += p.vx
      p.y += p.vy
      if (p.incoming && p.y > this.shape.glassTop - 2) {
        // falling in from above: land on the first occupied cell along the way
        const gx = Math.max(0, Math.min(W - 1, Math.floor(p.x / this.cell)))
        let landed = false
        for (let gy = Math.max(0, this.gyOf(prevY)); gy <= this.gyOf(p.y) && gy < this.H; gy++) {
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
      if (!p.incoming && p.y > bottom) this.respawn(p)
      still.push(p)
    }
    this.free = still
  }

  /** Reads the CSS colour (hex, rgb() or hsl()) into RGB by painting one pixel. */
  setColor(color: string) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    ctx.fillStyle = '#d99a4e'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    this.rgb = [d[0], d[1], d[2]]
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
    const n = Math.round(14 / this.cell)
    for (let i = 0; i < n; i++) {
      const p: Particle = { x: 0, y: 0, vx: 0, vy: 0, s: Math.floor(this.rnd() * 3), incoming: true }
      this.respawn(p)
      p.y += (i / n) * (this.shape.glassTop - this.shape.top)
      this.free.push(p)
    }
    for (let i = 0; i < steps; i++) this.step()
  }
}
