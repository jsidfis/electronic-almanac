import { useEffect, useRef, useState } from "react";
import { PaperShell } from "../components/PaperShell";

export function SettingsView({
  enabled,
  known = true,
  setAutostart,
  onBack,
  externalError = "",
  onClearExternalError = () => {},
}: {
  enabled: boolean;
  known?: boolean;
  setAutostart: (enabled: boolean) => Promise<boolean>;
  onBack: () => void;
  externalError?: string;
  onClearExternalError?: () => void;
}) {
  const [checked, setChecked] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [displayedError, setDisplayedError] = useState(externalError);
  const enabledRef = useRef(enabled);
  const pendingRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
    setChecked(enabled);
  }, [enabled]);

  useEffect(() => {
    setDisplayedError(externalError);
  }, [externalError]);

  async function changeAutostart(next: boolean) {
    if (pendingRef.current) return;

    pendingRef.current = true;
    setPending(true);
    setChecked(next);
    onClearExternalError();
    setDisplayedError("");

    try {
      setChecked(await setAutostart(next));
      setDisplayedError("");
    } catch {
      setChecked(enabledRef.current);
      setDisplayedError(next ? "未能开启开机自启动，请稍后重试" : "未能关闭开机自启动，请稍后重试");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <PaperShell className="settings-view">
      <button className="settings-view__back" type="button" onClick={onBack}>返回</button>
      <h1>设置</h1>
      <section className="settings-view__section">
        <label className="settings-view__row">
          <span>开机自启动</span>
          <input
            type="checkbox"
            checked={checked}
            disabled={pending || !known}
            aria-label="开机自启动"
            aria-describedby="autostart-description"
            onChange={(event) => changeAutostart(event.target.checked)}
          />
        </label>
        <p id="autostart-description">
          {!known && <span>状态待确认</span>}
          {!known && "。"}登录 Windows 后静默进入系统托盘
        </p>
      </section>
      {displayedError && <p className="settings-view__error" role="alert">{displayedError}</p>}
      <section className="settings-view__section settings-view__about">
        <h2>关于</h2>
        <p>电子黄历 v0.1.0 · 本地计算 · 不联网</p>
      </section>
    </PaperShell>
  );
}
