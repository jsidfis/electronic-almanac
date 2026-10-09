export type ISODate = `${number}-${number}-${number}`;

export type HourLevel = "auspicious" | "neutral" | "inauspicious";

export type AlmanacHour = {
  label: string;
  range: string;
  level: HourLevel;
  suitable: string[];
  avoid: string[];
};

export type DailyAlmanac = {
  date: ISODate;
  solarYear: number;
  solarMonth: number;
  solarDay: number;
  weekday: string;
  lunarDate: string;
  ganzhiYear: string;
  ganzhiMonth: string;
  ganzhiDay: string;
  zodiac: string;
  solarTerm?: string;
  festivals: string[];
  suitable: string[];
  avoid: string[];
  clash?: string;
  sha?: string;
  hours: AlmanacHour[];
};

export type AlmanacSnapshot =
  | { status: "ready"; date: ISODate; data: DailyAlmanac }
  | { status: "error"; date: ISODate; message: string };

export interface AlmanacProvider {
  getByDate(date: Date): Promise<DailyAlmanac>;
}
