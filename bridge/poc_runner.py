#!/usr/bin/env python3
"""
凱基行情 PoC — 互動式引導（給不熟指令的人用）

直接雙擊 scripts\\poc-kgi.bat 就會跑這個。
它會：檢查 Python → 檢查/安裝 SDK → 問你帳密 → 訂閱一檔看幾秒 → 印出結果。
不會寫入任何檔案、不會下單。
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

LINE = "=" * 56


def make_output_safe():
    """Windows 主控台預設可能是 cp950，避免中文以外的符號造成 UnicodeEncodeError。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def pause(msg="按 Enter 結束…"):
    try:
        input(msg)
    except EOFError:
        pass


def load_env_into_environ():
    """若專案根目錄有 .env，先讀進來當預設值（不覆蓋已存在的環境變數）。"""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass


def check_python():
    print(f"[1/4] Python：{sys.version.split()[0]}")
    print(f"      路徑：{sys.executable}")
    if "AutoClaw" in sys.executable:
        print("      [!] 這是 AutoClaw 內建的 Python（嵌入式），可能裝不了 SDK。")
        print("          建議改用 python.org 下載安裝的一般 Python 再跑本程式。")


def ensure_sdk():
    print("[2/4] 檢查官方 SDK（kgisuperpy）…")
    try:
        import kgisuperpy  # noqa: F401
        print("      [OK] 已安裝")
        return True
    except Exception:
        print("      [X] 尚未安裝")
        ans = input("      要現在自動安裝嗎？（需要網路，會執行 pip install）[Y/n] ").strip().lower()
        if ans in ("", "y", "yes"):
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", "kgisuperpy"])
                print("      安裝完成，請重新執行本程式。")
            except Exception as exc:
                print(f"      安裝失敗：{exc}")
                print("      請改用有 pip 的一般 Python，或照 bridge/README.md 手動安裝。")
        else:
            print("      略過安裝。")
        return False


def ask(prompt, default=""):
    got = input(prompt).strip()
    return got or default


def run_poc():
    import kgisuperpy as kgi

    person_id = os.environ.get("KGI_ID", "").strip() or ask("      身分證字號：")
    person_pwd = os.environ.get("KGI_PWD", "").strip() or ask("      登入密碼：")
    if not person_id or not person_pwd:
        print("      [X] 沒填帳密，結束。")
        return

    sim_raw = ask("      用模擬環境？(y=模擬 / Enter=正式)：", "n").lower()
    simulation = sim_raw.startswith("y")
    symbol = ask("      要看哪一檔代號？(Enter=2330)：", "2330")
    try:
        seconds = int(ask("      觀察幾秒？(Enter=20)：", "20"))
    except ValueError:
        seconds = 20

    print(f"\n      登入中（{'模擬' if simulation else '正式'}環境）…")
    api = kgi.login(person_id, person_pwd, simulation)
    print("      [OK] 登入成功")
    api.Quote.set_cb_tick(on_tick)
    api.Quote.subscribe_tick(symbol)
    print(f"      已訂閱 {symbol}，開始觀察 {seconds} 秒（每筆成交都會印一行）\n")

    deadline = time.time() + seconds
    while time.time() < deadline:
        time.sleep(0.5)
    return True


COUNT = {"n": 0}


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
    COUNT["n"] += 1
    d = to_dict(data)
    print(f"      #{COUNT['n']:>4} {d.get('datetime','')} {d.get('symbol','')} "
          f"成交={d.get('close')} 漲跌幅={d.get('pct_chg')}% 延遲={d.get('delay_time')}s", flush=True)


def main():
    make_output_safe()
    load_env_into_environ()
    print(LINE)
    print(" 凱基即時行情 PoC（只驗證連線與權限，不下單、不寫檔）")
    print(LINE)
    check_python()
    if not ensure_sdk():
        pause()
        return 1
    print("[3/4] 準備登入…")
    try:
        run_poc()
    except Exception as exc:
        print(f"\n      [X] 發生錯誤：{type(exc).__name__}: {exc}")
        print("          常見原因：憑證未安裝/未啟用、API 下單未申請、帳密錯誤、非交易時段。")
        pause()
        return 1
    print("[4/4] 結果")
    if COUNT["n"] == 0:
        print("      [!] 0 筆 tick。可能：非交易時段（台股 09:00-13:30）、行情權限未開、或憑證問題。")
        print("          建議在交易時段再測一次。")
    else:
        print(f"      [OK] 共收到 {COUNT['n']} 筆 tick —— 帳號、憑證、行情權限都正常！")
    pause()
    return 0


if __name__ == "__main__":
    sys.exit(main())
