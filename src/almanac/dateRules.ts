import type { ISODate } from "./types";

export function toLocalISODate(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}` as ISODate;
}

export function isSameLocalDate(first: Date, second: Date): boolean {
  return toLocalISODate(first) === toLocalISODate(second);
}
