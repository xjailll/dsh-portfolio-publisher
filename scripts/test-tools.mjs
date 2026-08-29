import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { apply } from '../lib/index.js'

// 模拟 DSH Cordis ctx，只捕获注册的工具
const registered = []
const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  tools: {
    register(tool) {
      registered.push(tool)
      return tool
    },
  },
}

apply(ctx, { defaultVisibility: 'public' })

const byName = (suffix) => registered.find((t) => t.name.endsWith(suffix))
const scanTool = byName('scan_repo')
const readmeTool = byName('generate_readme')
const sanitizeTool = byName('sanitize_check')
const githubTool = byName('github_init')

if (!scanTool || !readmeTool || !sanitizeTool || !githubTool) {
  throw new Error('工具注册不完整: ' + registered.map((t) => t.name).join(', '))
}

console.log('✅ 注册工具:', registered.map((t) => t.name).join('\n  '))

// 1. 扫描 campus-lost-found 仓库
const repoRoot = 'D:/2026论文相关/社区失物招领程序 - 终极版 - 副本/社区失物招领程序 - 终极版 - 副本'
console.log('\n========== 测试 scan_repo ==========')
const scanResult = await scanTool.execute({ root: repoRoot })
console.log(scanResult)

// 2. 测试 sanitize_check（扫描同一个仓库）
console.log('\n========== 测试 sanitize_check ==========')
const sanitizeResult = await sanitizeTool.execute({ root: repoRoot })
console.log(sanitizeResult)

// 3. 构造一个测试项目目录，验证 generate_readme
const fixture = path.resolve('test-fixture')
await rm(fixture, { recursive: true, force: true })
await mkdir(fixture, { recursive: true })
await writeFile(path.join(fixture, 'package.json'), JSON.stringify({
  name: 'demo-project',
  dependencies: { express: '^5.0.0', mongoose: '^9.0.0', vue: '^3.0.0' },
}, null, 2))
await writeFile(path.join(fixture, 'secret.txt'), 'appid=wx1234567890abcdef\ncloudbase-env=cloudbase-test123456\n')

console.log('\n========== 测试 generate_readme ==========')
const readmeResult = await readmeTool.execute({
  root: fixture,
  description: '一个用于测试的求职项目',
  author: '徐杰',
  repo: 'https://github.com/xjailll/demo-project',
  overwrite: true,
})
console.log(readmeResult.slice(0, 800))
const readmeText = await readFile(path.join(fixture, 'README.md'), 'utf8')
if (!readmeText.includes('demo-project')) throw new Error('README 生成失败：缺少项目名')
console.log('\n✅ README.md 已生成且内容包含项目名')

console.log('\n========== 测试 sanitize_check（测试目录） ==========')
const sanitizeFixture = await sanitizeTool.execute({ root: fixture })
console.log(sanitizeFixture)
if (!sanitizeFixture.includes('微信 AppID')) throw new Error('sanitize_check 未识别测试 AppID')

// 4. 测试 github_init 的安全失败分支（无 Git 身份时不应执行任何危险操作）
const gitFixture = path.resolve('test-git-fixture')
await rm(gitFixture, { recursive: true, force: true })
await mkdir(gitFixture, { recursive: true })
console.log('\n========== 测试 github_init（安全失败分支） ==========')
const githubResult = await githubTool.execute({
  root: gitFixture,
  repoName: 'demo-project',
  username: 'xjailll',
})
console.log(githubResult)
if (!githubResult.includes('未检测到 Git 用户名')) {
  throw new Error('github_init 未按预期在缺少 Git 身份时安全退出')
}

// 清理测试目录
await rm(fixture, { recursive: true, force: true })
await rm(gitFixture, { recursive: true, force: true })
console.log('\n✅ 全部工具测试通过，测试目录已清理')
