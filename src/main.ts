import './styles.css'
import QRCode from 'qrcode'
import { FriendshipBoatGame, type RunResult, type RunStats } from './game'
import { OrientationSensor } from './sensor'
import { CAPSIZE_DEGREES, DANGER_DEGREES, STABLE_DEGREES } from './rules'

const app = document.querySelector<HTMLDivElement>('#app')!
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 1024)
const launchUrl = new URL(`${location.origin}${location.pathname}`)
launchUrl.searchParams.set('release', '5')
const cleanUrl = launchUrl.toString()

if (isMobile) renderMobile()
else void renderDesktop()

async function renderDesktop(): Promise<void> {
  app.innerHTML = `
    <main class="desktop-page">
      <section class="desktop-copy">
        <p class="kicker">手机姿态感应挑战</p>
        <h1>友谊的<br><em>小船</em></h1>
        <p class="desktop-lead">这是一款手机姿态感应游戏，请使用手机体验。</p>
        <div class="steps"><span>01 手机横屏</span><span>02 允许感应</span><span>03 水平校准</span><span>04 滑动避障</span></div>
      </section>
      <aside class="phone-card">
        <div class="qr-frame"><canvas id="qr-code" aria-label="手机游戏二维码"></canvas><i></i></div>
        <h2>扫码上船</h2>
        <p>使用手机相机扫描二维码，在支持姿态传感器的浏览器中打开。</p>
        <a href="${cleanUrl}" class="address">${cleanUrl}</a>
        ${location.protocol !== 'https:' ? '<p class="local-warning">当前是本地调试地址。正式手机体验必须使用下方交付的 HTTPS 地址。</p>' : ''}
      </aside>
      <section class="permission-help">
        <article><b>iPhone Safari</b><p>保持横屏，在页面内点击“允许感应并开始”，随后在系统弹窗中选择“允许”。若曾拒绝，请前往“设置 → Safari → 动作与方向访问”。</p></article>
        <article><b>Android Chrome</b><p>保持横屏，点击“允许感应并开始”。若没有数据，请检查 Chrome 的网站设置及手机“动作与健身/传感器”权限。</p></article>
      </section>
    </main>`
  const canvas = document.querySelector<HTMLCanvasElement>('#qr-code')!
  await QRCode.toCanvas(canvas, cleanUrl, { width: 236, margin: 1, color: { dark: '#082c3a', light: '#fffaf0' }, errorCorrectionLevel: 'H' })
}

function renderMobile(): void {
  app.innerHTML = `
    <main class="mobile-game">
      <canvas id="boat-canvas" aria-label="通过手机姿态和左右滑动控制的友谊小船三维游戏"></canvas>
      <div class="game-shade"></div>
      <div id="mobile-hud" class="mobile-hud hidden">
        <div class="hud-cell"><small>剩余时间</small><b id="time-left">60.0</b></div>
        <div class="balance-meter"><span>左倾</span><div><i id="tilt-marker"></i><em></em></div><span>右倾</span></div>
        <div class="hud-cell right"><small>得分 · 碰撞</small><b><span id="score">0</span><em id="hit-count">0次</em></b></div>
        <div id="stable-badge" class="stable-badge">稳定 ±${STABLE_DEGREES}° · 翻船 ±${CAPSIZE_DEGREES}°</div>
        <div class="swipe-hint">↔ 左右滑动避障 · 手机俯仰控制上下</div>
      </div>
      <section id="mobile-stage" class="mobile-stage"></section>
    </main>`

  const stage = document.querySelector<HTMLElement>('#mobile-stage')!
  const hud = document.querySelector<HTMLElement>('#mobile-hud')!
  const mobileRoot = document.querySelector<HTMLElement>('.mobile-game')!
  const sensor = new OrientationSensor()
  const game = new FriendshipBoatGame(document.querySelector<HTMLCanvasElement>('#boat-canvas')!, { update: updateHud, finish: showResult })
  sensor.onTilt = (tilt) => game.setTilt(tilt)

  let activePointer: number | null = null
  let lastPointerX = 0
  mobileRoot.addEventListener('pointerdown', (event) => {
    if (!mobileRoot.classList.contains('is-running') || event.pointerType === 'mouse') return
    activePointer = event.pointerId
    lastPointerX = event.clientX
    mobileRoot.setPointerCapture?.(event.pointerId)
  })
  mobileRoot.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer || !mobileRoot.classList.contains('is-running')) return
    event.preventDefault()
    game.steerHorizontal(event.clientX - lastPointerX, innerWidth)
    lastPointerX = event.clientX
  })
  const endSwipe = (event: PointerEvent) => {
    if (event.pointerId === activePointer) activePointer = null
  }
  mobileRoot.addEventListener('pointerup', endSwipe)
  mobileRoot.addEventListener('pointercancel', endSwipe)

  function landscape(): boolean { return innerWidth > innerHeight }

  function showIntro(): void {
    game.stop(); mobileRoot.classList.remove('is-running'); hud.classList.add('hidden'); stage.classList.remove('hidden')
    stage.innerHTML = landscape() ? `
      <div class="setup-card intro-card"><p class="kicker">仅限手机 · 真实姿态传感器</p><h1>友谊的小船</h1><p>保持手机横屏。接下来浏览器将申请动作与方向传感器权限。</p><div class="sensor-promise"><span>没有键盘</span><span>没有虚拟摇杆</span><span>只读真实姿态</span></div><button class="primary" data-action="permission">允许感应并开始</button><small>点击即表示你准备授予当前页面动作与方向权限</small></div>` : `
      <div class="rotate-card"><div class="rotate-phone"><i></i></div><p class="kicker">第一步</p><h2>请将手机转为横屏</h2><p>请从屏幕顶部下拉，确认已开启“自动旋转”，然后横向拿住手机。横屏后页面会自动继续。</p><button class="secondary" data-action="recheck-orientation">重新检测横屏</button><small id="orientation-hint">若画面仍未旋转，请保持横向并点击按钮。</small></div>`
  }

  function showCalibration(message = ''): void {
    mobileRoot.classList.remove('is-running')
    stage.classList.remove('hidden'); hud.classList.add('hidden')
    stage.innerHTML = `<div class="setup-card calibrate-card"><div class="step-number">02</div><p class="kicker">水平基准</p><h2>把手机屏幕朝上<br>放在平整桌面</h2><p>保持手机静止，然后点击校准。之后拿起手机时，这个姿态会被视为 0°。</p>${message ? `<p class="inline-error">${message}</p>` : ''}<div class="level-visual"><i></i><span>0°</span></div><button class="primary" data-action="calibrate">校准水平</button></div>`
  }

  function showReady(): void {
    mobileRoot.classList.remove('is-running')
    stage.innerHTML = `<div class="setup-card ready-card"><div class="success-mark">✓</div><p class="kicker">校准完成</p><h2>双手拿起手机</h2><p>左右滑动控制船位避障，俯仰手机控制上下；横倾达到 <b>±${CAPSIZE_DEGREES}°</b> 就会翻船。</p><div class="angle-rules"><span><i class="safe"></i>${STABLE_DEGREES}° 稳定</span><span><i class="warn"></i>${DANGER_DEGREES}° 警戒</span><span><i class="danger"></i>${CAPSIZE_DEGREES}° 翻船</span></div><button class="primary" data-action="start">开始挑战</button></div>`
  }

  function showError(reason: string): void {
    mobileRoot.classList.remove('is-running')
    const messages: Record<string, { title: string; body: string }> = {
      insecure: { title: '需要 HTTPS 安全连接', body: '当前地址不是 HTTPS，手机浏览器不会提供姿态传感器。请使用正式 HTTPS 游戏地址。' },
      unsupported: { title: '此设备不支持姿态感应', body: '未检测到 DeviceOrientationEvent 或 DeviceMotionEvent。请换用支持传感器的手机浏览器。' },
      denied: { title: '传感器权限被拒绝', body: '请在浏览器或系统设置中允许此网站使用动作与方向传感器，然后刷新页面重试。不会提供虚拟控制替代。' },
      'no-data': { title: '没有收到传感器数据', body: '浏览器虽提供接口，但没有返回真实姿态数据。请检查网站权限、系统传感器权限或更换浏览器。' },
    }
    const content = messages[reason] ?? messages.unsupported
    stage.innerHTML = `<div class="setup-card error-card"><div class="error-icon">!</div><p class="kicker">无法开始</p><h2>${content.title}</h2><p>${content.body}</p><button class="secondary" data-action="retry">重新检查</button></div>`
  }

  async function requestSensor(): Promise<void> {
    const button = stage.querySelector<HTMLButtonElement>('button')
    if (button) { button.disabled = true; button.textContent = '正在等待系统授权…' }
    const status = await sensor.requestPermission()
    if (!status.ok) showError(status.reason ?? 'unsupported')
    else showCalibration()
  }

  function calibrate(): void {
    if (!sensor.calibrate()) { showCalibration('还没有收到姿态数据，请保持手机静止后再试。'); return }
    showReady()
  }

  async function countdown(): Promise<void> {
    if (!landscape()) { showIntro(); return }
    stage.classList.add('countdown'); stage.innerHTML = '<div class="count-number">3</div>'
    for (const text of ['3', '2', '1', '友谊出发']) {
      const node = stage.querySelector<HTMLElement>('.count-number')!
      node.textContent = text; node.animate([{ transform: 'scale(.65)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, fill: 'both' })
      await new Promise((resolve) => setTimeout(resolve, text === '友谊出发' ? 650 : 850))
    }
    stage.className = 'mobile-stage hidden'; hud.classList.remove('hidden'); mobileRoot.classList.add('is-running'); game.start()
    try { await navigator.wakeLock?.request('screen') } catch { /* Wake Lock is optional. */ }
  }

  function updateHud(stats: RunStats): void {
    const time = document.querySelector<HTMLElement>('#time-left')!, score = document.querySelector<HTMLElement>('#score')!, hits = document.querySelector<HTMLElement>('#hit-count')!
    const marker = document.querySelector<HTMLElement>('#tilt-marker')!, badge = document.querySelector<HTMLElement>('#stable-badge')!
    time.textContent = stats.timeLeft.toFixed(1); score.textContent = String(stats.score); hits.textContent = `${stats.hits}次`
    marker.style.left = `${50 + Math.max(-CAPSIZE_DEGREES, Math.min(CAPSIZE_DEGREES, stats.roll)) / CAPSIZE_DEGREES * 50}%`
    marker.className = stats.danger ? 'danger' : stats.stable ? 'safe' : ''
    badge.className = `stable-badge ${stats.stable ? 'active' : stats.danger ? 'danger' : ''}`
    badge.textContent = stats.stable ? `稳定！横倾 ${stats.roll.toFixed(1)}°` : stats.danger ? `危险！横倾 ${stats.roll.toFixed(1)}°` : `横倾 ${stats.roll.toFixed(1)}° · 俯仰 ${stats.pitch.toFixed(1)}°`
  }

  function showResult(result: RunResult): void {
    mobileRoot.classList.remove('is-running')
    hud.classList.add('hidden'); stage.className = 'mobile-stage'; stage.classList.remove('hidden')
    stage.innerHTML = `<div class="setup-card result-card"><p class="kicker">${result.completed ? '航程完成' : '挑战结束'}</p><h2>${result.completed ? '友谊经受住了风浪' : '小船翻了，再稳一点'}</h2><div class="grade">${result.grade}</div><div class="result-grid"><span><small>得分</small><b>${result.score}</b></span><span><small>稳定时间</small><b>${result.stableSeconds.toFixed(1)}秒</b></span><span><small>最大倾角</small><b>${result.maxRoll.toFixed(1)}°</b></span><span><small>碰撞</small><b>${result.hits}次</b></span></div><p>${result.reason === 'capsized' ? `横倾达到 ${CAPSIZE_DEGREES}° 并超过安全缓冲，小船已翻覆。` : `你坚持了完整的 60 秒，并躲避了航道障碍。`}</p><button class="primary" data-action="recalibrate">重新校准再挑战</button></div>`
  }

  stage.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
    if (action === 'permission') void requestSensor()
    if (action === 'calibrate') calibrate()
    if (action === 'start') void countdown()
    if (action === 'retry') showIntro()
    if (action === 'recalibrate') showCalibration()
    if (action === 'recheck-orientation') {
      if (landscape()) showIntro()
      else {
        const hint = document.querySelector<HTMLElement>('#orientation-hint')
        if (hint) {
          hint.textContent = '浏览器仍将当前画面识别为竖屏。请保持手机横向，确认系统自动旋转已开启后再试。'
          hint.classList.add('inline-error')
        }
      }
    }
  })

  function syncOrientation(): void {
    if (stage.classList.contains('hidden')) return
    if (!landscape() || stage.querySelector('.rotate-card')) showIntro()
  }

  function scheduleOrientationSync(): void {
    window.setTimeout(syncOrientation, 180)
  }

  window.addEventListener('resize', syncOrientation)
  window.addEventListener('orientationchange', scheduleOrientationSync)
  screen.orientation?.addEventListener('change', scheduleOrientationSync)
  showIntro()
}
