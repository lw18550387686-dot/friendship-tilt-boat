export const STABLE_DEGREES = 1.5
export const DANGER_DEGREES = 2.4
export const CAPSIZE_DEGREES = 3
export const HORIZONTAL_LIMIT = 4.35
export const LEVEL_DURATION_SECONDS = 20
export const TOTAL_LEVELS = 3

export interface LevelConfig {
  level: 1 | 2 | 3
  speed: number
  obstacleCount: number
  name: string
}

export const LEVEL_CONFIGS: readonly LevelConfig[] = [
  { level: 1, speed: 8.6, obstacleCount: 8, name: '晨光湾' },
  { level: 2, speed: 11.8, obstacleCount: 13, name: '珊瑚峡' },
  { level: 3, speed: 15.2, obstacleCount: 18, name: '星潮门' },
]

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

export function overlapsObstacle(boatX: number, boatY: number, obstacleX: number, obstacleY: number): boolean {
  return Math.abs(boatX - obstacleX) < 1.28 && Math.abs(boatY - obstacleY) < 0.78
}
