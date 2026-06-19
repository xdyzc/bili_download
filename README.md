# Bili Download Learning Project

这个仓库用于一边做一个 Bilibili 视频下载工具，一边系统练习本地 Git 版本控制。

## 项目目标

- 做一个仅供个人学习和合法使用的 Bilibili 下载辅助工具。
- 优先研究普通 UGC 视频的元信息解析、清晰度列表、DASH 音视频流获取和本地合并流程。
- 不绕过 Bilibili、作者、版权方或付费内容的访问控制；只处理当前账号本来有权限访问的内容。
- 通过真实功能迭代练习 Git：初始化、提交、分支、合并、撤销、标签、冲突处理和变更审查。

## 当前建议路线

先做一个轻量原型，再决定最终形态：

1. Userscript 原型：在 Bilibili 视频页读取当前 BV/cid，展示可下载清晰度。
2. 本地 CLI/小服务：负责下载 DASH 视频流和音频流，并调用 FFmpeg 合并。
3. 浏览器扩展：如果原型稳定，再迁移成 Chrome/Edge 插件。

这样做的好处是每一步都能独立提交、独立回滚，也适合练 Git。

## Git 学习主线

建议按里程碑提交，而不是等功能“大概完成”后一次性提交：

- `chore: initialize learning project`
- `docs: record downloader research notes`
- `feat: parse bilibili video id from url`
- `feat: fetch video metadata`
- `feat: list available stream qualities`
- `feat: download dash streams`
- `feat: merge streams with ffmpeg`
- `feat: add userscript control panel`

详细练习见 [docs/git-playbook.md](docs/git-playbook.md)。

## 参考资料

调研笔记见 [docs/research-notes.md](docs/research-notes.md)。

