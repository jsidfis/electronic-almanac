import { Solar, type LunarTime } from "lunar-javascript";
import { toLocalISODate } from "./dateRules";
import type { AlmanacHour, AlmanacProvider, DailyAlmanac } from "./types";

function withoutUnavailable(items: string[]): string[] {
  return items.filter((item) => item && item !== "无");
}

function uniqueFestivalNames(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function undefinedWhenEmpty(value: string): string | undefined {
  return value || undefined;
}

function prefixRawValue(value: string, prefix: string): string | undefined {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.startsWith(prefix) ? normalized : `${prefix}${normalized}`;
}

function toAlmanacHour(time: LunarTime): AlmanacHour {
  const luck = time.getTianShenLuck();

  return {
    label: `${time.getZhi()}时`,
    range: `${time.getMinHm()}–${time.getMaxHm()}`,
    level: luck === "吉" ? "auspicious" : luck === "凶" ? "inauspicious" : "neutral",
    suitable: withoutUnavailable(time.getYi()),
    avoid: withoutUnavailable(time.getJi()),
  };
}

export class LocalAlmanacProvider implements AlmanacProvider {
  async getByDate(date: Date): Promise<DailyAlmanac> {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();

    return {
      date: toLocalISODate(date),
      solarYear: solar.getYear(),
      solarMonth: solar.getMonth(),
      solarDay: solar.getDay(),
      weekday: `星期${solar.getWeekInChinese()}`,
      lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
      ganzhiYear: lunar.getYearInGanZhi(),
      ganzhiMonth: lunar.getMonthInGanZhi(),
      ganzhiDay: lunar.getDayInGanZhi(),
      zodiac: lunar.getYearShengXiao(),
      solarTerm: undefinedWhenEmpty(lunar.getJieQi()),
      festivals: uniqueFestivalNames([
        ...solar.getFestivals(),
        ...solar.getOtherFestivals(),
        ...lunar.getFestivals(),
        ...lunar.getOtherFestivals(),
      ]),
      suitable: withoutUnavailable(lunar.getDayYi()),
      avoid: withoutUnavailable(lunar.getDayJi()),
      clash: prefixRawValue(lunar.getDayChongDesc(), "冲"),
      sha: prefixRawValue(lunar.getDaySha(), "煞"),
      hours: lunar.getTimes().map(toAlmanacHour),
    };
  }
}
