import { useEffect, useRef, useState } from "react";

export function FirstRunPrompt({
  onComplete,
}: {
  onComplete: (enabled: boolean) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enableButtonRef = useRef<HTMLButtonElement>(null);
  const completeRef = useRef<(enabled: boolean) => void>(() => {});

  async function complete(enabled: boolean) {
    if (pendingRef.current) return;

    pendingRef.current = true;
    setPending(true);
    setError("");

    try {
      await onComplete(enabled);
    } catch {
      setError(enabled ? "未能开启开机自启动，请稍后重试" : "未能关闭开机自启动，请稍后重试");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  completeRef.current = complete;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog) return;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (import.meta.env.MODE === "test") {
      dialog.open = true;
    }

    enableButtonRef.current?.focus();

    const declineOnCancel = (event: Event) => {
      event.preventDefault();
      completeRef.current(false);
    };

    dialog.addEventListener("cancel", declineOnCancel);
    return () => {
      dialog.removeEventListener("cancel", declineOnCancel);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <dialog className="modal first-run-prompt__dialog" ref={dialogRef} aria-modal="true" aria-labelledby="autostart-prompt-title" aria-describedby="autostart-prompt-description">
        <h2 id="autostart-prompt-title">开机时自动启动电子黄历？</h2>
        <p id="autostart-prompt-description">开启后，登录 Windows 会静默进入系统托盘，不会自动弹出窗口。</p>
        {error && <p role="alert">{error}</p>}
        <div className="first-run-prompt__actions">
          <button ref={enableButtonRef} type="button" disabled={pending} onClick={() => complete(true)}>开启</button>
          <button type="button" disabled={pending} onClick={() => complete(false)}>暂不开启</button>
        </div>
    </dialog>
  );
}
