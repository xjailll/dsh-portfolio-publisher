/**
 * @dsh-external/dsh-portfolio-publisher — GitHub 求职仓库一键发布助手
 *
 * 工具：
 * 1. scan_repo        扫描项目，识别技术栈/结构/敏感信息
 * 2. generate_readme  基于 LLM 生成专业招聘向 README（支持自定义提示词）
 * 3. sanitize_check   检查仓库中的密钥/AppID/本地路径泄露点
 * 4. github_init      初始化 Git、创建 GitHub 仓库并推送
 *
 * Web 面板：
 * GET  /portfolio                浏览器可视化面板
 * POST /portfolio/api/scan       扫描仓库
 * POST /portfolio/api/readme     生成 README
 * POST /portfolio/api/sanitize   安全检查
 * POST /portfolio/api/push       发布到 GitHub（带人工确认）
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import z from 'schemastery'

export const name = "@dsh-external/dsh-portfolio-publisher"
export const inject = ['tools', 'webServer', 'llm']

export interface Config {
  defaultVisibility: 'public' | 'private'
  panelPath: string
  readmePrompt: string
}

export const Config = z.object({
  defaultVisibility: z.string().default('public'),
  panelPath: z.string().default('/portfolio'),
  readmePrompt: z.string().default(''),
})

type PanelContext = Context & {
  llm?: LlmService
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

// ─────────────────────────────────────────────────────────────
// 小工具函数
// ─────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.qoder', 'coverage',
  '.next', '.nuxt', '.cache', 'target', 'vendor', '.venv', 'venv',
])

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function readJson(p: string): Promise<Record<string, any> | null> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    }).trim()
  } catch {
    return ''
  }
}

const SECRET_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: '微信 AppID', regex: /\bwx[0-9a-f]{16}\b/gi },
  { label: '云开发环境 ID', regex: /\bcloudbase-[a-z0-9]{6,}\b/gi },
  { label: '疑似 Secret/Token', regex: /\b(?:secret|token|api[_-]?key|access[_-]?key|appsecret|password)\b\s*[:=]\s*['"][^'"]{6,}['"]/gi },
  { label: '本地绝对路径', regex: /[A-Za-z]:\\[^"'`\n\\]+(?:\\[^"'`\n\\]+)*/g },
  { label: 'AK/SK 硬编码', regex: /\b(?:LTAI|AKIA|ASIA)[A-Z0-9]{16,}\b/g },
]

interface ScanResult {
  root: string
  name: string
  fileCount: number
  topDirs: string[]
  techStack: string[]
  packageFiles: string[]
  hasReadme: boolean
  hasLicense: boolean
  hasGit: boolean
  secrets: { file: string; label: string; line: number }[]
}

async function countFiles(dir: string, depth = 0): Promise<number> {
  if (depth > 4) return 0
  let count = 0
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat) continue
    if (stat.isFile()) count++
    else if (stat.isDirectory()) count += await countFiles(full, depth + 1)
  }
  return count
}

async function scanSecrets(root: string): Promise<{ file: string; label: string; line: number }[]> {
  const hits: { file: string; label: string; line: number }[] = []
  async function walk(dir: string, depth = 0) {
    if (depth > 4) return
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = path.join(dir, entry)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!/\.(md|txt|json|js|ts|tsx|jsx|vue|py|go|java|cs|env|example|yml|yaml|toml|ini|sh|bat|wxml|wxss|html)$/i.test(entry)) continue
      try {
        const raw = await fs.readFile(full, 'utf8')
        const lines = raw.split(/\r?\n/)
        lines.forEach((line, idx) => {
          for (const p of SECRET_PATTERNS) {
            if (p.regex.test(line)) {
              hits.push({ file: path.relative(root, full), label: p.label, line: idx + 1 })
              break
            }
          }
        })
      } catch {
        // ignore binary/unreadable
      }
    }
  }
  await walk(root)
  return hits
}

async function scanRepo(root: string): Promise<ScanResult> {
  const resolved = path.resolve(root)
  const name = path.basename(resolved)
  const topDirs: string[] = []
  const packageFiles: string[] = []
  const techStack: string[] = []

  try {
    const entries = await fs.readdir(resolved)
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = path.join(resolved, entry)
      if (await isDir(full)) topDirs.push(entry)
    }
  } catch {
    throw new Error(`目录不存在或无法读取: ${resolved}`)
  }

  async function findPackageJson(dir: string, depth = 0) {
    if (depth > 3) return
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const full = path.join(dir, entry)
      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        await findPackageJson(full, depth + 1)
      } else if (entry === 'package.json') {
        packageFiles.push(path.relative(resolved, full).replace(/\\/g, '/') || 'package.json')
        const json = await readJson(full)
        if (json) {
          const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) }
          const keys = Object.keys(deps)
          if (keys.some(k => k.includes('vue') || k.includes('element-plus') || k.includes('pinia'))) {
            techStack.push('Vue3 + Element Plus')
          }
          if (keys.some(k => k.includes('express') || k.includes('koa') || k.includes('fastify'))) {
            techStack.push('Node.js')
          }
          if (keys.some(k => k.includes('mongoose') || k.includes('mongodb'))) {
            techStack.push('MongoDB')
          }
          if (keys.some(k => k.includes('react') || k.includes('next') || k.includes('vite'))) {
            techStack.push('React/Vite 前端')
          }
          if (keys.some(k => k.includes('typescript'))) {
            techStack.push('TypeScript')
          }
        }
      }
    }
  }
  await findPackageJson(resolved)

  if (await isDir(path.join(resolved, 'miniprogram'))) techStack.push('微信小程序')
  if (await isDir(path.join(resolved, 'cloudfunctions'))) techStack.push('微信云函数')
  if (await isDir(path.join(resolved, 'server'))) techStack.push('Node.js 后端')
  if (await isDir(path.join(resolved, 'admin-web')) || await isDir(path.join(resolved, 'admin'))) techStack.push('Vue3 管理端')

  const hasPy = await fs.readdir(resolved).then(es => es.some(e => e.endsWith('.py'))).catch(() => false)
  const hasGo = await fs.readdir(resolved).then(es => es.some(e => e.endsWith('.go'))).catch(() => false)
  const hasJava = await fs.readdir(resolved).then(es => es.some(e => e.endsWith('.java'))).catch(() => false)
  const hasRust = await fs.readdir(resolved).then(es => es.some(e => e.endsWith('.rs'))).catch(() => false)
  if (hasPy) techStack.push('Python')
  if (hasGo) techStack.push('Go')
  if (hasJava) techStack.push('Java')
  if (hasRust) techStack.push('Rust')

  const unique = [...new Set(techStack)]
  return {
    root: resolved,
    name,
    fileCount: await countFiles(resolved),
    topDirs: topDirs.sort(),
    techStack: unique,
    packageFiles,
    hasReadme: await isFile(path.join(resolved, 'README.md')),
    hasLicense: await isFile(path.join(resolved, 'LICENSE')) || await isFile(path.join(resolved, 'LICENSE.md')),
    hasGit: await isDir(path.join(resolved, '.git')),
    secrets: await scanSecrets(resolved),
  }
}

function renderReadme(info: ScanResult, extra: { description?: string; author?: string; repo?: string } = {}): string {
  const description = extra.description || '一个值得展示的全栈/项目作品。'
  const badges = info.techStack.map(t => `![${t}](https://img.shields.io/badge/${encodeURIComponent(t)}-${encodeURIComponent(t)}-blue)`).join(' ')
  const dirs = info.topDirs.map(d => `| \`${d}/\` | 见目录内 README 或源码 |`).join('\n')
  const secretsBlock = info.secrets.length
    ? `> ⚠️ 检测到 ${info.secrets.length} 处潜在敏感信息（AppID/Token/本地路径等），建议先运行 sanitize_check 处理。`
    : '> ✅ 未检测到常见敏感信息。'

  return `# ${info.name}

> ${description}

${badges}

## ✨ 项目亮点

- 完整项目作品，代码结构清晰
- 技术栈：${info.techStack.join(' / ') || '待识别'}
- 已包含 README、目录组织与开发文档

## 🗂️ 项目结构

| 目录 | 说明 |
| --- | --- |
${dirs || '| - | 待补充 |'}

## 🧰 技术栈

${info.techStack.map(t => `- ${t}`).join('\n') || '- 待识别'}

## 🚀 快速开始

（请根据实际项目补充启动命令）

\`\`\`bash
# 示例
npm install
npm start
\`\`\`

## 📄 文档

${info.hasReadme ? '- 项目 README 已存在' : '- README 由 dsh-portfolio-publisher 生成'}
${info.hasLicense ? '- 已包含 License' : '- 建议补充 License'}

${secretsBlock}

## 📬 关于

${extra.author ? `- 作者：${extra.author}` : '- 作者：待补充'}
${extra.repo ? `- 仓库：${extra.repo}` : '- 仓库：待补充'}

---
*Generated by [dsh-portfolio-publisher](https://github.com/xjailll/dsh-portfolio-publisher)*
`
}

function buildReadmePrompt(info: ScanResult, extra: { description?: string; author?: string; repo?: string }, customPrompt?: string): string {
  const base = `请为以下 GitHub 项目生成一份**专业、有说服力、适合求职作品集展示**的 README.md。

## 项目扫描信息

- 项目名称：${info.name}
- 项目根目录：${info.root}
- 文件数量：${info.fileCount}
- 识别到的技术栈：${info.techStack.join(', ') || '未识别'}
- 顶层目录：${info.topDirs.join(', ') || '无'}
- package.json 文件：${info.packageFiles.join(', ') || '无'}
- 是否已有 README：${info.hasReadme ? '是' : '否'}
- 是否已有 License：${info.hasLicense ? '是' : '否'}
- 是否已初始化 Git：${info.hasGit ? '是' : '否'}
- 检测到的潜在敏感信息数量：${info.secrets.length}
${extra.description ? `- 项目描述：${extra.description}` : ''}
${extra.author ? `- 作者：${extra.author}` : ''}
${extra.repo ? `- 仓库地址：${extra.repo}` : ''}

## 写作要求

1. 使用中文撰写，标题可以带英文副标题，整体专业、克制、有信息密度。
2. 必须包含以下结构（顺序可微调）：
   - 项目名称与一句话定位
   - 技术栈徽章（用 shields.io）
   - 项目亮点（3-5 条，突出工程能力、业务闭环、难点解决）
   - 功能特性（按用户端/管理端/后端等维度分组）
   - 技术栈表格
   - 系统架构（可用 Mermaid 或文字描述）
   - 快速开始（安装、配置、启动命令，使用代码块）
   - API 概览（如适用，用表格）
   - 项目文档入口
   - 测试说明
   - 未来规划
   - 关于/联系方式
   - License
3. 不要编造仓库中不存在的信息；不确定的内容用“待补充/示例”标注。
4. 不要输出解释性文字，直接输出 Markdown 正文。
5. 语言要像一位有经验的全栈工程师写的，避免空话套话。
6. 如果检测到敏感信息，在 README 中加一行提醒：建议先执行安全检查并脱敏。
${customPrompt ? `\n## 用户额外要求（优先级最高，必须遵守）\n${customPrompt}` : ''}`

  return base
}

async function generateReadmeWithLlm(
  ctx: PanelContext,
  lastRoute: { provider: string; model: string } | null,
  info: ScanResult,
  extra: { description?: string; author?: string; repo?: string },
  customPrompt?: string,
): Promise<string | null> {
  if (!ctx.llm || !lastRoute) return null
  try {
    const prompt = buildReadmePrompt(info, extra, customPrompt)
    let text = ''
    const stream = ctx.llm.stream({
      provider: lastRoute.provider,
      model: lastRoute.model,
      system: '你是一位资深开源项目维护者、技术文档专家和招聘官。你生成的 README 必须专业、真实、有说服力，适合求职作品集展示。',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
      temperature: 0.3,
      reasoningEffort: ReasoningEffortId('off'),
      maxTokens: 2000,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
    return text.trim() || null
  } catch {
    return null
  }
}

async function createReadme(
  ctx: PanelContext,
  lastRoute: { provider: string; model: string } | null,
  args: { root: string; description?: string; author?: string; repo?: string; overwrite?: boolean; prompt?: string },
  config: Config,
): Promise<{ ok: boolean; path?: string; content?: string; message: string }> {
  const info = await scanRepo(args.root)
  const readmePath = path.join(info.root, 'README.md')
  if (await isFile(readmePath) && !args.overwrite) {
    return { ok: false, path: readmePath, message: `README.md 已存在，未覆盖。如需重新生成请传 overwrite=true。\n\n当前文件：${readmePath}` }
  }

  const extra = {
    description: args.description,
    author: args.author,
    repo: args.repo,
  }
  const customPrompt = args.prompt || config.readmePrompt || undefined
  const llmContent = await generateReadmeWithLlm(ctx, lastRoute, info, extra, customPrompt)
  const content = llmContent || renderReadme(info, extra)

  await fs.writeFile(readmePath, content, 'utf8')
  return {
    ok: true,
    path: readmePath,
    content,
    message: llmContent
      ? `✅ README.md 已由 LLM 生成：${readmePath}`
      : `✅ README.md 已生成（LLM 不可用，使用内置模板）：${readmePath}`,
  }
}

async function githubInit(args: { root: string; repoName: string; username?: string; gitName?: string; gitEmail?: string; visibility?: string; commitMessage?: string; push?: boolean }, defaultVisibility: string): Promise<string> {
  const root = path.resolve(args.root)
  const visibility = args.visibility || defaultVisibility || 'public'
  const commitMessage = args.commitMessage || 'Initial commit'
  const push = args.push !== false

  if (!await isDir(root)) return `❌ 目录不存在：${root}`

  if (!await isDir(path.join(root, '.git'))) {
    run('git', ['init'], root)
  }

  // 自动配置 Git 提交身份：优先显式 gitName/gitEmail，其次用 GitHub 用户名兜底
  let gitUser = run('git', ['config', 'user.name'], root)
  let gitEmail = run('git', ['config', 'user.email'], root)
  if (!gitUser && args.gitName) {
    run('git', ['config', 'user.name', args.gitName], root)
    gitUser = args.gitName
  }
  if (!gitEmail && args.gitEmail) {
    run('git', ['config', 'user.email', args.gitEmail], root)
    gitEmail = args.gitEmail
  }
  if (!gitUser && args.username) {
    run('git', ['config', 'user.name', args.username], root)
    gitUser = args.username
  }
  if (!gitEmail && args.username) {
    const fallbackEmail = `${args.username}@users.noreply.github.com`
    run('git', ['config', 'user.email', fallbackEmail], root)
    gitEmail = fallbackEmail
  }
  if (!gitUser || !gitEmail) {
    return '❌ 未检测到 Git 提交身份。请在面板填写 Git 提交姓名/邮箱，或先运行: git config user.name "你的名字" && git config user.email "you@example.com"'
  }

  run('git', ['add', '-A'], root)
  const status = run('git', ['status', '--porcelain'], root)
  if (status) {
    run('git', ['commit', '-m', commitMessage], root)
  }

  const remote = run('git', ['remote', 'get-url', 'origin'], root)
  if (args.username && !remote) {
    const gh = run('gh', ['repo', 'create', `${args.username}/${args.repoName}`, '--' + visibility, '--source', root, '--remote', 'origin'], root)
    if (!gh && !run('gh', ['--version'], root)) {
      return '❌ gh CLI 未安装或未登录。请先安装 GitHub CLI 并执行 gh auth login，或手动创建仓库后添加 remote。'
    }
  } else if (!remote) {
    return `❌ 缺少 GitHub 仓库地址。请先创建仓库并运行:\n  git remote add origin https://github.com/你的用户名/${args.repoName}.git`
  }

  if (push) {
    const branch = run('git', ['branch', '--show-current'], root) || 'main'
    const pushed = run('git', ['push', '-u', 'origin', branch], root)
    if (!pushed) return `✅ 本地提交完成，但推送失败（请检查 remote/权限）。\n\n远程: ${run('git', ['remote', 'get-url', 'origin'], root) || '未设置'}`
  }

  const url = run('git', ['remote', 'get-url', 'origin'], root)
  return `✅ GitHub 发布完成！\n\n仓库: ${url || 'https://github.com/' + (args.username ? args.username + '/' : '') + args.repoName}\n分支: ${run('git', ['branch', '--show-current'], root) || 'main'}\n提交: ${commitMessage}`
}

// ─────────────────────────────────────────────────────────────
// Web 面板
// ─────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > 5_000_000) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function renderPanelHtml(panelPath: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Portfolio Publisher</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-top: 16px; }
  label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 6px; }
  textarea, input, select { width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 10px; font-size: 14px; margin-bottom: 12px; }
  textarea { font-family: ui-monospace, monospace; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  button { background: #3b82f6; color: white; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  button.green { background: #22c55e; }
  button.red { background: #ef4444; }
  button:hover { filter: brightness(1.1); }
  pre { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 13px; line-height: 1.6; }
  .tag { display: inline-block; background: #334155; border-radius: 999px; padding: 4px 10px; margin: 4px 4px 0 0; font-size: 12px; }
  .ok { color: #4ade80; }
  .warn { color: #fbbf24; }
  .err { color: #f87171; }
  .muted { color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📦 DSH Portfolio Publisher</h1>
  <p class="muted">扫描仓库 → LLM 生成 README → 安全检查 → 手动确认后发布到 GitHub</p>

  <div class="card">
    <label>项目根目录（支持多行批量扫描）</label>
    <textarea id="root" rows="3" placeholder="D:/projects/my-project"></textarea>
    <div class="row">
      <button onclick="scan()">🔍 扫描</button>
      <button class="green" onclick="generate()">📝 生成 README</button>
      <button onclick="sanitize()">🛡️ 安全检查</button>
      <button class="red" onclick="push()">🚀 发布到 GitHub</button>
    </div>
  </div>

  <div class="card">
    <h2>README 选项</h2>
    <div class="row">
      <input id="description" placeholder="一句话项目描述">
      <input id="author" placeholder="作者名">
      <input id="repo" placeholder="GitHub 仓库地址">
    </div>
    <label>自定义 README 提示词（可选，会覆盖默认要求）</label>
    <textarea id="prompt" rows="3" placeholder="例如：突出我的全栈能力，重点写系统架构和数据库设计，语气活泼一点"></textarea>
    <label><input type="checkbox" id="overwrite"> 覆盖已有 README</label>
  </div>

  <div class="card">
    <h2>GitHub 发布选项</h2>
    <div class="row">
      <input id="repoName" placeholder="仓库名（必填）">
      <input id="username" placeholder="GitHub 用户名">
        <input id="gitName" placeholder="Git 提交姓名（可选）">
        <input id="gitEmail" placeholder="Git 提交邮箱（可选）">
      <select id="visibility">
        <option value="public">public</option>
        <option value="private">private</option>
      </select>
      <input id="commitMessage" placeholder="提交信息（默认 Initial commit）">
    </div>
    <p class="muted">点击“发布到 GitHub”会弹出确认框，确认后才会执行 git/gh 操作。</p>
  </div>

  <div class="card">
    <h2>📋 结果</h2>
    <pre id="output">等待操作...</pre>
  </div>
</div>

<script>
const rootEl = document.getElementById('root');
const outputEl = document.getElementById('output');
if (localStorage.getItem('pp-root')) rootEl.value = localStorage.getItem('pp-root');
function save() { localStorage.setItem('pp-root', rootEl.value); }
function out(text) { outputEl.textContent = text; }
async function api(pathname, body) {
  const res = await fetch(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function fmtScan(data) {
  const lines = [
    '## ' + data.name,
    '文件数: ' + data.fileCount,
    '技术栈: ' + (data.techStack.join(', ') || '未识别'),
    '顶层目录: ' + data.topDirs.join(', '),
    'README: ' + (data.hasReadme ? '✅' : '❌'),
    'License: ' + (data.hasLicense ? '✅' : '❌'),
    'Git: ' + (data.hasGit ? '✅' : '❌'),
    '',
    '### 敏感信息',
    data.secrets.length ? data.secrets.map(s => '-' + s.label + ' @ ' + s.file + ':' + s.line).join('\\n') : '✅ 无'
  ];
  return lines.join('\\n');
}
async function scan() {
  save();
  const roots = rootEl.value.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
  if (!roots.length) return out('请先填写项目根目录');
  const parts = [];
  for (const root of roots) {
    try {
      const data = await api('${panelPath}/api/scan', { root });
      parts.push(fmtScan(data.data));
    } catch (e) {
      parts.push('❌ ' + root + '\\n' + e.message);
    }
  }
  out(parts.join('\\n\\n'));
}
async function generate() {
  save();
  const root = rootEl.value.trim();
  if (!root) return out('请先填写项目根目录');
  try {
    const data = await api('${panelPath}/api/readme', {
      root,
      description: document.getElementById('description').value,
      author: document.getElementById('author').value,
      repo: document.getElementById('repo').value,
      prompt: document.getElementById('prompt').value,
      overwrite: document.getElementById('overwrite').checked
    });
    if (data.ok) {
      out(data.message + '\\n\\n' + data.content);
    } else {
      out(data.message);
    }
  } catch (e) {
    out('❌ ' + e.message);
  }
}
async function sanitize() {
  save();
  const root = rootEl.value.trim();
  if (!root) return out('请先填写项目根目录');
  try {
    const data = await api('${panelPath}/api/sanitize', { root });
    if (!data.secrets.length) return out('✅ 未发现常见敏感信息');
    out(data.secrets.map(s => '-' + s.label + ' @ ' + s.file + ':' + s.line).join('\\n'));
  } catch (e) {
    out('❌ ' + e.message);
  }
}
async function push() {
  save();
  const root = rootEl.value.trim();
  const repoName = document.getElementById('repoName').value.trim();
  if (!root || !repoName) return out('请填写项目根目录和仓库名');
  const ok = confirm('确认要初始化 Git 并推送到 GitHub？');
  if (!ok) return out('已取消发布');
  try {
    const data = await api('${panelPath}/api/push', {
      root,
      repoName,
      username: document.getElementById('username').value.trim(),
        gitName: document.getElementById('gitName').value.trim(),
        gitEmail: document.getElementById('gitEmail').value.trim(),
      visibility: document.getElementById('visibility').value,
      commitMessage: document.getElementById('commitMessage').value.trim()
    });
    out(data.message);
  } catch (e) {
    out('❌ ' + e.message);
  }
}
</script>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────
// 插件入口
// ─────────────────────────────────────────────────────────────

export function apply(ctx: PanelContext, config: Config): void {
  const prefix = '_dsh_external_dsh_portfolio_publisher'

  // 捕获主模型路由，供 README LLM 生成复用
  let lastRoute: { provider: string; model: string } | null = null
  ctx.on('llm/stream', (options: any, next: any) => {
    lastRoute = { provider: options.provider, model: options.model }
    return next()
  })

  ctx.effect(() => ctx.tools.register(
    defineTool({
      name: `${prefix}_scan_repo`,
      description: '扫描本地项目，识别技术栈、目录结构、README/License/Git 状态和敏感信息',
      parameters: {
        root: { type: 'string', required: true, description: '项目根目录绝对路径' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: { root: string }) {
        const info = await scanRepo(args.root)
        const lines = [
          `# 仓库扫描报告: ${info.name}`,
          '',
          `- 根目录：\`${info.root}\``,
          `- 文件数：${info.fileCount}`,
          `- 技术栈：${info.techStack.join(', ') || '未识别'}`,
          `- 顶层目录：${info.topDirs.join(', ') || '无'}`,
          `- README：${info.hasReadme ? '✅ 已有' : '❌ 缺少'}`,
          `- License：${info.hasLicense ? '✅ 已有' : '❌ 缺少'}`,
          `- Git 仓库：${info.hasGit ? '✅ 已初始化' : '❌ 未初始化'}`,
          '',
          '## 📦 package.json 文件',
          ...info.packageFiles.map(f => `- ${f}`),
          '',
          '## 🔒 敏感信息检查',
          info.secrets.length
            ? info.secrets.map(s => `- [${s.label}] ${s.file}:${s.line}`).join('\n')
            : '✅ 未发现常见敏感信息',
        ]
        return lines.join('\n')
      },
    }),
  ), `${prefix}: scan_repo`)

  ctx.effect(() => ctx.tools.register(
    defineTool({
      name: `${prefix}_generate_readme`,
      description: '基于 LLM 生成专业招聘向 README.md，支持自定义提示词',
      parameters: {
        root: { type: 'string', required: true, description: '项目根目录绝对路径' },
        description: { type: 'string', description: '一句话项目描述' },
        author: { type: 'string', description: '作者名' },
        repo: { type: 'string', description: 'GitHub 仓库地址' },
        prompt: { type: 'string', description: '自定义 README 提示词（可选，会覆盖默认要求）' },
        overwrite: { type: 'boolean', description: '是否覆盖已有 README.md，默认 false' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: { root: string; description?: string; author?: string; repo?: string; prompt?: string; overwrite?: boolean }) {
        const result = await createReadme(ctx, lastRoute, args, config)
        return result.ok ? result.message + '\n\n' + result.content : result.message
      },
    }),
  ), `${prefix}: generate_readme`)

  ctx.effect(() => ctx.tools.register(
    defineTool({
      name: `${prefix}_sanitize_check`,
      description: '扫描仓库中的 AppID/Token/Secret/云环境 ID/本地绝对路径，输出泄露点报告',
      parameters: {
        root: { type: 'string', required: true, description: '项目根目录绝对路径' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: { root: string }) {
        const info = await scanRepo(args.root)
        if (info.secrets.length === 0) {
          return `✅ 未发现常见敏感信息。\n\n目录：${info.root}`
        }
        const byFile = new Map<string, string[]>()
        for (const s of info.secrets) {
          const arr = byFile.get(s.file) || []
          arr.push(`  - [${s.label}] 第 ${s.line} 行`)
          byFile.set(s.file, arr)
        }
        const report = [`⚠️ 发现 ${info.secrets.length} 处潜在敏感信息：`, '']
        for (const [file, items] of byFile.entries()) {
          report.push(`📄 ${file}`, ...items, '')
        }
        report.push('建议：将真实 AppID/Secret/云环境 ID 替换为 your-appid / your-secret / your-cloud-env-id 等占位符后再公开。')
        return report.join('\n')
      },
    }),
  ), `${prefix}: sanitize_check`)

  ctx.effect(() => ctx.tools.register(
    defineTool({
      name: `${prefix}_github_init`,
      description: '初始化 Git、创建 GitHub 仓库并推送（需要本机已安装并登录 gh，或已配置 remote）',
      parameters: {
        root: { type: 'string', required: true, description: '项目根目录绝对路径' },
        repoName: { type: 'string', required: true, description: 'GitHub 仓库名' },
          username: { type: 'string', description: 'GitHub 用户名（没有 Git 身份时会自动作为提交姓名）' },
          gitName: { type: 'string', description: 'Git 提交姓名（可选，优先于 username）' },
          gitEmail: { type: 'string', description: 'Git 提交邮箱（可选，缺省使用 username@users.noreply.github.com）' },
        visibility: { type: 'string', description: 'public 或 private' },
        commitMessage: { type: 'string', description: '提交信息' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
        async execute(args: { root: string; repoName: string; username?: string; gitName?: string; gitEmail?: string; visibility?: string; commitMessage?: string; push?: boolean }) {
        return githubInit(args, config.defaultVisibility)
      },
    }),
  ), `${prefix}: github_init`)

  // Web 面板路由
  const panelPath = config.panelPath || '/portfolio'
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: panelPath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost')
      let pathname = url.pathname.replace(/\/+$/, '')
      if (!pathname) pathname = panelPath

      if (req.method === 'GET' && pathname === panelPath) {
        sendHtml(res, renderPanelHtml(panelPath))
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }

      let body: any = {}
      try {
        const raw = await readBody(req)
        body = raw ? JSON.parse(raw) : {}
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' })
        return
      }

      try {
        if (pathname === `${panelPath}/api/scan`) {
          const info = await scanRepo(String(body.root || ''))
          sendJson(res, 200, { ok: true, data: info })
          return
        }
        if (pathname === `${panelPath}/api/readme`) {
          const result = await createReadme(ctx, lastRoute, {
            root: String(body.root || ''),
            description: body.description,
            author: body.author,
            repo: body.repo,
            prompt: body.prompt,
            overwrite: Boolean(body.overwrite),
          }, config)
          sendJson(res, 200, result)
          return
        }
        if (pathname === `${panelPath}/api/sanitize`) {
          const info = await scanRepo(String(body.root || ''))
          sendJson(res, 200, { ok: true, secrets: info.secrets })
          return
        }
        if (pathname === `${panelPath}/api/push`) {
          const message = await githubInit({
            root: String(body.root || ''),
            repoName: String(body.repoName || ''),
            username: body.username,
              gitName: body.gitName,
              gitEmail: body.gitEmail,
            visibility: body.visibility,
            commitMessage: body.commitMessage,
            push: body.push !== false,
          }, config.defaultVisibility)
          sendJson(res, 200, { ok: true, message })
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (e: any) {
        sendJson(res, 500, { error: String(e?.message || e) })
      }
    },
  }), `${prefix}: web panel`)
}
