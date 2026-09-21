#!/usr/bin/env python3
"""
凱基 SUPER PY → 股流 行情橋接（HTTP 版，零額外相依）

用途：把凱基 SUPER PY 的即時行情，轉成本機 HTTP 端點，供 Node 端的股流讀取。
設計：Python 端只負責「登入 + 訂閱 + 暫存最新報價 + 開一個本機 HTTP 端點」；
      Node 端（server/data/providers/kgi-live.ts）每 1 秒輪詢一次。
      用 stdlib http.server，不需要 websockets 套件；只依賴官方 kgisuperpy。

端點：
  GET  /health                       → 登入狀態、已訂閱數、最後一筆 tick 時間
  GET  /quotes?symbols=2330,2454     → 目前最新報價（JSON）
  POST /subscribe  {"symbols":[...]}  → 動態增加訂閱
  GET  /symbols                      → 目前訂閱清單

環境變數（建議放 .env，不要進版控）：
  KGI_ID           身分證字號
  KGI_PWD          登入密碼
  KGI_SIMULATION   1=模擬環境, 0=正式（預設 0）
  KGI_SYMBOLS      逗號分隔的代號（預設讀 bridge/symbols.txt）
  KGI_BRIDGE_HOST  預設 127.0.0.1
  KGI_BRIDGE_PORT  預設 3010

執行：
  python bridge/kgi_bridge.py
"""
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# 讓「與本檔同目錄」的套件也找得到：部分嵌入式/受限的 Python 不會自動把 script 目錄
# 加入 sys.path（例如 AutoClaw 內建的 Python），先手動補上比較保險。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import kgisuperpy as kgi  # 官方 SDK（需先安裝並完成 CA 憑證申請）
except Exception as exc:  # pragma: no cover - 只有環境缺 SDK 時會走到
    print(f"[bridge] 無法載入 kgisuperpy：{exc}")
    print("[bridge] 請先安裝官方 SDK 並完成憑證設定（見 bridge/README.md）")
    sys.exit(2)

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv_lite() -> None:
    """沒有 python-dotenv 也能用：讀專案根目錄的 .env，只填「尚未設定」的變數。"""
    for candidate in (os.path.join(HERE, "..", ".env"), os.path.join(HERE, ".env")):
        path = os.path.abspath(candidate)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except Exception:
            pass
        break


_load_dotenv_lite()

HOST = os.environ.get("KGI_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("KGI_BRIDGE_PORT", "3010"))
PERSON_ID = os.environ.get("KGI_ID", "").strip()
PERSON_PWD = os.environ.get("KGI_PWD", "").strip()
SIMULATION = os.environ.get("KGI_SIMULATION", "0").strip() in ("1", "true", "True", "yes")
ENV_SYMBOLS = [s.strip() for s in os.environ.get("KGI_SYMBOLS", "").split(",") if s.strip()]

_lock = threading.Lock()
_quotes: dict = {}
_subscribed: set = set()
_state = {
    "logged_in": False,
    "started_at": datetime.now().isoformat(timespec="seconds"),
    "last_tick_at": None,
    "last_error": None,
    "level": None,
}
_api = None


def log(msg: str) -> None:
    print(f"[bridge] {datetime.now().strftime('%H:%M:%S')} {msg}", flush=True)


def to_dict(obj) -> dict:
    """把 SDK 回傳的物件轉成 dict（不同版本可能是 dataclass / namedtuple / attrs）。"""
    if isinstance(obj, dict):
        return obj
    for attr in ("_asdict", "to_dict", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return dict(fn())
            except Exception:
                pass
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    try:
        return dict(obj)
    except Exception:
        return {"_raw": str(obj)}


def on_tick(data) -> None:
    """訂閱回呼：每筆 tick 更新記憶體中的最新報價。"""
    try:
        d = to_dict(data)
        sym = str(d.get("symbol") or d.get("code") or "").strip()
        if not sym:
            return
        d["received_at"] = datetime.now().isoformat(timespec="seconds")
        with _lock:
            _quotes[sym] = d
            _state["last_tick_at"] = d["received_at"]
    except Exception:
        _state["last_error"] = traceback.format_exc(limit=1)


def ensure_login() -> None:
    global _api
    if _api is None:
        log(f"登入凱基（simulation={SIMULATION}）…")
        _api = kgi.login(PERSON_ID, PERSON_PWD, SIMULATION)
        _state["logged_in"] = True
        log("登入成功")
    _api.Quote.set_cb_tick(on_tick)


def subscribe(symbols) -> None:
    for s in symbols:
        s = str(s).strip()
        if not s or s in _subscribed:
            continue
        try:
            _api.Quote.subscribe_tick(s)
            _subscribed.add(s)
            log(f"已訂閱 {s}")
        except Exception as exc:
            _state["last_error"] = f"subscribe {s}: {exc}"
            log(f"訂閱 {s} 失敗：{exc}")


def load_symbols_from_file() -> list:
    path = os.path.join(HERE, "symbols.txt")
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                out.append(line.split()[0])
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 靜音，避免每 1 秒被輪詢就洗版
        pass

    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/health":
            with _lock:
                self._send(200, {
                    **_state,
                    "subscribed": sorted(_subscribed),
                    "quotes_cached": len(_quotes),
                    "env": "simulation" if SIMULATION else "production",
                })
            return
        if url.path == "/quotes":
            qs = parse_qs(url.query)
            wanted = [s.strip() for s in (qs.get("symbols", [""])[0]).split(",") if s.strip()]
            with _lock:
                data = {s: _quotes[s] for s in wanted if s in _quotes} if wanted else dict(_quotes)
            self._send(200, {"updated_at": datetime.now().isoformat(timespec="seconds"), "quotes": data})
            return
        if url.path == "/symbols":
            self._send(200, {"symbols": sorted(_subscribed)})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/subscribe":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                syms = payload.get("symbols") or []
                subscribe(syms)
                self._send(200, {"ok": True, "subscribed": sorted(_subscribed)})
            except Exception as exc:
                self._send(400, {"error": str(exc)})
            return
        self._send(404, {"error": "not found"})


def watchdog() -> None:
    """盤中若超過 120 秒沒有 tick，嘗試重連並重新訂閱。"""
    while True:
        time.sleep(20)
        try:
            now = datetime.now()
            in_session = now.weekday() < 5 and (9 <= now.hour < 14)
            with _lock:
                last = _state["last_tick_at"]
                stale = (last is None) or (
                    (now - datetime.fromisoformat(last)).total_seconds() > 120
                )
            if in_session and stale:
                log("偵測到超過 120 秒無 tick，嘗試重連…")
                ensure_login()
                _subscribed.clear()
                subscribe(sorted(ENV_SYMBOLS or load_symbols_from_file()))
        except Exception:
            _state["last_error"] = traceback.format_exc(limit=1)


def main() -> None:
    symbols = ENV_SYMBOLS or load_symbols_from_file()
    log(f"啟動橋接：{HOST}:{PORT}，預計訂閱 {len(symbols)} 檔")
    if not PERSON_ID or not PERSON_PWD:
        log("缺少 KGI_ID / KGI_PWD 環境變數，仍會啟動端點供檢查（/health 會顯示未登入）")
    else:
        try:
            ensure_login()
            subscribe(symbols)
        except Exception:
            _state["last_error"] = traceback.format_exc(limit=3)
            log("登入或訂閱失敗，端點仍會啟動；請看 /health 的 last_error")

    threading.Thread(target=watchdog, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"HTTP 端點就緒： http://{HOST}:{PORT}/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("關閉中…")
        server.shutdown()


if __name__ == "__main__":
    main()
