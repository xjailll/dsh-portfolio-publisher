import { spawnSync } from 'node:child_process'

const input = 'protocol=https\nhost=github.com\n\n'
const cred = spawnSync('git', ['credential', 'fill'], { input, encoding: 'utf8' })
if (cred.status !== 0) throw new Error('无法读取 GitHub 凭据')

const lines = cred.stdout.split('\n')
const get = (k) => {
  const line = lines.find((l) => l.startsWith(k + '='))
  return line ? line.slice(k.length + 1) : undefined
}

const username = get('username')
const token = get('password')
if (!username || !token) throw new Error('GitHub 凭据不完整')

const res = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'dsh-portfolio-publisher',
  },
  body: JSON.stringify({
    name: 'deepseek-harness-plugin',
    description: 'DeepSeek Harness Plugin',
    private: false,
    auto_init: false,
    has_issues: true,
    has_wiki: true,
  }),
})

const data = await res.json()
if (!res.ok) {
  throw new Error(`GitHub API 创建失败 (${res.status}): ${JSON.stringify(data)}`)
}

console.log('CREATED ' + data.html_url)
