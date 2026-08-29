import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = 'xjailll'
const REPO = 'dsh-portfolio-publisher'
const VERSION = '0.3.0'
const TAG = `v${VERSION}`
const TGZ = join(process.cwd(), `dsh-external-dsh-portfolio-publisher-${VERSION}.tgz`)

const input = 'protocol=https\nhost=github.com\n\n'
const cred = spawnSync('git', ['credential', 'fill'], { input, encoding: 'utf8' })
if (cred.status !== 0) throw new Error('无法读取 GitHub 凭据')
const lines = cred.stdout.split('\n')
const get = (k) => {
  const line = lines.find((l) => l.startsWith(k + '='))
  return line ? line.slice(k.length + 1) : undefined
}
const token = get('password')
if (!token) throw new Error('GitHub 凭据不完整')

const baseHeaders = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'dsh-portfolio-publisher',
  Accept: 'application/vnd.github+json',
}

// 找到已有 Release
const relRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers: baseHeaders })
const rel = await relRes.json()
if (!relRes.ok) throw new Error(`查找 Release 失败 (${relRes.status}): ${JSON.stringify(rel)}`)

// 上传资产到 uploads.github.com
const tgzBuffer = readFileSync(TGZ)
const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(`dsh-external-dsh-portfolio-publisher-${VERSION}.tgz`)}`
const assetRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
    'User-Agent': 'dsh-portfolio-publisher',
    Accept: 'application/vnd.github+json',
  },
  body: tgzBuffer,
})
const assetData = await assetRes.json()
if (!assetRes.ok) throw new Error(`Asset 上传失败 (${assetRes.status}): ${JSON.stringify(assetData)}`)
console.log('✅ Asset:', assetData.browser_download_url)
