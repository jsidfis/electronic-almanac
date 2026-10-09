use serde_json::Value;
use std::{collections::HashMap, path::Path, sync::Arc};
use tauri::{menu::CheckMenuItem, AppHandle, Emitter, Manager, Runtime, State, Wry};
use tauri_plugin_autostart::{AutoLaunchManager, ManagerExt};
use tauri_plugin_store::{Store, StoreExt};

pub const SETTINGS_FILE: &str = "settings.json";
pub const PROMPT_SEEN_KEY: &str = "autostartPromptSeen";
pub(crate) const AUTOSTART_LABEL: &str = "开机自启动";
pub(crate) const AUTOSTART_UNKNOWN_LABEL: &str = "开机自启动（状态待确认）";

pub struct AutostartMenuItem(pub CheckMenuItem<Wry>);

trait AutostartBackend {
    fn is_enabled(&self) -> Result<bool, String>;
    fn enable(&self) -> Result<(), String>;
    fn disable(&self) -> Result<(), String>;
}

impl AutostartBackend for AutoLaunchManager {
    fn is_enabled(&self) -> Result<bool, String> {
        AutoLaunchManager::is_enabled(self).map_err(|error| error.to_string())
    }

    fn enable(&self) -> Result<(), String> {
        AutoLaunchManager::enable(self).map_err(|error| error.to_string())
    }

    fn disable(&self) -> Result<(), String> {
        AutoLaunchManager::disable(self).map_err(|error| error.to_string())
    }
}

trait SettingsStore {
    fn get_value(&self, key: &str) -> Option<Value>;
    fn set_value(&self, key: &str, value: Value);
    fn delete_value(&self, key: &str);
    fn clear_values(&self);
    fn save_values(&self) -> Result<(), String>;
}

impl<R: Runtime> SettingsStore for Store<R> {
    fn get_value(&self, key: &str) -> Option<Value> {
        self.get(key)
    }

    fn set_value(&self, key: &str, value: Value) {
        self.set(key, value);
    }

    fn delete_value(&self, key: &str) {
        self.delete(key);
    }

    fn clear_values(&self) {
        self.clear();
    }

    fn save_values(&self) -> Result<(), String> {
        self.save().map_err(|error| error.to_string())
    }
}

fn prompt_seen_value(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

fn remove_malformed_settings_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }

    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    if serde_json::from_slice::<HashMap<String, Value>>(&bytes).is_err() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
        return Ok(true);
    }

    Ok(false)
}

fn open_settings_at<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<Arc<Store<R>>, String> {
    let removed = remove_malformed_settings_file(path)?;
    let store = app.store(path).map_err(|error| error.to_string())?;
    clear_store_after_removal(store.as_ref(), removed);
    Ok(store)
}

fn clear_store_after_removal(store: &impl SettingsStore, removed: bool) {
    if removed {
        store.clear_values();
    }
}

fn open_settings(app: &AppHandle) -> Result<Arc<Store<Wry>>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(SETTINGS_FILE);
    open_settings_at(app, &path)
}

fn set_prompt_seen_and_save(store: &impl SettingsStore) -> Result<(), String> {
    let previous = store.get_value(PROMPT_SEEN_KEY);
    store.set_value(PROMPT_SEEN_KEY, Value::Bool(true));

    if let Err(error) = store.save_values() {
        if let Some(previous) = previous {
            store.set_value(PROMPT_SEEN_KEY, previous);
        } else {
            store.delete_value(PROMPT_SEEN_KEY);
        }
        return Err(error);
    }

    Ok(())
}

fn mark_prompt_seen(app: &AppHandle) -> Result<(), String> {
    let store = open_settings(app)?;
    set_prompt_seen_and_save(store.as_ref())
}

#[tauri::command]
pub fn get_prompt_seen(app: AppHandle) -> Result<bool, String> {
    let store = open_settings(&app)?;
    Ok(prompt_seen_value(store.get(PROMPT_SEEN_KEY).as_ref()))
}

#[tauri::command]
pub fn get_autostart(
    app: AppHandle,
    menu: State<'_, AutostartMenuItem>,
) -> Result<bool, String> {
    match app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
    {
        Ok(actual) => {
            sync_autostart_menu(&menu, actual)?;
            Ok(actual)
        }
        Err(error) => {
            let _ = menu.0.set_text(AUTOSTART_UNKNOWN_LABEL);
            Err(error)
        }
    }
}

fn sync_autostart_menu_fields(
    enabled: bool,
    set_text: impl FnOnce(&str) -> Result<(), String>,
    set_checked: impl FnOnce(bool) -> Result<(), String>,
) -> Result<(), String> {
    set_text(AUTOSTART_LABEL)?;
    set_checked(enabled)
}

fn sync_autostart_menu(menu: &AutostartMenuItem, enabled: bool) -> Result<(), String> {
    sync_autostart_menu_fields(
        enabled,
        |label| menu.0.set_text(label).map_err(|error| error.to_string()),
        |checked| {
            menu.0
                .set_checked(checked)
                .map_err(|error| error.to_string())
        },
    )
}

fn apply_autostart_target(
    backend: &impl AutostartBackend,
    enabled: bool,
    sync_menu: impl Fn(bool) -> Result<(), String>,
) -> Result<bool, String> {
    let current = backend.is_enabled()?;
    if current == enabled {
        sync_menu(current)?;
        return Ok(current);
    }

    let operation = if enabled {
        backend.enable()
    } else {
        backend.disable()
    };

    if let Err(error) = operation {
        if let Ok(actual) = backend.is_enabled() {
            let _ = sync_menu(actual);
        }
        return Err(error);
    }

    let actual = backend.is_enabled()?;
    sync_menu(actual)?;
    Ok(actual)
}

pub(crate) fn set_autostart_value(
    app: &AppHandle,
    menu: &AutostartMenuItem,
    enabled: bool,
) -> Result<bool, String> {
    let manager = app.autolaunch();
    apply_autostart_target(&*manager, enabled, |actual| sync_autostart_menu(menu, actual))
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

fn persist_decline_after_disable(
    disable_result: Result<bool, String>,
    mark_prompt_seen: impl FnOnce() -> Result<(), String>,
    report_error: impl FnOnce(&str),
) -> Result<(), String> {
    let actual = match disable_result {
        Ok(actual) => actual,
        Err(error) => {
            report_error(&format!("未能关闭开机自启动，请稍后重试：{error}"));
            return Err(error);
        }
    };

    if actual {
        let error = "开机自启动仍处于开启状态".to_string();
        report_error(&format!("未能关闭开机自启动，请稍后重试：{error}"));
        return Err(error);
    }

    match mark_prompt_seen() {
        Ok(()) => Ok(()),
        Err(error) => {
            report_error(&format!(
                "未能保存开机自启动选择，请稍后重试：{error}"
            ));
            Err(error)
        }
    }
}

fn prompt_seen_for_close(
    read_result: Result<bool, String>,
    report_error: impl FnOnce(&str),
) -> Result<bool, String> {
    match read_result {
        Ok(prompt_seen) => Ok(prompt_seen),
        Err(error) => {
            report_error(&format!(
                "未能读取开机自启动选择，请稍后重试：{error}"
            ));
            Err(error)
        }
    }
}

pub fn decline_prompt_on_window_close(app: &AppHandle) -> Result<(), String> {
    let prompt_seen = prompt_seen_for_close(get_prompt_seen(app.clone()), |message| {
        let _ = app.emit("app://open-settings", Some(message.to_string()));
    })?;
    if prompt_seen {
        return Ok(());
    }

    let disable_result = match app.try_state::<AutostartMenuItem>() {
        Some(menu) => set_autostart_value(app, &menu, false),
        None => Err("开机自启动菜单尚未就绪".to_string()),
    };
    persist_decline_after_disable(
        disable_result,
        || mark_prompt_seen(app),
        |message| {
            let _ = app.emit("app://open-settings", Some(message.to_string()));
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        cell::{Cell, RefCell},
        collections::VecDeque,
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[derive(Default)]
    struct FakeSettingsStore {
        values: RefCell<HashMap<String, Value>>,
        fail_save: Cell<bool>,
    }

    impl SettingsStore for FakeSettingsStore {
        fn get_value(&self, key: &str) -> Option<Value> {
            self.values.borrow().get(key).cloned()
        }

        fn set_value(&self, key: &str, value: Value) {
            self.values.borrow_mut().insert(key.to_string(), value);
        }

        fn delete_value(&self, key: &str) {
            self.values.borrow_mut().remove(key);
        }

        fn clear_values(&self) {
            self.values.borrow_mut().clear();
        }

        fn save_values(&self) -> Result<(), String> {
            if self.fail_save.get() {
                Err("save failed".to_string())
            } else {
                Ok(())
            }
        }
    }

    struct FakeAutostartBackend {
        statuses: RefCell<VecDeque<Result<bool, String>>>,
        enable_calls: Cell<usize>,
        disable_calls: Cell<usize>,
    }

    impl FakeAutostartBackend {
        fn with_statuses(statuses: impl IntoIterator<Item = Result<bool, String>>) -> Self {
            Self {
                statuses: RefCell::new(statuses.into_iter().collect()),
                enable_calls: Cell::new(0),
                disable_calls: Cell::new(0),
            }
        }
    }

    impl AutostartBackend for FakeAutostartBackend {
        fn is_enabled(&self) -> Result<bool, String> {
            self.statuses
                .borrow_mut()
                .pop_front()
                .expect("missing fake autostart status")
        }

        fn enable(&self) -> Result<(), String> {
            self.enable_calls.set(self.enable_calls.get() + 1);
            Ok(())
        }

        fn disable(&self) -> Result<(), String> {
            self.disable_calls.set(self.disable_calls.get() + 1);
            Ok(())
        }
    }

    fn unique_temp_directory(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("electronic-almanac-{prefix}-{unique}"))
    }

    #[test]
    fn already_disabled_target_skips_disable_and_allows_prompt_persistence() {
        let backend = FakeAutostartBackend::with_statuses([Ok(false)]);
        let menu_values = RefCell::new(Vec::new());

        let actual = apply_autostart_target(&backend, false, |checked| {
            menu_values.borrow_mut().push(checked);
            Ok(())
        })
        .unwrap();

        assert!(!actual);
        assert_eq!(backend.enable_calls.get(), 0);
        assert_eq!(backend.disable_calls.get(), 0);
        assert!(backend.statuses.borrow().is_empty());
        assert_eq!(menu_values.into_inner(), vec![false]);

        let prompt_store = FakeSettingsStore::default();
        set_prompt_seen_and_save(&prompt_store).unwrap();
        assert_eq!(prompt_store.get_value(PROMPT_SEEN_KEY), Some(json!(true)));

        let decline_marked = Cell::new(false);
        persist_decline_after_disable(
            Ok(actual),
            || {
                decline_marked.set(true);
                Ok(())
            },
            |_| panic!("幂等关闭不应报错"),
        )
        .unwrap();
        assert!(decline_marked.get());
    }

    #[test]
    fn already_enabled_target_skips_duplicate_enable() {
        let backend = FakeAutostartBackend::with_statuses([Ok(true)]);
        let menu_values = RefCell::new(Vec::new());

        let actual = apply_autostart_target(&backend, true, |checked| {
            menu_values.borrow_mut().push(checked);
            Ok(())
        })
        .unwrap();

        assert!(actual);
        assert_eq!(backend.enable_calls.get(), 0);
        assert_eq!(backend.disable_calls.get(), 0);
        assert_eq!(menu_values.into_inner(), vec![true]);
    }

    #[test]
    fn enabled_state_is_disabled_and_then_requeried() {
        let backend = FakeAutostartBackend::with_statuses([Ok(true), Ok(false)]);
        let menu_values = RefCell::new(Vec::new());

        let actual = apply_autostart_target(&backend, false, |checked| {
            menu_values.borrow_mut().push(checked);
            Ok(())
        })
        .unwrap();

        assert!(!actual);
        assert_eq!(backend.enable_calls.get(), 0);
        assert_eq!(backend.disable_calls.get(), 1);
        assert!(backend.statuses.borrow().is_empty());
        assert_eq!(menu_values.into_inner(), vec![false]);
    }

    #[test]
    fn unavailable_initial_autostart_status_does_not_guess_or_toggle() {
        let backend = FakeAutostartBackend::with_statuses([Err("query failed".to_string())]);
        let menu_values = RefCell::new(Vec::new());

        let error = apply_autostart_target(&backend, false, |checked| {
            menu_values.borrow_mut().push(checked);
            Ok(())
        })
        .unwrap_err();

        assert_eq!(error, "query failed");
        assert_eq!(backend.enable_calls.get(), 0);
        assert_eq!(backend.disable_calls.get(), 0);
        assert!(menu_values.borrow().is_empty());
    }

    #[test]
    fn confirmed_autostart_sync_restores_normal_label_and_checked_state() {
        let labels = RefCell::new(Vec::new());
        let checked_values = RefCell::new(Vec::new());

        sync_autostart_menu_fields(
            true,
            |label| {
                labels.borrow_mut().push(label.to_string());
                Ok(())
            },
            |checked| {
                checked_values.borrow_mut().push(checked);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(labels.into_inner(), vec!["开机自启动"]);
        assert_eq!(checked_values.into_inner(), vec![true]);
    }

    #[test]
    fn missing_or_invalid_prompt_setting_means_not_seen() {
        assert!(!prompt_seen_value(None));
        assert!(!prompt_seen_value(Some(&json!("broken"))));
        assert!(prompt_seen_value(Some(&json!(true))));
    }

    #[test]
    fn invalid_settings_cleanup_removes_only_the_exact_file() {
        let directory = unique_temp_directory("settings");
        let settings_path = directory.join(SETTINGS_FILE);
        let sibling_path = directory.join("keep.json");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&settings_path, b"{broken").unwrap();
        fs::write(&sibling_path, b"keep").unwrap();

        assert!(remove_malformed_settings_file(&settings_path).unwrap());

        assert!(!settings_path.exists());
        assert_eq!(fs::read(&sibling_path).unwrap(), b"keep");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn valid_settings_file_is_preserved() {
        let directory = unique_temp_directory("valid-settings");
        let settings_path = directory.join(SETTINGS_FILE);
        fs::create_dir_all(&directory).unwrap();
        fs::write(&settings_path, br#"{"autostartPromptSeen":true}"#).unwrap();

        assert!(!remove_malformed_settings_file(&settings_path).unwrap());

        assert!(settings_path.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cached_prompt_value_is_cleared_after_disk_corruption() {
        let directory = unique_temp_directory("cached-corruption");
        let settings_path = directory.join(SETTINGS_FILE);
        let cached = FakeSettingsStore::default();
        cached.set_value(PROMPT_SEEN_KEY, json!(true));
        fs::create_dir_all(&directory).unwrap();
        fs::write(&settings_path, b"{broken").unwrap();

        let removed = remove_malformed_settings_file(&settings_path).unwrap();
        clear_store_after_removal(&cached, removed);

        assert!(!prompt_seen_value(
            cached.get_value(PROMPT_SEEN_KEY).as_ref()
        ));
        assert!(cached.values.borrow().is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_disable_does_not_mark_prompt_seen() {
        let marked = Cell::new(false);
        let messages = RefCell::new(Vec::new());

        let error = persist_decline_after_disable(
            Err("disable failed".to_string()),
            || {
                marked.set(true);
                Ok(())
            },
            |message| messages.borrow_mut().push(message.to_string()),
        )
        .unwrap_err();

        assert_eq!(error, "disable failed");
        assert!(!marked.get());
        assert_eq!(
            messages.into_inner(),
            vec!["未能关闭开机自启动，请稍后重试：disable failed"]
        );
    }

    #[test]
    fn only_confirmed_disabled_state_marks_prompt_seen() {
        let marked = Cell::new(false);
        let messages = RefCell::new(Vec::new());

        let error = persist_decline_after_disable(
            Ok(true),
            || {
                marked.set(true);
                Ok(())
            },
            |message| messages.borrow_mut().push(message.to_string()),
        )
        .unwrap_err();
        assert_eq!(error, "开机自启动仍处于开启状态");
        assert!(!marked.get());
        assert_eq!(
            messages.borrow().as_slice(),
            ["未能关闭开机自启动，请稍后重试：开机自启动仍处于开启状态"]
        );

        persist_decline_after_disable(
            Ok(false),
            || {
                marked.set(true);
                Ok(())
            },
            |_| panic!("确认关闭不应发送错误提示"),
        )
        .unwrap();
        assert!(marked.get());
    }

    #[test]
    fn failed_prompt_save_is_reported_to_settings() {
        let message = RefCell::new(String::new());

        let error = persist_decline_after_disable(
            Ok(false),
            || Err("save failed".to_string()),
            |value| *message.borrow_mut() = value.to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "save failed");
        assert_eq!(
            message.into_inner(),
            "未能保存开机自启动选择，请稍后重试：save failed"
        );
    }

    #[test]
    fn failed_prompt_read_is_reported_to_settings() {
        let message = RefCell::new(String::new());

        let error = prompt_seen_for_close(
            Err("read failed".to_string()),
            |value| *message.borrow_mut() = value.to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "read failed");
        assert_eq!(
            message.into_inner(),
            "未能读取开机自启动选择，请稍后重试：read failed"
        );
    }

    #[test]
    fn missing_menu_state_is_reported_without_marking_prompt_seen() {
        let marked = Cell::new(false);
        let message = RefCell::new(String::new());

        let error = persist_decline_after_disable(
            Err("开机自启动菜单尚未就绪".to_string()),
            || {
                marked.set(true);
                Ok(())
            },
            |value| *message.borrow_mut() = value.to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "开机自启动菜单尚未就绪");
        assert!(!marked.get());
        assert_eq!(
            message.into_inner(),
            "未能关闭开机自启动，请稍后重试：开机自启动菜单尚未就绪"
        );
    }

    #[test]
    fn failed_prompt_save_restores_the_previous_cached_value() {
        let store = FakeSettingsStore::default();
        store.set_value(PROMPT_SEEN_KEY, json!(false));
        store.fail_save.set(true);

        assert!(set_prompt_seen_and_save(&store).is_err());

        assert_eq!(store.get_value(PROMPT_SEEN_KEY), Some(json!(false)));
    }

    #[test]
    fn failed_prompt_save_removes_a_new_cached_key() {
        let store = FakeSettingsStore::default();
        store.fail_save.set(true);

        assert!(set_prompt_seen_and_save(&store).is_err());

        assert_eq!(store.get_value(PROMPT_SEEN_KEY), None);
    }
}
