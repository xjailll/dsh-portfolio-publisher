# @dsh-external/dsh-portfolio-publisher

GitHub 求职仓库一键发布助手：扫描项目、生成 README、脱敏检查、初始化仓库并推送。

## 工具

| 工具 | 说明 |
| --- | --- |
| `scan_repo` | 扫描项目，识别技术栈、目录结构、README/License/Git 状态和敏感信息 |
| `generate_readme` | 根据扫描结果生成招聘向 README.md |
| `sanitize_check` | 检查仓库中的 AppID/Token/Secret/云环境 ID/本地绝对路径泄露点 |
| `github_init` | 初始化 Git、创建 GitHub 仓库并推送 |

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
- `scan_repo` 扫描真实项目
- `sanitize_check` 识别 AppID / 云环境 ID / Token / 本地路径
- `generate_readme` 生成 README
- `github_init` 在缺少 Git 身份时安全退出

## 示例

```
scan_repo(root="D:/projects/my-project")
generate_readme(root="D:/projects/my-project", description="xxx", author="xxx", repo="https://github.com/xxx/xxx", overwrite=true)
sanitize_check(root="D:/projects/my-project")
github_init(root="D:/projects/my-project", repoName="my-project", username="xxx", visibility="public")
```
