use std::{
    ffi::OsStr,
    os::windows::ffi::OsStrExt,
    path::{Component, Path},
    process::Command,
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_INVALID_PARAMETER, HANDLE,
        WAIT_ABANDONED_0, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    System::Threading::{
        CreateEventW, CreateMutexW, OpenProcess, ReleaseMutex, ResetEvent, SetEvent,
        WaitForMultipleObjects, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    },
    UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId},
};

const STARTUP_MUTEX_SUFFIX: &str = "startup-v1";
const READY_EVENT_SUFFIX: &str = "startup-ready-v1";
const RETRY_PARENT_PID_ENV: &str = "ELECTRONIC_ALMANAC_INTERNAL_RETRY_PARENT_PID";
pub(crate) const STARTUP_GATE_TIMEOUT_MS: u32 = 30_000;
pub(crate) const RETRY_PARENT_WAIT_TIMEOUT_MS: u32 = 15_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartupRole {
    Primary,
    SecondaryReady,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CallbackOwnerDecision {
    Continue,
    RelaunchOnce,
    Exit,
}

#[derive(Debug)]
struct GateHandles {
    mutex: usize,
    ready_event: usize,
    owns_mutex: bool,
}

impl Drop for GateHandles {
    fn drop(&mut self) {
        unsafe {
            if self.owns_mutex {
                ReleaseMutex(self.mutex as HANDLE);
            }
            CloseHandle(self.ready_event as HANDLE);
            CloseHandle(self.mutex as HANDLE);
        }
    }
}

#[derive(Debug)]
pub(crate) struct PendingStartupGate {
    handles: GateHandles,
    created_mutex: bool,
}

#[derive(Debug)]
pub(crate) struct StartupGate {
    handles: GateHandles,
    role: StartupRole,
}

fn validate_identifier(identifier: &str) -> Result<(), String> {
    if identifier.is_empty()
        || identifier.contains(['/', '\\', ':', '\0'])
        || matches!(identifier, "." | "..")
    {
        return Err("应用标识不安全，已拒绝建立启动门".to_string());
    }

    let mut components = Path::new(identifier).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(value)), None) if value == OsStr::new(identifier) => Ok(()),
        _ => Err("应用标识不安全，已拒绝建立启动门".to_string()),
    }
}

fn encode_wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn callback_target_names(identifier: &str) -> Result<(String, String), String> {
    validate_identifier(identifier)?;
    Ok((format!("{identifier}-sic"), format!("{identifier}-siw")))
}

pub(crate) fn current_process_owns_callback(identifier: &str) -> Result<bool, String> {
    let (class_name, window_name) = callback_target_names(identifier)?;
    let class_name = encode_wide(class_name);
    let window_name = encode_wide(window_name);
    let callback_window = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
    if callback_window.is_null() {
        return Ok(false);
    }

    let mut owner_pid = 0;
    let owner_thread = unsafe { GetWindowThreadProcessId(callback_window, &mut owner_pid) };
    Ok(owner_thread != 0 && owner_pid == std::process::id())
}

pub(crate) fn callback_owner_decision(
    callback_owned_by_current_process: bool,
    retry_parent_pid: Option<u32>,
) -> CallbackOwnerDecision {
    if callback_owned_by_current_process {
        CallbackOwnerDecision::Continue
    } else if retry_parent_pid.is_none() {
        CallbackOwnerDecision::RelaunchOnce
    } else {
        CallbackOwnerDecision::Exit
    }
}

fn parse_retry_parent_pid(value: Option<&OsStr>) -> Result<Option<u32>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let parent_pid = value
        .to_str()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|pid| *pid != 0)
        .ok_or_else(|| "内部启动重试标记无效，当前实例已安全退出".to_string())?;
    Ok(Some(parent_pid))
}

pub(crate) fn retry_parent_pid_from_env() -> Result<Option<u32>, String> {
    parse_retry_parent_pid(std::env::var_os(RETRY_PARENT_PID_ENV).as_deref())
}

pub(crate) fn wait_for_retry_parent(parent_pid: u32, timeout_ms: u32) -> Result<(), String> {
    if parent_pid == std::process::id() {
        return Err("内部启动重试不能等待当前进程".to_string());
    }

    let parent = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_pid) };
    if parent.is_null() {
        let error_code = unsafe { GetLastError() };
        if error_code == ERROR_INVALID_PARAMETER {
            return Ok(());
        }
        return Err(format!(
            "无法等待上一个启动进程退出：{}",
            std::io::Error::from_raw_os_error(error_code as i32)
        ));
    }

    let wait_result = unsafe { WaitForSingleObject(parent, timeout_ms) };
    let wait_error = if wait_result == WAIT_FAILED {
        Some(std::io::Error::last_os_error())
    } else {
        None
    };
    unsafe { CloseHandle(parent) };
    match wait_result {
        WAIT_OBJECT_0 => Ok(()),
        WAIT_TIMEOUT => Err("等待上一个启动进程退出超时，当前实例已安全退出".to_string()),
        WAIT_FAILED => Err(format!(
            "等待上一个启动进程退出失败：{}",
            wait_error.unwrap()
        )),
        value => Err(format!("等待上一个启动进程返回未知结果：{value}")),
    }
}

pub(crate) fn spawn_retry_after_current_process() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("无法定位启动重试程序：{error}"))?;
    Command::new(executable)
        .env(RETRY_PARENT_PID_ENV, std::process::id().to_string())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动一次性重试进程：{error}"))
}

pub(crate) fn open_startup_gate(identifier: &str) -> Result<PendingStartupGate, String> {
    validate_identifier(identifier)?;
    let mutex_name = encode_wide(format!("Local\\{identifier}-{STARTUP_MUTEX_SUFFIX}"));
    let mutex = unsafe { CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr()) };
    if mutex.is_null() {
        return Err(format!(
            "无法建立启动门互斥锁：{}",
            std::io::Error::last_os_error()
        ));
    }
    let created_mutex = unsafe { GetLastError() } != ERROR_ALREADY_EXISTS;

    let event_name = encode_wide(format!("Local\\{identifier}-{READY_EVENT_SUFFIX}"));
    let ready_event = unsafe { CreateEventW(std::ptr::null(), 1, 0, event_name.as_ptr()) };
    if ready_event.is_null() {
        let error = std::io::Error::last_os_error();
        if created_mutex {
            unsafe { ReleaseMutex(mutex) };
        }
        unsafe { CloseHandle(mutex) };
        return Err(format!("无法建立启动门就绪事件：{error}"));
    }
    if created_mutex && unsafe { ResetEvent(ready_event) } == 0 {
        let error = std::io::Error::last_os_error();
        unsafe {
            ReleaseMutex(mutex);
            CloseHandle(ready_event);
            CloseHandle(mutex);
        }
        return Err(format!("无法重置启动门就绪事件：{error}"));
    }

    Ok(PendingStartupGate {
        handles: GateHandles {
            mutex: mutex as usize,
            ready_event: ready_event as usize,
            owns_mutex: created_mutex,
        },
        created_mutex,
    })
}

pub(crate) fn acquire_startup_gate(
    identifier: &str,
    timeout_ms: u32,
) -> Result<StartupGate, String> {
    open_startup_gate(identifier)?.resolve(timeout_ms)
}

impl PendingStartupGate {
    pub(crate) fn resolve(mut self, timeout_ms: u32) -> Result<StartupGate, String> {
        if self.created_mutex {
            return Ok(StartupGate {
                handles: self.handles,
                role: StartupRole::Primary,
            });
        }

        let handles = [
            self.handles.mutex as HANDLE,
            self.handles.ready_event as HANDLE,
        ];
        match unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, timeout_ms) }
        {
            WAIT_OBJECT_0 | WAIT_ABANDONED_0 => {
                self.handles.owns_mutex = true;
                if unsafe { ResetEvent(self.handles.ready_event as HANDLE) } == 0 {
                    return Err(format!(
                        "无法重置启动门就绪事件：{}",
                        std::io::Error::last_os_error()
                    ));
                }
                Ok(StartupGate {
                    handles: self.handles,
                    role: StartupRole::Primary,
                })
            }
            value if value == WAIT_OBJECT_0 + 1 => Ok(StartupGate {
                handles: self.handles,
                role: StartupRole::SecondaryReady,
            }),
            WAIT_TIMEOUT => Err("等待主实例初始化超时，当前实例已安全退出".to_string()),
            WAIT_FAILED => Err(format!(
                "等待启动门失败：{}",
                std::io::Error::last_os_error()
            )),
            value => Err(format!("等待启动门返回未知状态：{value}")),
        }
    }
}

impl StartupGate {
    pub(crate) fn can_claim_app_root(&self) -> bool {
        self.role == StartupRole::Primary
    }

    pub(crate) fn mark_ready(&self) -> Result<(), String> {
        if !self.can_claim_app_root() {
            return Err("后续实例不能发布主实例就绪信号".to_string());
        }
        if unsafe { SetEvent(self.handles.ready_event as HANDLE) } == 0 {
            return Err(format!(
                "无法发布主实例就绪信号：{}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    pub(crate) fn promote_after_builder_return(mut self) -> Result<Option<Self>, String> {
        if self.can_claim_app_root() {
            return Ok(Some(self));
        }

        match unsafe { WaitForSingleObject(self.handles.mutex as HANDLE, 0) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED_0 => {
                self.handles.owns_mutex = true;
                if unsafe { ResetEvent(self.handles.ready_event as HANDLE) } == 0 {
                    return Err(format!(
                        "无法重置启动门就绪事件：{}",
                        std::io::Error::last_os_error()
                    ));
                }
                self.role = StartupRole::Primary;
                Ok(Some(self))
            }
            WAIT_TIMEOUT => Ok(None),
            WAIT_FAILED => Err(format!(
                "重新确认主实例状态失败：{}",
                std::io::Error::last_os_error()
            )),
            value => Err(format!("重新确认主实例状态返回未知结果：{value}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::mpsc,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_identifier(prefix: &str) -> String {
        format!(
            "com.paida.electronic-almanac.gate.{prefix}.{}.{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    #[test]
    fn primary_ready_signal_releases_a_secondary_to_build_only_as_secondary() {
        let identifier = unique_identifier("ready");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        assert!(primary.can_claim_app_root());
        let secondary = open_startup_gate(&identifier).unwrap();

        primary.mark_ready().unwrap();
        let secondary = std::thread::spawn(move || secondary.resolve(1_000))
            .join()
            .unwrap()
            .unwrap();

        assert!(!secondary.can_claim_app_root());
        assert!(secondary.mark_ready().is_err());
    }

    #[test]
    fn released_mutex_wins_over_a_stale_ready_signal() {
        let identifier = unique_identifier("ready-then-drop");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();

        primary.mark_ready().unwrap();
        drop(primary);
        let replacement = secondary.resolve(1_000).unwrap();

        assert!(replacement.can_claim_app_root());
    }

    #[test]
    fn secondary_promotes_when_builder_returns_after_primary_drops() {
        let identifier = unique_identifier("post-build-drop");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();
        primary.mark_ready().unwrap();
        let secondary = std::thread::spawn(move || secondary.resolve(1_000))
            .join()
            .unwrap()
            .unwrap();
        assert!(!secondary.can_claim_app_root());

        drop(primary);
        let replacement = secondary
            .promote_after_builder_return()
            .unwrap()
            .unwrap();

        assert!(replacement.can_claim_app_root());
    }

    #[test]
    fn post_build_promotion_refuses_app_root_while_primary_still_owns_mutex() {
        let identifier = unique_identifier("post-build-held");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();
        primary.mark_ready().unwrap();
        let secondary = std::thread::spawn(move || secondary.resolve(1_000))
            .join()
            .unwrap()
            .unwrap();
        let untouched_root = PathBuf::from(format!(r"C:\does-not-exist\{identifier}"));

        let promotion = std::thread::spawn(move || secondary.promote_after_builder_return())
            .join()
            .unwrap()
            .unwrap();

        assert!(promotion.is_none());
        assert!(!untouched_root.exists());
        drop(primary);
    }

    #[test]
    fn secondary_takes_over_when_primary_drops_before_ready() {
        let identifier = unique_identifier("drop-takeover");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();

        drop(primary);
        let replacement = secondary.resolve(1_000).unwrap();

        assert!(replacement.can_claim_app_root());
    }

    #[test]
    fn a_new_primary_clears_a_stale_ready_event_before_building() {
        let identifier = unique_identifier("stale-ready");
        let event_name = encode_wide(format!("Local\\{identifier}-{READY_EVENT_SUFFIX}"));
        let stale_event = unsafe { CreateEventW(std::ptr::null(), 1, 1, event_name.as_ptr()) };
        assert!(!stale_event.is_null());

        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();
        let waiter = std::thread::spawn(move || secondary.resolve(0));

        assert!(waiter.join().unwrap().is_err());
        drop(primary);
        unsafe { CloseHandle(stale_event) };
    }

    #[test]
    fn unresolved_secondary_times_out_without_becoming_builder_or_touching_app_root() {
        let identifier = unique_identifier("timeout");
        let primary = open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();
        let untouched_root = PathBuf::from(format!(r"C:\does-not-exist\{identifier}"));

        let waiter = std::thread::spawn(move || secondary.resolve(0));
        let error = waiter.join().unwrap().unwrap_err();

        assert!(error.contains("超时"));
        assert!(!untouched_root.exists());
        drop(primary);
    }

    #[test]
    fn abandoned_primary_is_taken_over_without_a_sleep_based_race() {
        let identifier = unique_identifier("abandoned");
        let (owned_tx, owned_rx) = mpsc::channel();
        let (exit_tx, exit_rx) = mpsc::channel();
        let owner_identifier = identifier.clone();
        let owner = std::thread::spawn(move || {
            let primary = open_startup_gate(&owner_identifier)
                .unwrap()
                .resolve(1_000)
                .unwrap();
            assert!(primary.can_claim_app_root());
            owned_tx.send(()).unwrap();
            exit_rx.recv().unwrap();
            std::mem::forget(primary);
        });

        owned_rx.recv().unwrap();
        let secondary = open_startup_gate(&identifier).unwrap();
        exit_tx.send(()).unwrap();
        owner.join().unwrap();

        let replacement = secondary.resolve(1_000).unwrap();
        assert!(replacement.can_claim_app_root());
    }

    #[test]
    fn unsafe_identifier_is_rejected_before_kernel_objects_are_created() {
        for identifier in ["", ".", "..", "../escape", r"..\escape", "a/b", r"a\b"] {
            assert!(open_startup_gate(identifier).is_err());
        }
    }

    #[test]
    fn callback_probe_uses_the_pinned_plugin_window_names() {
        let (class_name, window_name) = callback_target_names("com.paida.example").unwrap();

        assert_eq!(class_name, "com.paida.example-sic");
        assert_eq!(window_name, "com.paida.example-siw");
    }

    #[test]
    fn callback_owner_decision_never_runs_without_a_current_process_target() {
        assert_eq!(
            callback_owner_decision(true, None),
            CallbackOwnerDecision::Continue
        );
        assert_eq!(
            callback_owner_decision(false, None),
            CallbackOwnerDecision::RelaunchOnce
        );
        assert_eq!(
            callback_owner_decision(false, Some(123)),
            CallbackOwnerDecision::Exit
        );
    }

    #[test]
    fn retry_parent_parser_accepts_one_positive_pid_only() {
        assert_eq!(parse_retry_parent_pid(None).unwrap(), None);
        assert_eq!(
            parse_retry_parent_pid(Some(OsStr::new("123"))).unwrap(),
            Some(123)
        );
        assert!(parse_retry_parent_pid(Some(OsStr::new("0"))).is_err());
        assert!(parse_retry_parent_pid(Some(OsStr::new("not-a-pid"))).is_err());
    }

    #[test]
    fn retry_child_claims_primary_only_after_the_parent_process_exits() {
        let mut parent = Command::new("cmd.exe")
            .args(["/D", "/C", "exit", "0"])
            .spawn()
            .unwrap();

        wait_for_retry_parent(parent.id(), 5_000).unwrap();
        assert!(parent.wait().unwrap().success());

        let identifier = unique_identifier("retry-parent-exited");
        let replacement = acquire_startup_gate(&identifier, 1_000).unwrap();
        assert!(replacement.can_claim_app_root());
    }
}
