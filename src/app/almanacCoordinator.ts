import { toLocalISODate } from "../almanac/dateRules";
import type { AlmanacProvider, AlmanacSnapshot } from "../almanac/types";

type PublishSnapshot = (snapshot: AlmanacSnapshot) => Promise<void>;

export class AlmanacCoordinator {
  private publishedDate: string | null = null;
  private inFlight: { date: string; promise: Promise<void> } | null = null;
  private timer: number | null = null;

  constructor(
    private readonly provider: AlmanacProvider,
    private readonly publish: PublishSnapshot,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureToday(): Promise<void> {
    while (true) {
      const inFlight = this.inFlight;

      if (inFlight) {
        const requestedDate = toLocalISODate(this.now());
        await inFlight.promise;

        if (inFlight.date === requestedDate && toLocalISODate(this.now()) === requestedDate) {
          return;
        }

        continue;
      }

      const today = this.now();
      const date = toLocalISODate(today);

      if (this.publishedDate === date) {
        return;
      }

      const promise = this.calculateAndPublish(today, date);
      const transaction = { date, promise };
      this.inFlight = transaction;

      try {
        await promise;
      } finally {
        if (this.inFlight === transaction) {
          this.inFlight = null;
        }
      }

      if (toLocalISODate(this.now()) === date) {
        return;
      }
    }
  }

  private async calculateAndPublish(today: Date, date: AlmanacSnapshot["date"]): Promise<void> {
    try {
      const data = await this.provider.getByDate(today);
      if (toLocalISODate(this.now()) !== date) {
        return;
      }
      await this.publish({ status: "ready", date, data });
      if (toLocalISODate(this.now()) === date) {
        this.publishedDate = date;
      }
    } catch {
      if (toLocalISODate(this.now()) !== date) {
        return;
      }
      try {
        await this.publish({
          status: "error",
          date,
          message: "黄历信息暂时无法生成",
        });
      } catch {
        // Publishing an error must not expose provider or transport failures.
      }
    }
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }

    void this.ensureToday();
    this.timer = window.setInterval(() => {
      void this.ensureToday();
    }, 60_000);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
