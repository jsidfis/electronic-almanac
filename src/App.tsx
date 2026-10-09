import { useEffect, useMemo, useRef, useState } from "react";
import { LocalAlmanacProvider } from "./almanac/localAlmanacProvider";
import type { AlmanacSnapshot } from "./almanac/types";
import { AlmanacCoordinator } from "./app/almanacCoordinator";
import { FirstRunPrompt } from "./components/FirstRunPrompt";
import { tauriDesktopBridge, type DesktopBridge, type Unlisten } from "./desktop/desktopBridge";
import { DailyDetail } from "./views/DailyDetail";
import { SettingsView } from "./views/SettingsView";
import { TrayCard } from "./views/TrayCard";

export type WindowView = "tray-card" | "main";
type SettingsError = { message: string; source: "cleanup" | "native" | "read" };

export function resolveWindowView(search: string): WindowView {
  return new URLSearchParams(search).get("view") === "tray-card" ? "tray-card" : "main";
}

const bridgeIdentities = new WeakMap<DesktopBridge, number>();
let nextBridgeIdentity = 0;

function getBridgeIdentity(bridge: DesktopBridge): number {
  const existingIdentity = bridgeIdentities.get(bridge);

  if (existingIdentity !== undefined) {
    return existingIdentity;
  }

  const identity = ++nextBridgeIdentity;
  bridgeIdentities.set(bridge, identity);
  return identity;
}

function useSnapshot(bridge: DesktopBridge): AlmanacSnapshot | null {
  const [snapshot, setSnapshot] = useState<AlmanacSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: Unlisten | undefined;
    let updateCount = 0;

    void (async () => {
      const stopListening = await bridge.subscribeSnapshot((nextSnapshot) => {
        updateCount += 1;
        if (active) setSnapshot(nextSnapshot);
      });

      if (!active) {
        stopListening();
        return;
      }

      unlisten = stopListening;
      const countBeforeRead = updateCount;
      const existingSnapshot = await bridge.getSnapshot();

      if (active && updateCount === countBeforeRead) {
        setSnapshot(existingSnapshot);
      }
    })().catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, [bridge]);

  return snapshot;
}

export function App({
  view,
  bridge = tauriDesktopBridge,
}: {
  view: WindowView;
  bridge?: DesktopBridge;
}) {
  return <BridgeApp key={getBridgeIdentity(bridge)} view={view} bridge={bridge} />;
}

function BridgeApp({
  view,
  bridge,
}: {
  view: WindowView;
  bridge: DesktopBridge;
}) {
  const snapshot = useSnapshot(bridge);
  const coordinator = useMemo(
    () => view === "tray-card"
      ? new AlmanacCoordinator(
          new LocalAlmanacProvider(),
          (nextSnapshot) => bridge.publishSnapshot(nextSnapshot),
        )
      : null,
    [bridge, view],
  );
  const [mainView, setMainView] = useState<"detail" | "settings">("detail");
  const [promptSeen, setPromptSeen] = useState(true);
  const [autostart, setAutostart] = useState(false);
  const [autostartKnown, setAutostartKnown] = useState(false);
  const [settingsError, setSettingsError] = useState<SettingsError | null>(null);
  const autostartState = useRef({
    readRevision: 0,
    operationRevision: 0,
    operationPending: false,
    value: false,
  });
  const promptReadRevision = useRef(0);

  function refreshAutostart(preserveSettingsError: boolean, reportFailure: boolean) {
    const readRevision = ++autostartState.current.readRevision;
    const operationRevision = autostartState.current.operationRevision;
    const blockedByOperation = autostartState.current.operationPending;
    if (!blockedByOperation) setAutostartKnown(false);

    void bridge.getAutostart().then((enabled) => {
      if (
        blockedByOperation
        || autostartState.current.operationPending
        || autostartState.current.operationRevision !== operationRevision
        || autostartState.current.readRevision !== readRevision
      ) return;

      autostartState.current.value = enabled;
      setAutostart(enabled);
      setAutostartKnown(true);
      if (!preserveSettingsError) {
        setSettingsError((current) => current?.source === "read" ? null : current);
      }
    }).catch(() => {
      if (
        blockedByOperation
        || autostartState.current.operationPending
        || autostartState.current.operationRevision !== operationRevision
        || autostartState.current.readRevision !== readRevision
      ) return;

      setAutostartKnown(false);
      if (reportFailure && !preserveSettingsError) {
        setSettingsError((current) => current?.source === "native" ? current : {
          message: "无法读取开机自启动状态，请稍后重试",
          source: "read",
        });
      }
    });
  }

  useEffect(() => {
    if (!coordinator) return;

    let active = true;
    let unlisten: Unlisten | undefined;

    coordinator.start();
    void bridge.subscribeRefreshRequest(() => {
      void coordinator.ensureToday();
    }).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    }).catch(() => {});

    return () => {
      active = false;
      unlisten?.();
      coordinator.stop();
    };
  }, [bridge, coordinator, view]);

  useEffect(() => {
    if (view !== "main") return;

    let active = true;
    let unlistenSettings: Unlisten | undefined;
    let unlistenDetails: Unlisten | undefined;
    const initialPromptRevision = ++promptReadRevision.current;

    const openSettings = (errorMessage?: string) => {
      if (!active) return;
      if (errorMessage) {
        promptReadRevision.current += 1;
        setPromptSeen(true);
      }
      if (errorMessage) {
        setSettingsError({ message: errorMessage, source: "native" });
      }
      setMainView("settings");
      refreshAutostart(Boolean(errorMessage), true);
    };

    const showCleanupError = (errorMessage: string) => {
      if (!active) return;
      setSettingsError({ message: errorMessage, source: "cleanup" });
      setMainView("settings");
      refreshAutostart(true, true);
    };

    void bridge.subscribeSettingsRequest(openSettings).then((stopListening) => {
      if (active) unlistenSettings = stopListening;
      else stopListening();
    }).catch(() => {});

    void bridge.getStartupCleanupError().then((errorMessage) => {
      if (errorMessage) showCleanupError(errorMessage);
    }).catch(() => {});

    void bridge.subscribeDetailsRequest(() => {
      if (!active) return;
      setSettingsError(null);
      setMainView("detail");
    }).then((stopListening) => {
      if (active) unlistenDetails = stopListening;
      else stopListening();
    }).catch(() => {});

    void bridge.getPromptSeen().then((seen) => {
      if (active && promptReadRevision.current === initialPromptRevision) {
        setPromptSeen(seen);
      }
    }).catch(() => {
      if (active && promptReadRevision.current === initialPromptRevision) {
        setPromptSeen(false);
      }
    });

    refreshAutostart(false, false);

    void bridge.requestRefresh().catch(() => {});

    return () => {
      active = false;
      autostartState.current.readRevision += 1;
      autostartState.current.operationRevision += 1;
      promptReadRevision.current += 1;
      unlistenSettings?.();
      unlistenDetails?.();
    };
  }, [bridge, view]);

  async function completePrompt(enabled: boolean) {
    promptReadRevision.current += 1;
    const operationRevision = ++autostartState.current.operationRevision;
    autostartState.current.readRevision += 1;
    autostartState.current.operationPending = true;

    try {
      const actualAutostart = await bridge.completePrompt(enabled);
      if (autostartState.current.operationRevision === operationRevision) {
        autostartState.current.value = actualAutostart;
        setAutostart(actualAutostart);
        setAutostartKnown(true);
        setPromptSeen(true);
      }
    } finally {
      if (autostartState.current.operationRevision === operationRevision) {
        autostartState.current.operationPending = false;
      }
    }
  }

  async function changeAutostart(enabled: boolean): Promise<boolean> {
    const operationRevision = ++autostartState.current.operationRevision;
    autostartState.current.readRevision += 1;
    autostartState.current.operationPending = true;

    try {
      const actualAutostart = await bridge.setAutostart(enabled);
      if (autostartState.current.operationRevision === operationRevision) {
        autostartState.current.value = actualAutostart;
        setAutostart(actualAutostart);
        setAutostartKnown(true);
        return actualAutostart;
      }
      return autostartState.current.value;
    } catch (error) {
      try {
        const actualAutostart = await bridge.getAutostart();
        if (autostartState.current.operationRevision === operationRevision) {
          autostartState.current.value = actualAutostart;
          setAutostart(actualAutostart);
          setAutostartKnown(true);
        }
      } catch {
        if (autostartState.current.operationRevision === operationRevision) {
          setAutostartKnown(false);
          setSettingsError({
            message: "无法读取开机自启动状态，请稍后重试",
            source: "read",
          });
        }
      } finally {
        throw error;
      }
    } finally {
      if (autostartState.current.operationRevision === operationRevision) {
        autostartState.current.operationPending = false;
      }
    }
  }

  if (view === "tray-card") {
    return (
      <main className="app app--tray-card">
        <TrayCard
          snapshot={snapshot}
          onShowDetails={() => { void bridge.showDetails().catch(() => undefined); }}
          onHide={() => { void bridge.hideCard().catch(() => undefined); }}
        />
      </main>
    );
  }

  const showDetails = () => {
    setSettingsError(null);
    setMainView("detail");
  };

  return (
    <main className="app app--main">
      {mainView === "settings" ? (
        <SettingsView
          enabled={autostart}
          known={autostartKnown}
          setAutostart={changeAutostart}
          onBack={showDetails}
          externalError={settingsError?.message ?? ""}
          onClearExternalError={() => setSettingsError(null)}
        />
      ) : (
        <DailyDetail
          snapshot={snapshot}
          onOpenSettings={() => {
            setMainView("settings");
            refreshAutostart(false, true);
          }}
        />
      )}
      {!promptSeen && <FirstRunPrompt onComplete={completePrompt} />}
    </main>
  );
}
