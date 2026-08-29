import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const OWNER = 'xjailll'
const REPO = 'dsh-portfolio-publisher'
const VERSION = '0.3.1'
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

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'dsh-portfolio-publisher',
  Accept: 'application/vnd.github+json',
}

// 1. Topics
const topics = [
  'deepseek-harness',
  'dsh-plugin',
  'readme-generator',
  'github-cli',
  'portfolio',
  'job-hunting',
  'github-actions',
  'llm',
]
const topicsRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/topics`, {
  method: 'PUT',
  headers: { ...headers, Accept: 'application/vnd.github.mercy-preview+json' },
  body: JSON.stringify({ names: topics }),
})
const topicsData = await topicsRes.json()
if (!topicsRes.ok) throw new Error(`Topics 设置失败 (${topicsRes.status}): ${JSON.stringify(topicsData)}`)
console.log('✅ Topics:', topicsData.names.join(', '))

// 2. Release
const releaseBody = `# 🎉 dsh-portfolio-publisher v${VERSION}

GitHub 求职仓库一键发布助手。

## 功能

- 🔍 仓库扫描（技术栈 / 目录 / 依赖 / 敏感信息）
- 📝 LLM 生成专业 README，支持自定义提示词
- 🛡️ 安全检查（AppID / Token / Secret / 本地路径）
- 🖥️ Web 可视化面板 \`/portfolio\`
- 🚀 一键发布 GitHub（无 gh CLI 也可用）

## 安装

\`\`\`bash
# 请替换为插件解压后的真实目录
dev_inject_plugin /path/to/dsh-portfolio-publisher
\`\`\`

访问面板：

\`\`\`text
http://127.0.0.1:3080/portfolio
\`\`\`
`
const releaseRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body: releaseBody,
    draft: false,
    prerelease: false,
  }),
})
const releaseData = await releaseRes.json()
if (!releaseRes.ok) throw new Error(`Release 创建失败 (${releaseRes.status}): ${JSON.stringify(releaseData)}`)
console.log('✅ Release:', releaseData.html_url)

// 3. Upload tgz
const tgzBuffer = readFileSync(TGZ)
const assetRes = await fetch(
  `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseData.id}/assets?name=${encodeURIComponent(`dsh-external-dsh-portfolio-publisher-${VERSION}.tgz`)}`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'dsh-portfolio-publisher',
      Accept: 'application/vnd.github+json',
    },
    body: tgzBuffer,
  },
)
const assetData = await assetRes.json()
if (!assetRes.ok) throw new Error(`Asset 上传失败 (${assetRes.status}): ${JSON.stringify(assetData)}`)
console.log('✅ Asset:', assetData.browser_download_url)
