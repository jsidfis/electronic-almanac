import { describe, expect, test, vi } from "vitest";
import type { DailyAlmanac } from "../almanac/types";
import { AlmanacCoordinator } from "./almanacCoordinator";

function almanac(date: DailyAlmanac["date"]): DailyAlmanac {
  return {
    date,
    solarYear: 2026,
    solarMonth: 8,
    solarDay: 6,
    weekday: "星期四",
    lunarDate: "六月廿四",
    ganzhiYear: "丙午",
    ganzhiMonth: "乙未",
    ganzhiDay: "辛丑",
    zodiac: "马",
    festivals: [],
    suitable: ["祭祀"],
    avoid: ["动土"],
    hours: [],
  };
}

describe("AlmanacCoordinator", () => {
  test("calculates once for a local date and publishes again after local midnight", async () => {
    let currentDate = new Date(2026, 7, 6, 23, 59);
    const provider = { getByDate: vi.fn(async (date: Date) => almanac(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` as DailyAlmanac["date"])) };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => currentDate);

    await coordinator.ensureToday();
    await coordinator.ensureToday();
    currentDate = new Date(2026, 7, 7, 0, 1);
    await coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith({ status: "ready", date: "2026-08-06", data: almanac("2026-08-06") });
    expect(publish).toHaveBeenCalledWith({ status: "ready", date: "2026-08-07", data: almanac("2026-08-07") });
  });

  test("publishes a friendly error when the provider fails", async () => {
    const provider = { getByDate: vi.fn(async () => { throw new Error("source unavailable"); }) };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => new Date(2026, 7, 6, 12));

    await expect(coordinator.ensureToday()).resolves.toBeUndefined();

    expect(publish).toHaveBeenCalledExactlyOnceWith({
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    });
  });

  test("retries a date after a failed calculation", async () => {
    const provider = {
      getByDate: vi.fn()
        .mockRejectedValueOnce(new Error("source unavailable"))
        .mockResolvedValueOnce(almanac("2026-08-06")),
    };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => new Date(2026, 7, 6, 12));

    await coordinator.ensureToday();
    await coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, {
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    });
    expect(publish).toHaveBeenNthCalledWith(2, {
      status: "ready",
      date: "2026-08-06",
      data: almanac("2026-08-06"),
    });
  });

  test("does not calculate the same date twice while a calculation is in flight", async () => {
    let resolveProvider!: (value: DailyAlmanac) => void;
    const provider = {
      getByDate: vi.fn(() => new Promise<DailyAlmanac>((resolve) => {
        resolveProvider = resolve;
      })),
    };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => new Date(2026, 7, 6, 12));

    const first = coordinator.ensureToday();
    const second = coordinator.ensureToday();
    resolveProvider(almanac("2026-08-06"));
    await Promise.all([first, second]);

    expect(provider.getByDate).toHaveBeenCalledOnce();
  });

  test("queues a new local date until the previous calculation finishes", async () => {
    let currentDate = new Date(2026, 7, 6, 23, 59);
    const resolvers: Array<(value: DailyAlmanac) => void> = [];
    const provider = {
      getByDate: vi.fn(() => new Promise<DailyAlmanac>((resolve) => {
        resolvers.push(resolve);
      })),
    };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => currentDate);

    const first = coordinator.ensureToday();
    currentDate = new Date(2026, 7, 7, 0, 1);
    const second = coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledOnce();
    resolvers[0](almanac("2026-08-06"));
    await vi.waitFor(() => expect(provider.getByDate).toHaveBeenCalledTimes(2));
    resolvers[1](almanac("2026-08-07"));
    await Promise.all([first, second]);
    await coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledTimes(2);
  });

  test("discards an old-date result after the local date advances", async () => {
    let currentDate = new Date(2026, 7, 6, 23, 59);
    const resolvers: Array<(value: DailyAlmanac) => void> = [];
    const provider = {
      getByDate: vi.fn(() => new Promise<DailyAlmanac>((resolve) => {
        resolvers.push(resolve);
      })),
    };
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(provider, publish, () => currentDate);

    const oldDate = coordinator.ensureToday();
    currentDate = new Date(2026, 7, 7, 0, 1);
    const newDate = coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledOnce();
    resolvers[0](almanac("2026-08-06"));
    await vi.waitFor(() => expect(provider.getByDate).toHaveBeenCalledTimes(2));
    resolvers[1](almanac("2026-08-07"));
    await Promise.all([oldDate, newDate]);
    await coordinator.ensureToday();

    expect(publish).toHaveBeenCalledExactlyOnceWith({
      status: "ready",
      date: "2026-08-07",
      data: almanac("2026-08-07"),
    });
    expect(provider.getByDate).toHaveBeenCalledTimes(2);
  });

  test("serializes a new-day refresh behind an older pending publication", async () => {
    let currentDate = new Date(2026, 7, 6, 23, 59);
    let releaseOldPublish!: () => void;
    let markOldPublishStarted!: () => void;
    const oldPublishStarted = new Promise<void>((resolve) => {
      markOldPublishStarted = resolve;
    });
    const provider = {
      getByDate: vi.fn(async (date: Date) => almanac(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` as DailyAlmanac["date"])),
    };
    const publish = vi.fn((snapshot: { date: string }) => {
      if (snapshot.date === "2026-08-06") {
        markOldPublishStarted();
        return new Promise<void>((resolve) => {
          releaseOldPublish = resolve;
        });
      }

      return Promise.resolve();
    });
    const coordinator = new AlmanacCoordinator(provider, publish, () => currentDate);

    const oldEnsure = coordinator.ensureToday();
    await oldPublishStarted;
    currentDate = new Date(2026, 7, 7, 0, 1);
    const newEnsure = coordinator.ensureToday();

    expect(provider.getByDate).toHaveBeenCalledOnce();
    releaseOldPublish();
    await Promise.all([oldEnsure, newEnsure]);

    expect(provider.getByDate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({ date: "2026-08-06" }));
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({ date: "2026-08-07" }));
    await coordinator.ensureToday();
    expect(provider.getByDate).toHaveBeenCalledTimes(2);
  });
});
