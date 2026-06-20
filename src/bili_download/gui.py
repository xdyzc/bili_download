"""Minimal Tkinter desktop interface for Bili Download."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .client import BiliApiError, BiliClient, BiliNetworkError
from .cookies import CookieLoadError, load_cookie_file
from .downloader import BiliDownloader, UnsupportedStreamError
from .models import DashMedia, DownloadResult, LoginStatus, PlayUrl, VideoInfo, VideoPage


BG = "#f7f7f4"
PANEL = "#ffffff"
TEXT = "#1d1d1f"
MUTED = "#73736f"
LINE = "#deded8"
ACCENT = "#111111"
ACCENT_LIGHT = "#ecece7"


@dataclass(frozen=True)
class QualityOption:
    code: int
    label: str


def import_cookie_file(source: Path, destination: Path) -> None:
    """Validate a cookie JSON file, then copy it into the app cookie path."""

    source = source.expanduser()
    destination = destination.expanduser()
    cookie = load_cookie_file(source)
    if cookie.is_empty:
        raise CookieLoadError("cookie file did not contain Bilibili cookies")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() == destination.resolve():
        return
    shutil.copyfile(source, destination)


class DownloadApp:
    def __init__(self, root: tk.Tk, *, app_dir: Path | None = None) -> None:
        self.root = root
        self.app_dir = app_dir or _app_dir()
        self.cookie_file = self.app_dir / "bili.json"
        self.output_dir = self.app_dir / "downloads"
        self.queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.qualities: list[QualityOption] = []
        self.video_info: VideoInfo | None = None
        self.video_page: VideoPage | None = None
        self.loading = False
        self.downloading = False

        self.video_var = tk.StringVar()
        self.cookie_status_var = tk.StringVar(value="Cookie: \u68c0\u67e5\u4e2d...")
        self.title_var = tk.StringVar(value="\u5c1a\u672a\u52a0\u8f7d\u89c6\u9891")
        self.owner_var = tk.StringVar(value="")
        self.quality_var = tk.StringVar()
        self.output_var = tk.StringVar(value=str(self.output_dir))
        self.danmaku_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="\u51c6\u5907\u5c31\u7eea")
        self.progress_var = tk.DoubleVar(value=0)

        self._configure_root()
        self._build()
        self._set_busy(False)
        self._check_cookie_async()
        self.root.after(100, self._drain_queue)

    def _configure_root(self) -> None:
        self.root.title("Bili Download")
        self.root.geometry("900x640")
        self.root.minsize(780, 570)
        self.root.configure(bg=BG)
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        font = ("Microsoft YaHei UI", 10)
        style.configure(".", font=font, background=BG, foreground=TEXT)
        style.configure("TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("TLabel", background=BG, foreground=TEXT)
        style.configure("Panel.TLabel", background=PANEL, foreground=TEXT)
        style.configure("Muted.TLabel", background=PANEL, foreground=MUTED)
        style.configure(
            "Title.TLabel",
            background=BG,
            foreground=TEXT,
            font=("Microsoft YaHei UI", 22, "bold"),
        )
        style.configure(
            "Section.TLabel",
            background=PANEL,
            foreground=TEXT,
            font=("Microsoft YaHei UI", 11, "bold"),
        )
        style.configure("TButton", padding=(14, 8), borderwidth=1, focusthickness=0)
        style.configure("Primary.TButton", background=ACCENT, foreground="#ffffff", bordercolor=ACCENT)
        style.map("Primary.TButton", background=[("active", "#2b2b2b"), ("disabled", "#9a9a95")])
        style.configure("Ghost.TButton", background=PANEL, foreground=TEXT, bordercolor=LINE)
        style.configure("TEntry", fieldbackground="#fbfbf8", bordercolor=LINE, lightcolor=LINE, darkcolor=LINE, padding=8)
        style.configure("TCombobox", fieldbackground="#fbfbf8", bordercolor=LINE, arrowsize=16, padding=6)
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor=ACCENT_LIGHT, bordercolor=ACCENT_LIGHT)
        style.configure("TCheckbutton", background=PANEL, foreground=TEXT)

    def _build(self) -> None:
        shell = ttk.Frame(self.root, padding=(28, 24, 28, 24))
        shell.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        shell.columnconfigure(0, weight=1)
        shell.rowconfigure(2, weight=1)

        header = ttk.Frame(shell)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 18))
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="Bili Download", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(header, textvariable=self.cookie_status_var, foreground=MUTED).grid(row=0, column=1, sticky="e", padx=(0, 12))
        self.cookie_button = ttk.Button(
            header,
            text="\u5bfc\u5165 Cookie",
            style="Ghost.TButton",
            command=self.import_cookie,
        )
        self.cookie_button.grid(row=0, column=2, sticky="e")

        form = ttk.Frame(shell, style="Panel.TFrame", padding=(18, 16, 18, 18))
        form.grid(row=1, column=0, sticky="ew")
        form.columnconfigure(0, weight=1)
        form.columnconfigure(1, weight=0)
        form.columnconfigure(2, weight=0)

        ttk.Label(form, text="\u89c6\u9891", style="Section.TLabel").grid(row=0, column=0, sticky="w", columnspan=3)
        video_entry = ttk.Entry(form, textvariable=self.video_var)
        video_entry.grid(row=1, column=0, sticky="ew", pady=(8, 0), padx=(0, 10))
        video_entry.bind("<Return>", lambda _event: self.load_qualities())
        self.load_button = ttk.Button(form, text="\u52a0\u8f7d", style="Ghost.TButton", command=self.load_qualities)
        self.load_button.grid(row=1, column=1, sticky="ew", padx=(0, 10), pady=(8, 0))
        self.download_button = ttk.Button(form, text="\u4e0b\u8f7d", style="Primary.TButton", command=self.download)
        self.download_button.grid(row=1, column=2, sticky="ew", pady=(8, 0))

        meta = ttk.Frame(form, style="Panel.TFrame")
        meta.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(14, 0))
        meta.columnconfigure(0, weight=1)
        ttk.Label(meta, textvariable=self.title_var, style="Panel.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(meta, textvariable=self.owner_var, style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 0))

        controls = ttk.Frame(form, style="Panel.TFrame")
        controls.grid(row=3, column=0, columnspan=3, sticky="ew", pady=(16, 0))
        controls.columnconfigure(0, weight=1)
        controls.columnconfigure(1, weight=1)
        controls.columnconfigure(2, weight=0)

        ttk.Label(controls, text="\u6e05\u6670\u5ea6", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
        self.quality_box = ttk.Combobox(controls, textvariable=self.quality_var, state="readonly")
        self.quality_box.grid(row=1, column=0, sticky="ew", pady=(5, 0), padx=(0, 12))

        ttk.Label(controls, text="\u4fdd\u5b58\u4f4d\u7f6e", style="Muted.TLabel").grid(row=0, column=1, sticky="w")
        output_entry = ttk.Entry(controls, textvariable=self.output_var)
        output_entry.grid(row=1, column=1, sticky="ew", pady=(5, 0), padx=(0, 12))
        self.output_button = ttk.Button(
            controls,
            text="\u6d4f\u89c8",
            style="Ghost.TButton",
            command=self.choose_output,
        )
        self.output_button.grid(row=1, column=2, sticky="ew", pady=(5, 0))

        ttk.Checkbutton(
            form,
            text="\u989d\u5916\u751f\u6210\u5e26\u5f39\u5e55\u89c6\u9891",
            variable=self.danmaku_var,
        ).grid(row=4, column=0, columnspan=3, sticky="w", pady=(14, 0))

        body = ttk.Frame(shell)
        body.grid(row=2, column=0, sticky="nsew", pady=(18, 0))
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        progress_panel = ttk.Frame(body, style="Panel.TFrame", padding=(18, 16, 18, 18))
        progress_panel.grid(row=0, column=0, sticky="ew")
        progress_panel.columnconfigure(0, weight=1)
        ttk.Label(progress_panel, textvariable=self.status_var, style="Panel.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Progressbar(progress_panel, variable=self.progress_var, maximum=100).grid(row=1, column=0, sticky="ew", pady=(10, 0))

        log_panel = ttk.Frame(body, style="Panel.TFrame", padding=(18, 16, 18, 18))
        log_panel.grid(row=1, column=0, sticky="nsew", pady=(18, 0))
        log_panel.columnconfigure(0, weight=1)
        log_panel.rowconfigure(1, weight=1)
        ttk.Label(log_panel, text="\u6d3b\u52a8", style="Section.TLabel").grid(row=0, column=0, sticky="w")
        self.log_text = tk.Text(
            log_panel,
            height=10,
            wrap="word",
            relief="flat",
            bg="#fbfbf8",
            fg=TEXT,
            insertbackground=TEXT,
            padx=12,
            pady=10,
            font=("Cascadia Mono", 9),
        )
        self.log_text.grid(row=1, column=0, sticky="nsew", pady=(10, 0))
        self.log_text.configure(state="disabled")

    def import_cookie(self) -> None:
        if self.loading or self.downloading:
            return

        selected = filedialog.askopenfilename(
            title="\u9009\u62e9 Cookie JSON",
            filetypes=(("JSON \u6587\u4ef6", "*.json"), ("\u6240\u6709\u6587\u4ef6", "*.*")),
        )
        if not selected:
            return

        source = Path(selected)
        try:
            import_cookie_file(source, self.cookie_file)
        except (CookieLoadError, OSError) as exc:
            self._log(f"Cookie \u5bfc\u5165\u5931\u8d25: {exc}")
            messagebox.showerror("Bili Download", str(exc))
            return

        self.cookie_status_var.set("Cookie: \u68c0\u67e5\u4e2d...")
        self._log(f"Cookie \u5df2\u5bfc\u5165: {source}")
        self._check_cookie_async()

    def _check_cookie_async(self) -> None:
        def worker() -> None:
            try:
                status = self._client().get_login_status()
                self.queue.put(("cookie", status))
            except Exception as exc:
                self.queue.put(("cookie_error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def load_qualities(self) -> None:
        video = self.video_var.get().strip()
        if not video:
            messagebox.showinfo(
                "Bili Download",
                "\u8bf7\u5148\u8f93\u5165 BV \u53f7\u6216 Bilibili \u89c6\u9891\u94fe\u63a5\u3002",
            )
            return
        if self.loading or self.downloading:
            return

        self._set_busy(True)
        self.status_var.set("\u6b63\u5728\u52a0\u8f7d\u89c6\u9891\u4fe1\u606f...")
        self.progress_var.set(0)
        self._log(f"\u6b63\u5728\u52a0\u8f7d\u6e05\u6670\u5ea6: {video}")

        def worker() -> None:
            try:
                downloader = BiliDownloader(self._client())
                info, page, play_url = downloader.get_available_qualities(video)
                self.queue.put(("qualities", (info, page, play_url)))
            except Exception as exc:
                self.queue.put(("error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def download(self) -> None:
        video = self.video_var.get().strip()
        if not video:
            messagebox.showinfo(
                "Bili Download",
                "\u8bf7\u5148\u8f93\u5165 BV \u53f7\u6216 Bilibili \u89c6\u9891\u94fe\u63a5\u3002",
            )
            return
        if self.downloading or self.loading:
            return

        quality = self._selected_quality()
        output_dir = Path(self.output_var.get()).expanduser()
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self._show_error(str(exc))
            return

        danmaku = self.danmaku_var.get()
        self._set_busy(True, downloading=True)
        self.progress_var.set(0)
        self.status_var.set("\u51c6\u5907\u4e0b\u8f7d...")
        self._log(f"\u5f00\u59cb\u4e0b\u8f7d: {video}")

        def on_progress(label: str, written: int, total: int | None, done: bool) -> None:
            self.queue.put(("progress", (label, written, total, done)))

        def worker() -> None:
            try:
                result = BiliDownloader(self._client()).download(
                    video,
                    output_dir=output_dir,
                    quality=quality,
                    overwrite=True,
                    danmaku=danmaku,
                    progress_callback=on_progress,
                )
                self.queue.put(("downloaded", result))
            except Exception as exc:
                self.queue.put(("error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def choose_output(self) -> None:
        current = Path(self.output_var.get()).expanduser()
        initial = current if current.exists() else self.app_dir
        selected = filedialog.askdirectory(initialdir=str(initial))
        if selected:
            self.output_var.set(selected)

    def _drain_queue(self) -> None:
        while True:
            try:
                kind, payload = self.queue.get_nowait()
            except queue.Empty:
                break
            if kind == "cookie":
                self._show_cookie(payload)  # type: ignore[arg-type]
            elif kind == "cookie_error":
                self.cookie_status_var.set("Cookie: \u672a\u9a8c\u8bc1")
                self._log(f"Cookie \u68c0\u67e5\u5931\u8d25: {payload}")
            elif kind == "qualities":
                info, page, play_url = payload  # type: ignore[misc]
                self._show_qualities(info, page, play_url)
            elif kind == "progress":
                label, written, total, done = payload  # type: ignore[misc]
                self._show_progress(str(label), int(written), total, bool(done))
            elif kind == "downloaded":
                self._show_downloaded(payload)  # type: ignore[arg-type]
            elif kind == "error":
                self._show_error(str(payload))
        self.root.after(100, self._drain_queue)

    def _show_cookie(self, status: LoginStatus) -> None:
        if status.is_login:
            name = status.username or (str(status.user_id) if status.user_id else "\u5df2\u767b\u5f55")
            suffix = f" ({status.vip_label})" if status.vip_label else ""
            self.cookie_status_var.set(f"Cookie: {name}{suffix}")
        elif self.cookie_file.exists():
            self.cookie_status_var.set("Cookie: \u5df2\u627e\u5230\uff0c\u672a\u767b\u5f55")
        else:
            self.cookie_status_var.set("Cookie: \u65e0")

    def _show_qualities(self, info: VideoInfo, page: VideoPage, play_url: PlayUrl) -> None:
        self.video_info = info
        self.video_page = page
        options = _quality_options(play_url)
        self.qualities = options
        self.quality_box["values"] = [option.label for option in options]
        if options:
            default = next((option for option in options if option.code == play_url.quality), options[0])
            self.quality_var.set(default.label)
        else:
            self.quality_var.set("")
        self.title_var.set(info.title)
        owner = f"UP: {info.owner_name}" if info.owner_name else "\u89c6\u9891\u5df2\u52a0\u8f7d"
        self.owner_var.set(f"{owner}  /  P{page.index}")
        self.status_var.set("\u9009\u62e9\u6e05\u6670\u5ea6\u540e\u5373\u53ef\u4e0b\u8f7d\u3002")
        self._log(f"\u5df2\u52a0\u8f7d {len(options)} \u4e2a\u6e05\u6670\u5ea6: {info.bvid}")
        self._set_busy(False)

    def _show_progress(self, label: str, written: int, total: object, done: bool) -> None:
        total_bytes = int(total) if total else None
        if total_bytes:
            percent = min(written / total_bytes * 100, 100)
            self.progress_var.set(percent)
            self.status_var.set(
                f"{label}: {percent:.1f}%  {_format_bytes(written)} / {_format_bytes(total_bytes)}"
            )
        else:
            if done:
                self.progress_var.set(100)
            self.status_var.set(f"{label}: {_format_bytes(written)}")

    def _show_downloaded(self, result: DownloadResult) -> None:
        self.progress_var.set(100)
        self.status_var.set("\u5b8c\u6210")
        self._log(f"\u5df2\u4fdd\u5b58: {result.path}")
        if result.danmaku_video_path:
            self._log(f"\u5f39\u5e55\u89c6\u9891: {result.danmaku_video_path}")
        self._set_busy(False)
        if messagebox.askyesno(
            "\u4e0b\u8f7d\u5b8c\u6210",
            "\u4e0b\u8f7d\u5b8c\u6210\u3002\u6253\u5f00\u4fdd\u5b58\u6587\u4ef6\u5939\u5417\uff1f",
        ):
            _open_folder(result.path.parent)

    def _show_error(self, message: str) -> None:
        self.status_var.set("\u51fa\u73b0\u9519\u8bef")
        self._log(f"\u9519\u8bef: {message}")
        self._set_busy(False)
        messagebox.showerror("Bili Download", message)

    def _selected_quality(self) -> int | None:
        label = self.quality_var.get()
        for option in self.qualities:
            if option.label == label:
                return option.code
        return None

    def _client(self) -> BiliClient:
        cookie_header = ""
        if self.cookie_file.exists():
            cookie_header = load_cookie_file(self.cookie_file).header
        return BiliClient(cookie_header=cookie_header)

    def _set_busy(self, busy: bool, *, downloading: bool = False) -> None:
        self.loading = busy and not downloading
        self.downloading = downloading
        state = "disabled" if busy else "normal"
        self.cookie_button.configure(state=state)
        self.load_button.configure(state=state)
        self.download_button.configure(state=state)
        self.output_button.configure(state=state)
        self.quality_box.configure(state="disabled" if busy else "readonly")

    def _log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"{message}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")


def _quality_options(play_url: PlayUrl) -> list[QualityOption]:
    dash_by_quality: dict[int, DashMedia] = {}
    for stream in play_url.dash_videos:
        current = dash_by_quality.get(stream.id)
        if current is None or (stream.bandwidth or 0) > (current.bandwidth or 0):
            dash_by_quality[stream.id] = stream

    options: list[QualityOption] = []
    for code, description in zip(play_url.accept_quality, play_url.accept_description, strict=False):
        detail = []
        dash = dash_by_quality.get(code)
        if dash:
            if dash.height:
                detail.append(f"{dash.height}p")
            if dash.frame_rate:
                detail.append(f"{dash.frame_rate}fps")
        suffix = f"  {' '.join(detail)}" if detail else ""
        options.append(QualityOption(code=code, label=f"{code} - {description}{suffix}"))
    return options


def _format_bytes(value: float) -> str:
    units = ("B", "KB", "MB", "GB")
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"


def _open_folder(path: Path) -> None:
    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer", str(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def _app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()


def run() -> int:
    root = tk.Tk()
    DownloadApp(root)
    root.mainloop()
    return 0


def main() -> int:
    try:
        return run()
    except (BiliApiError, BiliNetworkError, CookieLoadError, UnsupportedStreamError) as exc:
        messagebox.showerror("Bili Download", str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
