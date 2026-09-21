#!/usr/bin/env python3
"""
階段 1 PoC：確認「凱基帳號 + CA 憑證 + 即時行情權限」到底通不通。

只做四件事：登入 → 設定 tick callback → 訂閱一檔 → 印出收到的 tick。
不碰股流、不開 HTTP、不寫任何檔。

執行：
  set KGI_ID=你的身分證字號
  set KGI_PWD=你的密碼
  python bridge/poc_subscribe.py 2330 20

  （參數：代號、觀察秒數；預設 2330 / 20 秒）
"""
import os
import sys
import time
from datetime import datetime

# 同 kgi_bridge.py：讓同目錄套件可被找到（嵌入式 Python 不會自動加 script 目錄）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import kgisuperpy as kgi
except Exception as exc:
    print(f"[poc] 無法載入 kgisuperpy：{exc}")
    print("[poc] 請先安裝官方 SDK（見 bridge/README.md）")
    sys.exit(2)

PERSON_ID = os.environ.get("KGI_ID", "").strip()
PERSON_PWD = os.environ.get("KGI_PWD", "").strip()
SIMULATION = os.environ.get("KGI_SIMULATION", "0").strip() in ("1", "true", "True", "yes")

symbol = sys.argv[1] if len(sys.argv) > 1 else "2330"
seconds = int(sys.argv[2]) if len(sys.argv) > 2 else 20

received = {"n": 0}


def to_dict(obj):
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


def on_tick(data):
    received["n"] += 1
    d = to_dict(data)
    sym = d.get("symbol", "?")
    ts = d.get("datetime", "")
    close = d.get("close")
    pct = d.get("pct_chg")
    print(f"[poc] #{received['n']:>4} {ts} {sym} close={close} pct={pct} delay={d.get('delay_time')}", flush=True)


def main():
    if not PERSON_ID or not PERSON_PWD:
        print("[poc] 請先設定 KGI_ID / KGI_PWD 環境變數")
        return 2
    print(f"[poc] 登入中（simulation={SIMULATION}）…")
    api = kgi.login(PERSON_ID, PERSON_PWD, SIMULATION)
    print("[poc] 登入成功")
    api.Quote.set_cb_tick(on_tick)
    api.Quote.subscribe_tick(symbol)
    print(f"[poc] 已訂閱 {symbol}，觀察 {seconds} 秒…")
    deadline = time.time() + seconds
    while time.time() < deadline:
        time.sleep(0.5)
    print(f"[poc] 結束。共收到 {received['n']} 筆 tick")
    if received["n"] == 0:
        print("[poc] ⚠ 沒收到任何 tick：可能非交易時段、權限不足、或憑證/登入有問題")
    return 0


if __name__ == "__main__":
    sys.exit(main())
