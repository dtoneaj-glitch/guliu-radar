import { downloadOfflineHTML } from "../lib/export-html";

interface Props {
  /** 選填：指定匯出日期（YYYY-MM-DD），不填則匯出今日 */
  date?: string;
}

export default function ExportButton({ date }: Props) {
  const handleClick = async () => {
    try {
      await downloadOfflineHTML(date);
    } catch (e) {
      alert("匯出失敗：" + (e as Error).message);
    }
  };

  return (
    <button
      onClick={handleClick}
      title="匯出離線 HTML（可帶出門看）"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30
                 border border-indigo-500/30 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      離線 HTML
      {date && <span className="text-indigo-500/60">· {date}</span>}
    </button>
  );
}
