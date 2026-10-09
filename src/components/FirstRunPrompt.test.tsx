import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { FirstRunPrompt } from "./FirstRunPrompt";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("FirstRunPrompt", () => {
  it("only completes after explicitly enabling autostart", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunPrompt onComplete={onComplete} />);

    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "开启" }));

    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it("completes without enabling when declined", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunPrompt onComplete={onComplete} />);

    await userEvent.click(screen.getByRole("button", { name: "暂不开启" }));

    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and reports an enable failure", async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error("failed"));
    render(<FirstRunPrompt onComplete={onComplete} />);

    await userEvent.click(screen.getByRole("button", { name: "开启" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("未能开启开机自启动，请稍后重试");
  });

  it("serializes conflicting actions and re-enables them after rejection", async () => {
    const request = deferred<void>();
    const onComplete = vi.fn(() => request.promise);
    render(<FirstRunPrompt onComplete={onComplete} />);

    const enable = screen.getByRole("button", { name: "开启" });
    const decline = screen.getByRole("button", { name: "暂不开启" });
    await userEvent.click(enable);
    await userEvent.click(decline);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(true);
    expect(enable).toBeDisabled();
    expect(decline).toBeDisabled();

    await act(async () => {
      request.reject(new Error("failed"));
    });

    expect(enable).toBeEnabled();
    expect(decline).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("未能开启开机自启动，请稍后重试");
  });

  it("opens as a modal and focuses the enable action", () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    const { unmount } = render(<FirstRunPrompt onComplete={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "开启" })).toHaveFocus();

    unmount();
    expect(previous).toHaveFocus();
    previous.remove();
  });

  it("declines through the native cancel event", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<FirstRunPrompt onComplete={onComplete} />);
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { cancelable: true });

    dialog.dispatchEvent(cancel);
    await act(async () => {});

    expect(cancel.defaultPrevented).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(false);
  });
});
