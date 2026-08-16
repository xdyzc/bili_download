# 项目优化审查报告

- 审查日期：2026-08-16
- 审查分支：`experiment/optimization`
- 审查范围：Python CLI/GUI、Chromium 扩展、Native Messaging Companion、测试与构建流程
- 工作树状态：包含已暂存和未暂存的扩展开发改动

## 1. 执行摘要

项目已经具备普通视频、DASH、分 P、番剧、音频、直播录制、浏览器下载任务恢复和本地流式 Companion 等较完整的功能。当前最值得投入的方向不是继续提高并发或增加功能，而是先补齐以下边界：

1. 媒体请求与登录 Cookie 的隔离。
2. 下载结果的完整性、原子发布和防覆盖。
3. Companion 多任务的跨进程协调。
4. 取消、端口断开和异常退出时的状态收敛。
5. 大型前端脚本的模块化与统一自动化测试。

审查发现 6 项应优先处理的 P1 问题，以及若干影响稳定性、性能和维护成本的 P2/P3 问题。建议先完成安全与数据完整性修复，再处理任务并发和恢复，最后进行架构拆分和性能优化。

## 2. 优先级定义

| 优先级 | 含义 |
| --- | --- |
| P1 | 可能泄露凭据、损坏或覆盖文件，或使关键用户流程稳定失败，应在继续扩展功能前修复 |
| P2 | 会造成错误状态、资源泄漏、重复下载或较明显的可靠性问题，应进入下一轮稳定性工作 |
| P3 | 主要影响性能、体验、可维护性或交付效率，可在核心边界稳定后处理 |

## 3. P1 问题

### 3.1 Python 媒体请求可能泄露完整登录 Cookie

**证据**

- [`src/bili_download/client.py:162`](../src/bili_download/client.py#L162) 的 `open_stream()` 接受 API 返回的媒体 URL。
- [`src/bili_download/client.py:167`](../src/bili_download/client.py#L167) 调用 `_download_headers(..., cookie_header=self._cookie_header)`。
- [`src/bili_download/client.py:257`](../src/bili_download/client.py#L257) 的 `_download_headers()` 会把整份 Cookie 写入请求头。

这会让 `SESSDATA`、`bili_jct` 等登录凭据被发送到媒体 CDN。由于 URL 来自远端响应，且请求还可能发生跨域重定向，凭据可能到达不应接收它的主机。

**建议**

- 媒体流请求默认完全不携带 Bilibili 登录 Cookie；播放地址本身的签名通常已经完成授权。
- 对媒体 URL 使用严格的 HTTPS 主机白名单。
- 自定义重定向处理，跨主机跳转时绝不转发 Cookie 或其他敏感头。
- 增加任意主机、跨域重定向及合法 CDN 的请求头测试。

### 3.2 Companion 并发保护只在单个进程内生效

**证据**

- [`extension/src/background.js:1971`](../extension/src/background.js#L1971) 为每个 Companion 任务调用一次 `chrome.runtime.connectNative()`。
- Chromium 会为每个 Native Messaging 连接启动独立宿主进程。
- [`extension/companion/bili_stream_companion.py:399`](../extension/companion/bili_stream_companion.py#L399) 至 `403` 的任务、磁盘预留和输出路径预留都只是当前进程的内存状态。
- [`extension/companion/bili_stream_companion.py:1525`](../extension/companion/bili_stream_companion.py#L1525) 的文件系统存在性检查不是原子占位。

因此，多个并发任务无法共享 README 所描述的组合磁盘预留。同名任务还可能同时选中相同输出路径，竞争 manifest、分片文件和最终成品。

**建议**

- 首选方案：后台复用一个长期 Native Messaging port，由一个 Companion 进程管理全部任务。
- 备选方案：增加跨进程文件锁、原子占位文件和共享磁盘预留账本。
- 增加两个并发同名任务、两个并发超额任务和多浏览器窗口的集成测试。

### 3.3 直播临时文件清理可能误删其他任务文件

**证据**

- [`extension/companion/bili_stream_companion.py:1303`](../extension/companion/bili_stream_companion.py#L1303) 的文件名清洗允许 `[` 和 `]`。
- [`extension/companion/bili_stream_companion.py:1573`](../extension/companion/bili_stream_companion.py#L1573) 将输出文件名直接拼入 glob 模式。

例如标题 `[x].flv` 会把方括号解释成 glob 字符组，可能匹配并删除另一个 `x.flv` 任务的 `.part` 文件，同时匹配不到自己的字面文件名。

**建议**

- 不再通过标题反推临时文件，直接在任务上下文中保存精确 `Path` 列表并逐一删除。
- 如仍需 glob，必须使用 `glob.escape()`。
- 增加含 `[]`、通配符语义字符和相似标题的并发清理测试。

### 3.4 批量下载取消与后台异步协议不一致

**证据**

- [`extension/src/background.js:1147`](../extension/src/background.js#L1147) 在存在活动 Chrome 下载时正常返回 `canceling`，等待 `downloads.onChanged` 给出最终结果。
- [`extension/src/popup.js:2373`](../extension/src/popup.js#L2373) 的批量取消却要求控制请求立即返回 terminal 状态，否则将队列标记为暂停并报告取消失败。
- 单项取消路径已经在 [`extension/src/popup.js:3312`](../extension/src/popup.js#L3312) 接受 `canceling`，两条路径行为不一致。

这会导致活动批次的首次取消通常被误判为失败，剩余下载可能继续运行。

**建议**

- 接受 `canceling` 作为控制请求已被浏览器接收。
- 通过任务 waiter、`downloads.onChanged` 或有界轮询等待最终状态。
- 只有确认各任务为 `canceled`、`complete` 或 `interrupted` 后，才持久化批次终态。
- 测试必须让后台真实返回 `canceling`，不能直接 mock 为 `canceled`。

### 3.5 截断的 HTTP 响应会被当作成功文件

**证据**

- [`src/bili_download/downloader.py:264`](../src/bili_download/downloader.py#L264) 的读取循环遇到 EOF 就结束。
- [`src/bili_download/downloader.py:280`](../src/bili_download/downloader.py#L280) 直接返回已写入字节数，没有与 API size 或 `Content-Length` 比较。
- 非 DASH 文件随后会在 [`src/bili_download/downloader.py:98`](../src/bili_download/downloader.py#L98) 被提升为正式文件。

短响应会被发布为成功文件。备用 URL 只在打开连接失败时使用，读取中途断开或提前 EOF 不会切换备用源。

**建议**

- 在已知长度时进行严格字节数校验。
- 将超时、读取异常和短读统一转换为下载错误。
- 使用 Range 从当前偏移继续，必要时切换备用 URL。
- 所有候选源失败后保留可诊断状态，但绝不发布正式文件。

### 3.6 默认覆盖与 FFmpeg 输出缺少原子性

**证据**

- [`src/bili_download/downloader.py:353`](../src/bili_download/downloader.py#L353) 的默认路径主要由标题生成，不包含 BV 号。
- [`src/bili_download/gui.py:312`](../src/bili_download/gui.py#L312) 和 [`src/bili_download/cli.py:278`](../src/bili_download/cli.py#L278) 的交互流程默认启用覆盖。
- [`src/bili_download/downloader.py:469`](../src/bili_download/downloader.py#L469) 会在 FFmpeg 合并前删除旧目标，并让 FFmpeg 直接写最终路径。
- 弹幕转码也在 [`src/bili_download/downloader.py:513`](../src/bili_download/downloader.py#L513) 提前删除旧成品。

相同标题、清洗后相同标题或截断后相同标题会静默覆盖已有视频。FFmpeg 失败时还可能同时丢失旧成品并留下半成品。

**建议**

- 默认文件名加入 `bvid`，多 P 文件继续加入页码。
- GUI 和交互 CLI 默认自动编号或要求用户确认覆盖。
- FFmpeg 始终写入同目录唯一 staging 文件。
- FFmpeg 成功并通过基本验证后，再使用 `os.replace()` 原子替换目标。

## 4. P2 问题

### 4.1 Range 下载失败后仍有旧 worker 运行

[`extension/src/popup.js:4111`](../extension/src/popup.js#L4111) 启动多个 Range worker；任一 worker 失败后，`Promise.all()` 会立即拒绝，但其他 worker 没有共享停止标志或本次尝试专用的 `AbortController`。调用者随后在 [`extension/src/popup.js:3946`](../extension/src/popup.js#L3946) 启动整文件请求。

结果可能是 Range 请求和整文件请求同时继续，造成重复带宽、额外内存占用和乱序进度，甚至突破原先的内存预算估算。

建议为每次 Range 尝试创建独立 `AbortController`，首个失败时停止领取新分片、取消所有在途请求，并等待 `Promise.allSettled()` 后再回退。

### 4.2 Native 端口 EOF 没有完整关闭活动任务

[`extension/companion/bili_stream_companion.py:1187`](../extension/companion/bili_stream_companion.py#L1187) 在 stdin EOF 后直接退出主循环，而 worker 在 [`extension/companion/bili_stream_companion.py:552`](../extension/companion/bili_stream_companion.py#L552) 以 daemon 线程运行。

浏览器关闭、扩展重载或端口意外断开可能绕过 worker 的 `finally`，留下 `running` manifest、分片、mux 临时文件，甚至仍在运行的 FFmpeg 子进程。后续重新授权会选择新文件名并从头下载，旧大文件可能永久残留。

建议实现宿主级 `shutdown()`：设置所有取消事件、关闭活动响应、终止或等待 FFmpeg、执行有界 `join()`，最后清理或明确保留可恢复文件。

### 4.3 多段 durl 采用直接字节拼接

[`src/bili_download/downloader.py:83`](../src/bili_download/downloader.py#L83) 打开一个目标文件后，将所有 durl segment 依次写入。独立 MP4/FLV 容器不保证可以通过简单拼接得到有效文件，播放器可能只识别第一段。

建议各段分别下载并验证，再使用 FFmpeg concat/remux。测试应使用真实双段媒体 fixture，并通过 `ffprobe` 检查时长、流数量和可解析性。

### 4.4 临时文件名固定，跨进程并发不安全

Python 下载器在 [`src/bili_download/downloader.py:76`](../src/bili_download/downloader.py#L76)、[`src/bili_download/downloader.py:140`](../src/bili_download/downloader.py#L140) 和 [`src/bili_download/downloader.py:510`](../src/bili_download/downloader.py#L510) 根据最终文件名生成固定临时路径，并会主动删除已有临时文件。

两个 CLI/EXE 同时下载同一目标时，可能删除、覆盖或发布对方的临时文件。建议使用同目录随机 staging 文件，并对最终目标使用锁或原子占位。

### 4.5 终态事件依赖 manifest 写入成功

Companion 的完成、取消和失败路径会先写 manifest，再向扩展发送终态。例如 [`extension/companion/bili_stream_companion.py:1087`](../extension/companion/bili_stream_companion.py#L1087) 的失败路径中，如果磁盘已满、文件被锁定或权限异常，终态事件不会发送，扩展可能一直显示任务进行中。

建议把 manifest 更新设为 best effort，并保证终态事件在 `finally` 中发送。manifest 写入错误应转换为安全错误码，不能阻断协议收敛。

### 4.6 API 响应结构缺少统一校验

[`src/bili_download/client.py:199`](../src/bili_download/client.py#L199) 接受任意合法 JSON，后续逻辑默认其为包含固定字段的 dict。顶层数组、字段缺失或字段类型变化会产生未统一处理的 `AttributeError`、`KeyError` 或 `TypeError`，CLI 可能直接显示 traceback。

建议在网络边界完成顶层类型和必要字段校验，并统一转换为 `BiliApiError` 或下载领域错误。

### 4.7 GUI 后台任务缺少取消和关闭协议

[`src/bili_download/gui.py:250`](../src/bili_download/gui.py#L250)、[`src/bili_download/gui.py:276`](../src/bili_download/gui.py#L276) 和 [`src/bili_download/gui.py:320`](../src/bili_download/gui.py#L320) 都创建 daemon 线程，但窗口没有 `WM_DELETE_WINDOW` 取消、等待和清理流程。

用户在下载或转码中关闭窗口时可能留下临时文件，FFmpeg 子进程也可能继续运行。建议增加任务取消事件、进程句柄跟踪和有界关闭流程。

### 4.8 Cookie 域名校验使用子串匹配

[`src/bili_download/cookies.py:53`](../src/bili_download/cookies.py#L53) 使用 `"bilibili.com" in domain`，因此 `notbilibili.com` 也会被接受。

建议规范化域名后只允许 `domain == "bilibili.com"` 或 `domain.endswith(".bilibili.com")`，并校验 Cookie 名和值不能包含控制字符。

## 5. P3 与性能优化

### 5.1 DASH 视频与音频可以受控并行下载

Python 下载器目前依次下载视频和音频。两条流互相独立，可使用最多两个 worker 并行下载，使耗时接近两者中的较慢者。实施前应先完成唯一临时文件、短读校验、取消和错误收敛。

### 5.2 断点续传与候选源重试

建议把下载核心抽象为可恢复传输：记录已写入偏移，使用 `Range` 继续，读取失败时在同一偏移切换备用 URL，并采用有限次数的指数退避。该能力比简单增加并发更能改善大文件下载成功率。

### 5.3 进度统计需要按任务统一计时

Python 多段下载会在每段重置计时，却使用累计字节计算速度，后续分段速度会虚高。未知总长度时，每段还会单独报告完成，GUI 可能过早显示 100%。建议由任务层统一维护开始时间、累计量和最终完成事件。

### 5.4 弹幕 ASS 路径转义不完整

[`src/bili_download/downloader.py:443`](../src/bili_download/downloader.py#L443) 只处理反斜杠和冒号，但 FFmpeg filtergraph 中的单引号、逗号、分号和方括号也可能影响解析。建议使用完整的 libavfilter 转义，或将 ASS 复制到受控的简单临时路径。

### 5.5 Windows 文件名兼容性

[`src/bili_download/downloader.py:365`](../src/bili_download/downloader.py#L365) 未处理 `CON`、`PRN`、`AUX`、`NUL`、`COM1` 等 Windows 保留名，也没有按完整路径控制长度。建议集中实现跨平台安全文件名策略。

## 6. 架构与可维护性

当前 [`extension/src/background.js`](../extension/src/background.js) 约 5100 行，包含约 240 个函数；[`extension/src/popup.js`](../extension/src/popup.js) 约 4700 行，包含约 200 个函数。API、下载、任务持久化、Companion、批处理、诊断和 UI 状态已经形成多个独立职责，但仍集中在两个脚本中。

建议逐步拆分为：

- `api/`：视频、番剧、直播和播放地址 API。
- `downloads/`：Chrome downloads、Range、页面上下文和 DASH mux。
- `tasks/`：直接任务、批次任务、Companion 任务及持久化。
- `companion/`：Native Messaging 协议和端口生命周期。
- `diagnostics/`：脱敏、错误归一化和诊断存储。
- `ui/`：页面状态、任务中心、进度与设置。

Manifest V3 service worker 可以迁移为 ES module；Popup 也可使用模块脚本。拆分时应先提取纯函数和协议模型，保持现有行为测试，再移动有副作用的 Chrome API 适配层。

## 7. 测试与交付缺口

### 7.1 当前验证结果

| 检查 | 结果 |
| --- | --- |
| 扩展 Node 测试 | 44 项中 43 项通过，1 项 Chromium smoke 跳过 |
| Companion Python `unittest` | 15 项通过 |
| JavaScript `node --check` | `background.js`、`popup.js`、`content.js`、`dash-muxer.mjs` 均通过 |
| Git whitespace 检查 | 无 whitespace error；部分扩展文件存在 LF/CRLF 转换警告 |
| 主 Python `pytest` | 未执行；当前可用 Python 环境未安装 `pytest` |

Chromium smoke 被跳过的原因是当前检测到的浏览器阻止了扩展页面运行，测试未获得有效的扩展 runtime。该跳过不能代替真实浏览器验证。

### 7.2 建议补充的自动化

- 新增 CI，至少覆盖 Windows 上的 Python 3.11、Node 22 和 Chrome for Testing。
- 将 Companion Python 测试纳入默认测试入口；当前 `pyproject.toml` 的 `testpaths` 只包含根目录 `tests`。
- 为 Node 测试提供统一 `package.json` scripts，即使运行时只依赖 Node 内置模块。
- 增加 Ruff 或同类 Python lint、JS lint，以及最低限度的类型检查。
- 固定构建依赖版本，避免 PyInstaller、pytest 和其他工具的最新版漂移影响可复现构建。
- 增加 `.gitattributes`，明确源码统一行尾，消除当前 LF/CRLF 警告。

优先新增的回归测试包括：

1. Cookie 主机隔离与跨域重定向。
2. HTTP 短读、读取超时、备用 URL 和 Range 续传。
3. 失败覆盖时保留旧成品。
4. 两个同目标进程并发下载。
5. Companion 同名并发、组合磁盘预算和端口 EOF 清理。
6. 后台返回 `canceling` 时的批量取消。
7. Range 中途失败后所有 worker 都已停止。
8. 真实 FFmpeg 多段合并和特殊字符路径。
9. GUI 关闭窗口时取消下载与子进程。

## 8. 推荐实施顺序

### 第一阶段：安全与数据完整性

1. 移除媒体请求 Cookie，增加主机和重定向限制。
2. 增加短读校验，禁止发布不完整文件。
3. 改造默认命名、防覆盖和 FFmpeg 原子 staging。
4. 修复直播 glob 清理越界。

### 第二阶段：任务生命周期与并发

1. 统一 Companion 为共享宿主进程，或实现跨进程锁。
2. 修复批量取消的 `canceling` 状态等待。
3. 为 Native EOF、GUI 关闭和 FFmpeg 增加取消/清理协议。
4. 修复 Range fallback 的 worker 终止。

### 第三阶段：可靠性与性能

1. 实现 Range 断点续传、备用源切换和退避。
2. 使用 FFmpeg 正确合并多段 durl。
3. 在边界稳定后并行下载 DASH 视频和音频。
4. 修正统一进度统计。

### 第四阶段：工程化

1. 拆分 `background.js` 和 `popup.js`。
2. 建立统一测试命令、CI、lint 和类型检查。
3. 固定构建依赖并补真实浏览器 smoke。
4. 更新根 README，使其反映扩展、Companion 和 Python 下载器的当前产品边界。

## 9. 总结

项目的功能广度已经足以支撑真实使用，但下载器属于对凭据、磁盘和长时间任务都高度敏感的工具。下一阶段应把“不会泄露 Cookie、不会发布半文件、不会覆盖旧成品、取消后一定收敛、并发任务不会互相破坏”作为完成标准。完成这些边界后，再做并行下载、断点续传和模块化，收益会更稳定，也更容易通过自动化测试验证。
