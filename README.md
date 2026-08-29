# 📦 DSH Portfolio Publisher

> **DeepSeek Harness 插件：GitHub 求职仓库一键发布助手**
>
> 扫描本地项目 → LLM 生成专业 README → 安全检查 → Web 可视化面板 → 一键推送 GitHub。

[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/version-0.3.0-22c55e)](https://github.com/xjailll/dsh-portfolio-publisher/releases)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)

---

## 🧭 这个插件解决什么问题

很多开发者做完项目后，不知道怎样把 GitHub 仓库整理成“面试官爱看的作品集”：

- README 写得太简单，像临时占位符；
- 项目里残留 AppID、Token、本地绝对路径等敏感信息；
- 不会初始化 Git / 创建 GitHub 仓库 / 推送；
- 没有可视化界面，操作全靠命令行。

`dsh-portfolio-publisher` 把这一整套流程变成 DSH 插件：

```text
扫描仓库 → 识别技术栈 → LLM 生成 README → 安全检查 → 预览 → 确认 → 推送 GitHub
```

---

## ✨ 核心功能

### 1. 仓库扫描

自动识别：

- 技术栈（Vue / React / Node.js / MongoDB / 微信小程序 / Python / Go / Java 等）
- 顶层目录结构
- package.json / 依赖分布
- README / License / Git 状态
- 常见敏感信息泄露点

### 2. LLM 生成专业 README

不再是固定模板，而是基于 DSH LLM 生成：

- 项目亮点
- 功能特性（按用户端 / 管理端 / 后端分组）
- 技术栈表格
- 系统架构
- 快速开始
- API 概览
- 测试说明
- 未来规划
- License / 关于

支持**自定义提示词**，你可以要求 LLM 突出全栈能力、强调数据库设计、换成英文、改成活泼语气等。

### 3. 安全检查

扫描并报告：

- 微信 AppID
- 云开发环境 ID
- Token / Secret / API Key
- 硬编码密码
- 本地绝对路径
- AK/SK 云厂商密钥

### 4. Web 可视化面板

插件内置 Web 面板，不需要额外前端项目：

```text
http://127.0.0.1:3080/portfolio
```

支持：

- 多仓库批量扫描
- README 浏览器预览
- 泄露点可视化列表
- 手动确认后发布 GitHub

### 5. 无需 gh CLI 也能发布

自动处理 Git 身份：

- 有 `gh` → 自动创建仓库并推送；
- 没有 `gh` → 自动尝试 `git remote add origin + git push`；
- 仓库不存在 → 返回详细手动创建步骤；
- 已有 remote → 直接推送。

---

## 🧩 插件工具

| 工具 | 说明 |
| --- | --- |
| `scan_repo` | 扫描项目，输出技术栈、结构、README/License/Git、敏感信息 |
| `generate_readme` | 基于 LLM 生成专业 README，支持自定义提示词 |
| `sanitize_check` | 检查 AppID / Token / Secret / 云环境 ID / 本地路径泄露点 |
| `github_init` | 初始化 Git、创建 GitHub 仓库并推送 |

### 工具调用示例

```text
scan_repo(root="D:/projects/my-project")
```

```text
generate_readme(
  root="D:/projects/my-project",
  description="社区服务全栈项目",
  author="徐杰",
  repo="https://github.com/xjailll/my-project",
  prompt="突出全栈能力，重点写系统架构和数据库设计",
  overwrite=true
)
```

```text
sanitize_check(root="D:/projects/my-project")
```

```text
github_init(
  root="D:/projects/my-project",
  repoName="my-project",
  username="xjailll",
  gitName="徐杰",
  gitEmail="2947995340@qq.com",
  visibility="public",
  commitMessage="feat: 初始化项目"
)
```

---

## 🖥️ Web 面板

插件注入后，浏览器访问：

```text
http://127.0.0.1:3080/portfolio
```

### Web API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/portfolio` | 可视化面板 |
| POST | `/portfolio/api/scan` | 扫描仓库，返回结构化结果 |
| POST | `/portfolio/api/readme` | LLM 生成 README |
| POST | `/portfolio/api/sanitize` | 返回敏感信息列表 |
| POST | `/portfolio/api/push` | 执行 Git/GitHub 发布 |

### 面板使用流程

1. 填写项目根目录（支持多行批量扫描）；
2. 点击 `🔍 扫描` 查看技术栈与泄露点；
3. 填写 README 选项和自定义提示词；
4. 点击 `📝 生成 README` 预览；
5. 填写仓库名 / GitHub 用户名 / Git 身份；
6. 点击 `🚀 发布到 GitHub`，确认后完成推送。

---

## 🧠 README 自定义提示词

默认提示词已经比较专业，但你可以覆盖：

| 方式 | 说明 |
| --- | --- |
| 工具参数 `prompt` | 单次生成时指定 |
| Web 面板文本框 | 可视化填写 |
| 插件配置 `readmePrompt` | 全局默认提示词 |

示例自定义提示词：

```text
突出我的全栈能力，重点写系统架构和数据库设计，语气专业克制。
可以适当使用 Mermaid 架构图，不要写空话。
```

---

## 🔒 安全检查与脱敏建议

`sanitize_check` 会输出类似报告：

```text
⚠️ 发现 5 处潜在敏感信息：

📄 admin-web/src/stores/user.js
  - [疑似 Secret/Token] 第 20 行

📄 docs/QUICK_REFERENCE.md
  - [本地绝对路径] 第 9 行
```

建议在公开仓库前：

1. 将真实 AppID / Secret / 云环境 ID 替换为占位符；
2. 删除本地绝对路径；
3. 检查 `.env` 是否被 Git 跟踪；
4. 使用 `.gitignore` 排除 `node_modules`、`.env`、密钥文件。

---

## 📂 项目结构

```text
dsh-portfolio-publisher/
├── src/
│   ├── index.ts              # 插件主入口（工具 + Web 路由）
│   └── client/               # （预留客户端面板）
├── scripts/
│   ├── build.sh              # DSH 构建脚本
│   ├── test-tools.mjs        # 自动化测试
│   └── create-gh-repo.mjs    # 通过本地 GitHub 凭据创建仓库
├── lib/                      # 编译产物
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛠️ 开发与构建

### 环境要求

- Node.js 18+
- DeepSeek Harness 环境
- TypeScript

### 构建

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
```

### 注入

```bash
dev_inject_plugin D:\2026论文相关\dsh-portfolio-publisher
```

### 测试

```bash
node scripts/test-tools.mjs
```

测试覆盖：

- 4 个工具注册
- Web 路由注册
- 真实项目扫描
- README 生成
- 敏感信息检查
- GitHub 发布安全分支
- Web API 接口

---

## 🚀 路线图

- [x] 仓库扫描
- [x] LLM 生成 README
- [x] 自定义提示词
- [x] Web 可视化面板
- [x] 无 gh CLI 发布
- [ ] 自动脱敏替换（不只报告，直接替换占位符）
- [ ] GitHub Topics 自动推荐
- [ ] 多仓库批量发布队列
- [ ] README 多语言生成（中 / 英）
- [ ] Release 自动创建

---

## 📄 License

[BSD-3-Clause](LICENSE)

---

## 🙌 感谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — “Everything is a Plugin”
- DSH 插件生态与社区
