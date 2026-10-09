export type CardSummary = {
  suitable: string[];
  avoid: string[];
};

function summarize(items: string[], limit: number): string[] {
  const summary = items.filter((item) => item && item !== "无").slice(0, limit);

  return summary.length > 0 ? summary : ["未列出"];
}

export function createCardSummary(suitable: string[], avoid: string[]): CardSummary {
  return {
    suitable: summarize(suitable, 3),
    avoid: summarize(avoid, 2),
  };
}
