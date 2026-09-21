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

## 三、先做 PoC（最簡單方式：雙擊）

> 不用打任何指令。

1. 到專案資料夾的 `scripts\` 底下，**雙擊 `poc-kgi.bat`**。
2. 視窗會依序做四件事，你只要照著回答：
   - `[1/4]` 顯示 Python 版本（若顯示 AutoClaw 內建 Python，建議改用一般 Python）
   - `[2/4]` 檢查 SDK；沒裝會問「要現在自動安裝嗎？」→ 按 **Y**
   - `[3/4]` 問你：身分證字號、密碼、要用模擬還是正式（直接按 Enter＝正式）、看哪一檔（Enter＝2330）、觀察幾秒（Enter＝20）
   - `[4/4]` 開始印出每一筆成交
3. 看到一行行的 `#1 20260921103005 2330 成交=100.5 漲跌幅=0.5% 延遲=0.001s` → **憑證、權限、連線全部正常**。
4. 若顯示 `[!] 0 筆 tick` → 多半是非交易時段（台股 09:00–13:30），改在盤中再測。

### 若你還沒有一版「一般」的 Python

到 <https://www.python.org/downloads/> 下載安裝，安裝時**勾選 `Add python.exe to PATH`**。
裝完後，把 `scripts\poc-kgi.bat` 裡的 `python` 改成完整路徑（例如 `C:\Python313\python.exe`）再雙擊。

### 手動方式（進階）

```bat
set KGI_ID=你的身分證字號
set KGI_PWD=你的密碼
python bridge\poc_subscribe.py 2330 20
```

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

## 九、股票現貨 vs 期貨夜盤

| 市場 | 交易時段 | 現況 |
|---|---|---|
| 台股現貨（例 2330） | 09:00-13:30（14:00-14:30 盤後定價，僅一次撮合） | **沒有夜盤** |
| 期貨（TXF 台指期） | 一般 08:45-13:45；**夜盤 15:00-次日 05:00** | 有夜盤 |

- 只想驗「帳號 / 憑證 / 連線」==> 可在**夜盤時段**跑 PoC 並選「2 = 期貨夜盤 TXF」。
- 想驗「股票現貨即時價」==> 必須在 09:00-13:30 之間。
- 注意：凱基期貨行情**目前僅開放 TXF 這一檔**可訂閱（官方文件明載）。
