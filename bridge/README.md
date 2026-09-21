# 凱基 SUPER PY 行情橋接

把凱基 SUPER PY 的即時行情，轉成本機 HTTP 端點，供股流（Node）讀取。

```
凱基站 ──(kgisuperpy)──> bridge/kgi_bridge.py ──(本機 HTTP :3010)──> 股流 server ──> 前端
```

## 一、前置（官方要求，缺一不可）

1. **凱基證券帳戶**（線上開戶）。
2. **CA 憑證**：
   - Windows：安裝憑證元件 → 申請憑證 → 用「憑證小幫手」檢測（畫面須全藍字）。
   - Linux：安裝 `libCGCrypt.so`（放 `/lib/x86_64-linux-gnu/` 或 `/lib64/`）→ 執行 `KGI_CGCrypt genDat` 安裝憑證。
3. **簽署「證券API服務風險預告書暨使用同意書」**。
4. 確認你的**會員等級含即時行情**（官方標「加值」）與連線數上限。

## 二、安裝

```bat
python -m pip install --upgrade kgisuperpy
```

把 `.env` 填好（或設成環境變數）：

```
KGI_ID=你的身分證字號
KGI_PWD=你的密碼
KGI_SIMULATION=0        # 0=正式, 1=模擬
KGI_SYMBOLS=2330,2454   # 選填；不填則讀 bridge/symbols.txt
KGI_BRIDGE_PORT=3010
```

## 三、先做 PoC（強烈建議第一步）

只驗證「登入 + 憑證 + 權限」通不通，不碰股流：

```bat
set KGI_ID=xxxx
set KGI_PWD=xxxx
python bridge\poc_subscribe.py 2330 20
```

看到每秒陸續印出 `#1 20260921103005 2330 close=... pct=...` 就代表環境沒問題。
若 20 秒內 0 筆 → 多半是非交易時段、權限未開、或憑證問題。

## 四、啟動橋接

```bat
python bridge\kgi_bridge.py
```

或雙擊 `scripts\start-kgi-bridge.bat`。

檢查：

```bat
curl http://127.0.0.1:3010/health
curl "http://127.0.0.1:3010/quotes?symbols=2330"
```

## 五、端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/health` | 登入狀態、已訂閱、最後 tick 時間、last_error |
| GET | `/quotes?symbols=a,b` | 最新報價（JSON） |
| POST | `/subscribe` `{"symbols":[...]}` | 動態增加訂閱 |
| GET | `/symbols` | 目前訂閱清單 |

## 六、注意

- 憑證綁機器：橋接必須跑在**有憑證的那台電腦**。
- 這是**你個人帳號**的行情，家人不能共用登入；小範圍自用請自行留意券商資料使用條款。
- 只訂閱行情，不啟用 `Order.*`（股流不做下單）。
- 盤中若連續 120 秒無 tick，程式會自動重連並重新訂閱。
- 排程與橋接可並存；`scripts\start-kgi-bridge.bat` 適合放進開機啟動或盤前排程。

## 七、Python 執行環境（重要）

- 請使用**一般安裝的 Python**（python.org 或凱基程式包附的 Python），不要用 AutoClaw 內建的嵌入式 Python——
  它會忽略 `PYTHONPATH` 且不把 script 目錄加入 `sys.path`（本專案已在橋接檔開頭手動補上 script 目錄，但仍建議用一般 Python）。
- 安裝 SDK：`python -m pip install --upgrade kgisuperpy`
- 橋接會自動讀取專案根目錄的 `.env`（不需 python-dotenv）。

## 八、本機驗證結果（2026-09-21）

用一個假的 `kgisuperpy` 模組驅動真實橋接，再讓 Node provider 讀取，全鏈路通過：

```
[bridge] 登入成功 / 已訂閱 2330 / 已訂閱 2454
GET /health  → {"logged_in":true,"subscribed":["2330","2454"],"quotes_cached":2,"last_error":null}
GET /quotes  → {"quotes":{"2330":{...close, pct_chg, bid_prices, ask_prices...}}}
Node provider → isBridgeHealthy:true, quotes count:2, 1s 快取命中
```
