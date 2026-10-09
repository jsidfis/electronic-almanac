import { Solar, type Lunar, type LunarTime, type SolarDate } from "lunar-javascript";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocalAlmanacProvider } from "./localAlmanacProvider";

function localNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12);
}

describe("LocalAlmanacProvider", () => {
  const provider = new LocalAlmanacProvider();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("maps source values into app-owned festival, yi-ji, and hour fields", async () => {
    const times: LunarTime[] = [
      {
        getZhi: () => "子",
        getMinHm: () => "00:00",
        getMaxHm: () => "00:59",
        getTianShenLuck: () => "吉",
        getYi: () => ["求财", "无", ""],
        getJi: () => ["", "动土", "无"],
      },
      {
        getZhi: () => "丑",
        getMinHm: () => "01:00",
        getMaxHm: () => "02:59",
        getTianShenLuck: () => "凶",
        getYi: () => ["无", ""],
        getJi: () => ["出行", "无", ""],
      },
      {
        getZhi: () => "寅",
        getMinHm: () => "03:00",
        getMaxHm: () => "04:59",
        getTianShenLuck: () => "平",
        getYi: () => ["修造"],
        getJi: () => ["无", ""],
      },
    ];
    const lunar: Lunar = {
      getMonthInChinese: () => "三",
      getDayInChinese: () => "初八",
      getYearInGanZhi: () => "乙巳",
      getMonthInGanZhi: () => "庚辰",
      getDayInGanZhi: () => "丁亥",
      getYearShengXiao: () => "蛇",
      getJieQi: () => "",
      getFestivals: () => ["农历节", "太阳节", ""],
      getOtherFestivals: () => ["公共纪念", "地方节", "农历节"],
      getDayYi: () => ["祭祀", "无", ""],
      getDayJi: () => ["", "无", "动土"],
      getDayChongDesc: () => "(乙巳)蛇",
      getDaySha: () => "东",
      getTimes: () => times,
    };
    const solar: SolarDate = {
      getYear: () => 2025,
      getMonth: () => 4,
      getDay: () => 5,
      getWeekInChinese: () => "六",
      getFestivals: () => ["太阳节", "", "重复节"],
      getOtherFestivals: () => ["公共纪念", "重复节", ""],
      getLunar: () => lunar,
    };
    const fromYmd = vi.spyOn(Solar, "fromYmd").mockReturnValue(solar);

    const almanac = await provider.getByDate(localNoon(2025, 4, 5));

    expect(fromYmd).toHaveBeenCalledWith(2025, 4, 5);
    expect(almanac.festivals).toEqual(["太阳节", "重复节", "公共纪念", "农历节", "地方节"]);
    expect(almanac.suitable).toEqual(["祭祀"]);
    expect(almanac.avoid).toEqual(["动土"]);
    expect(almanac.clash).toBe("冲(乙巳)蛇");
    expect(almanac.sha).toBe("煞东");
    expect(almanac.hours).toEqual([
      {
        label: "子时",
        range: "00:00–00:59",
        level: "auspicious",
        suitable: ["求财"],
        avoid: ["动土"],
      },
      {
        label: "丑时",
        range: "01:00–02:59",
        level: "inauspicious",
        suitable: [],
        avoid: ["出行"],
      },
      {
        label: "寅时",
        range: "03:00–04:59",
        level: "neutral",
        suitable: ["修造"],
        avoid: [],
      },
    ]);
  });

  test("keeps empty raw clash and sha values undefined", async () => {
    const lunar = {
      getMonthInChinese: () => "三",
      getDayInChinese: () => "初八",
      getYearInGanZhi: () => "乙巳",
      getMonthInGanZhi: () => "庚辰",
      getDayInGanZhi: () => "丁亥",
      getYearShengXiao: () => "蛇",
      getJieQi: () => "",
      getFestivals: () => [],
      getOtherFestivals: () => [],
      getDayYi: () => [],
      getDayJi: () => [],
      getDayChongDesc: () => "",
      getDaySha: () => "",
      getTimes: () => [],
    } as Lunar;
    const solar = {
      getYear: () => 2025,
      getMonth: () => 4,
      getDay: () => 5,
      getWeekInChinese: () => "六",
      getFestivals: () => [],
      getOtherFestivals: () => [],
      getLunar: () => lunar,
    } as SolarDate;
    vi.spyOn(Solar, "fromYmd").mockReturnValue(solar);

    const almanac = await provider.getByDate(localNoon(2025, 4, 5));

    expect(almanac.clash).toBeUndefined();
    expect(almanac.sha).toBeUndefined();
  });

  test("calculates Lunar New Year 2024", async () => {
    const almanac = await provider.getByDate(localNoon(2024, 2, 10));

    expect(almanac.date).toBe("2024-02-10");
    expect(almanac.lunarDate).toBe("正月初一");
    expect(almanac.ganzhiYear).toBe("甲辰");
    expect(almanac.zodiac).toBe("龙");
    expect(almanac.festivals).toContain("春节");
    expect(almanac.suitable).not.toHaveLength(0);
    expect(almanac.hours).toHaveLength(13);
    expect(almanac.hours[0]).toMatchObject({
      label: "子时",
      range: "00:00–00:59",
    });
    expect(almanac.hours.at(-1)).toMatchObject({
      label: "子时",
      range: "23:00–23:59",
    });
  });

  test("preserves the leap-month marker", async () => {
    const almanac = await provider.getByDate(localNoon(2023, 3, 22));

    expect(almanac.lunarDate).toBe("闰二月初一");
  });

  test("exposes solar terms", async () => {
    const almanac = await provider.getByDate(localNoon(2024, 2, 4));

    expect(almanac.solarTerm).toBe("立春");
  });

  test("calculates ordinary daily fields and all hourly details", async () => {
    const almanac = await provider.getByDate(localNoon(2026, 8, 6));

    expect(almanac.weekday).toBe("星期四");
    expect(almanac.suitable).not.toHaveLength(0);
    expect(almanac.avoid).not.toHaveLength(0);
    expect(almanac.clash).toBeTruthy();
    expect(almanac.sha).toBeTruthy();
    expect(almanac.hours).toHaveLength(13);
    expect(almanac.hours.every((hour) => hour.label && hour.range)).toBe(true);
  });
});
