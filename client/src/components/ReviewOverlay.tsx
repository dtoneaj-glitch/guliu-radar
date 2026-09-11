import { useEffect, useRef, useState } from "react";
import { Check, Eraser, PenTool, Trash2, Type, Undo2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * 標註回饋覆蓋層：在應用上直接畫圈、打字，送出到本地 API 存成 JSON。
 * 座標為視窗座標（開啟時鎖定捲動），AI 端按 pageState 重現頁面後對照。
 */

type Tool = "pen-red" | "pen-yellow" | "pen-mint" | "text" | "eraser";
interface Stroke {
  tool: Tool;
  points: [number, number][];
}
interface TextMark {
  x: number;
  y: number;
  content: string;
  color: string;
}

const TOOL_COLORS: Record<string, string> = { "pen-red": "#ff6b5e", "pen-yellow": "#ffc247", "pen-mint": "#65e6bd" };

export default function ReviewOverlay({ tab, paSymbol }: { tab: string; paSymbol: string }) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("pen-red");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [texts, setTexts] = useState<TextMark[]>([]);
  const [pending, setPending] = useState<{ x: number; y: number; value: string } | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 收件匣待處理數量：讓使用者知道回饋正在排隊等 AI 處理
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/feedback/count")
        .then((r) => r.json())
        .then((j: { count: number }) => {
          if (alive) setPendingCount(j.count ?? 0);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of [...strokes, ...(drawingRef.current ? [drawingRef.current] : [])]) {
      if (s.points.length === 0) continue;
      ctx.save();
      if (s.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
      else ctx.strokeStyle = TOOL_COLORS[s.tool] ?? "#ff6b5e";
      ctx.lineWidth = s.tool === "eraser" ? 24 : 3.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0][0], s.points[0][1]);
      for (const [x, y] of s.points.slice(1)) ctx.lineTo(x, y);
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.font = "600 15px 'Noto Sans TC', sans-serif";
    for (const t of texts) {
      const label = t.content;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(11,26,31,.9)";
      ctx.fillRect(t.x - 6, t.y - 18, w + 12, 24);
      ctx.fillStyle = t.color;
      ctx.fillText(label, t.x, t.y);
    }
  }, [open, strokes, texts, pending]);

  const toPoint = (e: React.PointerEvent): [number, number] => [e.clientX, e.clientY];

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "text") {
      setPending({ x: e.clientX, y: e.clientY, value: "" });
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    drawingRef.current = { tool, points: [toPoint(e)] };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toPoint(e));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 即時重繪（資料量小，原型可接受）
    const all = [...strokes, drawingRef.current];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of all) {
      if (s.points.length === 0) continue;
      ctx.save();
      if (s.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
      else ctx.strokeStyle = TOOL_COLORS[s.tool] ?? "#ff6b5e";
      ctx.lineWidth = s.tool === "eraser" ? 24 : 3.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0][0], s.points[0][1]);
      for (const [x, y] of s.points.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const onPointerUp = () => {
    if (!drawingRef.current) return;
    const s = drawingRef.current;
    drawingRef.current = null;
    if (s.points.length > 0) setStrokes((prev) => [...prev, s]);
  };

  const submit = async () => {
    if (strokes.length === 0 && texts.length === 0 && !note.trim()) {
      toast.error("先畫點東西或寫一句備註再送出");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: {
            path: window.location.pathname,
            tab,
            paSymbol,
            scrollY: window.scrollY,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            dataNote: "座標為送出時的視窗座標；頁面捲動已鎖定",
          },
          strokes,
          texts,
          note: note.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("回饋已送出！AI 會讀取並處理。");
      setOpen(false);
      setStrokes([]);
      setTexts([]);
      setNote("");
      setPending(null);
    } catch (err) {
      toast.error(`送出失敗：${err instanceof Error ? err.message : "未知錯誤"}`);
    } finally {
      setSending(false);
    }
  };

  const undo = () => {
    if (pending) return setPending(null);
    if (strokes.length > 0) setStrokes((p) => p.slice(0, -1));
    else setTexts((p) => p.slice(0, -1));
  };

  return (
    <>
      {!open && (
        <button className="review-fab" onClick={() => setOpen(true)} aria-label="開啟回饋標註">
          <PenTool size={16} />
          <span>標註回饋</span>
          {pendingCount > 0 && <i className="review-badge">{pendingCount}</i>}
        </button>
      )}
      {open && (
        <div className="review-overlay" role="dialog" aria-label="回饋標註模式">
          <canvas
            ref={canvasRef}
            className="review-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div className="review-toolbar" onPointerDown={(e) => e.stopPropagation()}>
            {(["pen-red", "pen-yellow", "pen-mint"] as Tool[]).map((t) => (
              <button key={t} className={`review-tool ${tool === t ? "selected" : ""}`} onClick={() => setTool(t)} aria-label={`畫筆 ${t}`}>
                <i style={{ background: TOOL_COLORS[t] }} />
              </button>
            ))}
            <button className={`review-tool ${tool === "text" ? "selected" : ""}`} onClick={() => setTool("text")} aria-label="文字標註"><Type size={16} /></button>
            <button className={`review-tool ${tool === "eraser" ? "selected" : ""}`} onClick={() => setTool("eraser")} aria-label="橡皮擦"><Eraser size={16} /></button>
            <span className="review-sep" />
            <button className="review-tool" onClick={() => { setStrokes((p) => p.slice(0, -1)); setPending(null); }} aria-label="復原"><Undo2 size={16} /></button>
            <button className="review-tool" onClick={() => { setStrokes([]); setTexts([]); setPending(null); }} aria-label="全部清除"><Trash2 size={16} /></button>
            <span className="review-sep" />
            <input className="review-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="一句話備註（可留空）" aria-label="備註" />
            <button className="review-send" onClick={submit} disabled={sending}><Check size={15} />{sending ? "送出中…" : "送出回饋"}</button>
            <button className="review-tool" onClick={() => { setOpen(false); setPending(null); }} aria-label="取消標註"><X size={16} /></button>
          </div>
          {pending && (
            <div className="review-input-wrap" style={{ left: pending.x, top: pending.y }} onPointerDown={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={pending.value}
                onChange={(e) => setPending({ ...pending, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pending.value.trim()) {
                    setTexts((p) => [...p, { x: pending.x, y: pending.y, content: pending.value.trim(), color: "#ffffff" }]);
                    setPending(null);
                  }
                  if (e.key === "Escape") setPending(null);
                }}
                placeholder="輸入文字，Enter 確認"
              />
            </div>
          )}
          <div className="review-hint">標註模式：捲動已鎖定。畫圈 → 拉箭頭 → 文字補充，然後送出。</div>
        </div>
      )}
    </>
  );
}
