import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck, X } from "lucide-react";

interface GuideStep {
  eyebrow: string;
  title: string;
  body: string;
  bullets?: string[];
}

/** 內容取自 docs/PHASE1_SPEC.md §7.4 固定六段框架，前台化成可捲動的引導頁 */
const STEPS: GuideStep[] = [
  {
    eyebrow: "為什麼要有這頁",
    title: "熱門不是訊號，結構才是。",
    body: "股流 Radar 分兩段：熱區負責「發現」，價格行為負責「規劃」。熱區只是縮小研究範圍，真正要不要動作，交給下面六段固定框架判斷。",
  },
  {
    eyebrow: "STEP 1 · 市場結構",
    title: "先看大小級別是否一致",
    body: "任何研判都先確認目前處在哪一種結構：上升、下降、還是震盪；大級別與小級別是否同向。",
    bullets: ["大級別信心（高／中／低）", "小級別目前狀態", "HH/HL 或 LH/LL 是否已成形", "大小級別是否一致，或互相矛盾"],
  },
  {
    eyebrow: "STEP 2 · 關鍵價位",
    title: "支撐壓力永遠是「區」，不是單一價",
    body: "價位刻意顯示為區間而非精確單一數字，避免製造虛假精準度。結構失效位是這一段最重要的輸出——它定義了「原本的判斷什麼時候算錯」。",
    bullets: ["壓力區間", "支撐區間", "結構失效位（跌破/站上就代表原判斷失效）"],
  },
  {
    eyebrow: "STEP 3 · 價格行為",
    title: "已確認 vs 未確認，嚴格分開",
    body: "這一段只列圖表直接支持的內容，並清楚標註哪些「已確認」、哪些「尚無有效確認」，不把可能性寫成事實。",
    bullets: ["已確認：圖表上實際發生的事", "未確認：還沒發生、仍在等待的訊號", "形態辨識（若有）是否已被確認"],
  },
  {
    eyebrow: "STEP 4 · 交易情境",
    title: "條件式，不是買賣建議",
    body: "每個情境都掛著觸發條件，例如「等待回踩確認」「不建議追價」「區間中不交易」——使用者自己判斷要不要等待、觀察或執行。",
  },
  {
    eyebrow: "STEP 5 · 風險規劃",
    title: "進場區、止損、止盈、R 倍數、倉位",
    body: "任何情境只要成立，都必須同時給出風險規劃四件套，並讓使用者輸入帳戶與風險比例即時試算倉位。",
    bullets: ["進場區域", "止損位置（通常在結構失效位外）", "止盈目標（可多個）", "預期盈虧比 R:R"],
  },
  {
    eyebrow: "STEP 6 · 分析限制",
    title: "誠實說出這份研判看不到什麼",
    body: "例如目前只有日線、尚未確認更大級別、或盤中結構未納入計算。限制永遠放在最後，但永遠會被列出來。",
  },
  {
    eyebrow: "合規邊界",
    title: "股流 Radar 不做的三件事",
    body: "任何策略訊號都必須同時標示已確認資訊、推測情境、尚需等待條件與結構失效位——這是產品的合規邊界，不是選配。",
    bullets: ["不自動下單、不做無使用者確認的自動交易", "不直接宣告「買進」「賣出」或「一定上漲」", "不承諾歷史勝率或獲利保證"],
  },
];

export default function GuideOverlay({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const isFirst = i === 0;
  const isLast = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !isLast) setI((n) => n + 1);
      if (e.key === "ArrowLeft" && !isFirst) setI((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isFirst, isLast]);

  return (
    <div className="guide-backdrop" role="presentation" onClick={onClose}>
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-label="怎麼讀這個系統" onClick={(e) => e.stopPropagation()}>
        <div className="guide-head">
          <span className="guide-progress">{i + 1} / {STEPS.length}</span>
          <button className="icon-button" onClick={onClose} aria-label="關閉說明"><X size={18} /></button>
        </div>
        <div className="guide-body">
          <span className="eyebrow coral-text">{step.eyebrow}</span>
          <h2>{step.title}</h2>
          <p>{step.body}</p>
          {step.bullets && (
            <ul className="guide-bullets">
              {step.bullets.map((b) => (
                <li key={b}><ShieldCheck size={13} /><span>{b}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="guide-dots">
          {STEPS.map((_, idx) => (
            <button key={idx} className={`guide-dot ${idx === i ? "on" : ""}`} aria-label={`前往第 ${idx + 1} 段`} onClick={() => setI(idx)} />
          ))}
        </div>
        <div className="guide-foot">
          <button className="secondary-button" onClick={() => setI((n) => n - 1)} disabled={isFirst}><ChevronLeft size={15} /> 上一段</button>
          {isLast ? (
            <button className="primary-button" onClick={onClose}>知道了，開始研判</button>
          ) : (
            <button className="primary-button" onClick={() => setI((n) => n + 1)}>下一段 <ChevronRight size={15} /></button>
          )}
        </div>
      </section>
    </div>
  );
}
