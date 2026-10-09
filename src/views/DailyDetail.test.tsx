import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { AlmanacHour, AlmanacSnapshot } from "../almanac/types";
import { DailyDetail } from "./DailyDetail";

const hours: AlmanacHour[] = [
  { label: "子时", range: "00:00–00:59", level: "neutral", suitable: ["静心"], avoid: ["远行"] },
  { label: "丑时", range: "01:00–02:59", level: "auspicious", suitable: ["祈福"], avoid: ["争执"] },
  { label: "寅时", range: "03:00–04:59", level: "neutral", suitable: ["读书"], avoid: ["动土"] },
  { label: "卯时", range: "05:00–06:59", level: "auspicious", suitable: ["出行"], avoid: ["安葬"] },
  { label: "辰时", range: "07:00–08:59", level: "inauspicious", suitable: ["洒扫"], avoid: ["开市"] },
  { label: "巳时", range: "09:00–10:59", level: "auspicious", suitable: ["会友"], avoid: ["诉讼"] },
  { label: "午时", range: "11:00–12:59", level: "neutral", suitable: ["整理"], avoid: ["迁居"] },
  { label: "未时", range: "13:00–14:59", level: "inauspicious", suitable: ["休整"], avoid: ["嫁娶"] },
  { label: "申时", range: "15:00–16:59", level: "auspicious", suitable: ["交易"], avoid: ["动土"] },
  { label: "酉时", range: "17:00–18:59", level: "neutral", suitable: ["收纳"], avoid: ["远行"] },
  { label: "戌时", range: "19:00–20:59", level: "inauspicious", suitable: ["安静"], avoid: ["开市"] },
  { label: "亥时", range: "21:00–22:59", level: "auspicious", suitable: ["沐浴"], avoid: ["争执"] },
  { label: "子时", range: "23:00–23:59", level: "inauspicious", suitable: [], avoid: [] },
];

const ready: AlmanacSnapshot = {
  status: "ready",
  date: "2026-08-06",
  data: {
    date: "2026-08-06",
    solarYear: 2026,
    solarMonth: 8,
    solarDay: 6,
    weekday: "星期四",
    lunarDate: "六月廿四",
    ganzhiYear: "丙午",
    ganzhiMonth: "乙未",
    ganzhiDay: "壬子",
    zodiac: "马",
    solarTerm: "立秋",
    festivals: ["七夕前夕"],
    suitable: ["出行", "会友"],
    avoid: ["动土", "迁居"],
    clash: "冲马",
    sha: "煞南",
    hours: [...hours],
  },
};

describe("DailyDetail", () => {
  it("renders the full daily almanac", () => {
    render(<DailyDetail snapshot={ready} onOpenSettings={() => {}} />);

    expect(screen.getByRole("heading", { name: "2026年8月6日" })).toBeInTheDocument();
    expect(screen.getByText("丙午年 · 乙未月 · 壬子日")).toBeInTheDocument();
    expect(screen.getByText("冲马 · 煞南")).toBeInTheDocument();
    expect(screen.getAllByText("子时")).toHaveLength(2);
    expect(screen.getByText("传统民俗信息仅供文化参考，请勿作为医疗、法律、财务或其他重要决定的依据。")).toBeInTheDocument();
  });

  it("hides optional note and 冲煞 sections when their data is unavailable", () => {
    render(<DailyDetail snapshot={{
      ...ready,
      data: { ...ready.data, solarTerm: undefined, festivals: [], clash: undefined, sha: undefined },
    }} onOpenSettings={() => {}} />);

    expect(document.querySelector(".detail-note")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "冲煞" })).not.toBeInTheDocument();
  });

  it("renders every civil-day hour with textual luck and empty fallbacks", () => {
    render(<DailyDetail snapshot={ready} onOpenSettings={() => {}} />);

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(13);
    expect(screen.getAllByText("子时")).toHaveLength(2);
    expect(screen.getByText("00:00–00:59")).toBeInTheDocument();
    expect(screen.getByText("23:00–23:59")).toBeInTheDocument();
    expect(screen.getAllByText("吉")).toHaveLength(5);
    expect(screen.getAllByText("平")).toHaveLength(4);
    expect(screen.getAllByText("凶")).toHaveLength(4);
    expect(document.querySelector(".detail-hour--auspicious")).toBeInTheDocument();
    expect(document.querySelector(".detail-hour--neutral")).toBeInTheDocument();
    expect(document.querySelector(".detail-hour--inauspicious")).toBeInTheDocument();
    expect(screen.getAllByText("未列出")).toHaveLength(2);
  });

  it("shows a generating status while no snapshot is available", () => {
    render(<DailyDetail snapshot={null} onOpenSettings={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("正在生成今日黄历…");
  });

  it("shows the friendly error message from the snapshot", () => {
    render(<DailyDetail snapshot={{
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    }} onOpenSettings={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("黄历信息暂时无法生成");
  });

  it("opens settings from the header", async () => {
    const onOpenSettings = vi.fn();
    render(<DailyDetail snapshot={ready} onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "设置" })).toHaveAttribute("type", "button");
  });
});
