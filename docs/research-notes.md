# Downloader Research Notes

这份笔记记录我们调研过的项目、接口和技术路线。引用外部项目时只学习设计思路，不直接复制受限代码。

## 观察到的实现路线

### ACG 助手 / bilibili-helper

你提到的 ACG 助手是一个面向 Bilibili 的浏览器扩展，官方介绍包含视频下载、直播串流下载、消息推送、页面信息聚合等功能；Chrome Web Store 页面也说明其包含订阅功能，订阅后可解锁 1080P 高帧率及以上画质下载等能力。

可学习点：

- 产品形态：浏览器扩展能直接贴近 Bilibili 页面，入口自然。
- 功能边界：下载、字幕、弹幕、封面、直播录制和消息推送可以拆成独立模块。
- 商业化边界：高清下载被做成付费点，说明“取流、合并、稳定性、维护成本”才是核心难点。

参考资料：

- [ACG 助手官网](https://acghelper.com/)
- [ACG 助手 Chrome Web Store](https://chromewebstore.google.com/detail/acg%E5%8A%A9%E6%89%8B-%E6%8F%90%E4%BE%9B%E8%A7%86%E9%A2%91%E4%B8%8B%E8%BD%BD%E6%B6%88%E6%81%AF%E6%8E%A8%E9%80%81/kpbnombpnpcffllnianjibmpadjolanh)
- [bilibili-helper GitHub 组织](https://github.com/bilibili-helper)

### Userscript / 浏览器脚本

适合快速原型：

- 能直接运行在 Bilibili 页面里，读取页面 URL、DOM 和当前登录态下可访问的接口响应。
- 适合先做“识别视频、列清晰度、显示下载按钮”。
- 如果要在浏览器内合并 DASH 音视频流，常见方案是 `ffmpeg.wasm`，但体积和性能压力较大。

参考项目：

- [Bilibili Evolved](https://github.com/the1812/Bilibili-Evolved)：综合性 Bilibili 增强脚本。README 提醒如果只是下载视频，GreasyFork 上有更专业的脚本；这说明“增强脚本”和“下载器”最好拆开思考。
- [Jeffrey0117/tampermonkey-bilibili-download](https://github.com/Jeffrey0117/tampermonkey-bilibili-download)：Tampermonkey 脚本，README 提到支持直接下载、RPC、AriaNG、清晰度选择和批量队列。
- [owendswang/Download-Pictures-from-Bilibili-Timeline](https://github.com/owendswang/Download-Pictures-from-Bilibili-Timeline)：Tampermonkey 脚本，README 提到可下载 Bilibili DASH 音视频流，并用 `ffmpeg.wasm` 在浏览器内合并 MP4。
- [GreasyFork: bilibili 视频下载](https://greasyfork.org/en/scripts/413228-bilibili%E8%A7%86%E9%A2%91%E4%B8%8B%E8%BD%BD)：页面说明支持 Web、RPC、Blob、Aria 等下载方式，以及 flv、dash、mp4、字幕弹幕等能力。

### 本地 CLI / 小服务

适合真正下载和合并：

- 浏览器脚本负责提取页面信息，本地程序负责下载与合并。
- 可以调用系统 FFmpeg，性能和稳定性通常比 `ffmpeg.wasm` 好。
- 后续能包装成桌面 App 或被浏览器扩展调用。

参考项目：

- [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)：成熟的通用下载器，支持大量站点和 FFmpeg 后处理。我们可以学习它的任务拆分和命令行体验。
- 一些 Bilibili 专用下载器通常采用 “获取视频流 URL -> 下载音频/视频 -> FFmpeg 合并” 的结构。

### 浏览器扩展

适合最终产品化：

- 能做更完整的 UI、权限控制、后台任务和本地服务通信。
- Manifest V3、跨域请求、下载 API、Cookie 权限都需要单独处理。
- 适合在 Userscript 和本地下载核心稳定后迁移。

## Bilibili 取流基本概念和风险

Bilibili Web 端常见流程大致是：

1. 从 URL 或页面状态拿到 `bvid`/`aid`。
2. 获取视频分 P 信息，拿到目标 `cid`。
3. 请求播放地址接口，得到可用清晰度、格式和 DASH 流信息。
4. 下载视频流和音频流。
5. 使用 FFmpeg 合并为 MP4/MKV。

常见响应字段包括：

- `accept_quality`：可用清晰度代码列表。
- `accept_description`：清晰度文字说明。
- `durl`：FLV/MP4 分段流信息。
- `dash`：DASH 音视频分离流信息。

风险提醒：

- [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) 曾是常见的 Bilibili API 资料库，但该仓库在 2026-01-30 被作者归档，README 说明其已停止维护并删除相关文档与源码，原因涉及 B 站方面关于非公开 API 收集传播的法律警告。
- 因此本项目不把“整理非公开接口调用逻辑”作为目标。更合适的学习方向是：工程结构、Git 管理、下载任务编排、FFmpeg 合并、浏览器扩展权限模型，以及对用户已可访问内容的个人学习使用。

## 合规边界

这个项目用于学习和个人合法备份，不做这些事：

- 绕过 Bilibili 付费会员、区域限制、DRM 或风控。
- 批量爬取、传播或二次分发无授权内容。
- 在仓库里保存 Cookie、账号凭据、下载到的视频文件或私密数据。

## 待确认问题

- 第一阶段已选择本地 CLI 作为下载核心的原型入口，后续可以再接 Userscript 或浏览器扩展。
- 是否允许依赖 FFmpeg？当前建议允许，因为 DASH 音视频流合并会简单很多。
- 是否只支持当前登录账号可观看的普通 UGC 视频？
- 是否需要下载字幕、弹幕、封面和分 P 列表？
