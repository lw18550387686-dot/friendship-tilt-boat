import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
await mkdir(resolve(root, 'dist/server'), { recursive: true })
await mkdir(resolve(root, 'dist/client'), { recursive: true })
await mkdir(resolve(root, 'dist/mobile-v3'), { recursive: true })
await mkdir(resolve(root, 'dist/mobile-v4'), { recursive: true })
await mkdir(resolve(root, 'dist/mobile-v5'), { recursive: true })
await mkdir(resolve(root, 'dist/mobile-v6'), { recursive: true })
await mkdir(resolve(root, 'dist/mobile-v7'), { recursive: true })
await mkdir(resolve(root, 'dist/.openai'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/client/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/client/assets'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/mobile-v3/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/mobile-v3/assets'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/mobile-v4/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/mobile-v4/assets'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/mobile-v5/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/mobile-v5/assets'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/mobile-v6/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/mobile-v6/assets'), { recursive: true })
await cp(resolve(root, 'dist/index.html'), resolve(root, 'dist/mobile-v7/index.html'))
await cp(resolve(root, 'dist/assets'), resolve(root, 'dist/mobile-v7/assets'), { recursive: true })
await cp(resolve(root, '.openai/hosting.json'), resolve(root, 'dist/.openai/hosting.json'))
await writeFile(resolve(root, 'dist/server/index.js'), `
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    let response = await env.ASSETS.fetch(request)
    if (response.status === 404 && !url.pathname.includes('.')) {
      response = await env.ASSETS.fetch(new Request(new URL('/', request.url), request))
    }
    return response
  }
}
`)
