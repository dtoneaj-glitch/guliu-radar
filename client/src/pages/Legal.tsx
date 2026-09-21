/**
 * 隱私權政策 與 服務條款（內部測試版）
 *
 * ⚠ 這是「草稿版」，供封閉測試使用；對外正式發布前請由法務/律師確認。
 * 內容以本產品實際行為為準：整理公開市場資料、提供自選股與研究輔助，
 * 不提供投資建議、不代客下單、不收受任何交易款項。
 */
import { Link } from "wouter";

const wrapStyle: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  padding: "32px 20px 80px",
  lineHeight: 1.85,
  fontSize: 15,
};
const h2Style: React.CSSProperties = { fontSize: 17, margin: "26px 0 8px" };
const mutedStyle: React.CSSProperties = { color: "var(--muted-foreground, #8b95a5)", fontSize: 13 };

function Shell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={wrapStyle}>
      <p style={mutedStyle}>
        <Link href="/" style={{ color: "inherit" }}>
          ← 回股流 Radar
        </Link>
      </p>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>{title}</h1>
      <p style={mutedStyle}>最後更新：{updated}（封閉測試版，尚未經法務確認）</p>
      {children}
      <p style={{ ...mutedStyle, marginTop: 32 }}>
        聯絡方式：（測試期間請透過邀請你的窗口反映，或寄信至 __________________）
      </p>
    </div>
  );
}

export function Terms() {
  return (
    <Shell title="服務條款" updated="2026-09-21">
      <h2 style={h2Style}>一、服務內容</h2>
      <p>
        本服務（以下稱「股流 Radar」）整理公開市場資料（包含交易所公開資訊、公開行情與統計），提供熱區、價格行為研判、籌碼彙整與自選股等
        <b>研究輔助</b>功能。
      </p>
      <h2 style={h2Style}>二、非投資建議</h2>
      <p>
        本服務所有內容僅為公開資料之整理與研究用途，<b>不構成投資建議、買賣推薦、要約或任何獲利保證</b>。使用者應自行判斷並承擔投資決策之全部風險與結果。
      </p>
      <h2 style={h2Style}>三、不提供交易功能</h2>
      <p>本服務<b>不提供下單、代客操作、金流或任何交易執行功能</b>。任何交易請自行透過合法券商進行。</p>
      <h2 style={h2Style}>四、資料來源與正確性</h2>
      <p>
        資料來自第三方公開來源，可能有延遲、缺漏或變動。本服務不保證資料之即時性、完整性或正確性；如發現錯誤請回報，我們會儘速處理。
      </p>
      <h2 style={h2Style}>五、帳號與使用規範</h2>
      <p>
        測試期間帳號僅供受邀者本人使用，請勿轉讓、分享或大量散布帳號；請勿以自動化方式大量存取本服務或嘗試破壞、繞過安全機制。
      </p>
      <h2 style={h2Style}>六、服務變更與終止</h2>
      <p>本服務為測試性質，功能與內容可能隨時調整或中止，恕不另行個別通知。</p>
    </Shell>
  );
}

export function Privacy() {
  return (
    <Shell title="隱私權政策" updated="2026-09-21">
      <h2 style={h2Style}>一、我們蒐集什麼</h2>
      <p>
        測試期間僅蒐集提供服務所必需的資料：<b>帳號名稱、密碼雜湊值（不儲存明碼）、自選股清單與其異動紀錄、登入時間與來源 IP</b>。
        本服務不要求身分證字號、電話或地址。
      </p>
      <h2 style={h2Style}>二、蒐集目的與使用方式</h2>
      <p>用於：登入驗證、儲存你的自選股與偏好、問題排查（異動紀錄）、以及服務穩定性維護。不用於行銷或用戶輪廓分析。</p>
      <h2 style={h2Style}>三、資料儲存與保存期限</h2>
      <p>
        資料儲存於本服務運行的主機（資料庫與 JSON 檔）。測試期間保存至服務結束或你要求刪除為止；超過保存期限將刪除或匿名化。
      </p>
      <h2 style={h2Style}>四、資料分享</h2>
      <p>除下列情形外，不將你的資料提供給第三人：（一）法律要求；（二）為提供服務而必要之技術處理（例如推播服務）。</p>
      <h2 style={h2Style}>五、你的權利</h2>
      <p>你可以要求查詢、更正或刪除你的帳號與自選股資料；請透過上方聯絡方式提出，我們將於合理期間內處理。</p>
      <h2 style={h2Style}>六、Cookie 與本機儲存</h2>
      <p>本服務使用瀏覽器本機儲存（localStorage）保存登入憑證與自選股，以維持登入狀態與操作體驗。</p>
      <h2 style={h2Style}>七、安全措施</h2>
      <p>密碼以雜湊儲存、登入憑證具時效、自選股採使用者隔離與異動稽核。惟網際網路傳輸與儲存無法保證絕對安全，請妥善保管帳號密碼。</p>
    </Shell>
  );
}
