import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../lib/index.js'

// 模拟 DSH Cordis ctx，捕获注册的工具和 Web 路由
const registered = []
const routes = []
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
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

apply(ctx, { defaultVisibility: 'public', panelPath: '/portfolio' })

const byName = (suffix) => registered.find((t) => t.name.endsWith(suffix))
const scanTool = byName('scan_repo')
const readmeTool = byName('generate_readme')
const sanitizeTool = byName('sanitize_check')
const githubTool = byName('github_init')

if (!scanTool || !readmeTool || !sanitizeTool || !githubTool) {
  throw new Error('工具注册不完整: ' + registered.map((t) => t.name).join(', '))
}

console.log('✅ 注册工具:', registered.map((t) => t.name).join('\n  '))
console.log('✅ 注册 Web 路由:', routes.map((r) => r.path).join(', '))

// 模拟 HTTP 请求
function fakeRes() {
  const res = { status: 0, headers: {}, body: '' }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (body) => { res.body = body }
  return res
}

function fakeReq(method, url, body) {
  const req = Readable.from([body ? JSON.stringify(body) : ''])
  req.method = method
  req.url = url
  return req
}

const webRoute = routes.find((r) => r.path === '/portfolio')
if (!webRoute) throw new Error('未注册 /portfolio 路由')

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

// 5. 测试 Web 面板路由
console.log('\n========== 测试 Web /portfolio ==========')
const pageRes = fakeRes()
await webRoute.handler(fakeReq('GET', '/portfolio'), pageRes)
if (pageRes.status !== 200 || !pageRes.body.includes('DSH Portfolio Publisher')) {
  throw new Error('Web 面板页面返回异常')
}
console.log('✅ GET /portfolio 返回 HTML 页面')

console.log('\n========== 测试 Web /portfolio/api/scan ==========')
const scanApiRes = fakeRes()
await webRoute.handler(fakeReq('POST', '/portfolio/api/scan', { root: fixture }), scanApiRes)
const scanApi = JSON.parse(scanApiRes.body)
if (scanApiRes.status !== 200 || !scanApi.ok || !scanApi.data.name) {
  throw new Error('Web scan API 返回异常')
}
console.log('✅ POST /portfolio/api/scan 返回:', scanApi.data.name, '| 技术栈:', scanApi.data.techStack.join(','))

console.log('\n========== 测试 Web /portfolio/api/readme ==========')
const readmeApiRes = fakeRes()
await webRoute.handler(fakeReq('POST', '/portfolio/api/readme', {
  root: fixture,
  description: 'Web 面板测试',
  author: '徐杰',
  repo: 'https://github.com/xjailll/demo-project',
  overwrite: true,
}), readmeApiRes)
const readmeApi = JSON.parse(readmeApiRes.body)
if (readmeApiRes.status !== 200 || !readmeApi.ok || !readmeApi.content) {
  throw new Error('Web readme API 返回异常')
}
console.log('✅ POST /portfolio/api/readme 返回 README 内容长度:', readmeApi.content.length)

console.log('\n========== 测试 Web /portfolio/api/sanitize ==========')
const sanitizeApiRes = fakeRes()
await webRoute.handler(fakeReq('POST', '/portfolio/api/sanitize', { root: fixture }), sanitizeApiRes)
const sanitizeApi = JSON.parse(sanitizeApiRes.body)
if (sanitizeApiRes.status !== 200 || !sanitizeApi.ok || !sanitizeApi.secrets.length) {
  throw new Error('Web sanitize API 返回异常')
}
console.log('✅ POST /portfolio/api/sanitize 发现泄露点:', sanitizeApi.secrets.length)

// 清理测试目录
await rm(fixture, { recursive: true, force: true })
await rm(gitFixture, { recursive: true, force: true })
console.log('\n✅ 全部工具 + Web 面板测试通过，测试目录已清理')
