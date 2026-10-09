import { describe, expect, test } from "vitest";
import { isSameLocalDate, toLocalISODate } from "./dateRules";

function controlledLocalDate(utcInstant: string, year: number, month: number, day: number): Date {
  const date = new Date(utcInstant);

  Object.assign(date, {
    getFullYear: () => year,
    getMonth: () => month - 1,
    getDate: () => day,
  });

  return date;
}

describe("date rules", () => {
  test("formats a local date without UTC conversion", () => {
    expect(toLocalISODate(controlledLocalDate("2026-08-07T00:30:00.000Z", 2026, 8, 6))).toBe(
      "2026-08-06",
    );
  });

  test("distinguishes adjacent local dates", () => {
    expect(
      isSameLocalDate(
        controlledLocalDate("2026-08-07T00:01:00.000Z", 2026, 8, 6),
        controlledLocalDate("2026-08-07T00:02:00.000Z", 2026, 8, 7),
      ),
    ).toBe(false);
  });
});
