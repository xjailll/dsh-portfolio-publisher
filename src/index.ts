/**
 * @dsh-external/dsh-portfolio-publisher — GitHub 求职仓库一键发布助手
 *
 * 工具：
 * 1. scan_repo        扫描项目，识别技术栈/结构/敏感信息
 * 2. generate_readme  根据扫描结果生成招聘向 README.md
 * 3. sanitize_check   检查仓库中的密钥/AppID/本地路径泄露点
 * 4. github_init      初始化 Git、创建 GitHub 仓库并推送
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = "@dsh-external/dsh-portfolio-publisher"
export const inject = ['tools']

export interface Config {
  defaultVisibility: 'public' | 'private'
}

export const Config = z.object({
  defaultVisibility: z.string().default('public'),
})

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
      // 只扫文本类文件，避免二进制/图片
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

  // 递归查找 package.json（限制深度，避免 node_modules）
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
*Generated by [dsh-portfolio-publisher](https://github.com/your-name/dsh-portfolio-publisher)*
`
}

// ─────────────────────────────────────────────────────────────
// 插件入口
// ─────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: Config): void {
  const prefix = '_dsh_external_dsh_portfolio_publisher'

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
      description: '根据扫描结果生成招聘向 README.md 并写入项目根目录',
      parameters: {
        root: { type: 'string', required: true, description: '项目根目录绝对路径' },
        description: { type: 'string', description: '一句话项目描述' },
        author: { type: 'string', description: '作者名' },
        repo: { type: 'string', description: 'GitHub 仓库地址' },
        overwrite: { type: 'boolean', description: '是否覆盖已有 README.md，默认 false' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: { root: string; description?: string; author?: string; repo?: string; overwrite?: boolean }) {
        const info = await scanRepo(args.root)
        const readmePath = path.join(info.root, 'README.md')
        if (await isFile(readmePath) && !args.overwrite) {
          return `README.md 已存在，未覆盖。如需重新生成请传 overwrite=true。\n\n当前文件：${readmePath}`
        }
        const content = renderReadme(info, {
          description: args.description,
          author: args.author,
          repo: args.repo,
        })
        await fs.writeFile(readmePath, content, 'utf8')
        return `✅ README.md 已生成：${readmePath}\n\n${content}`
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
        username: { type: 'string', description: 'GitHub 用户名' },
        visibility: { type: 'string', description: 'public 或 private' },
        commitMessage: { type: 'string', description: '提交信息' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: { root: string; repoName: string; username?: string; visibility?: string; commitMessage?: string; push?: boolean }) {
        const root = path.resolve(args.root)
        const visibility = args.visibility || config.defaultVisibility || 'public'
        const commitMessage = args.commitMessage || 'Initial commit'
        const push = args.push !== false

        if (!await isDir(root)) return `❌ 目录不存在：${root}`

        // 1. git init
        if (!await isDir(path.join(root, '.git'))) {
          run('git', ['init'], root)
        }

        // 2. git add + commit
        const gitUser = run('git', ['config', 'user.name'], root)
        if (!gitUser) {
          return '❌ 未检测到 Git 用户名，请先运行: git config user.name "你的名字"'
        }
        run('git', ['add', '-A'], root)
        const status = run('git', ['status', '--porcelain'], root)
        if (status) {
          run('git', ['commit', '-m', commitMessage], root)
        }

        // 3. 创建 GitHub 仓库并推送
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
      },
    }),
  ), `${prefix}: github_init`)
}
