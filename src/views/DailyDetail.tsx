import type { AlmanacSnapshot } from "../almanac/types";
import { AlmanacStatus } from "../components/AlmanacStatus";
import { PaperShell } from "../components/PaperShell";

export function DailyDetail({
  snapshot,
  onOpenSettings,
}: {
  snapshot: AlmanacSnapshot | null;
  onOpenSettings: () => void;
}) {
  if (!snapshot) {
    return (
      <PaperShell className="daily-detail">
        <AlmanacStatus message="正在生成今日黄历…" />
      </PaperShell>
    );
  }

  if (snapshot.status === "error") {
    return (
      <PaperShell className="daily-detail">
        <AlmanacStatus message={snapshot.message} />
      </PaperShell>
    );
  }

  const { data } = snapshot;
  const notes = [data.solarTerm, ...data.festivals].filter(Boolean);
  const clashAndSha = [data.clash, data.sha].filter(Boolean);
  const hourLuck = { auspicious: "吉", neutral: "平", inauspicious: "凶" };

  return (
    <PaperShell className="daily-detail">
      <header className="detail-header">
        <span className="detail-title"><span className="seal">黄</span><span>今日黄历</span></span>
        <button className="detail-settings" type="button" onClick={onOpenSettings}>设置</button>
      </header>

      <section className="detail-date" aria-label="日期信息">
        <p className="detail-day" aria-hidden="true">{String(data.solarDay).padStart(2, "0")}</p>
        <div>
          <h1>{data.solarYear}年{data.solarMonth}月{data.solarDay}日</h1>
          <p>{data.weekday} · {data.lunarDate} · 属{data.zodiac}</p>
          <p>{data.ganzhiYear}年 · {data.ganzhiMonth}月 · {data.ganzhiDay}日</p>
          {notes.length > 0 && <p className="detail-note">{notes.join(" · ")}</p>}
        </div>
      </section>

      <div className="paper-rule" aria-hidden="true" />

      <section className="detail-yi-ji" aria-label="宜忌">
        <div className="detail-fact detail-fact--suitable">
          <h2>宜</h2>
          <p>{data.suitable.length > 0 ? data.suitable.join(" · ") : "未列出"}</p>
        </div>
        <div className="detail-fact detail-fact--avoid">
          <h2>忌</h2>
          <p>{data.avoid.length > 0 ? data.avoid.join(" · ") : "未列出"}</p>
        </div>
      </section>

      {clashAndSha.length > 0 && (
        <section className="detail-section detail-clash">
          <h2>冲煞</h2>
          <p>{clashAndSha.join(" · ")}</p>
        </section>
      )}

      {data.hours.length > 0 && (
        <section className="detail-section">
          <h2>时辰详情</h2>
          <div className="detail-hours">
            {data.hours.map((hour) => (
              <article className={`detail-hour detail-hour--${hour.level}`} key={`${hour.label}-${hour.range}`}>
                <h3>{hour.label} <span className="detail-hour-luck">{hourLuck[hour.level]}</span></h3>
                <p className="detail-hour-range">{hour.range}</p>
                <p><span>宜</span>{hour.suitable.length > 0 ? hour.suitable.join(" · ") : "未列出"}</p>
                <p><span>忌</span>{hour.avoid.length > 0 ? hour.avoid.join(" · ") : "未列出"}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <p className="detail-disclaimer">传统民俗信息仅供文化参考，请勿作为医疗、法律、财务或其他重要决定的依据。</p>
    </PaperShell>
  );
}
