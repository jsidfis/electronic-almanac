import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { SettingsView } from "./SettingsView";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function ExternalErrorHarness() {
  const [externalError, setExternalError] = useState("来自系统的同一错误");

  return (
    <>
      <SettingsView
        enabled={false}
        setAutostart={async () => true}
        onBack={() => {}}
        externalError={externalError}
        onClearExternalError={() => setExternalError("")}
      />
      <output data-testid="external-error">{externalError}</output>
      <button type="button" onClick={() => setExternalError("来自系统的同一错误")}>再次发送同一错误</button>
    </>
  );
}

describe("SettingsView", () => {
  it("restores the unchecked switch and reports an enable failure", async () => {
    const setAutostart = vi.fn().mockRejectedValue(new Error("failed"));
    render(<SettingsView enabled={false} setAutostart={setAutostart} onBack={() => {}} />);

    const autostart = screen.getByRole("checkbox", { name: "开机自启动" });
    expect(autostart).not.toBeChecked();

    await userEvent.click(autostart);

    expect(setAutostart).toHaveBeenCalledWith(true);
    expect(autostart).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("未能开启开机自启动，请稍后重试");
  });

  it("serializes conflicting changes while an autostart update is pending", async () => {
    const request = deferred<boolean>();
    const setAutostart = vi.fn(() => request.promise);
    render(<SettingsView enabled={false} setAutostart={setAutostart} onBack={() => {}} />);

    const autostart = screen.getByRole("checkbox", { name: "开机自启动" });
    await userEvent.click(autostart);
    await userEvent.click(autostart);

    expect(setAutostart).toHaveBeenCalledTimes(1);
    expect(autostart).toBeDisabled();

    await act(async () => {
      request.resolve(true);
    });

    expect(autostart).toBeEnabled();
    expect(autostart).toBeChecked();
  });

  it("restores the latest enabled prop when a pending update fails", async () => {
    const request = deferred<boolean>();
    const setAutostart = vi.fn(() => request.promise);
    const { rerender } = render(<SettingsView enabled={false} setAutostart={setAutostart} onBack={() => {}} />);

    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    rerender(<SettingsView enabled setAutostart={setAutostart} onBack={() => {}} />);

    await act(async () => {
      request.reject(new Error("failed"));
    });

    expect(screen.getByRole("checkbox", { name: "开机自启动" })).toBeChecked();
  });

  it("replaces a local error with a newer external error", async () => {
    const setAutostart = vi.fn().mockRejectedValue(new Error("failed"));
    const { rerender } = render(<SettingsView enabled={false} setAutostart={setAutostart} onBack={() => {}} />);

    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));
    rerender(<SettingsView enabled={false} setAutostart={setAutostart} onBack={() => {}} externalError="来自系统的最新错误" />);

    expect(screen.getByRole("alert")).toHaveTextContent("来自系统的最新错误");
  });

  it("clears the displayed error after a successful local update", async () => {
    const setAutostart = vi.fn().mockResolvedValue(true);
    render(
      <SettingsView
        enabled={false}
        setAutostart={setAutostart}
        onBack={() => {}}
        externalError="来自系统的旧错误"
      />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an identical external error after the parent clears the previous one", async () => {
    render(<ExternalErrorHarness />);

    expect(screen.getByRole("alert")).toHaveTextContent("来自系统的同一错误");
    await userEvent.click(screen.getByRole("checkbox", { name: "开机自启动" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("external-error")).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole("button", { name: "再次发送同一错误" }));

    expect(screen.getByRole("alert")).toHaveTextContent("来自系统的同一错误");
  });
});
