# @dsh-external/dsh-portfolio-publisher

GitHub 求职仓库一键发布助手：LLM 生成专业 README、扫描项目、脱敏检查、Web 面板、初始化仓库并推送。

## 工具

| 工具 | 说明 |
| --- | --- |
| `scan_repo` | 扫描项目，识别技术栈、目录结构、README/License/Git 状态和敏感信息 |
| `generate_readme` | 基于 LLM 生成专业招聘向 README.md，支持自定义提示词 |
| `sanitize_check` | 检查仓库中的 AppID/Token/Secret/云环境 ID/本地绝对路径泄露点 |
| `github_init` | 初始化 Git、创建 GitHub 仓库并推送（自动配置 Git 提交身份；没有 gh CLI 时自动尝试 remote + push） |

## README 生成

`generate_readme` 默认会调用 DSH LLM，根据扫描到的技术栈、目录、依赖等信息，生成一份**专业、真实、有说服力**的求职作品集 README。

默认提示词要求包含：

- 项目名称与一句话定位
- 技术栈徽章
- 项目亮点
- 功能特性
- 技术栈表格
- 系统架构
- 快速开始
- API 概览
- 文档入口
- 测试说明
- 未来规划
- 关于/License

### 自定义提示词

你可以通过 `prompt` 参数传入自己的要求，优先级最高：

```
generate_readme(
  root="D:/projects/my-project",
  description="社区服务全栈项目",
  author="徐杰",
  repo="https://github.com/xjailll/my-project",
  prompt="突出我的全栈能力，重点写系统架构和数据库设计，语气专业克制",
  overwrite=true
)
```

也可以在 Web 面板的“自定义 README 提示词”文本框中填写。

## Web 面板

插件注册了浏览器可视化面板，注入后访问：

```text
http://127.0.0.1:3080/portfolio
```

面板支持：

- 🔍 扫描仓库（支持多行批量扫描）
- 📝 基于 LLM 生成 README 并在浏览器预览
- 🛡️ 可视化展示安全检查报告（泄露文件、类型、行号）
- 🚀 手动确认后发布到 GitHub（带确认弹窗，不会误操作）
- 👤 自动配置 Git 提交身份：没有本地 Git 身份时，会用 GitHub 用户名自动设置 `user.name` 和 `user@users.noreply.github.com`；也支持手动填写 Git 姓名/邮箱

### Web API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/portfolio` | 可视化面板页面 |
| POST | `/portfolio/api/scan` | 扫描仓库，返回结构化结果 |
| POST | `/portfolio/api/readme` | 基于 LLM 生成 README，返回内容与路径 |
| POST | `/portfolio/api/sanitize` | 返回敏感信息泄露点列表 |
| POST | `/portfolio/api/push` | 执行 Git/GitHub 发布（需先人工确认） |

## 没有安装 gh CLI 怎么办

`github_init` 不强制要求 `gh`：

1. 如果你已经手动在 GitHub 创建了空仓库，插件会直接使用 `git remote add origin + git push` 发布；
2. 如果你填了 GitHub 用户名但还没创建仓库，插件会先尝试按 `https://github.com/用户名/仓库名.git` 添加 remote 并 push；
3. 如果仓库不存在导致 push 失败，插件会返回详细的手动创建步骤，你只需在网页建一个空仓库后重试。

> 推荐流程：先在 GitHub 网页创建空仓库（不要勾选 README/.gitignore/License），再在面板里点“发布到 GitHub”，这样不需要安装任何额外 CLI。

## 构建与注入

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
# 注入器环境内：
# dev_inject_plugin D:\2026论文相关\dsh-portfolio-publisher
```

## 测试

```bash
node scripts/test-tools.mjs
```

测试会覆盖：

- 4 个工具是否成功注册
- Web `/portfolio` 路由是否注册
- `scan_repo` 扫描真实项目
- `sanitize_check` 识别 AppID / 云环境 ID / Token / 本地路径
- `generate_readme` 生成 README（LLM 不可用时自动回退内置模板）
- `github_init` 在缺少 Git 身份时安全退出
- Web API 的 `scan` / `readme` / `sanitize` 接口

## 示例

```
scan_repo(root="D:/projects/my-project")
generate_readme(root="D:/projects/my-project", description="xxx", author="xxx", repo="https://github.com/xxx/xxx", prompt="自定义要求", overwrite=true)
sanitize_check(root="D:/projects/my-project")
github_init(root="D:/projects/my-project", repoName="my-project", username="xxx", visibility="public")
```
