import { useEffect } from "react";
import type { AlmanacSnapshot } from "../almanac/types";
import { createCardSummary } from "../almanac/summaryRules";
import { AlmanacStatus } from "../components/AlmanacStatus";
import { PaperShell } from "../components/PaperShell";

function formatErrorDate(date: string): { day: string; meta: string } {
  const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);

  if (!parts) {
    return { day: "--", meta: "日期暂不可用" };
  }

  const [, yearText, monthText, dayText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const localDate = new Date(year, month - 1, day);

  if (
    localDate.getFullYear() !== year
    || localDate.getMonth() !== month - 1
    || localDate.getDate() !== day
  ) {
    return { day: "--", meta: "日期暂不可用" };
  }

  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(localDate);
  return { day: String(day).padStart(2, "0"), meta: `${month}月 · ${weekday}` };
}

export function TrayCard({
  snapshot,
  onShowDetails,
  onHide,
}: {
  snapshot: AlmanacSnapshot | null;
  onShowDetails: () => void;
  onHide: () => void;
}) {
  useEffect(() => {
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHide();
    };

    window.addEventListener("keydown", hideOnEscape);
    return () => window.removeEventListener("keydown", hideOnEscape);
  }, [onHide]);

  if (!snapshot) {
    return <PaperShell className="tray-card"><AlmanacStatus message="正在生成今日黄历…" /></PaperShell>;
  }

  if (snapshot.status === "error") {
    const errorDate = formatErrorDate(snapshot.date);

    return (
      <PaperShell className="tray-card">
        <header className="paper-header"><span className="seal">历</span><span>今日</span></header>
        <p className="date-hero">{errorDate.day}</p>
        <p className="date-meta">{errorDate.meta}</p>
        <AlmanacStatus message={snapshot.message} />
        <footer className="paper-footer"><span>本地计算 · 不缓存黄历</span></footer>
      </PaperShell>
    );
  }

  const { data } = snapshot;
  const summary = createCardSummary(data.suitable, data.avoid);
  const note = [data.solarTerm, ...data.festivals, data.clash, data.sha].filter(Boolean).join(" · ");

  return (
    <PaperShell className="tray-card">
      <header className="paper-header"><span className="seal">历</span><span>今日 · 已更新</span></header>
      <p className="date-hero">{String(data.solarDay).padStart(2, "0")}</p>
      <p className="date-meta">{data.solarMonth}月 · {data.weekday}</p>
      <p className="lunar-meta">{data.lunarDate} · {data.ganzhiYear}年 · 生肖{data.zodiac}</p>
      <div className="paper-rule" />
      <p className="section-label">今日简要</p>
      <div className="tag-row">
        {summary.suitable.map((item, index) => <span className="tag" key={`yi-${index}-${item}`}>宜 {item}</span>)}
        {summary.avoid.map((item, index) => <span className="tag tag--avoid" key={`ji-${index}-${item}`}>忌 {item}</span>)}
      </div>
      {note && <p className="card-note" title={note}>{note}</p>}
      <footer className="paper-footer">
        <span>本地计算 · 不缓存黄历</span>
        <button className="paper-button" type="button" onClick={onShowDetails}>查看详情</button>
      </footer>
    </PaperShell>
  );
}
