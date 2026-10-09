use std::{
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};
use tauri::State;

#[cfg(windows)]
use std::{fs::OpenOptions, os::windows::fs::MetadataExt};

const WEBVIEW_CACHE_DIRECTORY: &str = "EBWebView";
const CLEANUP_LOCK_FILE: &str = ".webview-cache-cleanup.lock";
#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CleanupOutcome {
    NotPresent,
    Removed,
}

pub(crate) struct CleanupGuard {
    #[cfg(windows)]
    _lock_file: fs::File,
}

pub(crate) struct StartupCleanup {
    _guard: Option<CleanupGuard>,
    error: Option<String>,
}

#[derive(Clone)]
pub struct StartupCleanupError(Option<String>);

impl StartupCleanupError {
    pub(crate) fn message(&self) -> Option<&str> {
        self.0.as_deref()
    }
}

impl From<&StartupCleanup> for StartupCleanupError {
    fn from(cleanup: &StartupCleanup) -> Self {
        Self(cleanup.error.clone())
    }
}

#[tauri::command]
pub fn get_startup_cleanup_error(state: State<'_, StartupCleanupError>) -> Option<String> {
    state.message().map(str::to_owned)
}

#[cfg(test)]
impl StartupCleanup {
    pub(crate) fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
}

fn validate_identifier(identifier: &str) -> Result<(), String> {
    if identifier.is_empty()
        || identifier.contains(['/', '\\', ':', '\0'])
        || matches!(identifier, "." | "..")
    {
        return Err("应用标识不安全，已跳过 WebView 临时数据清理".to_string());
    }

    let mut components = Path::new(identifier).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(value)), None) if value == OsStr::new(identifier) => Ok(()),
        _ => Err("应用标识不安全，已跳过 WebView 临时数据清理".to_string()),
    }
}

fn validate_resolved_app_root(resolved_app_root: &Path, identifier: &str) -> Result<(), String> {
    validate_identifier(identifier)?;
    if !resolved_app_root.is_absolute() {
        return Err("Tauri 解析的应用本地数据目录不是绝对路径，已拒绝清理".to_string());
    }
    if resolved_app_root.file_name() != Some(OsStr::new(identifier)) {
        return Err("Tauri 解析的应用本地数据目录与应用标识不匹配，已拒绝清理".to_string());
    }
    Ok(())
}

pub(crate) fn webview_cache_path(
    resolved_app_root: &Path,
    identifier: &str,
) -> Result<PathBuf, String> {
    validate_resolved_app_root(resolved_app_root, identifier)?;
    Ok(resolved_app_root.join(WEBVIEW_CACHE_DIRECTORY))
}

#[cfg(any(not(windows), test))]
pub(crate) fn prepare_startup_cleanup_noop() -> StartupCleanup {
    StartupCleanup {
        _guard: None,
        error: None,
    }
}

pub(crate) fn validate_cleanup_directory(
    label: &str,
    is_directory: bool,
    is_reparse_point: bool,
) -> Result<(), String> {
    if is_reparse_point {
        return Err(format!("{label} 是链接或重解析点，已拒绝清理"));
    }
    if !is_directory {
        return Err(format!("{label} 不是普通目录，已拒绝清理"));
    }
    Ok(())
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法检查 {}：{error}", path.display())),
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

pub(crate) fn clear_previous_webview_data(
    resolved_app_root: &Path,
    identifier: &str,
) -> Result<CleanupOutcome, String> {
    let cache_path = webview_cache_path(resolved_app_root, identifier)?;

    let Some(app_metadata) = metadata(resolved_app_root)? else {
        return Ok(CleanupOutcome::NotPresent);
    };
    validate_cleanup_directory(
        "应用本地数据目录",
        app_metadata.is_dir(),
        is_reparse_point(&app_metadata),
    )?;

    let Some(cache_metadata) = metadata(&cache_path)? else {
        return Ok(CleanupOutcome::NotPresent);
    };
    validate_cleanup_directory(
        WEBVIEW_CACHE_DIRECTORY,
        cache_metadata.is_dir(),
        is_reparse_point(&cache_metadata),
    )?;

    fs::remove_dir_all(&cache_path)
        .map_err(|error| format!("无法清理 {}：{error}", cache_path.display()))?;
    if metadata(&cache_path)?.is_some() {
        return Err(format!("清理后目录仍然存在：{}", cache_path.display()));
    }

    Ok(CleanupOutcome::Removed)
}

#[cfg(windows)]
fn prepare_app_root(resolved_app_root: &Path, identifier: &str) -> Result<(), String> {
    validate_resolved_app_root(resolved_app_root, identifier)?;
    if let Some(app_metadata) = metadata(resolved_app_root)? {
        return validate_cleanup_directory(
            "应用本地数据目录",
            app_metadata.is_dir(),
            is_reparse_point(&app_metadata),
        );
    }

    fs::create_dir_all(resolved_app_root).map_err(|error| {
        format!(
            "无法创建应用本地数据目录 {}：{error}",
            resolved_app_root.display()
        )
    })?;
    let app_metadata = metadata(resolved_app_root)?
        .ok_or_else(|| "创建应用本地数据目录后无法找到该目录".to_string())?;
    validate_cleanup_directory(
        "应用本地数据目录",
        app_metadata.is_dir(),
        is_reparse_point(&app_metadata),
    )
}

#[cfg(windows)]
pub(crate) fn acquire_app_root_lock(
    resolved_app_root: &Path,
    identifier: &str,
) -> Result<Option<CleanupGuard>, String> {
    prepare_app_root(resolved_app_root, identifier)?;
    let lock_path = resolved_app_root.join(CLEANUP_LOCK_FILE);
    if let Some(lock_metadata) = metadata(&lock_path)? {
        if is_reparse_point(&lock_metadata) || !lock_metadata.is_file() {
            return Err("WebView 清理锁不是普通文件，应用已安全退出".to_string());
        }
    }

    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("无法打开 WebView 清理锁 {}：{error}", lock_path.display()))?;
    match fs2::FileExt::try_lock_exclusive(&lock_file) {
        Ok(()) => Ok(Some(CleanupGuard {
            _lock_file: lock_file,
        })),
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            Ok(None)
        }
        Err(error) => Err(format!(
            "无法锁定 WebView 清理锁 {}：{error}",
            lock_path.display()
        )),
    }
}

#[cfg(windows)]
pub(crate) fn prepare_startup_cleanup(
    resolved_app_root: &Path,
    identifier: &str,
) -> Result<Option<StartupCleanup>, String> {
    let Some(guard) = acquire_app_root_lock(resolved_app_root, identifier)? else {
        return Ok(None);
    };
    let error = clear_previous_webview_data(resolved_app_root, identifier)
        .err()
        .map(|error| format!("WebView 临时数据清理失败：{error}"));
    Ok(Some(StartupCleanup {
        _guard: Some(guard),
        error,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_directory(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "electronic-almanac-cache-{prefix}-{}-{unique}",
            std::process::id()
        ))
    }

    const IDENTIFIER: &str = "com.paida.electronic-almanac";

    fn app_root(prefix: &str) -> (PathBuf, PathBuf) {
        let base = unique_temp_directory(prefix);
        let root = base.join(IDENTIFIER);
        (base, root)
    }

    #[test]
    fn cache_path_uses_the_injected_absolute_resolved_app_root() {
        let (_base, resolved_app_root) = app_root("resolved-root");

        assert_eq!(
            webview_cache_path(&resolved_app_root, IDENTIFIER).unwrap(),
            resolved_app_root.join("EBWebView")
        );
    }

    #[test]
    fn relative_or_mismatched_resolved_roots_are_rejected() {
        assert!(webview_cache_path(Path::new(IDENTIFIER), IDENTIFIER).is_err());

        let absolute_wrong_root = unique_temp_directory("wrong-root").join("other-app");
        assert!(webview_cache_path(&absolute_wrong_root, IDENTIFIER).is_err());
    }

    #[test]
    fn unsafe_identifiers_are_rejected_with_an_injected_resolved_root() {
        let (_base, resolved_app_root) = app_root("unsafe-identifier");
        for identifier in ["", ".", "..", "../escape", r"..\escape", "a/b", r"a\b"] {
            assert!(webview_cache_path(&resolved_app_root, identifier).is_err());
        }
    }

    #[test]
    fn cleanup_removes_only_ebwebview_and_preserves_siblings() {
        let (base, resolved_app_root) = app_root("exact-target");
        let cache = resolved_app_root.join("EBWebView");
        let marker = cache.join("marker.txt");
        let sibling = resolved_app_root.join("keep.txt");
        let settings = resolved_app_root.join("settings.json");
        let lock_file = resolved_app_root.join(CLEANUP_LOCK_FILE);
        fs::create_dir_all(&cache).unwrap();
        fs::write(&marker, b"delete me").unwrap();
        fs::write(&sibling, b"keep me").unwrap();
        fs::write(&settings, b"{\"keep\":true}").unwrap();
        fs::write(&lock_file, b"").unwrap();

        assert_eq!(
            clear_previous_webview_data(&resolved_app_root, IDENTIFIER).unwrap(),
            CleanupOutcome::Removed
        );

        assert!(!cache.exists());
        assert_eq!(fs::read(&sibling).unwrap(), b"keep me");
        assert_eq!(fs::read(&settings).unwrap(), b"{\"keep\":true}");
        assert!(lock_file.is_file());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn an_unsafe_app_root_or_cache_target_is_rejected() {
        assert!(validate_cleanup_directory("app root", true, true).is_err());
        assert!(validate_cleanup_directory("EBWebView", true, true).is_err());
        assert!(validate_cleanup_directory("EBWebView", false, false).is_err());

        let (base, resolved_app_root) = app_root("file-target");
        fs::create_dir_all(&resolved_app_root).unwrap();
        fs::write(resolved_app_root.join("EBWebView"), b"not a directory").unwrap();

        assert!(clear_previous_webview_data(&resolved_app_root, IDENTIFIER).is_err());
        assert!(resolved_app_root.join("EBWebView").is_file());
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn app_root_lock_contends_across_handles_and_releases_on_drop() {
        let (base, resolved_app_root) = app_root("lock-contention");
        let first = acquire_app_root_lock(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .expect("first handle should own the lock");
        assert!(acquire_app_root_lock(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .is_none());
        drop(first);
        let after_release = acquire_app_root_lock(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .expect("lock should be reusable after the owner drops");

        assert!(resolved_app_root.join(CLEANUP_LOCK_FILE).is_file());
        drop(after_release);
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn different_resolved_app_roots_do_not_share_a_lock_scope() {
        let (base_a, root_a) = app_root("lock-scope-a");
        let (base_b, root_b) = app_root("lock-scope-b");
        let lock_a = acquire_app_root_lock(&root_a, IDENTIFIER)
            .unwrap()
            .expect("root A should lock");
        let lock_b = acquire_app_root_lock(&root_b, IDENTIFIER)
            .unwrap()
            .expect("root B should lock independently");

        drop(lock_a);
        drop(lock_b);
        fs::remove_dir_all(&base_a).unwrap();
        fs::remove_dir_all(&base_b).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn first_startup_cleans_second_preserves_and_restart_cleans() {
        let (base, resolved_app_root) = app_root("startup-decision");
        let marker = resolved_app_root.join("EBWebView").join("marker.txt");
        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(&marker, b"old session").unwrap();

        let first_startup = prepare_startup_cleanup(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .expect("first startup should run");
        assert!(first_startup.error().is_none());
        assert!(!marker.exists());

        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(&marker, b"active session").unwrap();
        assert!(prepare_startup_cleanup(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .is_none());
        assert_eq!(fs::read(&marker).unwrap(), b"active session");

        drop(first_startup);
        let restarted = prepare_startup_cleanup(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .expect("restart should reacquire the lock");
        assert!(!marker.exists());

        drop(restarted);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn non_windows_startup_noop_has_no_cleanup_error() {
        let startup = prepare_startup_cleanup_noop();
        assert!(startup.error().is_none());
        assert!(StartupCleanupError::from(&startup).message().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_failure_is_exposed_after_the_app_root_lock_is_acquired() {
        let (base, resolved_app_root) = app_root("cleanup-error");
        fs::create_dir_all(&resolved_app_root).unwrap();
        fs::write(resolved_app_root.join("EBWebView"), b"not a directory").unwrap();
        let startup = prepare_startup_cleanup(&resolved_app_root, IDENTIFIER)
            .unwrap()
            .expect("lock acquisition should still succeed");
        let state = StartupCleanupError::from(&startup);

        assert!(state
            .message()
            .unwrap()
            .contains("WebView 临时数据清理失败"));
        assert!(resolved_app_root.join("EBWebView").is_file());
        drop(startup);
        fs::remove_dir_all(&base).unwrap();
    }
}
