import { describe, expect, test, vi } from "vitest";
import type { AlmanacSnapshot } from "../almanac/types";
import { createMemoryDesktopBridge, tauriDesktopBridge } from "./desktopBridge";

describe("MemoryDesktopBridge", () => {
  test("publishes an error snapshot to subscribers and retains it in memory", async () => {
    const bridge = createMemoryDesktopBridge();
    const listener = vi.fn();
    const unlisten = await bridge.subscribeSnapshot(listener);
    const snapshot: AlmanacSnapshot = {
      status: "error",
      date: "2026-08-06",
      message: "黄历信息暂时无法生成",
    };

    await bridge.publishSnapshot(snapshot);

    await expect(bridge.getSnapshot()).resolves.toEqual(snapshot);
    expect(listener).toHaveBeenCalledExactlyOnceWith(snapshot);
    unlisten();
    await bridge.publishSnapshot(snapshot);
    expect(listener).toHaveBeenCalledOnce();
  });

  test("broadcasts refresh requests through the public subscription contract", async () => {
    const bridge = createMemoryDesktopBridge();
    const listener = vi.fn();
    const unlisten = await bridge.subscribeRefreshRequest(listener);

    await bridge.requestRefresh();

    expect(listener).toHaveBeenCalledOnce();
    unlisten();
  });

  test("delivers an omitted settings error as undefined", async () => {
    const bridge = createMemoryDesktopBridge();
    const listener = vi.fn();
    const unlisten = await bridge.subscribeSettingsRequest(listener);

    await bridge.requestSettings();

    expect(listener).toHaveBeenCalledExactlyOnceWith(undefined);
    unlisten();
  });

  test("returns the actual autostart state when completing the prompt", async () => {
    const bridge = createMemoryDesktopBridge();

    await expect(bridge.setAutostart(true)).resolves.toBe(true);
    await expect(bridge.completePrompt(false)).resolves.toBe(false);
    await expect(bridge.getAutostart()).resolves.toBe(false);
    await expect(bridge.getPromptSeen()).resolves.toBe(true);
    expect(tauriDesktopBridge).toBeDefined();
  });
});
