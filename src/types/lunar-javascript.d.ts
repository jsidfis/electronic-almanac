declare module "lunar-javascript" {
  export interface LunarTime {
    getZhi(): string;
    getMinHm(): string;
    getMaxHm(): string;
    getTianShenLuck(): string;
    getYi(): string[];
    getJi(): string[];
  }

  export interface Lunar {
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInGanZhi(): string;
    getMonthInGanZhi(): string;
    getDayInGanZhi(): string;
    getYearShengXiao(): string;
    getJieQi(): string;
    getFestivals(): string[];
    getOtherFestivals(): string[];
    getDayYi(): string[];
    getDayJi(): string[];
    getDayChongDesc(): string;
    getDaySha(): string;
    getTimes(): LunarTime[];
  }

  export interface SolarDate {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getWeekInChinese(): string;
    getFestivals(): string[];
    getOtherFestivals(): string[];
    getLunar(): Lunar;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
}
