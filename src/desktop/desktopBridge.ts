import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
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
  getStartupCleanupError(): Promise<string | undefined>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<boolean>;
  getPromptSeen(): Promise<boolean>;
  completePrompt(enabled: boolean): Promise<boolean>;
}

export class MemoryDesktopBridge implements DesktopBridge {
  private snapshot: AlmanacSnapshot | null = null;
  private autostart = false;
  private promptSeen = false;
  private readonly snapshotListeners = new Set<(snapshot: AlmanacSnapshot) => void>();
  private readonly refreshListeners = new Set<() => void>();
  private readonly settingsListeners = new Set<(errorMessage?: string) => void>();
  private readonly detailsListeners = new Set<() => void>();

  async publishSnapshot(snapshot: AlmanacSnapshot): Promise<void> {
    this.snapshot = snapshot;
    this.snapshotListeners.forEach((listener) => listener(snapshot));
  }

  async getSnapshot(): Promise<AlmanacSnapshot | null> {
    return this.snapshot;
  }

  async subscribeSnapshot(listener: (snapshot: AlmanacSnapshot) => void): Promise<Unlisten> {
    return this.subscribe(this.snapshotListeners, listener);
  }

  async subscribeRefreshRequest(listener: () => void): Promise<Unlisten> {
    return this.subscribe(this.refreshListeners, listener);
  }

  async subscribeSettingsRequest(listener: (errorMessage?: string) => void): Promise<Unlisten> {
    return this.subscribe(this.settingsListeners, listener);
  }

  async subscribeDetailsRequest(listener: () => void): Promise<Unlisten> {
    return this.subscribe(this.detailsListeners, listener);
  }

  async requestRefresh(): Promise<void> {
    this.refreshListeners.forEach((listener) => listener());
  }

  async requestSettings(errorMessage?: string): Promise<void> {
    this.settingsListeners.forEach((listener) => listener(errorMessage));
  }

  async showDetails(): Promise<void> {
    this.detailsListeners.forEach((listener) => listener());
  }

  async hideCard(): Promise<void> {}

  async getStartupCleanupError(): Promise<string | undefined> {
    return undefined;
  }

  async getAutostart(): Promise<boolean> {
    return this.autostart;
  }

  async setAutostart(enabled: boolean): Promise<boolean> {
    this.autostart = enabled;
    return this.autostart;
  }

  async getPromptSeen(): Promise<boolean> {
    return this.promptSeen;
  }

  async completePrompt(enabled: boolean): Promise<boolean> {
    this.autostart = enabled;
    this.promptSeen = true;
    return this.autostart;
  }

  private subscribe<T>(listeners: Set<T>, listener: T): Unlisten {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

class TauriDesktopBridge implements DesktopBridge {
  async publishSnapshot(snapshot: AlmanacSnapshot): Promise<void> {
    await invoke("publish_almanac_snapshot", { snapshot });
  }

  getSnapshot(): Promise<AlmanacSnapshot | null> {
    return invoke("get_almanac_snapshot");
  }

  subscribeSnapshot(listener: (snapshot: AlmanacSnapshot) => void): Promise<Unlisten> {
    return listen<AlmanacSnapshot>("almanac://updated", (event) => listener(event.payload));
  }

  subscribeRefreshRequest(listener: () => void): Promise<Unlisten> {
    return listen("almanac://refresh-requested", () => listener());
  }

  subscribeSettingsRequest(listener: (errorMessage?: string) => void): Promise<Unlisten> {
    return listen<string | null>("app://open-settings", (event) => listener(event.payload ?? undefined));
  }

  subscribeDetailsRequest(listener: () => void): Promise<Unlisten> {
    return listen("app://show-details", () => listener());
  }

  async requestRefresh(): Promise<void> {
    await emit("almanac://refresh-requested");
  }

  async requestSettings(errorMessage?: string): Promise<void> {
    await emit("app://open-settings", errorMessage ?? null);
  }

  async showDetails(): Promise<void> {
    await invoke("show_details");
  }

  async hideCard(): Promise<void> {
    await invoke("hide_tray_card");
  }

  getStartupCleanupError(): Promise<string | undefined> {
    return invoke<string | null>("get_startup_cleanup_error")
      .then((message) => message ?? undefined);
  }

  getAutostart(): Promise<boolean> {
    return invoke("get_autostart");
  }

  setAutostart(enabled: boolean): Promise<boolean> {
    return invoke("set_autostart", { enabled });
  }

  getPromptSeen(): Promise<boolean> {
    return invoke("get_prompt_seen");
  }

  completePrompt(enabled: boolean): Promise<boolean> {
    return invoke("complete_autostart_prompt", { enabled });
  }
}

export function createMemoryDesktopBridge(): DesktopBridge {
  return new MemoryDesktopBridge();
}

export const tauriDesktopBridge: DesktopBridge = new TauriDesktopBridge();
