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

## 本地运行

创建虚拟环境并安装当前项目：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e . pytest
```

运行测试：

```powershell
.\.venv\Scripts\python.exe -m pytest
```

解析一个 Bilibili 视频地址：

```powershell
.\.venv\Scripts\bili-download.exe "https://www.bilibili.com/video/BV1xx411c7mD/?p=3"
```

下载一个公开视频的默认流：

```powershell
.\.venv\Scripts\bili-download.exe download BV1xx411c7mD
```

也可以直接双击项目根目录下的 `download.bat`，按提示输入 BV 号或视频链接，文件会保存到 `downloads` 文件夹。

指定输出文件：

```powershell
.\.venv\Scripts\bili-download.exe download BV1xx411c7mD --output downloads\demo.flv --overwrite
```

第一版下载功能的边界：

- 不使用 Cookie，只下载游客/当前网络可访问的公开视频默认流。
- 不选择清晰度，先使用 Bilibili 返回的默认 `durl` 流。
- 暂不支持 DASH-only 音视频分离流；这会在后续版本中加入 FFmpeg 合并。
- 不绕过登录、会员、区域、DRM 或其他访问限制。

## 参考资料

调研笔记见 [docs/research-notes.md](docs/research-notes.md)。
