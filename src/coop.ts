import Peer, { type DataConnection } from 'peerjs'
import type { GameFrame, RunResult } from './game'
import type { Tilt } from './sensor'

export type CoopRole = 'host' | 'guest'

export type CoopMessage =
  | { type: 'tilt'; tilt: Tilt }
  | { type: 'swipe'; fraction: number }
  | { type: 'start' }
  | { type: 'frame'; frame: GameFrame }
  | { type: 'finish'; result: RunResult }
  | { type: 'ping'; sentAt: number }

export interface CoopCallbacks {
  status: (status: 'waiting' | 'connected' | 'disconnected' | 'error', message: string) => void
  message: (message: CoopMessage) => void
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PEER_PREFIX = 'friendship-boat-'

export function createRoomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('')
}

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 12)
}

export class CoopSession {
  private peer?: Peer
  private connection?: DataConnection
  private connectionTimer?: number
  role?: CoopRole
  roomCode = ''

  constructor(private callbacks: CoopCallbacks) {}

  get connected(): boolean { return Boolean(this.connection?.open) }

  async host(roomCode = createRoomCode()): Promise<string> {
    this.destroy()
    this.role = 'host'
    this.roomCode = normalizeRoomCode(roomCode)
    return new Promise((resolve, reject) => {
      const peer = new Peer(`${PEER_PREFIX}${this.roomCode.toLowerCase()}`, { debug: 1 })
      this.peer = peer
      let opened = false
      peer.on('open', () => {
        opened = true
        this.callbacks.status('waiting', '房间已建立，等待好友上船')
        resolve(this.roomCode)
      })
      peer.on('connection', (connection) => {
        if (this.connection?.open) { connection.close(); return }
        this.attach(connection)
      })
      peer.on('error', (error) => {
        const message = error.type === 'unavailable-id' ? '房间号被占用，请重新创建' : '联机信令不可用，请检查网络后重试'
        this.callbacks.status('error', message)
        if (!opened) reject(new Error(message))
      })
    })
  }

  async join(roomCode: string): Promise<void> {
    this.destroy()
    this.role = 'guest'
    this.roomCode = normalizeRoomCode(roomCode)
    if (!this.roomCode) throw new Error('邀请房间号无效')
    this.callbacks.status('waiting', '正在寻找朋友的小船…')
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 })
      this.peer = peer
      let settled = false
      peer.on('open', () => {
        const connection = peer.connect(`${PEER_PREFIX}${this.roomCode.toLowerCase()}`, { reliable: true, serialization: 'json' })
        this.attach(connection, () => {
          settled = true
          resolve()
        })
        this.connectionTimer = window.setTimeout(() => {
          if (settled || connection.open) return
          const message = '连接超时。请确认船长仍停留在邀请页面，并检查双方网络。'
          this.callbacks.status('error', message)
          connection.close()
          reject(new Error(message))
        }, 15000)
      })
      peer.on('error', () => {
        if (settled) return
        const message = '无法连接联机服务，请检查网络后重试'
        this.callbacks.status('error', message)
        settled = true
        reject(new Error(message))
      })
    })
  }

  send(message: CoopMessage): void {
    if (!this.connection?.open) return
    try { void this.connection.send(message) } catch { this.callbacks.status('error', '发送联机数据失败') }
  }

  destroy(): void {
    if (this.connectionTimer) window.clearTimeout(this.connectionTimer)
    this.connectionTimer = undefined
    this.connection?.close()
    this.peer?.destroy()
    this.connection = undefined
    this.peer = undefined
    this.role = undefined
    this.roomCode = ''
  }

  private attach(connection: DataConnection, onOpen?: () => void): void {
    this.connection = connection
    connection.on('open', () => {
      if (this.connectionTimer) window.clearTimeout(this.connectionTimer)
      this.connectionTimer = undefined
      this.callbacks.status('connected', '好友已上船，可以开始配合挑战')
      onOpen?.()
    })
    connection.on('data', (data) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      this.callbacks.message(data as CoopMessage)
    })
    connection.on('close', () => this.callbacks.status('disconnected', '好友已离开小船'))
    connection.on('error', () => this.callbacks.status('error', '点对点连接出现错误'))
  }
}
