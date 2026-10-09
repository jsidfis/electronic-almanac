import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { AlmanacSnapshot } from "../almanac/types";
import { TrayCard } from "./TrayCard";

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
    festivals: [],
    suitable: ["出行", "会友", "整理", "交易"],
    avoid: ["动土", "迁居", "安葬"],
    clash: "冲马",
    sha: "煞南",
    hours: [],
  },
};

describe("TrayCard", () => {
  it("renders the approved compact summary", () => {
    render(<TrayCard snapshot={ready} onShowDetails={vi.fn()} onHide={vi.fn()} />);

    expect(screen.getByText("06")).toBeInTheDocument();
    expect(screen.getByText("六月廿四 · 丙午年 · 生肖马")).toBeInTheDocument();
    expect(screen.getByText("宜 出行")).toBeInTheDocument();
    expect(screen.queryByText("宜 交易")).not.toBeInTheDocument();
    expect(screen.getByText("本地计算 · 不缓存黄历")).toBeInTheDocument();
  });

  it("opens details from the card action", async () => {
    const onShowDetails = vi.fn();
    render(<TrayCard snapshot={ready} onShowDetails={onShowDetails} onHide={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "查看详情" }));

    expect(onShowDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "查看详情" })).toHaveAttribute("type", "button");
  });

  it("preserves a long note in its title while the card stays compact", () => {
    const longNote = "立秋 · 夏末节气 · 民俗活动 · 冲马 · 煞南";
    render(<TrayCard snapshot={{
      ...ready,
      data: { ...ready.data, festivals: ["夏末节气", "民俗活动"] },
    }} onShowDetails={vi.fn()} onHide={vi.fn()} />);

    expect(screen.getByTitle(longNote)).toBeInTheDocument();
  });

  it("keeps the Gregorian date visible when calculation fails", () => {
    render(<TrayCard snapshot={{
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    }} onShowDetails={vi.fn()} onHide={vi.fn()} />);

    expect(screen.getByText("06")).toBeInTheDocument();
    expect(screen.getByText("8月 · 星期四")).toBeInTheDocument();
    expect(screen.getByText("黄历信息暂时无法生成")).toBeInTheDocument();
  });

  it("formats an unpadded error date using local calendar parts", () => {
    render(<TrayCard snapshot={{
      status: "error",
      date: "2026-8-6" as AlmanacSnapshot["date"],
      message: "黄历信息暂时无法生成",
    }} onShowDetails={vi.fn()} onHide={vi.fn()} />);

    expect(screen.getByText("06")).toBeInTheDocument();
    expect(screen.getByText("8月 · 星期四")).toBeInTheDocument();
  });

  it("shows a safe fallback for a malformed error date", () => {
    render(<TrayCard snapshot={{
      status: "error",
      date: "not-a-date" as AlmanacSnapshot["date"],
      message: "黄历信息暂时无法生成",
    }} onShowDetails={vi.fn()} onHide={vi.fn()} />);

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("日期暂不可用")).toBeInTheDocument();
  });

  it("hides when Escape is pressed", async () => {
    const onHide = vi.fn();
    render(<TrayCard snapshot={ready} onShowDetails={vi.fn()} onHide={onHide} />);

    await userEvent.keyboard("{Escape}");

    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
