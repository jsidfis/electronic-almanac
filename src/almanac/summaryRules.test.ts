import { describe, expect, test } from "vitest";
import { createCardSummary } from "./summaryRules";

describe("card summary rules", () => {
  test("preserves order and caps suitable and avoid entries", () => {
    expect(
      createCardSummary(["祭祀", "祈福", "出行", "嫁娶"], ["动土", "安葬", "开市"]),
    ).toEqual({
      suitable: ["祭祀", "祈福", "出行"],
      avoid: ["动土", "安葬"],
    });
  });

  test("uses the empty-state label when no entries remain", () => {
    expect(createCardSummary([], [])).toEqual({
      suitable: ["未列出"],
      avoid: ["未列出"],
    });
  });

  test("omits empty entries and the exact unavailable label", () => {
    expect(createCardSummary(["", "无", "祭祀"], ["无", ""])).toEqual({
      suitable: ["祭祀"],
      avoid: ["未列出"],
    });
  });
});
