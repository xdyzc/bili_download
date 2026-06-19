# Git Playbook

这份手册会随着项目推进逐步扩展。每次新增真实功能时，都配一个 Git 练习目标。

## 0. 安装和配置 Git

当前机器的 PowerShell 里暂时找不到 `git` 命令。可以用 Git for Windows 安装包安装，也可以在 PowerShell 里执行：

```powershell
winget install --id Git.Git -e
```

安装完成后，重新打开终端再执行：

```powershell
git --version
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
git config --global init.defaultBranch main
git config --global core.autocrlf true
```

查看配置：

```powershell
git config --global --list
```

## 1. 初始化仓库

```powershell
git init
git status
git add README.md docs/git-playbook.md docs/research-notes.md .gitignore
git commit -m "chore: initialize learning project"
```

练习点：

- `git status`：看工作区和暂存区状态。
- `git add`：把改动放进暂存区。
- `git commit`：保存一个可回退的项目快照。
- `git log --oneline`：查看提交历史。

## 2. 每次功能都开分支

```powershell
git switch -c feat/parse-video-id
```

完成小功能后：

```powershell
git status
git diff
git add .
git commit -m "feat: parse bilibili video id from url"
git switch main
git merge feat/parse-video-id
```

练习点：

- `git switch -c`：从当前提交创建新分支。
- `git diff`：提交前审查自己改了什么。
- `git merge`：把功能分支合回主线。

## 3. 提交前自查

每次提交前先跑三件事：

```powershell
git status
git diff
git diff --staged
```

判断标准：

- 这次提交是否只表达一个清晰意图？
- 是否混入了临时文件、下载的视频、账号 Cookie 或密钥？
- 提交信息是否能让一个月后的自己看懂？

## 4. 常见撤销练习

撤销未暂存的某个文件改动：

```powershell
git restore path/to/file
```

把文件从暂存区拿回来，但保留内容：

```powershell
git restore --staged path/to/file
```

修改上一条提交信息：

```powershell
git commit --amend -m "new message"
```

注意：刚开始只在本地仓库练这些命令。以后接入远端仓库后，再学习哪些历史能改、哪些历史不要改。

## 5. 建议分支命名

- `docs/...`：文档和学习笔记。
- `feat/...`：新功能。
- `fix/...`：修 bug。
- `refactor/...`：不改变行为的代码整理。
- `chore/...`：项目配置、依赖、构建脚本。
