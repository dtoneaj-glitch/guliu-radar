/**
 * 漲跌/漲跌幅的共用計算（處理除權息）
 *
 * 背景：交易所的「漲跌」欄位在**當日除權息**時不是數字，而是字串 "X"
 *（TWSE 與 TPEx 皆同）。若直接 Number() 會得到 NaN，往下傳會變成
 *   - prevClose = close − NaN = NaN
 *   - changePct = 0（假裝平盤）
 * 兩種都是錯的。正確做法是：**如實標記為「無法計算」**，由前端顯示「—」並註明除權息。
 *
 * 這個函式是全站唯一的口徑來源，避免各處各寫一份。
 */

export interface ChangeInfo {
  /** 前一日收盤；無法取得時等於當日收盤（僅為避免 NaN 擴散，不代表真實前收） */
  prevClose: number;
  /** 漲跌幅 %；無法計算時為 null（前端顯示「—」） */
  changePct: number | null;
  /** 漲跌額；無法計算時為 null */
  changeAmt: number | null;
  /** 當日除權息（或官方欄位異常），漲跌不可比 */
  exDividend: boolean;
}

/**
 * @param close    當日收盤價
 * @param rawChange 官方「漲跌」欄位（除權息當日為 NaN，因為來源是字串 "X"）
 */
export function deriveChange(close: number, rawChange: number | null | undefined): ChangeInfo {
  const valid = rawChange != null && Number.isFinite(rawChange);

  // 除權息（X）或欄位缺失：漲跌與漲跌幅一律不可用，如實標記
  if (!valid) {
    return { prevClose: close, changePct: null, changeAmt: null, exDividend: true };
  }

  const prevClose = close - rawChange;

  // 反推的前收不合理（<= 0）→ 無法算百分比，但漲跌額本身有效
  if (!(prevClose > 0)) {
    return { prevClose: close, changePct: null, changeAmt: rawChange, exDividend: false };
  }

  return { prevClose, changePct: (rawChange / prevClose) * 100, changeAmt: rawChange, exDividend: false };
}
