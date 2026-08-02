export const STABLE_DEGREES = 3
export const DANGER_DEGREES = 4
export const CAPSIZE_DEGREES = 5
export const HORIZONTAL_LIMIT = 4.35

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
