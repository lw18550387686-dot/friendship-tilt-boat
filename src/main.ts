import './styles.css'
import QRCode from 'qrcode'
import { FriendshipBoatGame, type RunResult, type RunStats } from './game'
import { OrientationSensor, type Tilt } from './sensor'
import { CAPSIZE_DEGREES, DANGER_DEGREES, STABLE_DEGREES } from './rules'
import { CoopSession, normalizeRoomCode, type CoopMessage } from './coop'

const app = document.querySelector<HTMLDivElement>('#app')!
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 1024)
const launchUrl = new URL(`${location.origin}${location.pathname}`)
const invitedRoom = normalizeRoomCode(new URL(location.href).searchParams.get('room') ?? '')
launchUrl.searchParams.set('release', '7')
if (invitedRoom) launchUrl.searchParams.set('room', invitedRoom)
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
        <div class="steps"><span>01 手机横屏</span><span>02 允许感应</span><span>03 水平校准</span><span>04 三关避障</span><span>05 好友联机</span></div>
      </section>
      <aside class="phone-card">
        <div class="qr-frame"><canvas id="qr-code" aria-label="手机游戏二维码"></canvas><i></i></div>
        <h2>${invitedRoom ? '好友邀请你上船' : '扫码上船'}</h2>
        <p>${invitedRoom ? `房间 ${invitedRoom} 正在等你。` : '使用手机相机扫描二维码，在支持姿态传感器的浏览器中打开。'}</p>
        <a href="${cleanUrl}" class="address">${cleanUrl}</a>
        ${location.protocol !== 'https:' ? '<p class="local-warning">当前是本地调试地址。正式手机体验必须使用 HTTPS 地址。</p>' : ''}
      </aside>
      <section class="permission-help">
        <article><b>iPhone Safari</b><p>保持横屏，在页面内点击“允许感应并开始”，随后在系统弹窗中选择“允许”。若曾拒绝，请前往“设置 → Safari → 动作与方向访问”。</p></article>
        <article><b>Android Chrome</b><p>保持横屏，点击“允许感应并开始”。若没有数据，请检查 Chrome 的网站设置及手机“动作与健身/传感器”权限。</p></article>
      </section>
    </main>`
  const canvas = document.querySelector<HTMLCanvasElement>('#qr-code')!
  await QRCode.toCanvas(canvas, cleanUrl, { width: 236, margin: 1, color: { dark: '#082c3a', light: '#fffaf0' }, errorCorrectionLevel: 'H' })
}

type PlayMode = 'solo' | 'host' | 'guest'

function renderMobile(): void {
  app.innerHTML = `
    <main class="mobile-game">
      <canvas id="boat-canvas" aria-label="通过手机姿态和左右滑动控制的友谊小船三维游戏"></canvas>
      <div class="game-shade"></div>
      <div id="mobile-hud" class="mobile-hud hidden">
        <div class="hud-cell"><small>剩余时间</small><b id="time-left">60.0</b></div>
        <div class="balance-stack">
          <div class="level-pill"><b id="level-label">第1关 · 晨光湾</b><span><i id="level-progress"></i></span></div>
          <div class="balance-meter"><span>左倾</span><div><i id="tilt-marker"></i><em></em></div><span>右倾</span></div>
        </div>
        <div class="hud-cell right"><small>得分 · 碰撞</small><b><span id="score">0</span><em id="hit-count">0次</em></b></div>
        <div id="stable-badge" class="stable-badge">稳定 ±${STABLE_DEGREES}° · 翻船 ±${CAPSIZE_DEGREES}°</div>
        <div id="coop-badge" class="coop-badge hidden">双人已连接</div>
        <div class="swipe-hint">↔ 左右滑动避障 · 手机俯仰控制上下</div>
      </div>
      <section id="mobile-stage" class="mobile-stage"></section>
    </main>`

  const stage = document.querySelector<HTMLElement>('#mobile-stage')!
  const hud = document.querySelector<HTMLElement>('#mobile-hud')!
  const mobileRoot = document.querySelector<HTMLElement>('.mobile-game')!
  const sensor = new OrientationSensor()
  let mode: PlayMode = 'solo'
  let coop: CoopSession | undefined
  let localTilt: Tilt = { roll: 0, pitch: 0 }
  let remoteTilt: Tilt = { roll: 0, pitch: 0 }
  let lastTiltSent = 0
  let activePointer: number | null = null
  let lastPointerX = 0

  const game = new FriendshipBoatGame(document.querySelector<HTMLCanvasElement>('#boat-canvas')!, {
    update: updateHud,
    finish: handleFinish,
    frame: (frame) => { if (mode === 'host' && coop?.connected) coop.send({ type: 'frame', frame }) },
  })

  sensor.onTilt = (tilt) => {
    localTilt = tilt
    if (mode === 'guest') {
      const now = performance.now()
      if (now - lastTiltSent >= 45) {
        lastTiltSent = now
        coop?.send({ type: 'tilt', tilt })
      }
      return
    }
    if (mode === 'host' && coop?.connected) game.setTilt(averageTilt(localTilt, remoteTilt))
    else game.setTilt(tilt)
  }

  mobileRoot.addEventListener('pointerdown', (event) => {
    if (!mobileRoot.classList.contains('is-running') || event.pointerType === 'mouse') return
    activePointer = event.pointerId
    lastPointerX = event.clientX
    mobileRoot.setPointerCapture?.(event.pointerId)
  })
  mobileRoot.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer || !mobileRoot.classList.contains('is-running')) return
    event.preventDefault()
    const delta = event.clientX - lastPointerX
    if (mode === 'guest') coop?.send({ type: 'swipe', fraction: delta / Math.max(1, innerWidth) })
    else game.steerHorizontal(delta, innerWidth)
    lastPointerX = event.clientX
  })
  const endSwipe = (event: PointerEvent) => { if (event.pointerId === activePointer) activePointer = null }
  mobileRoot.addEventListener('pointerup', endSwipe)
  mobileRoot.addEventListener('pointercancel', endSwipe)

  function landscape(): boolean { return innerWidth > innerHeight }

  function averageTilt(first: Tilt, second: Tilt): Tilt {
    return { roll: (first.roll + second.roll) / 2, pitch: (first.pitch + second.pitch) / 2 }
  }

  function endCoop(): void {
    coop?.destroy()
    coop = undefined
    mode = 'solo'
    remoteTilt = { roll: 0, pitch: 0 }
  }

  function createCoop(): CoopSession {
    coop?.destroy()
    coop = new CoopSession({ status: updateCoopStatus, message: handleCoopMessage })
    return coop
  }

  function showIntro(): void {
    endCoop()
    game.stop(); mobileRoot.classList.remove('is-running'); hud.classList.add('hidden'); stage.classList.remove('hidden')
    stage.innerHTML = landscape() ? `
      <div class="setup-card intro-card"><p class="kicker">仅限手机 · 真实姿态传感器</p><h1>友谊的小船</h1><p>保持手机横屏。接下来浏览器将申请动作与方向传感器权限。</p><div class="sensor-promise"><span>三关递进</span><span>3°翻船</span><span>可邀请好友</span></div><button class="primary" data-action="permission">允许感应并开始</button><small>点击即表示你准备授予当前页面动作与方向权限</small></div>` : `
      <div class="rotate-card"><div class="rotate-phone"><i></i></div><p class="kicker">第一步</p><h2>请将手机转为横屏</h2><p>请从屏幕顶部下拉，确认已开启“自动旋转”，然后横向拿住手机。横屏后页面会自动继续。</p><button class="secondary" data-action="recheck-orientation">重新检测横屏</button><small id="orientation-hint">若画面仍未旋转，请保持横向并点击按钮。</small></div>`
  }

  function showCalibration(message = ''): void {
    mobileRoot.classList.remove('is-running'); stage.classList.remove('hidden'); hud.classList.add('hidden')
    stage.innerHTML = `<div class="setup-card calibrate-card"><div class="step-number">02</div><p class="kicker">水平基准</p><h2>把手机屏幕朝上<br>放在平整桌面</h2><p>保持手机静止，然后点击校准。之后拿起手机时，这个姿态会被视为 0°。</p>${message ? `<p class="inline-error">${message}</p>` : ''}<div class="level-visual"><i></i><span>0°</span></div><button class="primary" data-action="calibrate">校准水平</button></div>`
  }

  function showReady(): void {
    mobileRoot.classList.remove('is-running')
    const actions = invitedRoom
      ? `<button class="primary" data-action="join-room">加入好友房间 ${invitedRoom}</button><button class="secondary" data-action="solo-start">改为单人挑战</button>`
      : `<button class="primary" data-action="solo-start">单人三关挑战</button><button class="secondary" data-action="host-room">邀请好友一起坐船</button>`
    stage.innerHTML = `<div class="setup-card ready-card"><div class="success-mark">✓</div><p class="kicker">校准完成 · 三关航程</p><h2>超过 ±${CAPSIZE_DEGREES}° 就翻船</h2><p>左右滑动避障，俯仰手机控制上下。双人模式会平均两人的姿态，需要一起保持默契。</p><div class="angle-rules"><span><i class="safe"></i>${STABLE_DEGREES}° 稳定</span><span><i class="warn"></i>${DANGER_DEGREES}° 警戒</span><span><i class="danger"></i>${CAPSIZE_DEGREES}° 翻船</span></div><div class="mode-actions">${actions}</div></div>`
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

  async function hostRoom(): Promise<void> {
    mode = 'host'
    stage.innerHTML = `<div class="setup-card coop-card"><div class="boat-pair">● ●</div><p class="kicker">双人联机</p><h2>正在创建小船房间…</h2><p>正在连接房间信令服务。</p></div>`
    try {
      const room = await createCoop().host()
      await showHostLobby(room)
    } catch (error) {
      showCoopFailure(error instanceof Error ? error.message : '创建房间失败')
    }
  }

  async function showHostLobby(room: string): Promise<void> {
    const invite = new URL(`${location.origin}${location.pathname}`)
    invite.searchParams.set('release', '7')
    invite.searchParams.set('room', room)
    stage.innerHTML = `<div class="setup-card coop-card"><p class="kicker">房间 ${room}</p><h2>邀请好友上船</h2><div class="invite-layout"><div class="invite-qr"><canvas id="invite-qr" aria-label="好友联机邀请二维码"></canvas></div><div><p id="coop-status">等待好友扫描二维码或打开邀请链接。</p><div class="connection-state waiting"><i></i><span>等待好友上船</span></div><button class="secondary compact" data-action="share-invite" data-invite-url="${invite}">分享链接</button><button class="secondary compact" data-action="copy-invite" data-invite-url="${invite}">复制链接</button></div></div><div class="mode-actions"><button class="primary" data-action="coop-start" disabled>好友上船后开始</button><button class="secondary" data-action="cancel-coop">取消联机</button></div><small>连接建立后，游戏数据通过加密的 WebRTC 点对点传输。</small></div>`
    await QRCode.toCanvas(document.querySelector<HTMLCanvasElement>('#invite-qr')!, invite.toString(), { width: 156, margin: 1, color: { dark: '#082c3a', light: '#fffaf0' }, errorCorrectionLevel: 'M' })
  }

  async function joinRoom(): Promise<void> {
    if (!invitedRoom) return
    mode = 'guest'
    stage.innerHTML = `<div class="setup-card coop-card"><div class="boat-pair">● ●</div><p class="kicker">房间 ${invitedRoom}</p><h2>正在登上好友的小船</h2><p id="coop-status">正在建立点对点连接，请让船长停留在邀请页面。</p><div class="connection-state waiting"><i></i><span>连接中</span></div><button class="secondary" data-action="cancel-coop">取消</button></div>`
    try { await createCoop().join(invitedRoom) }
    catch (error) { showCoopFailure(error instanceof Error ? error.message : '加入房间失败') }
  }

  function showCoopFailure(message: string): void {
    stage.innerHTML = `<div class="setup-card error-card"><div class="error-icon">!</div><p class="kicker">联机失败</p><h2>没有连上好友的小船</h2><p>${message}</p><div class="mode-actions"><button class="secondary" data-action="cancel-coop">返回模式选择</button></div></div>`
  }

  function updateCoopStatus(status: 'waiting' | 'connected' | 'disconnected' | 'error', message: string): void {
    const statusNode = document.querySelector<HTMLElement>('#coop-status')
    if (statusNode) statusNode.textContent = message
    const connectionNode = document.querySelector<HTMLElement>('.connection-state')
    if (connectionNode) {
      connectionNode.className = `connection-state ${status}`
      const label = connectionNode.querySelector('span')
      if (label) label.textContent = status === 'connected' ? '双人连接成功' : status === 'waiting' ? '等待连接' : message
    }
    const start = document.querySelector<HTMLButtonElement>('[data-action="coop-start"]')
    if (start) { start.disabled = status !== 'connected'; start.textContent = status === 'connected' ? '双人开始三关挑战' : '好友上船后开始' }
    const badge = document.querySelector<HTMLElement>('#coop-badge')
    if (badge && status === 'disconnected') { badge.textContent = '好友已离开'; badge.classList.add('warning') }
  }

  function handleCoopMessage(message: CoopMessage): void {
    if (mode === 'host') {
      if (message.type === 'tilt') {
        remoteTilt = message.tilt
        game.setTilt(averageTilt(localTilt, remoteTilt))
      }
      if (message.type === 'swipe') game.steerHorizontal(message.fraction * innerWidth, innerWidth)
      return
    }
    if (mode !== 'guest') return
    if (message.type === 'start') void countdown(true)
    if (message.type === 'frame') game.applyRemoteFrame(message.frame)
    if (message.type === 'finish') { game.stop(); showResult(message.result) }
  }

  async function shareInvite(button: HTMLElement): Promise<void> {
    const url = button.dataset.inviteUrl
    if (!url) return
    try {
      if (navigator.share) await navigator.share({ title: '友谊的小船：邀请你一起上船', text: '打开链接，校准手机后一起挑战三关！', url })
      else { await navigator.clipboard.writeText(url); updateCoopStatus('waiting', '邀请链接已复制，请发送给好友') }
    } catch { /* The user may cancel the native share sheet. */ }
  }

  async function copyInvite(button: HTMLElement): Promise<void> {
    const url = button.dataset.inviteUrl
    if (!url) return
    try { await navigator.clipboard.writeText(url); updateCoopStatus('waiting', '邀请链接已复制，请发送给好友') }
    catch { updateCoopStatus('error', '复制失败，请使用系统分享按钮') }
  }

  async function countdown(remote = false): Promise<void> {
    if (!landscape()) { showIntro(); return }
    stage.classList.add('countdown'); stage.innerHTML = '<div class="count-number">3</div>'
    for (const text of ['3', '2', '1', remote ? '一起出发' : '友谊出发']) {
      const node = stage.querySelector<HTMLElement>('.count-number')!
      node.textContent = text
      node.animate([{ transform: 'scale(.65)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, fill: 'both' })
      await new Promise((resolve) => setTimeout(resolve, text.includes('出发') ? 650 : 850))
    }
    stage.className = 'mobile-stage hidden'; hud.classList.remove('hidden'); mobileRoot.classList.add('is-running')
    const coopBadge = document.querySelector<HTMLElement>('#coop-badge')!
    if (mode === 'solo') coopBadge.classList.add('hidden')
    else { coopBadge.classList.remove('hidden'); coopBadge.textContent = mode === 'host' ? '双人 · 船长' : '双人 · 伙伴' }
    if (remote) game.startRemote(); else game.start()
    try { await navigator.wakeLock?.request('screen') } catch { /* Wake Lock is optional. */ }
  }

  function updateHud(stats: RunStats): void {
    const time = document.querySelector<HTMLElement>('#time-left')!, score = document.querySelector<HTMLElement>('#score')!, hits = document.querySelector<HTMLElement>('#hit-count')!
    const marker = document.querySelector<HTMLElement>('#tilt-marker')!, badge = document.querySelector<HTMLElement>('#stable-badge')!
    const levelLabel = document.querySelector<HTMLElement>('#level-label')!, levelProgress = document.querySelector<HTMLElement>('#level-progress')!
    time.textContent = stats.timeLeft.toFixed(1); score.textContent = String(stats.score); hits.textContent = `${stats.hits}次`
    levelLabel.textContent = `第${stats.level}关 · ${stats.levelName}`
    levelProgress.style.width = `${stats.levelProgress * 100}%`
    marker.style.left = `${50 + Math.max(-CAPSIZE_DEGREES, Math.min(CAPSIZE_DEGREES, stats.roll)) / CAPSIZE_DEGREES * 50}%`
    marker.className = stats.danger ? 'danger' : stats.stable ? 'safe' : ''
    badge.className = `stable-badge ${stats.stable ? 'active' : stats.danger ? 'danger' : ''}`
    badge.textContent = stats.stable ? `默契稳定！横倾 ${stats.roll.toFixed(1)}°` : stats.danger ? `危险！横倾 ${stats.roll.toFixed(1)}°` : `横倾 ${stats.roll.toFixed(1)}° · 俯仰 ${stats.pitch.toFixed(1)}°`
  }

  function handleFinish(result: RunResult): void {
    if (mode === 'host' && coop?.connected) coop.send({ type: 'finish', result })
    showResult(result)
  }

  function showResult(result: RunResult): void {
    mobileRoot.classList.remove('is-running'); hud.classList.add('hidden'); stage.className = 'mobile-stage'; stage.classList.remove('hidden')
    stage.innerHTML = `<div class="setup-card result-card"><p class="kicker">${result.completed ? '三关航程完成' : '挑战结束'}</p><h2>${result.completed ? '友谊经受住了三重风浪' : '小船翻了，再默契一点'}</h2><div class="grade">${result.grade}</div><div class="result-grid"><span><small>得分</small><b>${result.score}</b></span><span><small>稳定时间</small><b>${result.stableSeconds.toFixed(1)}秒</b></span><span><small>最大倾角</small><b>${result.maxRoll.toFixed(1)}°</b></span><span><small>碰撞</small><b>${result.hits}次</b></span></div><p>${result.reason === 'capsized' ? `横倾达到 ${CAPSIZE_DEGREES}° 并超过安全缓冲，小船已翻覆。` : '你完成了晨光湾、珊瑚峡和星潮门。'}</p><button class="primary" data-action="recalibrate">重新校准再挑战</button></div>`
  }

  stage.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
    const action = target?.dataset.action
    if (action === 'permission') void requestSensor()
    if (action === 'calibrate') calibrate()
    if (action === 'solo-start') { endCoop(); void countdown(false) }
    if (action === 'host-room') void hostRoom()
    if (action === 'join-room') void joinRoom()
    if (action === 'coop-start' && coop?.connected) { coop.send({ type: 'start' }); void countdown(false) }
    if (action === 'share-invite' && target) void shareInvite(target)
    if (action === 'copy-invite' && target) void copyInvite(target)
    if (action === 'cancel-coop') { endCoop(); showReady() }
    if (action === 'retry') showIntro()
    if (action === 'recalibrate') { endCoop(); showCalibration() }
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
  function scheduleOrientationSync(): void { window.setTimeout(syncOrientation, 180) }
  window.addEventListener('resize', syncOrientation)
  window.addEventListener('orientationchange', scheduleOrientationSync)
  screen.orientation?.addEventListener('change', scheduleOrientationSync)
  showIntro()
}
