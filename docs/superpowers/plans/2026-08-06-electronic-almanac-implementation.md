# Electronic Almanac Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight Windows tray almanac that starts silently, shows a traditional-paper daily card, opens a complete daily detail window, calculates all data locally, and ships as an NSIS installer.

**Architecture:** A Tauri 2 process owns the tray, two windows, single-instance behavior, autostart, settings, and a process-memory almanac snapshot. The hidden `tray-card` webview is the single calculation owner: it converts `lunar-javascript` output into the app-owned `DailyAlmanac` model, publishes the snapshot through Tauri commands/events, and refreshes only when the local date changes. Both React windows consume the same snapshot; no daily almanac data is written to disk.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vite, Vitest, Testing Library, `lunar-javascript` 1.7.7, Tauri autostart/store/single-instance/positioner plugins, NSIS.

---

## Scope and execution rules

- Work only in `D:\APP\电子黄历`.
- Keep the existing approved design at `docs/superpowers/specs/2026-08-06-electronic-almanac-design.md` as the source of truth.
- Use `npm.cmd` in PowerShell.
- Follow TDD for every behavior: failing test, confirm failure, minimal implementation, confirm pass.
- Commit after every task using only that task's files.
- Do not implement a month calendar, history, reminders, online APIs, accounts, cloud sync, daily cache, weather, horoscope scoring, or automatic updates.
- Do not touch `D:\APP\每日复盘小程序` or the old C-drive duplicate.

## Planned file structure

```text
电子黄历/
├─ .gitignore
├─ README.md
├─ index.html
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ tsconfig.app.json
├─ tsconfig.node.json
├─ vite.config.ts
├─ vitest.setup.ts
├─ docs/superpowers/specs/...
├─ docs/superpowers/plans/...
├─ src/
│  ├─ main.tsx                       # React bootstrap
│  ├─ App.tsx                        # Select tray-card or main window UI
│  ├─ App.test.tsx
│  ├─ styles.css                     # Shared traditional-paper visual system
│  ├─ vite-env.d.ts
│  ├─ almanac/
│  │  ├─ types.ts                    # App-owned almanac types
│  │  ├─ dateRules.ts                # Local ISO date and refresh comparison
│  │  ├─ dateRules.test.ts
│  │  ├─ summaryRules.ts             # Stable card summary selection
│  │  ├─ summaryRules.test.ts
│  │  ├─ localAlmanacProvider.ts     # lunar-javascript adapter only
│  │  └─ localAlmanacProvider.test.ts
│  ├─ app/
│  │  ├─ almanacCoordinator.ts       # Single calculation owner and minute polling
│  │  └─ almanacCoordinator.test.ts
│  ├─ desktop/
│  │  ├─ desktopBridge.ts            # Tauri invoke/event boundary
│  │  └─ desktopBridge.test.ts
│  ├─ components/
│  │  ├─ PaperShell.tsx
│  │  ├─ AlmanacStatus.tsx
│  │  ├─ FirstRunPrompt.tsx
│  │  └─ FirstRunPrompt.test.tsx
│  ├─ views/
│  │  ├─ TrayCard.tsx
│  │  ├─ TrayCard.test.tsx
│  │  ├─ DailyDetail.tsx
│  │  ├─ DailyDetail.test.tsx
│  │  ├─ SettingsView.tsx
│  │  └─ SettingsView.test.tsx
│  └─ types/lunar-javascript.d.ts    # Minimal declarations for used upstream API
└─ src-tauri/
   ├─ build.rs
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json
   ├─ icons/app-icon.svg
   └─ src/
      ├─ main.rs
      ├─ lib.rs                      # Plugin setup and window lifecycle
      ├─ almanac_state.rs            # Process-memory snapshot commands/events
      ├─ settings.rs                 # Prompt/autostart commands
      └─ tray.rs                     # Tray menu, click behavior, positioning
```

### Task 1: Bootstrap the React, TypeScript, and test harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/App.test.tsx`
- Create: `src/styles.css`

- [x] **Step 1: Write the baseline failing application test**

Create `src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the electronic almanac shell", () => {
    render(<App view="main" />);
    expect(screen.getByRole("heading", { name: "电子黄历" })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Add the package and tool configuration**

Create `package.json`:

```json
{
  "name": "electronic-almanac",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

Install and pin the application dependency selected in the design, then install current compatible React/Tauri tooling and commit the generated lockfile:

```powershell
npm.cmd install react react-dom @tauri-apps/api lunar-javascript@1.7.7
npm.cmd install -D @types/react @types/react-dom @vitejs/plugin-react @tauri-apps/cli typescript vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: `package-lock.json` is created and `npm.cmd ls lunar-javascript` reports `lunar-javascript@1.7.7`.

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Create `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true
  },
  "include": ["vite.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    css: true,
  },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>电子黄历</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 3: Run the test and verify the application is missing**

Run:

```powershell
npm.cmd run test:run -- src/App.test.tsx
```

Expected: FAIL because `src/App.tsx` does not exist.

- [x] **Step 4: Add the minimal React application**

Create `src/App.tsx`:

```tsx
export type WindowView = "tray-card" | "main";

export function App({ view }: { view: WindowView }) {
  return (
    <main className={`app app--${view}`}>
      <h1>电子黄历</h1>
    </main>
  );
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type WindowView } from "./App";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view") === "tray-card"
  ? "tray-card"
  : "main";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view as WindowView} />
  </StrictMode>,
);
```

Create `src/styles.css`:

```css
:root {
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  color: #3b2b20;
  background: #dfc69e;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* { box-sizing: border-box; }
html, body, #root { min-height: 100%; margin: 0; }
button, input { font: inherit; }
.app { min-height: 100vh; padding: 24px; }
```

- [x] **Step 5: Verify baseline tests and build pass**

Run:

```powershell
npm.cmd run test:run
npm.cmd run build
```

Expected: one test passes and Vite creates `dist/` without TypeScript errors.

- [x] **Step 6: Commit the bootstrap**

```powershell
git add package.json package-lock.json index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts vitest.setup.ts src
git commit -m "chore: bootstrap electronic almanac app"
```

### Task 2: Define the app-owned almanac model and pure rules

**Files:**
- Create: `src/almanac/types.ts`
- Create: `src/almanac/dateRules.ts`
- Create: `src/almanac/dateRules.test.ts`
- Create: `src/almanac/summaryRules.ts`
- Create: `src/almanac/summaryRules.test.ts`

- [x] **Step 1: Write failing date and summary tests**

Create `src/almanac/dateRules.test.ts`:

```ts
import { isSameLocalDate, toLocalISODate } from "./dateRules";

describe("dateRules", () => {
  it("formats the local calendar date without UTC shifting", () => {
    expect(toLocalISODate(new Date(2026, 7, 6, 23, 30))).toBe("2026-08-06");
  });

  it("detects a local midnight transition", () => {
    expect(isSameLocalDate(
      new Date(2026, 7, 6, 23, 59),
      new Date(2026, 7, 7, 0, 1),
    )).toBe(false);
  });
});
```

Create `src/almanac/summaryRules.test.ts`:

```ts
import { createCardSummary } from "./summaryRules";

describe("createCardSummary", () => {
  it("keeps source order and limits the card to three suitable and two avoid items", () => {
    expect(createCardSummary(
      ["祭祀", "出行", "会友", "交易"],
      ["动土", "迁居", "安葬"],
    )).toEqual({
      suitable: ["祭祀", "出行", "会友"],
      avoid: ["动土", "迁居"],
    });
  });

  it("uses the approved empty label instead of inventing advice", () => {
    expect(createCardSummary([], [])).toEqual({
      suitable: ["未列出"],
      avoid: ["未列出"],
    });
  });
});
```

- [x] **Step 2: Run tests and verify missing modules fail**

Run:

```powershell
npm.cmd run test:run -- src/almanac/dateRules.test.ts src/almanac/summaryRules.test.ts
```

Expected: FAIL because `dateRules.ts` and `summaryRules.ts` do not exist.

- [x] **Step 3: Add the model and minimal pure implementations**

Create `src/almanac/types.ts`:

```ts
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
```

Create `src/almanac/dateRules.ts`:

```ts
import type { ISODate } from "./types";

export function toLocalISODate(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as ISODate;
}

export function isSameLocalDate(left: Date, right: Date): boolean {
  return toLocalISODate(left) === toLocalISODate(right);
}
```

Create `src/almanac/summaryRules.ts`:

```ts
export type CardSummary = {
  suitable: string[];
  avoid: string[];
};

function takeOrEmptyLabel(items: string[], limit: number): string[] {
  const selected = items.filter((item) => item && item !== "无").slice(0, limit);
  return selected.length > 0 ? selected : ["未列出"];
}

export function createCardSummary(suitable: string[], avoid: string[]): CardSummary {
  return {
    suitable: takeOrEmptyLabel(suitable, 3),
    avoid: takeOrEmptyLabel(avoid, 2),
  };
}
```

- [x] **Step 4: Run pure rule tests**

Run:

```powershell
npm.cmd run test:run -- src/almanac/dateRules.test.ts src/almanac/summaryRules.test.ts
```

Expected: four tests pass.

- [x] **Step 5: Commit the domain model and rules**

```powershell
git add src/almanac
git commit -m "feat: define almanac domain rules"
```

### Task 3: Adapt `lunar-javascript` into `DailyAlmanac`

**Files:**
- Create: `src/types/lunar-javascript.d.ts`
- Create: `src/almanac/localAlmanacProvider.ts`
- Create: `src/almanac/localAlmanacProvider.test.ts`

- [x] **Step 1: Write failing provider tests using known calendar dates**

Create `src/almanac/localAlmanacProvider.test.ts`:

```ts
import { LocalAlmanacProvider } from "./localAlmanacProvider";

describe("LocalAlmanacProvider", () => {
  const provider = new LocalAlmanacProvider();

  it("maps Chinese New Year into the app-owned model", async () => {
    const result = await provider.getByDate(new Date(2024, 1, 10, 12));

    expect(result.date).toBe("2024-02-10");
    expect(result.lunarDate).toBe("正月初一");
    expect(result.ganzhiYear).toBe("甲辰");
    expect(result.zodiac).toBe("龙");
    expect(result.festivals).toContain("春节");
    expect(result.suitable.length).toBeGreaterThan(0);
    expect(result.hours).toHaveLength(13);
    expect(result.hours[0]).toMatchObject({
      label: "子时",
      range: "00:00–00:59",
    });
    expect(result.hours.at(-1)).toMatchObject({
      label: "子时",
      range: "23:00–23:59",
    });
  });

  it("keeps the leap-month marker", async () => {
    const result = await provider.getByDate(new Date(2023, 2, 22, 12));
    expect(result.lunarDate).toBe("闰二月初一");
  });

  it("reports a solar term on its calendar day", async () => {
    const result = await provider.getByDate(new Date(2024, 1, 4, 12));
    expect(result.solarTerm).toBe("立春");
  });

  it("maps ordinary-day yi, ji, clash, sha, and hour details", async () => {
    const result = await provider.getByDate(new Date(2026, 7, 6, 12));
    expect(result.weekday).toBe("星期四");
    expect(result.suitable.length).toBeGreaterThan(0);
    expect(result.avoid.length).toBeGreaterThan(0);
    expect(result.clash).toBeTruthy();
    expect(result.sha).toBeTruthy();
    expect(result.hours.every((hour) => hour.label && hour.range)).toBe(true);
  });
});
```

- [x] **Step 2: Run the provider test and verify the adapter is missing**

Run:

```powershell
npm.cmd run test:run -- src/almanac/localAlmanacProvider.test.ts
```

Expected: FAIL because `localAlmanacProvider.ts` does not exist.

- [x] **Step 3: Add minimal upstream type declarations**

Create `src/types/lunar-javascript.d.ts` containing only APIs used by the app:

```ts
declare module "lunar-javascript" {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getWeekInChinese(): string;
    getFestivals(): string[];
    getOtherFestivals(): string[];
    getLunar(): Lunar;
  }

  export class Lunar {
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

  export class LunarTime {
    getZhi(): string;
    getMinHm(): string;
    getMaxHm(): string;
    getTianShenLuck(): string;
    getYi(): string[];
    getJi(): string[];
  }
}
```

- [x] **Step 4: Implement the adapter with no UI dependencies**

Create `src/almanac/localAlmanacProvider.ts`:

```ts
import { Solar } from "lunar-javascript";
import { toLocalISODate } from "./dateRules";
import type { AlmanacHour, AlmanacProvider, DailyAlmanac, HourLevel } from "./types";

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function withoutNone(items: string[]): string[] {
  return items.filter((item) => item && item !== "无");
}

function toHourLevel(luck: string): HourLevel {
  if (luck === "吉") return "auspicious";
  if (luck === "凶") return "inauspicious";
  return "neutral";
}

export class LocalAlmanacProvider implements AlmanacProvider {
  async getByDate(date: Date): Promise<DailyAlmanac> {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const lunarMonth = lunar.getMonthInChinese();
    const solarTerm = lunar.getJieQi();

    const hours: AlmanacHour[] = lunar.getTimes().map((time) => ({
      label: `${time.getZhi()}时`,
      range: `${time.getMinHm()}–${time.getMaxHm()}`,
      level: toHourLevel(time.getTianShenLuck()),
      suitable: withoutNone(time.getYi()),
      avoid: withoutNone(time.getJi()),
    }));

    return {
      date: toLocalISODate(date),
      solarYear: solar.getYear(),
      solarMonth: solar.getMonth(),
      solarDay: solar.getDay(),
      weekday: `星期${solar.getWeekInChinese()}`,
      lunarDate: `${lunarMonth.startsWith("闰") ? "闰" : ""}${lunarMonth.replace(/^闰/, "")}月${lunar.getDayInChinese()}`,
      ganzhiYear: lunar.getYearInGanZhi(),
      ganzhiMonth: lunar.getMonthInGanZhi(),
      ganzhiDay: lunar.getDayInGanZhi(),
      zodiac: lunar.getYearShengXiao(),
      solarTerm: solarTerm || undefined,
      festivals: unique([
        ...solar.getFestivals(),
        ...solar.getOtherFestivals(),
        ...lunar.getFestivals(),
        ...lunar.getOtherFestivals(),
      ]),
      suitable: withoutNone(lunar.getDayYi()),
      avoid: withoutNone(lunar.getDayJi()),
      clash: lunar.getDayChongDesc() || undefined,
      sha: lunar.getDaySha() || undefined,
      hours,
    };
  }
}
```

- [x] **Step 5: Run the adapter tests and inspect any upstream API mismatch before changing declarations**

Run:

```powershell
npm.cmd run test:run -- src/almanac/localAlmanacProvider.test.ts
```

Expected: four tests pass using the exact upstream methods declared above. Before committing, run `npm.cmd ls lunar-javascript` and confirm the lockfile resolves `1.7.7`; do not substitute a different library API or change the app-owned model.

- [x] **Step 6: Commit the local provider**

```powershell
git add src/types/lunar-javascript.d.ts src/almanac/localAlmanacProvider.ts src/almanac/localAlmanacProvider.test.ts
git commit -m "feat: calculate local daily almanac"
```

### Task 4: Create the single calculation coordinator and desktop channel

**Files:**
- Create: `src/app/almanacCoordinator.ts`
- Create: `src/app/almanacCoordinator.test.ts`
- Create: `src/desktop/desktopBridge.ts`
- Create: `src/desktop/desktopBridge.test.ts`

- [x] **Step 1: Write failing coordinator tests**

Create `src/app/almanacCoordinator.test.ts`:

```ts
import type { AlmanacProvider, DailyAlmanac } from "../almanac/types";
import { AlmanacCoordinator } from "./almanacCoordinator";

const day = (date: string): DailyAlmanac => ({
  date: date as DailyAlmanac["date"],
  solarYear: 2026,
  solarMonth: 8,
  solarDay: 6,
  weekday: "星期四",
  lunarDate: "六月廿四",
  ganzhiYear: "丙午",
  ganzhiMonth: "乙未",
  ganzhiDay: "壬子",
  zodiac: "马",
  festivals: [],
  suitable: ["出行"],
  avoid: ["动土"],
  hours: [],
});

describe("AlmanacCoordinator", () => {
  it("publishes once per local date and refreshes after midnight", async () => {
    let now = new Date(2026, 7, 6, 23, 59);
    const getByDate = vi.fn(async (date: Date) => day(
      date.getDate() === 6 ? "2026-08-06" : "2026-08-07",
    ));
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(
      { getByDate } as AlmanacProvider,
      publish,
      () => now,
    );

    await coordinator.ensureToday();
    await coordinator.ensureToday();
    expect(getByDate).toHaveBeenCalledTimes(1);

    now = new Date(2026, 7, 7, 0, 1);
    await coordinator.ensureToday();
    expect(getByDate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "ready",
      date: "2026-08-07",
    }));
  });

  it("publishes a usable error snapshot instead of throwing", async () => {
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(
      { getByDate: vi.fn().mockRejectedValue(new Error("broken")) },
      publish,
      () => new Date(2026, 7, 6, 12),
    );

    await coordinator.ensureToday();
    expect(publish).toHaveBeenCalledWith({
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    });
  });

  it("retries the same date after a calculation failure", async () => {
    const getByDate = vi.fn()
      .mockRejectedValueOnce(new Error("broken"))
      .mockResolvedValueOnce(day("2026-08-06"));
    const publish = vi.fn(async () => undefined);
    const coordinator = new AlmanacCoordinator(
      { getByDate } as AlmanacProvider,
      publish,
      () => new Date(2026, 7, 6, 12),
    );

    await coordinator.ensureToday();
    await coordinator.ensureToday();
    expect(getByDate).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" }));
  });

  it("coalesces concurrent checks for the same date", async () => {
    const getByDate = vi.fn(async () => day("2026-08-06"));
    const coordinator = new AlmanacCoordinator(
      { getByDate } as AlmanacProvider,
      vi.fn(async () => undefined),
      () => new Date(2026, 7, 6, 12),
    );
    await Promise.all([coordinator.ensureToday(), coordinator.ensureToday()]);
    expect(getByDate).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run the coordinator test and verify it fails**

```powershell
npm.cmd run test:run -- src/app/almanacCoordinator.test.ts
```

Expected: FAIL because `AlmanacCoordinator` does not exist.

- [x] **Step 3: Implement the coordinator with injected time and timers**

Create `src/app/almanacCoordinator.ts`:

```ts
import { toLocalISODate } from "../almanac/dateRules";
import type { AlmanacProvider, AlmanacSnapshot } from "../almanac/types";

type Publish = (snapshot: AlmanacSnapshot) => Promise<void>;

export class AlmanacCoordinator {
  private publishedDate: string | null = null;
  private inFlightDate: string | null = null;
  private timer: number | null = null;

  constructor(
    private readonly provider: AlmanacProvider,
    private readonly publish: Publish,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureToday(): Promise<void> {
    const current = this.now();
    const date = toLocalISODate(current);
    if (date === this.publishedDate || date === this.inFlightDate) return;
    this.inFlightDate = date;

    try {
      const data = await this.provider.getByDate(current);
      await this.publish({ status: "ready", date, data });
      this.publishedDate = date;
    } catch {
      await this.publish({
        status: "error",
        date,
        message: "黄历信息暂时无法生成",
      });
    } finally {
      this.inFlightDate = null;
    }

  }

  start(): void {
    void this.ensureToday();
    this.timer = window.setInterval(() => void this.ensureToday(), 60_000);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [x] **Step 4: Write the desktop bridge contract test**

Create `src/desktop/desktopBridge.test.ts`:

```ts
import type { AlmanacSnapshot } from "../almanac/types";
import { createMemoryDesktopBridge } from "./desktopBridge";

describe("memory desktop bridge", () => {
  it("publishes one snapshot to all consumers", async () => {
    const bridge = createMemoryDesktopBridge();
    const listener = vi.fn();
    const unlisten = await bridge.subscribeSnapshot(listener);
    const snapshot = {
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    } satisfies AlmanacSnapshot;

    await bridge.publishSnapshot(snapshot);
    expect(await bridge.getSnapshot()).toEqual(snapshot);
    expect(listener).toHaveBeenCalledWith(snapshot);
    unlisten();
  });
});
```

- [x] **Step 5: Implement the Tauri boundary plus memory test double**

Create `src/desktop/desktopBridge.ts`:

```ts
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { AlmanacSnapshot } from "../almanac/types";

export type Unlisten = () => void;

export interface DesktopBridge {
  publishSnapshot(snapshot: AlmanacSnapshot): Promise<void>;
  getSnapshot(): Promise<AlmanacSnapshot | null>;
  subscribeSnapshot(listener: (snapshot: AlmanacSnapshot) => void): Promise<Unlisten>;
  subscribeRefreshRequest(listener: () => void): Promise<Unlisten>;
  subscribeSettingsRequest(listener: (errorMessage?: string) => void): Promise<Unlisten>;
  subscribeDetailsRequest(listener: () => void): Promise<Unlisten>;
  requestRefresh(): Promise<void>;
  requestSettings(errorMessage?: string): Promise<void>;
  showDetails(): Promise<void>;
  hideCard(): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<boolean>;
  getPromptSeen(): Promise<boolean>;
  completePrompt(enabled: boolean): Promise<boolean>;
}

export const tauriDesktopBridge: DesktopBridge = {
  publishSnapshot: (snapshot) => invoke("publish_almanac_snapshot", { snapshot }),
  getSnapshot: () => invoke("get_almanac_snapshot"),
  subscribeSnapshot: async (listener) => listen<AlmanacSnapshot>(
    "almanac://updated",
    (event) => listener(event.payload),
  ),
  subscribeRefreshRequest: async (listener) => listen("almanac://refresh-requested", listener),
  subscribeSettingsRequest: async (listener) => listen<string | null>(
    "app://open-settings",
    (event) => listener(event.payload ?? undefined),
  ),
  subscribeDetailsRequest: async (listener) => listen("app://show-details", listener),
  requestRefresh: () => emit("almanac://refresh-requested"),
  requestSettings: (errorMessage) => emit("app://open-settings", errorMessage ?? null),
  showDetails: () => invoke("show_details"),
  hideCard: () => invoke("hide_tray_card"),
  getAutostart: () => invoke("get_autostart"),
  setAutostart: (enabled) => invoke("set_autostart", { enabled }),
  getPromptSeen: () => invoke("get_prompt_seen"),
  completePrompt: (enabled) => invoke("complete_autostart_prompt", { enabled }),
};

export function createMemoryDesktopBridge(): DesktopBridge {
  let snapshot: AlmanacSnapshot | null = null;
  let autostart = false;
  let promptSeen = false;
  const snapshotListeners = new Set<(value: AlmanacSnapshot) => void>();
  const refreshListeners = new Set<() => void>();
  const settingsListeners = new Set<(errorMessage?: string) => void>();
  const detailsListeners = new Set<() => void>();

  return {
    publishSnapshot: async (value) => {
      snapshot = value;
      snapshotListeners.forEach((listener) => listener(value));
    },
    getSnapshot: async () => snapshot,
    subscribeSnapshot: async (listener) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    subscribeRefreshRequest: async (listener) => {
      refreshListeners.add(listener);
      return () => refreshListeners.delete(listener);
    },
    subscribeSettingsRequest: async (listener) => {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
    subscribeDetailsRequest: async (listener) => {
      detailsListeners.add(listener);
      return () => detailsListeners.delete(listener);
    },
    requestRefresh: async () => refreshListeners.forEach((listener) => listener()),
    requestSettings: async (errorMessage) => settingsListeners.forEach((listener) => listener(errorMessage)),
    showDetails: async () => detailsListeners.forEach((listener) => listener()),
    hideCard: async () => undefined,
    getAutostart: async () => autostart,
    setAutostart: async (enabled) => (autostart = enabled),
    getPromptSeen: async () => promptSeen,
    completePrompt: async (enabled) => {
      promptSeen = true;
      autostart = enabled;
      return autostart;
    },
  };
}
```

- [x] **Step 6: Run coordinator and bridge tests**

```powershell
npm.cmd run test:run -- src/app/almanacCoordinator.test.ts src/desktop/desktopBridge.test.ts
```

Expected: all tests pass.

- [x] **Step 7: Commit coordination and IPC contracts**

```powershell
git add src/app src/desktop
git commit -m "feat: coordinate daily almanac state"
```

### Task 5: Build the traditional-paper tray card

**Files:**
- Create: `src/components/PaperShell.tsx`
- Create: `src/components/AlmanacStatus.tsx`
- Create: `src/views/TrayCard.tsx`
- Create: `src/views/TrayCard.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing card tests for ready and error states**

Create `src/views/TrayCard.test.tsx` with a complete `DailyAlmanac` fixture and these assertions:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AlmanacSnapshot } from "../almanac/types";
import { TrayCard } from "./TrayCard";

const ready: AlmanacSnapshot = {
  status: "ready",
  date: "2026-08-06",
  data: {
    date: "2026-08-06",
    solarYear: 2026,
    solarMonth: 8,
    solarDay: 6,
    weekday: "星期四",
    lunarDate: "六月廿四",
    ganzhiYear: "丙午",
    ganzhiMonth: "乙未",
    ganzhiDay: "壬子",
    zodiac: "马",
    solarTerm: "立秋",
    festivals: [],
    suitable: ["出行", "会友", "整理", "交易"],
    avoid: ["动土", "迁居", "安葬"],
    clash: "冲马",
    sha: "煞南",
    hours: [],
  },
};

describe("TrayCard", () => {
  it("renders the approved compact summary", () => {
    render(<TrayCard snapshot={ready} onShowDetails={vi.fn()} onHide={vi.fn()} />);
    expect(screen.getByText("06")).toBeInTheDocument();
    expect(screen.getByText("六月廿四 · 丙午年 · 生肖马")).toBeInTheDocument();
    expect(screen.getByText("宜 出行")).toBeInTheDocument();
    expect(screen.queryByText("宜 交易")).not.toBeInTheDocument();
    expect(screen.getByText("本地计算 · 无缓存")).toBeInTheDocument();
  });

  it("opens details from the card action", async () => {
    const onShowDetails = vi.fn();
    render(<TrayCard snapshot={ready} onShowDetails={onShowDetails} onHide={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onShowDetails).toHaveBeenCalledTimes(1);
  });

  it("keeps the Gregorian date visible when calculation fails", () => {
    render(<TrayCard snapshot={{
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    }} onShowDetails={vi.fn()} onHide={vi.fn()} />);
    expect(screen.getByText("06")).toBeInTheDocument();
    expect(screen.getByText("8月 · 星期四")).toBeInTheDocument();
    expect(screen.getByText("黄历信息暂时无法生成")).toBeInTheDocument();
  });

  it("hides when Escape is pressed", async () => {
    const onHide = vi.fn();
    render(<TrayCard snapshot={ready} onShowDetails={vi.fn()} onHide={onHide} />);
    await userEvent.keyboard("{Escape}");
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run the card tests and verify the component is missing**

```powershell
npm.cmd run test:run -- src/views/TrayCard.test.tsx
```

Expected: FAIL because `TrayCard.tsx` does not exist.

- [x] **Step 3: Implement the shared paper shell and card**

Create `src/components/PaperShell.tsx`:

```tsx
import type { PropsWithChildren } from "react";

export function PaperShell({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`paper-shell ${className}`.trim()}>{children}</section>;
}
```

Create `src/components/AlmanacStatus.tsx`:

```tsx
export function AlmanacStatus({ message }: { message: string }) {
  return <p className="almanac-status" role="status">{message}</p>;
}
```

Create `src/views/TrayCard.tsx`:

```tsx
import { useEffect } from "react";
import type { AlmanacSnapshot } from "../almanac/types";
import { createCardSummary } from "../almanac/summaryRules";
import { AlmanacStatus } from "../components/AlmanacStatus";
import { PaperShell } from "../components/PaperShell";

export function TrayCard({
  snapshot,
  onShowDetails,
  onHide,
}: {
  snapshot: AlmanacSnapshot | null;
  onShowDetails: () => void;
  onHide: () => void;
}) {
  const date = snapshot?.date ?? "";
  const day = date.slice(-2);

  useEffect(() => {
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHide();
    };
    window.addEventListener("keydown", hideOnEscape);
    return () => window.removeEventListener("keydown", hideOnEscape);
  }, [onHide]);

  if (!snapshot) {
    return <PaperShell className="tray-card"><AlmanacStatus message="正在生成今日黄历…" /></PaperShell>;
  }

  if (snapshot.status === "error") {
    const [year, month, solarDay] = snapshot.date.split("-").map(Number);
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" })
      .format(new Date(year, month - 1, solarDay));
    return (
      <PaperShell className="tray-card">
        <header className="paper-header"><span className="seal">历</span><span>今日</span></header>
        <p className="date-hero">{day}</p>
        <p className="date-meta">{month}月 · {weekday}</p>
        <AlmanacStatus message={snapshot.message} />
        <footer className="paper-footer"><span>本地计算 · 无缓存</span></footer>
      </PaperShell>
    );
  }

  const { data } = snapshot;
  const summary = createCardSummary(data.suitable, data.avoid);
  const note = [data.solarTerm, ...data.festivals, data.clash, data.sha].filter(Boolean).join(" · ");

  return (
    <PaperShell className="tray-card">
      <header className="paper-header"><span className="seal">历</span><span>今日 · 已更新</span></header>
      <p className="date-hero">{String(data.solarDay).padStart(2, "0")}</p>
      <p className="date-meta">{data.solarMonth}月 · {data.weekday}</p>
      <p className="lunar-meta">{data.lunarDate} · {data.ganzhiYear}年 · 生肖{data.zodiac}</p>
      <div className="paper-rule" />
      <p className="section-label">今日简要</p>
      <div className="tag-row">
        {summary.suitable.map((item) => <span className="tag" key={`yi-${item}`}>宜 {item}</span>)}
        {summary.avoid.map((item) => <span className="tag tag--avoid" key={`ji-${item}`}>忌 {item}</span>)}
      </div>
      {note && <p className="card-note">{note}</p>}
      <footer className="paper-footer">
        <span>本地计算 · 无缓存</span>
        <button className="paper-button" onClick={onShowDetails}>查看详情</button>
      </footer>
    </PaperShell>
  );
}
```

Append the complete card visual rules to `src/styles.css`:

```css
.paper-shell {
  position: relative;
  overflow: hidden;
  color: #3b2b20;
  background-color: #dfc69e;
  background-image:
    linear-gradient(90deg, rgb(90 60 35 / 3.2%) 1px, transparent 1px),
    linear-gradient(rgb(90 60 35 / 3.2%) 1px, transparent 1px);
  background-size: 12px 12px;
  border: 1px solid #b89768;
}

.paper-shell::after {
  content: "";
  position: absolute;
  inset: 10px;
  border: 1px solid rgb(109 71 42 / 24%);
  pointer-events: none;
}

.tray-card { min-height: 500px; padding: 24px; }
.paper-header, .paper-footer { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; color: #6d4d34; font-size: 12px; }
.seal { display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border: 2px solid #8c2822; color: #8c2822; font-family: serif; font-weight: 700; }
.date-hero { position: relative; z-index: 1; margin: 28px 0 2px; color: #8c2822; font: 76px/.95 Georgia, serif; }
.date-meta, .lunar-meta, .card-note, .section-label, .tag-row { position: relative; z-index: 1; }
.date-meta, .lunar-meta { margin: 4px 0; font-size: 14px; line-height: 1.6; }
.paper-rule { position: relative; z-index: 1; height: 1px; margin: 18px 0; background: #b8986d; }
.section-label { margin: 0 0 9px; color: #715239; font-size: 11px; letter-spacing: .14em; }
.tag-row { display: flex; flex-wrap: wrap; gap: 7px; }
.tag { padding: 6px 9px; border: 1px solid #a8875d; background: rgb(255 250 235 / 22%); font-size: 12px; }
.tag--avoid { color: #79231f; }
.card-note { color: #644a36; font-size: 12px; line-height: 1.7; }
.paper-footer { position: absolute; right: 24px; bottom: 20px; left: 24px; }
.paper-button { position: relative; z-index: 2; border: 0; padding: 9px 14px; color: #f5e8d4; background: #432e21; cursor: pointer; }
.almanac-status { position: relative; z-index: 1; line-height: 1.7; }
```

- [x] **Step 4: Run card tests and build**

```powershell
npm.cmd run test:run -- src/views/TrayCard.test.tsx
npm.cmd run build
```

Expected: four card tests pass and the TypeScript build succeeds.

- [x] **Step 5: Commit the tray card**

```powershell
git add src/components src/views/TrayCard.tsx src/views/TrayCard.test.tsx src/styles.css
git commit -m "feat: add tray almanac card"
```

### Task 6: Build the full daily detail window

**Files:**
- Create: `src/views/DailyDetail.tsx`
- Create: `src/views/DailyDetail.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing detail tests**

Create `src/views/DailyDetail.test.tsx` using the Task 5 ready fixture and assert:

```tsx
import { render, screen } from "@testing-library/react";
import type { AlmanacSnapshot } from "../almanac/types";
import { DailyDetail } from "./DailyDetail";

const snapshot = {
  status: "ready",
  date: "2026-08-06",
  data: {
    date: "2026-08-06",
    solarYear: 2026,
    solarMonth: 8,
    solarDay: 6,
    weekday: "星期四",
    lunarDate: "六月廿四",
    ganzhiYear: "丙午",
    ganzhiMonth: "乙未",
    ganzhiDay: "壬子",
    zodiac: "马",
    solarTerm: "立秋",
    festivals: [],
    suitable: ["出行", "会友", "整理"],
    avoid: ["动土", "迁居"],
    clash: "冲马",
    sha: "煞南",
    hours: [{
      label: "子时",
      range: "23:00–00:59",
      level: "auspicious",
      suitable: ["祈福"],
      avoid: [],
    }],
  },
} satisfies AlmanacSnapshot;

describe("DailyDetail", () => {
  it("renders complete daily fields and cultural disclaimer", () => {
    render(<DailyDetail snapshot={snapshot} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "2026年8月6日" })).toBeInTheDocument();
    expect(screen.getByText("丙午年 · 乙未月 · 壬子日")).toBeInTheDocument();
    expect(screen.getByText("冲马 · 煞南")).toBeInTheDocument();
    expect(screen.getByText("子时")).toBeInTheDocument();
    expect(screen.getByText(/传统民俗信息仅供文化参考/)).toBeInTheDocument();
  });

  it("hides missing optional sections", () => {
    const partial = { ...snapshot, data: { ...snapshot.data, solarTerm: undefined, clash: undefined, sha: undefined } };
    render(<DailyDetail snapshot={partial} onOpenSettings={vi.fn()} />);
    expect(screen.queryByText("冲煞")).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the detail test and verify it fails**

```powershell
npm.cmd run test:run -- src/views/DailyDetail.test.tsx
```

Expected: FAIL because `DailyDetail.tsx` does not exist.

- [x] **Step 3: Implement the detail view**

Create `src/views/DailyDetail.tsx`:

```tsx
import type { AlmanacSnapshot } from "../almanac/types";
import { AlmanacStatus } from "../components/AlmanacStatus";
import { PaperShell } from "../components/PaperShell";

export function DailyDetail({
  snapshot,
  onOpenSettings,
}: {
  snapshot: AlmanacSnapshot | null;
  onOpenSettings: () => void;
}) {
  if (!snapshot) return <PaperShell className="detail"><AlmanacStatus message="正在生成今日黄历…" /></PaperShell>;
  if (snapshot.status === "error") return <PaperShell className="detail"><AlmanacStatus message={snapshot.message} /></PaperShell>;

  const { data } = snapshot;
  const clash = [data.clash, data.sha].filter(Boolean).join(" · ");

  return (
    <PaperShell className="detail">
      <header className="detail-header">
        <span className="seal">历</span>
        <button className="text-button" onClick={onOpenSettings}>设置</button>
      </header>
      <div className="detail-title">
        <p className="detail-day">{String(data.solarDay).padStart(2, "0")}</p>
        <div>
          <h1>{data.solarYear}年{data.solarMonth}月{data.solarDay}日</h1>
          <p>{data.weekday} · 农历{data.lunarDate} · 生肖{data.zodiac}</p>
          <p>{data.ganzhiYear}年 · {data.ganzhiMonth}月 · {data.ganzhiDay}日</p>
        </div>
      </div>
      {(data.solarTerm || data.festivals.length > 0) && <p>{[data.solarTerm, ...data.festivals].filter(Boolean).join(" · ")}</p>}
      <div className="yi-grid">
        <section><h2>宜</h2><p>{data.suitable.length ? data.suitable.join("　") : "未列出"}</p></section>
        <section><h2>忌</h2><p>{data.avoid.length ? data.avoid.join("　") : "未列出"}</p></section>
      </div>
      {clash && <section className="fact"><h2>冲煞</h2><p>{clash}</p></section>}
      {data.hours.length > 0 && (
        <section>
          <h2>时辰详情</h2>
          <div className="hours-grid">
            {data.hours.map((hour) => (
              <article className={`hour hour--${hour.level}`} key={`${hour.label}-${hour.range}`}>
                <h3>{hour.label}</h3><p>{hour.range}</p>
                <p>宜：{hour.suitable.length ? hour.suitable.join("、") : "未列出"}</p>
                <p>忌：{hour.avoid.length ? hour.avoid.join("、") : "未列出"}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="disclaimer">传统民俗信息仅供文化参考，请勿作为医疗、法律、财务或其他重要决定的依据。</p>
    </PaperShell>
  );
}
```

Append to `src/styles.css`:

```css
.detail { min-height: 100vh; padding: 28px 32px; overflow-y: auto; }
.detail-header { position: relative; z-index: 1; display: flex; justify-content: space-between; }
.text-button { border: 0; color: #5f432f; background: transparent; cursor: pointer; }
.detail-title { position: relative; z-index: 1; display: flex; gap: 18px; align-items: end; margin: 22px 0; }
.detail-title h1 { margin: 0 0 8px; font-size: 20px; }
.detail-title p { margin: 4px 0; }
.detail-day { margin: 0; color: #8c2822; font: 66px/.9 Georgia, serif; }
.yi-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.yi-grid section, .fact { border: 1px solid #ad8c61; padding: 14px; background: rgb(255 250 235 / 18%); }
.yi-grid h2, .fact h2 { margin-top: 0; color: #802821; font-size: 18px; }
.hours-grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.hour { border: 1px solid #aa895e; padding: 10px; background: rgb(255 250 235 / 14%); font-size: 11px; }
.hour h3, .hour p { margin: 4px 0; }
.hour--auspicious h3 { color: #285a42; }
.hour--inauspicious h3 { color: #7b2823; }
.disclaimer { position: relative; z-index: 1; margin-top: 24px; color: #785d45; font-size: 10px; text-align: center; }
```

- [x] **Step 4: Run detail tests and build**

```powershell
npm.cmd run test:run -- src/views/DailyDetail.test.tsx
npm.cmd run build
```

Expected: detail tests pass and build succeeds.

- [x] **Step 5: Commit the detail view**

```powershell
git add src/views/DailyDetail.tsx src/views/DailyDetail.test.tsx src/styles.css
git commit -m "feat: add daily almanac detail"
```

### Task 7: Add first-run autostart consent and settings

**Files:**
- Create: `src/components/FirstRunPrompt.tsx`
- Create: `src/components/FirstRunPrompt.test.tsx`
- Create: `src/views/SettingsView.tsx`
- Create: `src/views/SettingsView.test.tsx`
- Modify: `src/styles.css`

- [x] **Step 1: Write failing consent and settings tests**

Create `src/components/FirstRunPrompt.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRunPrompt } from "./FirstRunPrompt";

describe("FirstRunPrompt", () => {
  it("enables autostart only after explicit consent", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunPrompt onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: "开启" }));
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("treats closing as temporarily disabled", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunPrompt onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("keeps the prompt open and explains an autostart failure", async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error("denied"));
    render(<FirstRunPrompt onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: "开启" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("未能开启开机自启动，请稍后重试");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

Create `src/views/SettingsView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("restores the real switch state when enabling fails", async () => {
    const setAutostart = vi.fn().mockRejectedValue(new Error("denied"));
    render(<SettingsView enabled={false} setAutostart={setAutostart} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).not.toBeChecked();
    expect(screen.getByText("未能开启开机自启动，请稍后重试")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the tests and verify the components are missing**

```powershell
npm.cmd run test:run -- src/components/FirstRunPrompt.test.tsx src/views/SettingsView.test.tsx
```

Expected: FAIL because both components are missing.

- [x] **Step 3: Implement explicit consent and truthful settings state**

Create `src/components/FirstRunPrompt.tsx`:

```tsx
import { useState } from "react";

export function FirstRunPrompt({ onComplete }: { onComplete: (enabled: boolean) => Promise<void> }) {
  const [error, setError] = useState("");

  async function complete(enabled: boolean) {
    setError("");
    try {
      await onComplete(enabled);
    } catch {
      setError(enabled
        ? "未能开启开机自启动，请稍后重试"
        : "未能关闭开机自启动，请稍后重试");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="autostart-title">
        <h2 id="autostart-title">开机时自动启动电子黄历？</h2>
        <p>开启后应用会静默进入系统托盘，不会自动弹出窗口。</p>
        <div className="modal-actions">
          <button className="paper-button" onClick={() => void complete(true)}>开启</button>
          <button className="text-button" onClick={() => void complete(false)}>暂不开启</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
```

Create `src/views/SettingsView.tsx`:

```tsx
import { useEffect, useState } from "react";

export function SettingsView({
  enabled,
  setAutostart,
  onBack,
  externalError = "",
}: {
  enabled: boolean;
  setAutostart: (enabled: boolean) => Promise<boolean>;
  onBack: () => void;
  externalError?: string;
}) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState("");

  useEffect(() => setChecked(enabled), [enabled]);

  async function change(next: boolean) {
    const previous = checked;
    setError("");
    try {
      setChecked(await setAutostart(next));
    } catch {
      setChecked(previous);
      setError(next ? "未能开启开机自启动，请稍后重试" : "未能关闭开机自启动，请稍后重试");
    }
  }

  return (
    <section className="settings">
      <button className="text-button" onClick={onBack}>返回今日黄历</button>
      <h1>设置</h1>
      <label className="setting-row">
        <span><strong>开机自启动</strong><small>登录 Windows 后静默进入系统托盘</small></span>
        <input aria-label="开机自启动" type="checkbox" checked={checked} onChange={(event) => void change(event.target.checked)} />
      </label>
      {(error || externalError) && <p role="alert">{error || externalError}</p>}
      <section><h2>关于</h2><p>电子黄历 v0.1.0 · 本地计算 · 不联网</p></section>
    </section>
  );
}
```

Append modal and settings CSS to `src/styles.css`:

```css
.modal-backdrop { position: fixed; z-index: 10; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(41 27 18 / 45%); }
.modal { max-width: 420px; border: 1px solid #a8875d; padding: 24px; background: #ead6b4; box-shadow: 0 18px 48px rgb(41 27 18 / 30%); }
.modal-actions { display: flex; gap: 14px; align-items: center; justify-content: flex-end; margin-top: 20px; }
.settings { min-height: 100vh; padding: 28px 32px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; border-block: 1px solid #ad8c61; padding: 18px 0; }
.setting-row small { display: block; margin-top: 6px; color: #76593f; }
```

- [x] **Step 4: Run first-run and settings tests**

```powershell
npm.cmd run test:run -- src/components/FirstRunPrompt.test.tsx src/views/SettingsView.test.tsx
```

Expected: all tests pass.

- [x] **Step 5: Commit settings UI**

```powershell
git add src/components/FirstRunPrompt.tsx src/components/FirstRunPrompt.test.tsx src/views/SettingsView.tsx src/views/SettingsView.test.tsx src/styles.css
git commit -m "feat: add autostart consent settings"
```

### Task 8: Compose both React windows around the shared snapshot

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/main.tsx`

- [x] **Step 1: Replace the bootstrap test with failing window-role tests**

Update `src/App.test.tsx` to use `createMemoryDesktopBridge()` and verify:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createMemoryDesktopBridge } from "./desktop/desktopBridge";

describe("App windows", () => {
  it("runs the calculation owner in the tray card window", async () => {
    const bridge = createMemoryDesktopBridge();
    render(<App view="tray-card" bridge={bridge} />);
    await waitFor(() => expect(screen.getByText("本地计算 · 无缓存")).toBeInTheDocument());
  });

  it("opens the first-run consent only once in the main window", async () => {
    const bridge = createMemoryDesktopBridge();
    render(<App view="main" bridge={bridge} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens settings and shows a tray autostart error", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    render(<App view="main" bridge={bridge} />);
    await bridge.requestSettings("未能开启开机自启动，请稍后重试");
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未能开启开机自启动，请稍后重试");
  });

  it("returns from settings to the daily detail when the tray requests it", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    render(<App view="main" bridge={bridge} />);
    await bridge.requestSettings();
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    await bridge.showDetails();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "设置" })).not.toBeInTheDocument());
  });
});
```

- [x] **Step 2: Run the app tests and verify the old App API fails**

```powershell
npm.cmd run test:run -- src/App.test.tsx
```

Expected: FAIL because `App` does not accept `bridge` or render the window views.

- [x] **Step 3: Implement window composition**

Update `src/App.tsx` so the tray-card view owns `LocalAlmanacProvider` and `AlmanacCoordinator`, while the main view subscribes to the Rust-memory snapshot. The implementation must:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { AlmanacSnapshot } from "./almanac/types";
import { LocalAlmanacProvider } from "./almanac/localAlmanacProvider";
import { AlmanacCoordinator } from "./app/almanacCoordinator";
import { FirstRunPrompt } from "./components/FirstRunPrompt";
import type { DesktopBridge } from "./desktop/desktopBridge";
import { tauriDesktopBridge } from "./desktop/desktopBridge";
import { DailyDetail } from "./views/DailyDetail";
import { SettingsView } from "./views/SettingsView";
import { TrayCard } from "./views/TrayCard";

export type WindowView = "tray-card" | "main";

function useSnapshot(bridge: DesktopBridge) {
  const [snapshot, setSnapshot] = useState<AlmanacSnapshot | null>(null);
  useEffect(() => {
    let unlisten = () => undefined;
    void bridge.getSnapshot().then((value) => value && setSnapshot(value));
    void bridge.subscribeSnapshot(setSnapshot).then((stop) => { unlisten = stop; });
    return () => unlisten();
  }, [bridge]);
  return snapshot;
}

export function App({ view, bridge = tauriDesktopBridge }: { view: WindowView; bridge?: DesktopBridge }) {
  const snapshot = useSnapshot(bridge);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [promptSeen, setPromptSeen] = useState(true);
  const [autostart, setAutostartState] = useState(false);

  const coordinator = useMemo(() => new AlmanacCoordinator(
    new LocalAlmanacProvider(),
    (value) => bridge.publishSnapshot(value),
  ), [bridge]);

  useEffect(() => {
    if (view !== "tray-card") return;
    coordinator.start();
    let stopRefresh = () => undefined;
    void bridge.subscribeRefreshRequest(() => void coordinator.ensureToday()).then((stop) => { stopRefresh = stop; });
    return () => { stopRefresh(); coordinator.stop(); };
  }, [bridge, coordinator, view]);

  useEffect(() => {
    if (view !== "main") return;
    let stopSettings = () => undefined;
    let stopDetails = () => undefined;
    void Promise.all([bridge.getPromptSeen(), bridge.getAutostart()]).then(([seen, enabled]) => {
      setPromptSeen(seen);
      setAutostartState(enabled);
    });
    void bridge.subscribeSettingsRequest((errorMessage) => {
      setSettingsError(errorMessage ?? "");
      setSettingsOpen(true);
    }).then((stop) => { stopSettings = stop; });
    void bridge.subscribeDetailsRequest(() => {
      setSettingsError("");
      setSettingsOpen(false);
    }).then((stop) => { stopDetails = stop; });
    void bridge.requestRefresh();
    return () => { stopSettings(); stopDetails(); };
  }, [bridge, view]);

  if (view === "tray-card") {
    return <TrayCard
      snapshot={snapshot}
      onShowDetails={() => void bridge.showDetails()}
      onHide={() => void bridge.hideCard()}
    />;
  }

  async function completePrompt(enabled: boolean) {
    setAutostartState(await bridge.completePrompt(enabled));
    setPromptSeen(true);
  }

  async function changeAutostart(enabled: boolean) {
    try {
      const actual = await bridge.setAutostart(enabled);
      setAutostartState(actual);
      return actual;
    } catch (error) {
      setAutostartState(await bridge.getAutostart());
      throw error;
    }
  }

  return (
    <main className="main-window">
      {settingsOpen
        ? <SettingsView
            enabled={autostart}
            setAutostart={changeAutostart}
            externalError={settingsError}
            onBack={() => { setSettingsError(""); setSettingsOpen(false); }}
          />
        : <DailyDetail snapshot={snapshot} onOpenSettings={() => { setSettingsError(""); setSettingsOpen(true); }} />}
      {!promptSeen && <FirstRunPrompt onComplete={completePrompt} />}
    </main>
  );
}
```

Update `src/main.tsx` only to pass the parsed view; keep the existing query parsing and styles import.

- [x] **Step 4: Run all frontend tests and build**

```powershell
npm.cmd run test:run
npm.cmd run build
```

Expected: all tests and TypeScript build pass. The existing coordinator test proves that repeated start/focus requests do not recalculate the same local date, including React StrictMode's development cleanup/restart cycle.

- [x] **Step 5: Commit React integration**

```powershell
git add src/App.tsx src/App.test.tsx src/main.tsx
git commit -m "feat: compose almanac windows"
```

### Task 9: Add the Tauri project, plugins, memory state, and settings commands

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/almanac_state.rs`
- Create: `src-tauri/src/settings.rs`

- [x] **Step 1: Write Rust unit tests for state replacement and setting fallback**

In `src-tauri/src/almanac_state.rs`, start with tests against pure helpers:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_state_replaces_the_previous_day() {
        let state = AlmanacState::default();
        state.set(json!({"date":"2026-08-06"}));
        state.set(json!({"date":"2026-08-07"}));
        assert_eq!(state.get().unwrap()["date"], "2026-08-07");
    }
}
```

Run after the Cargo scaffold exists:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml almanac_state
```

Expected initially: FAIL because `AlmanacState` is not implemented.

Also start `src-tauri/src/settings.rs` with pure fallback tests before adding Tauri commands:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_invalid_prompt_setting_means_not_seen() {
        assert!(!prompt_seen_value(None));
        assert!(!prompt_seen_value(Some(&json!("broken"))));
        assert!(prompt_seen_value(Some(&json!(true))));
    }
}
```

Run `cargo test --manifest-path src-tauri/Cargo.toml settings`; expected initially: FAIL because `prompt_seen_value` is missing.

- [x] **Step 2: Create the Tauri Cargo and build configuration**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "electronic-almanac"
version = "0.1.0"
description = "A lightweight local Windows electronic almanac"
authors = ["PAIDA"]
edition = "2021"

[lib]
name = "electronic_almanac_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-autostart = "2"
tauri-plugin-positioner = { version = "2", features = ["tray-icon"] }
tauri-plugin-single-instance = "2"
tauri-plugin-store = "2"
```

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    electronic_almanac_lib::run();
}
```

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "电子黄历",
  "version": "0.1.0",
  "identifier": "com.paida.electronic-almanac",
  "build": {
    "beforeDevCommand": "npm.cmd run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm.cmd run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "tray-card",
        "title": "今日黄历",
        "url": "index.html?view=tray-card",
        "width": 360,
        "height": 500,
        "visible": false,
        "decorations": false,
        "resizable": false,
        "alwaysOnTop": true,
        "skipTaskbar": true
      },
      {
        "label": "main",
        "title": "电子黄历",
        "url": "index.html?view=main",
        "width": 620,
        "height": 760,
        "minWidth": 560,
        "minHeight": 680,
        "visible": false,
        "center": true
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ],
    "windows": {
      "nsis": { "installMode": "currentUser" }
    }
  }
}
```

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for both local almanac windows",
  "windows": ["tray-card", "main"],
  "permissions": ["core:default"]
}
```

- [x] **Step 3: Implement process-memory snapshot commands**

Create `src-tauri/src/almanac_state.rs`:

```rust
use std::sync::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AlmanacState(Mutex<Option<Value>>);

impl AlmanacState {
    pub fn set(&self, value: Value) {
        *self.0.lock().expect("almanac state lock poisoned") = Some(value);
    }

    pub fn get(&self) -> Option<Value> {
        self.0.lock().expect("almanac state lock poisoned").clone()
    }
}

#[tauri::command]
pub fn publish_almanac_snapshot(
    app: AppHandle,
    state: State<'_, AlmanacState>,
    snapshot: Value,
) -> Result<(), String> {
    state.set(snapshot.clone());
    app.emit("almanac://updated", snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_almanac_snapshot(state: State<'_, AlmanacState>) -> Option<Value> {
    state.get()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_state_replaces_the_previous_day() {
        let state = AlmanacState::default();
        state.set(json!({"date":"2026-08-06"}));
        state.set(json!({"date":"2026-08-07"}));
        assert_eq!(state.get().unwrap()["date"], "2026-08-07");
    }
}
```

- [x] **Step 4: Implement settings and truthful autostart commands**

Create `src-tauri/src/settings.rs`. Resolve only the exact `settings.json` path inside Tauri's app-data directory. If opening it reports malformed JSON, delete only that exact file and reopen an empty store so the app falls back to `autostartPromptSeen = false`; do not create a backup artifact or touch any other app-data file.

```rust
use std::sync::Arc;
use tauri::{menu::CheckMenuItem, AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::{Store, StoreExt};

pub const SETTINGS_FILE: &str = "settings.json";
pub const PROMPT_SEEN_KEY: &str = "autostartPromptSeen";

pub struct AutostartMenuItem(pub CheckMenuItem<Wry>);

fn prompt_seen_value(value: Option<&serde_json::Value>) -> bool {
    value.and_then(|value| value.as_bool()).unwrap_or(false)
}

fn open_settings(app: &AppHandle) -> Result<Arc<Store<Wry>>, String> {
    match app.store(SETTINGS_FILE) {
        Ok(store) => Ok(store),
        Err(_) => {
            let path = app.path().app_data_dir()
                .map_err(|error| error.to_string())?
                .join(SETTINGS_FILE);
            if path.is_file() {
                std::fs::remove_file(&path).map_err(|error| error.to_string())?;
            }
            app.store(SETTINGS_FILE).map_err(|error| error.to_string())
        }
    }
}

fn mark_prompt_seen(app: &AppHandle) -> Result<(), String> {
    let store = open_settings(app)?;
    store.set(PROMPT_SEEN_KEY, true);
    store.save().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_prompt_seen(app: AppHandle) -> Result<bool, String> {
    let store = open_settings(&app)?;
    Ok(prompt_seen_value(store.get(PROMPT_SEEN_KEY).as_ref()))
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|error| error.to_string())
}

pub(crate) fn set_autostart_value(
    app: &AppHandle,
    menu: &AutostartMenuItem,
    enabled: bool,
) -> Result<bool, String> {
    let manager = app.autolaunch();
    let operation = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = operation {
        let actual = manager.is_enabled().unwrap_or(!enabled);
        let _ = menu.0.set_checked(actual);
        return Err(error.to_string());
    }
    let actual = manager.is_enabled().map_err(|error| error.to_string())?;
    let _ = menu.0.set_checked(actual);
    Ok(actual)
}

#[tauri::command]
pub fn set_autostart(
    app: AppHandle,
    menu: State<'_, AutostartMenuItem>,
    enabled: bool,
) -> Result<bool, String> {
    set_autostart_value(&app, &menu, enabled)
}

#[tauri::command]
pub fn complete_autostart_prompt(
    app: AppHandle,
    menu: State<'_, AutostartMenuItem>,
    enabled: bool,
) -> Result<bool, String> {
    let actual = set_autostart_value(&app, &menu, enabled)?;
    mark_prompt_seen(&app)?;
    Ok(actual)
}

pub fn decline_prompt_on_window_close(app: &AppHandle) -> Result<(), String> {
    if get_prompt_seen(app.clone())? {
        return Ok(());
    }
    if let Some(menu) = app.try_state::<AutostartMenuItem>() {
        if let Err(error) = set_autostart_value(app, &menu, false) {
            let _ = app.emit("app://open-settings", Some(format!(
                "未能关闭开机自启动，请稍后重试：{error}"
            )));
        }
    }
    mark_prompt_seen(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_invalid_prompt_setting_means_not_seen() {
        assert!(!prompt_seen_value(None));
        assert!(!prompt_seen_value(Some(&json!("broken"))));
        assert!(prompt_seen_value(Some(&json!(true))));
    }
}
```

- [x] **Step 5: Run Rust state tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml almanac_state
cargo test --manifest-path src-tauri/Cargo.toml settings
```

Expected: state replacement and settings fallback tests pass after Cargo downloads dependencies.

- [x] **Step 6: Commit the Tauri foundation**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/main.rs src-tauri/src/almanac_state.rs src-tauri/src/settings.rs
git commit -m "feat: add tauri almanac foundation"
```

### Task 10: Implement tray behavior, window lifecycle, and single instance

**Files:**
- Create: `src-tauri/src/tray.rs`
- Create: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/settings.rs`

- [x] **Step 1: Add a failing pure test for card visibility toggling**

Start `src-tauri/src/tray.rs` with a pure state decision:

```rust
#[derive(Debug, PartialEq, Eq)]
pub enum CardAction { Show, Hide }

pub fn next_card_action(is_visible: bool) -> CardAction {
    if is_visible { CardAction::Hide } else { CardAction::Show }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_click_toggles_card_visibility() {
        assert_eq!(next_card_action(false), CardAction::Show);
        assert_eq!(next_card_action(true), CardAction::Hide);
    }
}
```

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tray_click_toggles_card_visibility
```

Expected: FAIL until `tray.rs` is included from `lib.rs`.

- [x] **Step 2: Implement tray creation and window commands**

Complete `src-tauri/src/tray.rs` with:

```rust
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_positioner::{Position, WindowExt};

use crate::settings::{self, AutostartMenuItem};

#[derive(Debug, PartialEq, Eq)]
pub enum CardAction { Show, Hide }

pub fn next_card_action(is_visible: bool) -> CardAction {
    if is_visible { CardAction::Hide } else { CardAction::Show }
}

pub fn show_card(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("tray-card").ok_or("tray-card window missing")?;
    if window.move_window_constrained(Position::TrayCenter).is_err() {
        window.move_window_constrained(Position::BottomRight)
            .map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn hide_card(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("tray-card").ok_or("tray-card window missing")?;
    window.hide().map_err(|error| error.to_string())
}

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("main window missing")?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn build_tray(app: &mut App) -> tauri::Result<()> {
    let autostart = CheckMenuItemBuilder::new("开机自启动")
        .id("autostart")
        .checked(app.autolaunch().is_enabled().unwrap_or(false))
        .build(app)?;
    let show = MenuItemBuilder::with_id("show", "查看今日黄历").build(app)?;
    let about = MenuItemBuilder::with_id("about", "关于").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "彻底退出").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &autostart, &about, &separator, &quit])
        .build()?;
    app.manage(AutostartMenuItem(autostart.clone()));

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("application icon missing").clone())
        .tooltip("电子黄历")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => { let _ = show_details(app.clone()); }
            "about" => {
                let _ = app.emit("app://open-settings", Option::<String>::None);
                let _ = show_main(app);
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                let menu = app.state::<AutostartMenuItem>();
                if settings::set_autostart_value(app, &menu, !enabled).is_err() {
                    let message = if enabled {
                        "未能关闭开机自启动，请稍后重试"
                    } else {
                        "未能开启开机自启动，请稍后重试"
                    };
                    let _ = app.emit("app://open-settings", Some(message.to_string()));
                    let _ = show_main(app);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                if let Some(window) = tray.app_handle().get_webview_window("tray-card") {
                    let visible = window.is_visible().unwrap_or(false);
                    match next_card_action(visible) {
                        CardAction::Show => { let _ = show_card(tray.app_handle()); }
                        CardAction::Hide => { let _ = hide_card(tray.app_handle()); }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
pub fn show_details(app: AppHandle) -> Result<(), String> {
    hide_card(&app)?;
    app.emit("app://show-details", ()).map_err(|error| error.to_string())?;
    show_main(&app)
}

#[tauri::command]
pub fn hide_tray_card(app: AppHandle) -> Result<(), String> {
    hide_card(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_click_toggles_card_visibility() {
        assert_eq!(next_card_action(false), CardAction::Show);
        assert_eq!(next_card_action(true), CardAction::Hide);
    }
}
```

- [x] **Step 3: Wire plugins, commands, first-run display, blur hiding, and close-to-hide**

Create `src-tauri/src/lib.rs`:

```rust
mod almanac_state;
mod settings;
mod tray;

use almanac_state::AlmanacState;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = tray::show_card(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AlmanacState::default())
        .invoke_handler(tauri::generate_handler![
            almanac_state::publish_almanac_snapshot,
            almanac_state::get_almanac_snapshot,
            settings::get_prompt_seen,
            settings::get_autostart,
            settings::set_autostart,
            settings::complete_autostart_prompt,
            tray::show_details,
            tray::hide_tray_card,
        ])
        .setup(|app| {
            tray::build_tray(app)?;
            let seen = settings::get_prompt_seen(app.handle().clone())
                .unwrap_or(false);
            if !seen {
                tray::show_main(app.handle()).map_err(|message| std::io::Error::other(message))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == "tray-card" => {
                let _ = window.hide();
            }
            WindowEvent::Focused(true) => {
                let _ = window.app_handle().emit("almanac://refresh-requested", ());
            }
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = settings::decline_prompt_on_window_close(window.app_handle());
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running electronic almanac");
}
```

The checked-in `Cargo.lock` and `cargo check` output are authoritative for the selected Tauri 2 APIs. Any compile correction must preserve the event names, window labels, behavior, and command names shown here and must be covered by the same tests before commit.

- [ ] **Step 4: Verify one managed tray checkbox is the only UI copy of OS state**

The `AutostartMenuItem` state created in Step 2 is mandatory. Both the React settings command and the tray menu call `settings::set_autostart_value`, which re-queries the OS and updates this same item. Add no second stored autostart boolean. Confirm with a manual toggle in each UI direction and verify the other UI reflects the real OS state when reopened.

- [x] **Step 5: Run Rust tests and compile checks**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: unit tests pass and the Tauri crate compiles with no errors.

- [ ] **Step 6: Run the desktop app for manual interaction smoke**

```powershell
npm.cmd run tauri:dev
```

Verify:

- First run opens the consent prompt.
- Closing the untouched first-run window marks the prompt answered as disabled; the next launch stays silent.
- Closing the main window hides it but leaves one tray icon.
- Left-click toggles the card; card blur and `Esc` hide it.
- Right-click menu does not trigger left-click behavior.
- “关于” opens the settings/about view.
- Test the card with the taskbar on all four screen edges, on a secondary monitor, and at 100%, 125%, 150%, 175%, and 200% scaling. `TrayCenter` must stay inside the visible work area; force the tray-anchor call to fail once and verify the constrained bottom-right fallback remains visible.
- “彻底退出” ends the process.
- Launching a second instance focuses the existing app and does not add another tray icon.

- [x] **Step 7: Commit desktop lifecycle**

```powershell
git add src-tauri/src src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add tray desktop lifecycle"
```

### Task 11: Add the app icon, installer documentation, and full verification

**Files:**
- Create: `src-tauri/icons/app-icon.svg`
- Generate: `src-tauri/icons/32x32.png`
- Generate: `src-tauri/icons/128x128.png`
- Generate: `src-tauri/icons/128x128@2x.png`
- Generate: `src-tauri/icons/icon.ico`
- Create: `README.md`
- Modify: `.gitignore`

- [x] **Step 1: Add the approved seal-style vector source**

Create `src-tauri/icons/app-icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#dfc69e"/>
  <rect x="56" y="56" width="400" height="400" rx="52" fill="none" stroke="#8c2822" stroke-width="28"/>
  <path d="M150 170h212M150 250h212M150 330h212" stroke="#8c2822" stroke-width="22" stroke-linecap="round"/>
  <text x="256" y="322" text-anchor="middle" font-size="190" font-family="serif" font-weight="700" fill="#432e21">历</text>
</svg>
```

Generate platform icons:

```powershell
npm.cmd run tauri icon src-tauri/icons/app-icon.svg
```

Expected: the PNG and ICO paths listed in `tauri.conf.json` exist.

- [x] **Step 2: Add user-facing run and privacy documentation**

Create `README.md` with these exact sections and commands:

````markdown
# 电子黄历

一个本地计算、开机后静默常驻系统托盘的 Windows 电子黄历。

## 首版能力

- 托盘极简今日卡片
- 当日完整黄历详情
- 农历、干支、生肖、节气、节日、宜忌、冲煞和时辰详情
- 首次启动询问开机自启动
- 完全离线运行，不保存逐日黄历缓存

传统民俗信息仅供文化参考，请勿作为医疗、法律、财务或其他重要决定的依据。

## 开发

```powershell
npm.cmd install
npm.cmd run test:run
npm.cmd run build
cargo check --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri:dev
```

## Windows 安装包

```powershell
npm.cmd run tauri:build
```

NSIS 安装包输出在 `src-tauri/target/release/bundle/nsis/`。

## 本地数据

应用不联网、不使用数据库，也不保存每日黄历。应用数据目录只保存首次询问状态等小型设置。
````

- [x] **Step 3: Ensure generated and local-only files stay out of Git**

Append only missing entries to `.gitignore`:

```gitignore
src-tauri/gen/
*.log
```

Do not ignore generated application icons; they are required for reproducible installers.

- [x] **Step 4: Run the complete automatic verification suite**

```powershell
npm.cmd run test:run
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: every command exits 0 and `git diff --check` prints nothing.

- [x] **Step 5: Build the NSIS installer**

```powershell
npm.cmd run tauri:build
```

Expected: a `电子黄历_0.1.0_x64-setup.exe`-style file exists under `src-tauri/target/release/bundle/nsis/`, and the release binary starts without a console window.

- [ ] **Step 6: Perform the approved Windows installer smoke**

Use a normal Windows user account and record each result:

1. Install without administrator elevation.
2. Confirm the first-run autostart question appears once.
3. Choose “开启”, sign out and back in, and confirm only one tray icon appears with no automatic window.
4. Left-click card show/hide, `Esc`, blur hiding, right-click menu, detail open/close, and explicit exit.
5. Disable networking and confirm full almanac content still appears.
6. Inspect the app data directory and confirm only a small settings file exists; no date-named cache files appear after changing the system date in a test environment.
7. Uninstall and confirm application files and the autostart registration are removed.

- [x] **Step 7: Commit release readiness**

```powershell
git add .gitignore README.md src-tauri/icons src-tauri/tauri.conf.json
git commit -m "docs: prepare electronic almanac release"
```

### Task 12: Final regression, spec audit, and handoff

**Files:**
- Keep product files unchanged unless a regression command exposes a defect directly covered by the approved specification; fix that defect with a failing test in its owning task before rerunning this audit.
- Update: `docs/superpowers/plans/2026-08-06-electronic-almanac-implementation.md` checkboxes as tasks complete.

- [x] **Step 1: Audit implementation against every design requirement**

Confirm each section of `docs/superpowers/specs/2026-08-06-electronic-almanac-design.md` maps to implemented code or an explicit first-version non-goal. Pay special attention to:

- Silent subsequent startup.
- Explicit first-run consent.
- One calculation owner and one in-memory snapshot.
- No daily cache or database.
- Empty optional fields hidden.
- Fixed cultural disclaimer.
- Date refresh on minute polling and window focus.
- Truthful autostart failure behavior.
- One instance and explicit exit.

- [x] **Step 2: Run final regression from a clean dependency install**

Do not delete user data. Use the existing lockfile:

```powershell
npm.cmd ci
npm.cmd run test:run
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short --branch
```

Expected: all verification commands exit 0. `git status` shows only the intentionally updated plan checkboxes, or a clean tree after committing them.

- [x] **Step 3: Commit completed plan tracking**

```powershell
git add docs/superpowers/plans/2026-08-06-electronic-almanac-implementation.md
git commit -m "docs: complete electronic almanac plan"
```

- [x] **Step 4: Report artifacts and known manual constraints**

Report:

- Latest commit hash and clean/dirty status.
- Automatic verification command results.
- NSIS installer absolute path and file size.
- Manual smoke results, including whether a sign-out/sign-in test was completed.
- Any remaining manual action, especially the old `C:\Users\PAIDA\Documents\每日复盘小程序` duplicate that must be deleted after Codex is closed.
