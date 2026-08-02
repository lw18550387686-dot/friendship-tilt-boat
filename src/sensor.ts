import { CAPSIZE_DEGREES, STABLE_DEGREES } from './rules'

export interface Tilt {
  roll: number
  pitch: number
}

export interface SensorStatus {
  ok: boolean
  reason?: 'unsupported' | 'denied' | 'no-data' | 'insecure'
}

type PermissionOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

type PermissionMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export function normalizeAngle(value: number): number {
  let result = value % 360
  if (result > 180) result -= 360
  if (result < -180) result += 360
  return result
}

export function mapToLandscape(beta: number, gamma: number, screenAngle: number): Tilt {
  const angle = ((screenAngle % 360) + 360) % 360
  if (angle === 90) return { roll: beta, pitch: -gamma }
  if (angle === 270) return { roll: -beta, pitch: gamma }
  if (angle === 180) return { roll: -gamma, pitch: -beta }
  return { roll: gamma, pitch: beta }
}

export function calibratedTilt(sample: Tilt, baseline: Tilt): Tilt {
  return {
    roll: normalizeAngle(sample.roll - baseline.roll),
    pitch: normalizeAngle(sample.pitch - baseline.pitch),
  }
}

export function lowPass(previous: Tilt, next: Tilt, alpha = 0.18): Tilt {
  const weight = Math.max(0, Math.min(1, alpha))
  return {
    roll: previous.roll + normalizeAngle(next.roll - previous.roll) * weight,
    pitch: previous.pitch + normalizeAngle(next.pitch - previous.pitch) * weight,
  }
}

export function isStable(roll: number, pitch: number, threshold = STABLE_DEGREES): boolean {
  return Math.abs(roll) <= threshold && Math.abs(pitch) <= threshold
}

export function isCapsized(roll: number, threshold = CAPSIZE_DEGREES): boolean {
  return Math.abs(roll) >= threshold
}

export function gradeFor(stableSeconds: number, totalSeconds: number): 'S' | 'A' | 'B' | 'C' {
  const ratio = totalSeconds > 0 ? stableSeconds / totalSeconds : 0
  if (ratio >= 0.8) return 'S'
  if (ratio >= 0.65) return 'A'
  if (ratio >= 0.45) return 'B'
  return 'C'
}

export class TiltFilter {
  private current: Tilt = { roll: 0, pitch: 0 }
  constructor(private alpha = 0.18) {}
  reset(value: Tilt = { roll: 0, pitch: 0 }): void { this.current = { ...value } }
  push(value: Tilt): Tilt { this.current = lowPass(this.current, value, this.alpha); return { ...this.current } }
}

export class OrientationSensor {
  private raw: Tilt | null = null
  private baseline: Tilt | null = null
  private filtered: Tilt = { roll: 0, pitch: 0 }
  private filter = new TiltFilter(0.16)
  private listening = false
  onTilt?: (tilt: Tilt) => void

  get hasSample(): boolean { return this.raw !== null }
  get tilt(): Tilt { return { ...this.filtered } }

  async requestPermission(): Promise<SensorStatus> {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return { ok: false, reason: 'insecure' }
    if (!('DeviceOrientationEvent' in window) && !('DeviceMotionEvent' in window)) return { ok: false, reason: 'unsupported' }
    try {
      const OrientationCtor = DeviceOrientationEvent as PermissionOrientationEvent
      const MotionCtor = DeviceMotionEvent as PermissionMotionEvent
      if (typeof OrientationCtor.requestPermission === 'function') {
        if (await OrientationCtor.requestPermission() !== 'granted') return { ok: false, reason: 'denied' }
      }
      if (typeof MotionCtor.requestPermission === 'function') {
        if (await MotionCtor.requestPermission() !== 'granted') return { ok: false, reason: 'denied' }
      }
      this.start()
      const received = await this.waitForSample(2200)
      return received ? { ok: true } : { ok: false, reason: 'no-data' }
    } catch {
      return { ok: false, reason: 'denied' }
    }
  }

  calibrate(): boolean {
    if (!this.raw) return false
    this.baseline = { ...this.raw }
    this.filtered = { roll: 0, pitch: 0 }
    this.filter.reset()
    return true
  }

  start(): void {
    if (this.listening) return
    window.addEventListener('deviceorientation', this.handleOrientation, true)
    this.listening = true
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.handleOrientation, true)
    this.listening = false
  }

  private screenAngle(): number {
    return screen.orientation?.angle ?? (typeof window.orientation === 'number' ? window.orientation : 0)
  }

  private handleOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta == null || event.gamma == null) return
    this.raw = mapToLandscape(event.beta, event.gamma, this.screenAngle())
    if (!this.baseline) return
    this.filtered = this.filter.push(calibratedTilt(this.raw, this.baseline))
    this.onTilt?.(this.tilt)
  }

  private waitForSample(timeout: number): Promise<boolean> {
    if (this.raw) return Promise.resolve(true)
    return new Promise((resolve) => {
      const started = performance.now()
      const poll = () => {
        if (this.raw) resolve(true)
        else if (performance.now() - started >= timeout) resolve(false)
        else requestAnimationFrame(poll)
      }
      poll()
    })
  }
}
