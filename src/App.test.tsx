import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { AlmanacSnapshot } from "./almanac/types";
import { App, resolveWindowView } from "./App";
import { createMemoryDesktopBridge } from "./desktop/desktopBridge";

const readySnapshot: AlmanacSnapshot = {
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
    festivals: [],
    suitable: ["出行"],
    avoid: ["动土"],
    hours: [],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("App", () => {
  it("calculates today's almanac in the tray-card window", async () => {
    const bridge = createMemoryDesktopBridge();

    render(<App view="tray-card" bridge={bridge} />);

    expect(await screen.findByText("本地计算 · 不缓存黄历")).toBeInTheDocument();
  });

  it("completes the first-run prompt without enabling autostart", async () => {
    const bridge = createMemoryDesktopBridge();

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(bridge.getAutostart()).resolves.toBe(false);
    await expect(bridge.getPromptSeen()).resolves.toBe(true);
  });

  it("still shows the first-run prompt when reading autostart fails", async () => {
    const bridge = createMemoryDesktopBridge();
    bridge.getAutostart = vi.fn().mockRejectedValue(new Error("autostart unavailable"));

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("refreshes autostart from the system every time settings opens", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    await bridge.publishSnapshot(readySnapshot);
    const readAutostart = vi.spyOn(bridge, "getAutostart");
    render(<App view="main" bridge={bridge} />);
    await waitFor(() => expect(readAutostart).toHaveBeenCalledTimes(1));

    await bridge.setAutostart(true);
    await act(async () => {
      await bridge.requestSettings();
    });

    expect(readAutostart).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();

    await act(async () => {
      await bridge.showDetails();
    });
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() => expect(readAutostart).toHaveBeenCalledTimes(3));
  });

  it("shows unknown state instead of false when an autostart refresh fails", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    bridge.getAutostart = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("registry unavailable"));
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings();
    });

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("状态待确认")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("无法读取开机自启动状态，请稍后重试");
  });

  it("ignores a late autostart read from an older settings request", async () => {
    const staleRead = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    bridge.getAutostart = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => staleRead.promise)
      .mockResolvedValueOnce(true);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings();
      await bridge.requestSettings();
    });
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();

    await act(async () => staleRead.resolve(false));
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
  });

  it("does not let a settings refresh failure overwrite a pending autostart change", async () => {
    const pendingChange = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    bridge.getAutostart = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("registry unavailable"));
    bridge.setAutostart = vi.fn(() => pendingChange.promise);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});
    await act(async () => {
      await bridge.requestSettings();
    });

    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    await act(async () => {
      await bridge.requestSettings();
    });
    await act(async () => pendingChange.resolve(true));

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
    expect(screen.queryByText("状态待确认")).not.toBeInTheDocument();
  });

  it("preserves a native settings error when the autostart refresh succeeds", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    bridge.getAutostart = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings("开机自启动暂时不可用");
    });

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("开机自启动暂时不可用");
  });

  it("clears a prior read error after a later settings refresh succeeds", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    bridge.getAutostart = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("registry unavailable"))
      .mockResolvedValueOnce(true);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("无法读取开机自启动状态，请稍后重试");

    await act(async () => {
      await bridge.requestSettings();
    });
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an initial autostart read that resolves after completing the prompt", async () => {
    const initialAutostart = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    const readAutostart = bridge.getAutostart.bind(bridge);
    bridge.getAutostart = vi.fn()
      .mockImplementationOnce(() => initialAutostart.promise)
      .mockImplementation(readAutostart);
    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await act(async () => {
      initialAutostart.resolve(true);
    });
    await act(async () => {
      await bridge.requestSettings();
    });

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).not.toBeChecked();
  });

  it("does not expose a stale autostart change after switching bridges", async () => {
    const staleChange = deferred<boolean>();
    const firstBridge = createMemoryDesktopBridge();
    const secondBridge = createMemoryDesktopBridge();
    await firstBridge.completePrompt(false);
    await secondBridge.completePrompt(false);
    firstBridge.setAutostart = vi.fn(() => staleChange.promise);

    const { rerender } = render(<App view="main" bridge={firstBridge} />);
    await act(async () => {});
    await act(async () => {
      await firstBridge.requestSettings();
    });

    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    rerender(<App view="main" bridge={secondBridge} />);
    await act(async () => {});
    await act(async () => {
      await secondBridge.requestSettings();
    });

    await act(async () => {
      staleChange.resolve(true);
    });

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).not.toBeChecked();
  });

  it("does not expose a stale autostart read after switching bridges", async () => {
    const staleRead = deferred<boolean>();
    const firstBridge = createMemoryDesktopBridge();
    const secondBridge = createMemoryDesktopBridge();
    await firstBridge.completePrompt(false);
    await secondBridge.completePrompt(true);
    firstBridge.getAutostart = vi.fn(() => staleRead.promise);

    const { rerender } = render(<App view="main" bridge={firstBridge} />);
    await act(async () => {});
    rerender(<App view="main" bridge={secondBridge} />);
    await act(async () => {});
    await act(async () => {
      await secondBridge.requestSettings();
    });

    await act(async () => staleRead.resolve(false));
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
  });

  it("clears a previous bridge snapshot when the bridge changes", async () => {
    const firstBridge = createMemoryDesktopBridge();
    const secondBridge = createMemoryDesktopBridge();
    await firstBridge.completePrompt(false);
    await secondBridge.completePrompt(false);
    await firstBridge.publishSnapshot(readySnapshot);
    secondBridge.getSnapshot = vi.fn().mockRejectedValue(new Error("snapshot unavailable"));

    const { rerender } = render(<App view="main" bridge={firstBridge} />);
    expect(await screen.findByRole("heading", { name: "2026年8月6日" })).toBeInTheDocument();

    rerender(<App view="main" bridge={secondBridge} />);

    expect(screen.queryByRole("heading", { name: "2026年8月6日" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成今日黄历…");
  });

  it("resets pending settings state when the bridge changes", async () => {
    const pendingChange = deferred<boolean>();
    const firstBridge = createMemoryDesktopBridge();
    const secondBridge = createMemoryDesktopBridge();
    await firstBridge.completePrompt(false);
    await secondBridge.completePrompt(true);
    firstBridge.setAutostart = vi.fn(() => pendingChange.promise);

    const { rerender } = render(<App view="main" bridge={firstBridge} />);
    await act(async () => {});
    await act(async () => {
      await firstBridge.requestSettings();
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeDisabled();

    rerender(<App view="main" bridge={secondBridge} />);
    await act(async () => {});
    await act(async () => {
      await secondBridge.requestSettings();
    });

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeEnabled();
  });

  it("shows the first-run prompt when reading prompt-seen fails", async () => {
    const bridge = createMemoryDesktopBridge();
    bridge.getPromptSeen = vi.fn().mockRejectedValue(new Error("prompt state unavailable"));

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("contains a rejected show-details command", async () => {
    const bridge = createMemoryDesktopBridge();
    let rejectedCommand: Promise<void> | undefined;
    await bridge.publishSnapshot(readySnapshot);
    bridge.showDetails = vi.fn(() => {
      rejectedCommand = Promise.reject(new Error("show failed"));
      vi.spyOn(rejectedCommand, "catch");
      return rejectedCommand;
    });
    render(<App view="tray-card" bridge={bridge} />);

    await userEvent.click(await screen.findByRole("button", { name: "查看详情" }));
    await act(async () => {});

    expect(bridge.showDetails).toHaveBeenCalledOnce();
    expect(rejectedCommand?.catch).toHaveBeenCalledOnce();
  });

  it("contains a rejected hide-card command", async () => {
    const bridge = createMemoryDesktopBridge();
    let rejectedCommand: Promise<void> | undefined;
    bridge.hideCard = vi.fn(() => {
      rejectedCommand = Promise.reject(new Error("hide failed"));
      vi.spyOn(rejectedCommand, "catch");
      return rejectedCommand;
    });
    render(<App view="tray-card" bridge={bridge} />);

    await userEvent.keyboard("{Escape}");
    await act(async () => {});

    expect(bridge.hideCard).toHaveBeenCalledOnce();
    expect(rejectedCommand?.catch).toHaveBeenCalledOnce();
  });

  it("opens settings and displays a request error", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings("开机自启动暂时不可用");
    });

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("开机自启动暂时不可用");
  });

  it("keeps an unseen first-run prompt when startup cache cleanup fails", async () => {
    const bridge = createMemoryDesktopBridge();
    const completePrompt = vi.spyOn(bridge, "completePrompt");
    Object.assign(bridge, {
      getStartupCleanupError: vi.fn().mockResolvedValue(
        "WebView 临时数据清理失败：目录正在使用",
      ),
    });

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "WebView 临时数据清理失败：目录正在使用",
    );
    await expect(bridge.getPromptSeen()).resolves.toBe(false);
    expect(completePrompt).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "WebView 临时数据清理失败：目录正在使用",
    );
  });

  it("shows a deferred unseen prompt after startup cache cleanup fails", async () => {
    const promptSeen = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    const completePrompt = vi.spyOn(bridge, "completePrompt");
    bridge.getPromptSeen = vi.fn(() => promptSeen.promise);
    bridge.getStartupCleanupError = vi.fn().mockResolvedValue(
      "WebView 临时数据清理失败：目录正在使用",
    );

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(completePrompt).not.toHaveBeenCalled();

    await act(async () => promptSeen.resolve(false));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "WebView 临时数据清理失败：目录正在使用",
    );
  });

  it("opens settings without a prompt when cleanup fails after the prompt was seen", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    const completePrompt = vi.spyOn(bridge, "completePrompt");
    bridge.getStartupCleanupError = vi.fn().mockResolvedValue(
      "WebView 临时数据清理失败：目录正在使用",
    );

    render(<App view="main" bridge={bridge} />);

    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "WebView 临时数据清理失败：目录正在使用",
    );
    await expect(bridge.getPromptSeen()).resolves.toBe(true);
    expect(completePrompt).not.toHaveBeenCalled();
  });

  it("reveals a close failure instead of leaving it behind the first-run dialog", async () => {
    const bridge = createMemoryDesktopBridge();
    render(<App view="main" bridge={bridge} />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      await bridge.requestSettings("未能保存开机自启动选择，请稍后重试");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未能保存开机自启动选择，请稍后重试");
    await expect(bridge.getPromptSeen()).resolves.toBe(false);
  });

  it("ignores a late unseen result after a settings error takes precedence", async () => {
    const promptSeen = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    bridge.getPromptSeen = vi.fn(() => promptSeen.promise);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings("未能保存开机自启动选择，请稍后重试");
    });
    await act(async () => promptSeen.resolve(false));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未能保存开机自启动选择，请稍后重试");
  });

  it("ignores a late prompt-read rejection after a settings error takes precedence", async () => {
    const promptSeen = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    bridge.getPromptSeen = vi.fn(() => promptSeen.promise);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings("未能读取开机自启动选择，请稍后重试");
    });
    await act(async () => promptSeen.reject(new Error("read failed")));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未能读取开机自启动选择，请稍后重试");
  });

  it("keeps a late unseen result after an ordinary settings request", async () => {
    const promptSeen = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    bridge.getPromptSeen = vi.fn(() => promptSeen.promise);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings();
    });
    await act(async () => promptSeen.resolve(false));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the normal unseen fallback after a details request", async () => {
    const promptSeen = deferred<boolean>();
    const bridge = createMemoryDesktopBridge();
    bridge.getPromptSeen = vi.fn(() => promptSeen.promise);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.showDetails();
    });
    await act(async () => promptSeen.reject(new Error("read failed")));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("returns from requested settings to daily details", async () => {
    const bridge = createMemoryDesktopBridge();
    await bridge.completePrompt(false);
    render(<App view="main" bridge={bridge} />);
    await act(async () => {});

    await act(async () => {
      await bridge.requestSettings();
    });
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();

    await act(async () => {
      await bridge.showDetails();
    });
    expect(screen.queryByRole("heading", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在生成今日黄历…");
  });

  it("resolves empty, default, and unknown searches to the main view", () => {
    expect(resolveWindowView("")).toBe("main");
    expect(resolveWindowView("?view=main")).toBe("main");
    expect(resolveWindowView("?view=unknown")).toBe("main");
  });

  it("resolves the tray-card query to the tray-card view", () => {
    expect(resolveWindowView("?view=tray-card")).toBe("tray-card");
  });

  it("applies the tray-card class to the tray-card view", () => {
    render(<App view="tray-card" />);
    expect(screen.getByRole("main")).toHaveClass("app--tray-card");
  });
});
