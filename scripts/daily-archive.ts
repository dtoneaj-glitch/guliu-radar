import "../server/load-env";

/**
 * 股流 Radar — 每日存檔排程腳本（可獨立執行，不需要 dev server 常駐）
 *
 * 目的：累積 SQLite 歷史資料庫，讓「近 5/20 日熱度、法人連買超天數、本週籌碼彙總」
 *       這些需要連續每日資料的功能可以真正運作。
 *
 * 特性：
 *   - 以「資料源最新交易日」(snapshot.asOf) 當存檔鍵；重複執行安全（已存就跳過）。
 *   - 單獨跑一次即可，不必讓 server 一直開著。適合交給 Windows 工作排程器每天跑。
 *   - 存的是「當下資料源提供的最新交易日」，所以早跑晚跑都會補上，只是時間差。
 *
 * 執行方式：
 *   node_modules\.bin\tsx scripts\daily-archive.ts
 *   或雙擊 scripts\run-daily-archive.bat
 */
import { getSnapshot } from "../server/data/hotzones";
import { saveSnapshot, listArchiveDates } from "../server/data/archive";
import { fetchChipCard } from "../server/data/providers/taifex";
import { saveChipCardSnapshot } from "../server/data/chipcard-archive";
import { fetchRetailFuturesPosition } from "../server/data/providers/taifex";
import { saveRetailSnapshot } from "../server/data/retail-archive";

async function main(): Promise<void> {
  console.log(`[daily-archive] ${new Date().toISOString()} 開始`);

  // 1) B0 每日快照：全市場報價 + 三大法人買賣超分項
  const snapshot = await getSnapshot();
  const asOf = snapshot.asOf;
  if (listArchiveDates().includes(asOf)) {
    console.log(`[daily-archive] B0 快照 ${asOf} 已存在，跳過`);
  } else {
    saveSnapshot(asOf, snapshot, snapshot.institutional);
    console.log(`[daily-archive] B0 快照已存 ${asOf}（報價 ${snapshot.quotes.length} 檔）`);
  }

  // 2) 大盤籌碼快照：三大法人期貨未平倉（TAIFEX，每日盤後約 16:00~20:00 公布）
  try {
    const chip = await fetchChipCard();
    saveChipCardSnapshot(chip);
    console.log(`[daily-archive] 大盤籌碼已存 ${chip.asOf}`);
  } catch (err) {
    console.warn(`[daily-archive] 大盤籌碼存檔失敗（不影響 B0）：${(err as Error).message}`);
  }
  // 3) 散戶留倉快照：小台/微台淨多空比（供日後計算單日變動）
  for (const contract of ["MTX", "TMF"] as const) {
    try {
      const retail = await fetchRetailFuturesPosition(contract);
      if (retail) {
        saveRetailSnapshot(retail);
        console.log(`[daily-archive] 散戶留倉已存 ${retail.asOf} ${contract}（淨多空比 ${retail.retailNetRatioPct}%）`);
      }
    } catch (err) {
      console.warn(`[daily-archive] 散戶留倉存檔失敗 ${contract}：${(err as Error).message}`);
    }
  }

  console.log(`[daily-archive] 完成`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[daily-archive] 失敗：", err);
    process.exit(1);
  });
