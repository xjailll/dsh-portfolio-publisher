# @dsh-external/dsh-portfolio-publisher

GitHub 求职仓库一键发布助手：扫描项目、生成 README、脱敏检查、Web 面板、初始化仓库并推送。

## 工具

| 工具 | 说明 |
| --- | --- |
| `scan_repo` | 扫描项目，识别技术栈、目录结构、README/License/Git 状态和敏感信息 |
| `generate_readme` | 根据扫描结果生成招聘向 README.md |
| `sanitize_check` | 检查仓库中的 AppID/Token/Secret/云环境 ID/本地绝对路径泄露点 |
| `github_init` | 初始化 Git、创建 GitHub 仓库并推送 |

## Web 面板

插件注册了浏览器可视化面板，注入后访问：

```text
http://127.0.0.1:3080/portfolio
```

面板支持：

- 🔍 扫描仓库（支持多行批量扫描）
- 📝 生成 README 并在浏览器预览渲染结果
- 🛡️ 可视化展示安全检查报告（泄露文件、类型、行号）
- 🚀 手动确认后发布到 GitHub（带确认弹窗，不会误操作）

### Web API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/portfolio` | 可视化面板页面 |
| POST | `/portfolio/api/scan` | 扫描仓库，返回结构化结果 |
| POST | `/portfolio/api/readme` | 生成 README，返回内容与路径 |
| POST | `/portfolio/api/sanitize` | 返回敏感信息泄露点列表 |
| POST | `/portfolio/api/push` | 执行 Git/GitHub 发布（需先人工确认） |

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
- `generate_readme` 生成 README
- `github_init` 在缺少 Git 身份时安全退出
- Web API 的 `scan` / `readme` / `sanitize` 接口

## 示例

```
scan_repo(root="D:/projects/my-project")
generate_readme(root="D:/projects/my-project", description="xxx", author="xxx", repo="https://github.com/xxx/xxx", overwrite=true)
sanitize_check(root="D:/projects/my-project")
github_init(root="D:/projects/my-project", repoName="my-project", username="xxx", visibility="public")
```
