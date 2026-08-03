export const STABLE_DEGREES = 1.5
export const DANGER_DEGREES = 2.4
export const CAPSIZE_DEGREES = 3
export const HORIZONTAL_LIMIT = 5.8
export const LEVEL_DURATION_SECONDS = 20
export const TOTAL_LEVELS = 3

export interface LevelConfig {
  level: 1 | 2 | 3
  speed: number
  obstacleCount: number
  lateralSwing: number
  verticalSwing: number
  swingSpeed: number
  name: string
}

export const LEVEL_CONFIGS: readonly LevelConfig[] = [
  { level: 1, speed: 9.6, obstacleCount: 10, lateralSwing: 1.05, verticalSwing: 0.18, swingSpeed: 1.2, name: '晨光湾' },
  { level: 2, speed: 13.8, obstacleCount: 15, lateralSwing: 1.72, verticalSwing: 0.38, swingSpeed: 1.65, name: '珊瑚峡' },
  { level: 3, speed: 18.4, obstacleCount: 18, lateralSwing: 2.45, verticalSwing: 0.62, swingSpeed: 2.2, name: '星潮门' },
]

export function obstacleMotion(elapsedSeconds: number, config: LevelConfig, phase: number, mode = 0): { x: number; y: number } {
  const time = Math.max(0, elapsedSeconds) * config.swingSpeed + phase
  if (mode % 4 === 1) return {
    x: Math.sin(time * 1.38) * config.lateralSwing,
    y: Math.sin(time * 0.72 + Math.PI / 3) * config.verticalSwing,
  }
  if (mode % 4 === 2) return {
    x: (Math.sin(time * 0.72) * 0.62 + Math.sin(time * 1.93) * 0.38) * config.lateralSwing,
    y: Math.cos(time * 1.78) * config.verticalSwing,
  }
  if (mode % 4 === 3) return {
    x: Math.sin(time) * Math.cos(time * 0.43) * config.lateralSwing,
    y: Math.sin(time * 1.5) * config.verticalSwing,
  }
  return { x: Math.sin(time) * config.lateralSwing, y: Math.cos(time * 1.27) * config.verticalSwing }
}

export function levelForElapsed(elapsedSeconds: number): LevelConfig {
  const index = Math.max(0, Math.min(TOTAL_LEVELS - 1, Math.floor(Math.max(0, elapsedSeconds) / LEVEL_DURATION_SECONDS)))
  return LEVEL_CONFIGS[index]
}

export function swipeToWorldDelta(deltaPixels: number, viewportWidth: number): number {
  const safeWidth = Math.max(1, viewportWidth)
  return deltaPixels / safeWidth * HORIZONTAL_LIMIT * 2.45
}

export function pitchToBoatHeight(pitch: number): number {
  return Math.max(0.55, Math.min(2.15, 1.3 + pitch * 0.115))
}

export function overlapsObstacle(boatX: number, boatY: number, obstacleX: number, obstacleY: number, radiusX = 1.48, radiusY = 0.9): boolean {
  return Math.abs(boatX - obstacleX) < radiusX && Math.abs(boatY - obstacleY) < radiusY
}
