import * as THREE from 'three'
import { gradeFor, isCapsized, isStable, type Tilt } from './sensor'
import { DANGER_DEGREES, HORIZONTAL_LIMIT, LEVEL_CONFIGS, LEVEL_DURATION_SECONDS, levelForElapsed, obstacleMotion, overlapsObstacle, pitchToBoatHeight, swipeToWorldDelta, type LevelConfig } from './rules'

export interface RunStats {
  timeLeft: number
  stableSeconds: number
  score: number
  roll: number
  pitch: number
  stable: boolean
  danger: boolean
  hits: number
  level: 1 | 2 | 3
  levelName: string
  levelProgress: number
}

export interface GameFrame {
  stats: RunStats
  boat: { x: number; y: number; rotationX: number; rotationZ: number; scale: number }
  obstacles: Array<{ x: number; y: number; z: number; rotationY: number; visible: boolean }>
}

export interface RunResult {
  completed: boolean
  reason: 'finished' | 'capsized'
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  stableSeconds: number
  totalSeconds: number
  maxRoll: number
  hits: number
}

interface BoatCallbacks {
  update: (stats: RunStats) => void
  finish: (result: RunResult) => void
  frame?: (frame: GameFrame) => void
}

const material = (color: number, roughness = 0.65, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })

export class FriendshipBoatGame {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(49, 1, 0.1, 400)
  private boat = new THREE.Group()
  private water!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private laneObjects = new THREE.Group()
  private obstacles = new THREE.Group()
  private scenery = new THREE.Group()
  private hemi = new THREE.HemisphereLight(0xe9fbff, 0x185b78, 2.7)
  private sun = new THREE.DirectionalLight(0xfff2ce, 3.6)
  private tilt: Tilt = { roll: 0, pitch: 0 }
  private horizontalTarget = 0
  private running = false
  private remoteFollowing = false
  private finished = false
  private timeLeft = 60
  private elapsed = 0
  private stableSeconds = 0
  private score = 0
  private maxRoll = 0
  private capsizeHold = 0
  private hits = 0
  private collisionPulse = 0
  private currentLevel: 1 | 2 | 3 = 1
  private lastFrameSent = 0
  private last = performance.now()
  private raf = 0

  constructor(private canvas: HTMLCanvasElement, private callbacks: BoatCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.background = new THREE.Color(0x8ed7e9)
    this.scene.fog = new THREE.Fog(0x8ed7e9, 38, 145)
    this.buildScene()
    this.resize()
    window.addEventListener('resize', this.resize)
    this.raf = requestAnimationFrame(this.loop)
  }

  start(): void {
    this.running = true
    this.remoteFollowing = false
    this.finished = false
    this.timeLeft = 60
    this.elapsed = 0
    this.stableSeconds = 0
    this.score = 0
    this.maxRoll = 0
    this.capsizeHold = 0
    this.hits = 0
    this.collisionPulse = 0
    this.lastFrameSent = 0
    this.horizontalTarget = 0
    this.boat.position.set(0, 1.2, 3)
    this.boat.rotation.set(0, 0, 0)
    this.boat.scale.setScalar(1)
    this.resetObstacles()
    this.applyLevelTheme(LEVEL_CONFIGS[0])
  }

  startRemote(): void {
    this.running = false
    this.remoteFollowing = true
    this.finished = false
    this.resetObstacles()
    this.applyLevelTheme(LEVEL_CONFIGS[0])
  }

  stop(): void { this.running = false; this.remoteFollowing = false }
  setTilt(tilt: Tilt): void { this.tilt = tilt }
  steerHorizontal(deltaPixels: number, viewportWidth: number): void {
    if (!this.running) return
    this.horizontalTarget = THREE.MathUtils.clamp(this.horizontalTarget + swipeToWorldDelta(deltaPixels, viewportWidth), -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT)
  }

  applyRemoteFrame(frame: GameFrame): void {
    if (!this.remoteFollowing) return
    if (frame.stats.level !== this.currentLevel) this.applyLevelTheme(LEVEL_CONFIGS[frame.stats.level - 1])
    this.boat.position.set(frame.boat.x, frame.boat.y, 3)
    this.boat.rotation.x = frame.boat.rotationX
    this.boat.rotation.z = frame.boat.rotationZ
    this.boat.scale.setScalar(frame.boat.scale)
    frame.obstacles.forEach((snapshot, index) => {
      const obstacle = this.obstacles.children[index]
      if (!obstacle) return
      obstacle.position.set(snapshot.x, snapshot.y, snapshot.z)
      obstacle.rotation.y = snapshot.rotationY
      obstacle.visible = snapshot.visible
    })
    this.callbacks.update(frame.stats)
  }

  private buildScene(): void {
    this.scene.add(this.hemi)
    this.sun.position.set(-12, 22, 18); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024)
    this.scene.add(this.sun)

    const waterGeometry = new THREE.PlaneGeometry(220, 260, 42, 52)
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x177fa1, roughness: 0.24, metalness: 0.25, transparent: true, opacity: 0.97 })
    this.water = new THREE.Mesh(waterGeometry, waterMaterial)
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -0.2; this.water.receiveShadow = true
    this.scene.add(this.water)

    this.buildBoat()
    this.scene.add(this.boat)
    this.buildCourse()
    this.scene.add(this.laneObjects)
    this.buildObstacles()
    this.scene.add(this.obstacles)
    this.buildScenery()
    this.scene.add(this.scenery)

    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: 0xffe7a4, fog: false }))
    sunDisc.position.set(-32, 25, -95); this.scene.add(sunDisc)
    this.camera.position.set(0, 7.6, 14.4)
    this.camera.lookAt(0, 1.55, -8)
    this.applyLevelTheme(LEVEL_CONFIGS[0])
  }

  private buildBoat(): void {
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 3.2, 8, 18), material(0xf4ae39, 0.46))
    hull.rotation.x = Math.PI / 2; hull.scale.set(1, 0.7, 0.74); hull.castShadow = true; hull.position.y = 0.25
    this.boat.add(hull)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.1, 8, 32), material(0xffe7aa, 0.38))
    rim.scale.z = 2.08; rim.rotation.x = Math.PI / 2; rim.position.y = 0.78; this.boat.add(rim)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.18, 3.25), material(0x81462d, 0.82))
    deck.position.y = 0.68; deck.castShadow = true; this.boat.add(deck)
    this.boat.add(this.buildFriend(-0.48, 0x2cb9a3, 0xf0bd93))
    this.boat.add(this.buildFriend(0.48, 0xf06472, 0xe8ad82))
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.3, 8), material(0xf5e6bd))
    flagPole.position.set(0, 1.88, -0.85); this.boat.add(flagPole)
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.62), new THREE.MeshStandardMaterial({ color: 0xff5a70, side: THREE.DoubleSide }))
    flag.position.set(0.56, 2.52, -0.85); this.boat.add(flag)
  }

  private buildFriend(x: number, shirtColor: number, skinColor: number): THREE.Group {
    const friend = new THREE.Group(); friend.position.set(x, 0.82, 0.35)
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 6, 12), material(shirtColor, 0.68)); body.position.y = 0.55; friend.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), material(skinColor, 0.75)); head.position.y = 1.35; friend.add(head)
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.48), material(0x332622, 0.92)); hair.position.y = 1.47; friend.add(hair)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 5, 8), material(skinColor, 0.76)); arm.position.set(side * 0.38, 0.65, 0); arm.rotation.z = side * 0.25; friend.add(arm)
    }
    friend.traverse((obj) => { if (obj instanceof THREE.Mesh) obj.castShadow = true })
    return friend
  }

  private buildCourse(): void {
    for (let i = 0; i < 24; i++) {
      const z = -12 - i * 13
      for (const side of [-1, 1]) {
        const buoy = new THREE.Group()
        const float = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), material(i % 2 ? 0xffd34f : 0xff5f64, 0.36, 0.08))
        float.scale.y = 0.62; float.position.y = 0.2
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 8), material(0xf3f6ef)); pole.position.y = 1
        buoy.add(float, pole); buoy.scale.setScalar(1.16); buoy.position.set(side * (6.75 + (i % 3) * 0.5), 0, z); this.laneObjects.add(buoy)
      }
      if (i % 5 === 2) {
        const arch = new THREE.Group()
        for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 5.4, 10), material(0xffe48a)); post.position.set(side * 6.25, 2.35, 0); arch.add(post) }
        const banner = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.62, 0.24), material(0x2bb7b5)); banner.position.y = 4.95; arch.add(banner)
        arch.position.z = z; this.laneObjects.add(arch)
      }
    }
  }

  private buildObstacles(): void {
    for (let index = 0; index < 18; index++) {
      const obstacle = this.buildObstacle(index % 5)
      obstacle.userData.index = index
      obstacle.userData.motionMode = index % 4
      obstacle.userData.pass = 0
      obstacle.userData.hit = false
      obstacle.scale.setScalar(1.24)
      obstacle.position.z = -24 - index * 17.5
      this.placeObstacle(obstacle)
      this.obstacles.add(obstacle)
    }
  }

  private buildObstacle(kind: number): THREE.Group {
    const obstacle = new THREE.Group()
    obstacle.userData.radiusX = 1.48
    obstacle.userData.radiusY = 0.9
    if (kind === 0) {
      const reef = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), material(0xe7654f, 0.9))
      reef.scale.set(1.25, 0.78, 0.9); obstacle.add(reef)
      const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 0), material(0xffb04d, 0.78))
      cap.position.set(0.55, 0.45, -0.1); obstacle.add(cap)
    } else if (kind === 1) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.25, 1.25), material(0x9b5938, 0.82))
      obstacle.add(crate)
      for (const offset of [-0.48, 0.48]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.32, 1.32), material(0xffd16a, 0.55))
        band.position.x = offset; obstacle.add(band)
      }
    } else if (kind === 2) {
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), material(0x7c62d7, 0.42, 0.12))
      pod.scale.y = 1.18; obstacle.add(pod)
      for (let arm = 0; arm < 5; arm++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 7), material(0x5ce0bd, 0.5))
        const angle = arm / 5 * Math.PI * 2
        spike.position.set(Math.cos(angle) * 0.74, Math.sin(angle * 2) * 0.18, Math.sin(angle) * 0.74)
        spike.rotation.z = Math.PI / 2; spike.rotation.y = -angle; obstacle.add(spike)
      }
    } else if (kind === 3) {
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), material(0xff6a72, 0.38, 0.16))
      obstacle.add(hub)
      for (let arm = 0; arm < 2; arm++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.24, 0.28), material(arm ? 0xffd45d : 0x4fe2c1, 0.45, 0.1))
        beam.rotation.z = arm * Math.PI / 2; obstacle.add(beam)
        for (const side of [-1, 1]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: arm ? 0xff7a85 : 0x8dfff0 }))
          lamp.position.set(arm ? 0 : side * 1.68, arm ? side * 1.68 : 0, 0); obstacle.add(lamp)
        }
      }
      obstacle.userData.radiusX = 2.15
      obstacle.userData.radiusY = 1.05
    } else {
      for (const offset of [-0.58, 0, 0.58]) {
        const mine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.56, 1), material(offset ? 0x7356c9 : 0xff6f82, 0.34, 0.22))
        mine.position.set(offset, Math.abs(offset) * 0.65, 0); obstacle.add(mine)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.06, 7, 22), new THREE.MeshBasicMaterial({ color: offset ? 0x7fffe2 : 0xffdc72 }))
        ring.position.copy(mine.position); ring.rotation.x = Math.PI / 2; obstacle.add(ring)
      }
      obstacle.userData.radiusX = 1.72
      obstacle.userData.radiusY = 1.12
    }
    const warningRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.055, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffed8a }))
    warningRing.rotation.x = Math.PI / 2; warningRing.position.y = -0.62; obstacle.add(warningRing)
    obstacle.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true })
    return obstacle
  }

  private placeObstacle(obstacle: THREE.Object3D): void {
    const lanePattern = [-4.65, -2.35, 0, 2.35, 4.65, -1.15, 3.55, -3.55, 1.15]
    const heightPattern = [0.7, 1.88, 1.24, 0.72, 1.86, 0.98, 1.58, 1.42, 0.76]
    const pattern = (Number(obstacle.userData.index) + Number(obstacle.userData.pass)) % lanePattern.length
    obstacle.userData.baseX = lanePattern[pattern]
    obstacle.userData.baseY = heightPattern[pattern]
    obstacle.userData.phase = Number(obstacle.userData.index) * 1.73 + Number(obstacle.userData.pass) * 0.61
    obstacle.position.x = Number(obstacle.userData.baseX)
    obstacle.position.y = Number(obstacle.userData.baseY)
  }

  private resetObstacles(): void {
    this.obstacles.children.forEach((obstacle, index) => {
      obstacle.userData.pass = 0
      obstacle.userData.hit = false
      obstacle.position.z = -24 - index * 17.5
      this.placeObstacle(obstacle)
    })
  }

  private buildScenery(): void {
    for (let index = 0; index < 13; index++) {
      const side = index % 2 === 0 ? -1 : 1
      const island = new THREE.Group()
      const rock = new THREE.Mesh(new THREE.ConeGeometry(2.2 + index % 3 * 0.35, 4.2, 7), material(index % 2 ? 0x3d877b : 0x477d71, 0.94))
      rock.position.y = 1.45; island.add(rock)
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 0), material(0x62bf8d, 0.84))
      crown.position.y = 3.8; crown.scale.set(1.35, 0.72, 1.2); island.add(crown)
      island.position.set(side * (12.5 + index % 3 * 2.5), -0.4, -18 - index * 24)
      island.scale.setScalar(1.14)
      island.userData.minLevel = 1; this.scenery.add(island)

      const coral = new THREE.Group()
      for (let branch = 0; branch < 3; branch++) {
        const stem = new THREE.Mesh(new THREE.ConeGeometry(0.28 + branch * 0.06, 2.5 + branch * 0.55, 7), material(branch % 2 ? 0xff7a8b : 0x8c72e5, 0.58))
        stem.position.set((branch - 1) * 0.62, 1.05 + branch * 0.14, 0)
        stem.rotation.z = (branch - 1) * -0.18; coral.add(stem)
      }
      coral.position.set(-side * (9.6 + index % 4 * 1.3), -0.2, -30 - index * 22)
      coral.scale.setScalar(1.2)
      coral.userData.minLevel = 2; this.scenery.add(coral)

      if (index < 9) {
        const crystal = new THREE.Group()
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 6.5 + index % 3, 6), material(index % 2 ? 0x4a66c8 : 0x55d5cf, 0.28, 0.38))
        tower.position.y = 3; crystal.add(tower)
        const halo = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 6, 30), new THREE.MeshBasicMaterial({ color: index % 2 ? 0xffd67d : 0x8dfff0 }))
        halo.position.y = 5.2; halo.rotation.x = Math.PI / 2; crystal.add(halo)
        crystal.position.set(side * (10.4 + index % 3 * 1.8), -0.2, -42 - index * 28)
        crystal.scale.setScalar(1.18)
        crystal.userData.minLevel = 3; this.scenery.add(crystal)
      }
    }

    const starPositions: number[] = []
    for (let index = 0; index < 90; index++) {
      starPositions.push(Math.sin(index * 9.7) * 62, 12 + (index * 7 % 28), -20 - (index * 19 % 170))
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xe8fff9, size: 0.42, transparent: true, opacity: 0.86, fog: false }))
    stars.userData.minLevel = 3; stars.userData.static = true; this.scenery.add(stars)
    this.scenery.traverse((object) => { if (object instanceof THREE.Mesh) object.receiveShadow = object.castShadow = true })
  }

  private applyLevelTheme(config: LevelConfig): void {
    this.currentLevel = config.level
    const themes = [
      { sky: 0x8ed7e9, fog: 0x8ed7e9, water: 0x177fa1, sun: 3.6, hemi: 2.7, exposure: 1.08 },
      { sky: 0x67b9d0, fog: 0x77c5d5, water: 0x116f94, sun: 3.2, hemi: 2.55, exposure: 1.12 },
      { sky: 0x485f9e, fog: 0x566fa4, water: 0x183f78, sun: 2.55, hemi: 2.25, exposure: 1.2 },
    ][config.level - 1]
    ;(this.scene.background as THREE.Color).setHex(themes.sky)
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(themes.fog)
      this.scene.fog.near = config.level === 3 ? 30 : 38
      this.scene.fog.far = config.level === 3 ? 122 : 145
    }
    this.water.material.color.setHex(themes.water)
    this.sun.intensity = themes.sun
    this.hemi.intensity = themes.hemi
    this.renderer.toneMappingExposure = themes.exposure
    this.obstacles.children.forEach((obstacle, index) => { obstacle.visible = index < config.obstacleCount })
    this.scenery.children.forEach((object) => { object.visible = Number(object.userData.minLevel ?? 1) <= config.level })
  }

  private moveScenery(dt: number, speed: number): void {
    for (const object of this.scenery.children) {
      if (object.userData.static) continue
      object.position.z += speed * dt * 0.72
      if (object.position.z > 26) object.position.z -= 310
    }
  }

  private update(dt: number, now: number): void {
    const wave = now * 0.001
    const positions = this.water.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i)
      positions.setZ(i, Math.sin(x * 0.24 + wave * 1.6) * 0.28 + Math.cos(y * 0.16 + wave) * 0.2)
    }
    positions.needsUpdate = true
    this.water.geometry.computeVertexNormals()

    if (this.remoteFollowing) {
      this.moveScenery(dt, LEVEL_CONFIGS[this.currentLevel - 1].speed)
      this.renderer.render(this.scene, this.camera)
      return
    }

    if (!this.running || this.finished) {
      this.boat.position.y = 1.2 + Math.sin(wave * 1.7) * 0.12
      this.boat.rotation.z *= Math.max(0, 1 - dt * 2)
      this.renderer.render(this.scene, this.camera)
      return
    }

    this.elapsed += dt; this.timeLeft = Math.max(0, 60 - this.elapsed)
    const levelConfig = levelForElapsed(this.elapsed)
    if (levelConfig.level !== this.currentLevel) this.applyLevelTheme(levelConfig)
    const roll = THREE.MathUtils.clamp(this.tilt.roll, -9, 9)
    const pitch = THREE.MathUtils.clamp(this.tilt.pitch, -14, 14)
    this.maxRoll = Math.max(this.maxRoll, Math.abs(roll))
    const stable = isStable(roll, pitch)
    const danger = Math.abs(roll) >= DANGER_DEGREES
    if (stable) { this.stableSeconds += dt; this.score += dt * 115 }
    else this.score += dt * Math.max(8, 52 - Math.abs(roll) * 2.2)
    this.boat.rotation.z += (THREE.MathUtils.degToRad(-roll * 1.38) - this.boat.rotation.z) * Math.min(1, dt * 8)
    this.boat.rotation.x += (THREE.MathUtils.degToRad(pitch * 0.45) - this.boat.rotation.x) * Math.min(1, dt * 7)
    this.boat.position.x += (this.horizontalTarget - this.boat.position.x) * Math.min(1, dt * 10)
    const verticalTarget = pitchToBoatHeight(pitch) + Math.sin(wave * 2.1) * 0.09
    this.boat.position.y += (verticalTarget - this.boat.position.y) * Math.min(1, dt * 8)
    const courseSpeed = levelConfig.speed
    for (const object of this.laneObjects.children) {
      object.position.z += courseSpeed * dt
      if (object.position.z > 18) object.position.z -= 312
    }
    for (const obstacle of this.obstacles.children) {
      if (!obstacle.visible) continue
      obstacle.position.z += courseSpeed * dt
      obstacle.rotation.y += dt * (0.82 + Number(obstacle.userData.motionMode) * 0.22)
      if (obstacle.position.z > 15) {
        obstacle.position.z -= 308
        obstacle.userData.pass = Number(obstacle.userData.pass) + 1
        obstacle.userData.hit = false
        this.placeObstacle(obstacle)
      }
      const motion = obstacleMotion(this.elapsed, levelConfig, Number(obstacle.userData.phase), Number(obstacle.userData.motionMode))
      obstacle.position.x = THREE.MathUtils.clamp(Number(obstacle.userData.baseX) + motion.x, -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT)
      obstacle.position.y = THREE.MathUtils.clamp(Number(obstacle.userData.baseY) + motion.y, 0.55, 2.15)
      if (!obstacle.userData.hit && Math.abs(obstacle.position.z - this.boat.position.z) < 1.55 && overlapsObstacle(this.boat.position.x, this.boat.position.y, obstacle.position.x, obstacle.position.y, Number(obstacle.userData.radiusX), Number(obstacle.userData.radiusY))) {
        obstacle.userData.hit = true
        this.hits += 1
        this.score = Math.max(0, this.score - 280)
        this.collisionPulse = 0.32
      }
    }
    this.moveScenery(dt, courseSpeed)
    this.collisionPulse = Math.max(0, this.collisionPulse - dt)
    const collisionScale = this.collisionPulse > 0 ? 1 + Math.sin(this.collisionPulse * 55) * 0.055 : 1
    this.boat.scale.setScalar(collisionScale)
    this.camera.position.x += ((this.boat.position.x * 0.42) - this.camera.position.x) * Math.min(1, dt * 3)
    this.camera.lookAt(this.boat.position.x * 0.14, 1.25, -8)

    if (isCapsized(roll)) this.capsizeHold += dt
    else this.capsizeHold = Math.max(0, this.capsizeHold - dt * 2.4)
    const stats: RunStats = {
      timeLeft: this.timeLeft,
      stableSeconds: this.stableSeconds,
      score: Math.round(this.score),
      roll,
      pitch,
      stable,
      danger,
      hits: this.hits,
      level: levelConfig.level,
      levelName: levelConfig.name,
      levelProgress: Math.min(1, (this.elapsed - (levelConfig.level - 1) * LEVEL_DURATION_SECONDS) / LEVEL_DURATION_SECONDS),
    }
    this.callbacks.update(stats)
    if (this.callbacks.frame && now - this.lastFrameSent >= 85) {
      this.lastFrameSent = now
      this.callbacks.frame(this.createFrame(stats))
    }
    if (this.capsizeHold >= 0.18) this.finish('capsized')
    else if (this.timeLeft <= 0) this.finish('finished')
    this.renderer.render(this.scene, this.camera)
  }

  private finish(reason: RunResult['reason']): void {
    if (this.finished) return
    this.finished = true; this.running = false
    if (reason === 'capsized') this.boat.rotation.z = this.tilt.roll > 0 ? -Math.PI / 2 : Math.PI / 2
    this.callbacks.finish({ completed: reason === 'finished', reason, score: Math.round(this.score), grade: gradeFor(this.stableSeconds, Math.max(0.01, this.elapsed)), stableSeconds: this.stableSeconds, totalSeconds: this.elapsed, maxRoll: this.maxRoll, hits: this.hits })
  }

  private createFrame(stats: RunStats): GameFrame {
    return {
      stats,
      boat: {
        x: this.boat.position.x,
        y: this.boat.position.y,
        rotationX: this.boat.rotation.x,
        rotationZ: this.boat.rotation.z,
        scale: this.boat.scale.x,
      },
      obstacles: this.obstacles.children.map((obstacle) => ({
        x: obstacle.position.x,
        y: obstacle.position.y,
        z: obstacle.position.z,
        rotationY: obstacle.rotation.y,
        visible: obstacle.visible,
      })),
    }
  }

  private resize = (): void => {
    const width = this.canvas.clientWidth || innerWidth, height = this.canvas.clientHeight || innerHeight
    this.renderer.setSize(width, height, false); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7))
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix()
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.04, Math.max(0, (now - this.last) / 1000)); this.last = now
    this.update(dt, now); this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize); this.renderer.dispose() }
}
