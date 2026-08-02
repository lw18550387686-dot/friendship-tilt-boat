import * as THREE from 'three'
import { gradeFor, isCapsized, isStable, type Tilt } from './sensor'
import { DANGER_DEGREES, HORIZONTAL_LIMIT, overlapsObstacle, pitchToBoatHeight, swipeToWorldDelta } from './rules'

export interface RunStats {
  timeLeft: number
  stableSeconds: number
  score: number
  roll: number
  pitch: number
  stable: boolean
  danger: boolean
  hits: number
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
}

const material = (color: number, roughness = 0.65, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })

export class FriendshipBoatGame {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  private boat = new THREE.Group()
  private water!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private laneObjects = new THREE.Group()
  private obstacles = new THREE.Group()
  private tilt: Tilt = { roll: 0, pitch: 0 }
  private horizontalTarget = 0
  private running = false
  private finished = false
  private timeLeft = 60
  private elapsed = 0
  private stableSeconds = 0
  private score = 0
  private maxRoll = 0
  private capsizeHold = 0
  private hits = 0
  private collisionPulse = 0
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
    this.finished = false
    this.timeLeft = 60
    this.elapsed = 0
    this.stableSeconds = 0
    this.score = 0
    this.maxRoll = 0
    this.capsizeHold = 0
    this.hits = 0
    this.collisionPulse = 0
    this.horizontalTarget = 0
    this.boat.position.set(0, 1.2, 3)
    this.boat.rotation.set(0, 0, 0)
    this.boat.scale.setScalar(1)
    this.resetObstacles()
  }

  stop(): void { this.running = false }
  setTilt(tilt: Tilt): void { this.tilt = tilt }
  steerHorizontal(deltaPixels: number, viewportWidth: number): void {
    if (!this.running) return
    this.horizontalTarget = THREE.MathUtils.clamp(this.horizontalTarget + swipeToWorldDelta(deltaPixels, viewportWidth), -HORIZONTAL_LIMIT, HORIZONTAL_LIMIT)
  }

  private buildScene(): void {
    const hemi = new THREE.HemisphereLight(0xe9fbff, 0x185b78, 2.7)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff2ce, 3.6)
    sun.position.set(-12, 22, 18); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
    this.scene.add(sun)

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

    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: 0xffe7a4, fog: false }))
    sunDisc.position.set(-32, 25, -95); this.scene.add(sunDisc)
    this.camera.position.set(0, 8.2, 16)
    this.camera.lookAt(0, 1.5, -8)
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
        buoy.add(float, pole); buoy.position.set(side * (5 + (i % 3) * 0.45), 0, z); this.laneObjects.add(buoy)
      }
      if (i % 5 === 2) {
        const arch = new THREE.Group()
        for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 5, 10), material(0xffe48a)); post.position.set(side * 4.5, 2.2, 0); arch.add(post) }
        const banner = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.5, 0.2), material(0x2bb7b5)); banner.position.y = 4.6; arch.add(banner)
        arch.position.z = z; this.laneObjects.add(arch)
      }
    }
  }

  private buildObstacles(): void {
    for (let index = 0; index < 14; index++) {
      const obstacle = this.buildObstacle(index % 3)
      obstacle.userData.index = index
      obstacle.userData.pass = 0
      obstacle.userData.hit = false
      obstacle.position.z = -24 - index * 22
      this.placeObstacle(obstacle)
      this.obstacles.add(obstacle)
    }
  }

  private buildObstacle(kind: number): THREE.Group {
    const obstacle = new THREE.Group()
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
    } else {
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), material(0x7c62d7, 0.42, 0.12))
      pod.scale.y = 1.18; obstacle.add(pod)
      for (let arm = 0; arm < 5; arm++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 7), material(0x5ce0bd, 0.5))
        const angle = arm / 5 * Math.PI * 2
        spike.position.set(Math.cos(angle) * 0.74, Math.sin(angle * 2) * 0.18, Math.sin(angle) * 0.74)
        spike.rotation.z = Math.PI / 2; spike.rotation.y = -angle; obstacle.add(spike)
      }
    }
    const warningRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.055, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffed8a }))
    warningRing.rotation.x = Math.PI / 2; warningRing.position.y = -0.62; obstacle.add(warningRing)
    obstacle.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true })
    return obstacle
  }

  private placeObstacle(obstacle: THREE.Object3D): void {
    const lanePattern = [-3.35, 0, 3.35, 0, -3.35, 3.35, 0]
    const heightPattern = [0.72, 1.86, 0.72, 1.86, 1.86, 0.72, 1.25]
    const pattern = (Number(obstacle.userData.index) + Number(obstacle.userData.pass)) % lanePattern.length
    obstacle.position.x = lanePattern[pattern]
    obstacle.position.y = heightPattern[pattern]
  }

  private resetObstacles(): void {
    this.obstacles.children.forEach((obstacle, index) => {
      obstacle.userData.pass = 0
      obstacle.userData.hit = false
      obstacle.position.z = -24 - index * 22
      this.placeObstacle(obstacle)
    })
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

    if (!this.running || this.finished) {
      this.boat.position.y = 1.2 + Math.sin(wave * 1.7) * 0.12
      this.boat.rotation.z *= Math.max(0, 1 - dt * 2)
      this.renderer.render(this.scene, this.camera)
      return
    }

    this.elapsed += dt; this.timeLeft = Math.max(0, 60 - this.elapsed)
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
    const courseSpeed = 9.2
    for (const object of this.laneObjects.children) {
      object.position.z += courseSpeed * dt
      if (object.position.z > 18) object.position.z -= 312
    }
    for (const obstacle of this.obstacles.children) {
      obstacle.position.z += courseSpeed * dt
      obstacle.rotation.y += dt * 0.65
      if (obstacle.position.z > 15) {
        obstacle.position.z -= 308
        obstacle.userData.pass = Number(obstacle.userData.pass) + 1
        obstacle.userData.hit = false
        this.placeObstacle(obstacle)
      }
      if (!obstacle.userData.hit && Math.abs(obstacle.position.z - this.boat.position.z) < 1.45 && overlapsObstacle(this.boat.position.x, this.boat.position.y, obstacle.position.x, obstacle.position.y)) {
        obstacle.userData.hit = true
        this.hits += 1
        this.score = Math.max(0, this.score - 280)
        this.collisionPulse = 0.32
      }
    }
    this.collisionPulse = Math.max(0, this.collisionPulse - dt)
    const collisionScale = this.collisionPulse > 0 ? 1 + Math.sin(this.collisionPulse * 55) * 0.055 : 1
    this.boat.scale.setScalar(collisionScale)
    this.camera.position.x += ((this.boat.position.x * 0.42) - this.camera.position.x) * Math.min(1, dt * 3)
    this.camera.lookAt(this.boat.position.x * 0.14, 1.25, -8)

    if (isCapsized(roll)) this.capsizeHold += dt
    else this.capsizeHold = Math.max(0, this.capsizeHold - dt * 2.4)
    this.callbacks.update({ timeLeft: this.timeLeft, stableSeconds: this.stableSeconds, score: Math.round(this.score), roll, pitch, stable, danger, hits: this.hits })
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
