pub mod almanac_state;
pub mod cache_cleanup;
pub mod settings;
#[cfg(windows)]
mod startup_gate;
pub mod tray;

use almanac_state::AlmanacState;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Debug, PartialEq, Eq)]
enum MainCloseAction {
    Hide,
    KeepVisible,
}

fn main_close_action(result: Result<(), String>) -> MainCloseAction {
    match result {
        Ok(()) => MainCloseAction::Hide,
        Err(_) => MainCloseAction::KeepVisible,
    }
}

fn show_main_on_startup(prompt_seen: bool, cleanup_failed: bool) -> bool {
    !prompt_seen || cleanup_failed
}

#[cfg(windows)]
fn publish_ready_after_setup(gate: &startup_gate::StartupGate) -> Result<(), String> {
    gate.mark_ready()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    let retry_parent_pid = match startup_gate::retry_parent_pid_from_env() {
        Ok(parent_pid) => parent_pid,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };
    #[cfg(windows)]
    if let Some(parent_pid) = retry_parent_pid {
        if let Err(error) = startup_gate::wait_for_retry_parent(
            parent_pid,
            startup_gate::RETRY_PARENT_WAIT_TIMEOUT_MS,
        ) {
            eprintln!("{error}");
            return;
        }
    }

    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();

    #[cfg(windows)]
    let startup_gate = match startup_gate::acquire_startup_gate(
        &identifier,
        startup_gate::STARTUP_GATE_TIMEOUT_MS,
    ) {
        Ok(gate) => gate,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };

    // `build` initializes plugins but the event loop has not created configured WebViews yet.
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = tray::show_card(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AlmanacState::default())
        .invoke_handler(tauri::generate_handler![
            almanac_state::publish_almanac_snapshot,
            almanac_state::get_almanac_snapshot,
            cache_cleanup::get_startup_cleanup_error,
            settings::get_prompt_seen,
            settings::get_autostart,
            settings::set_autostart,
            settings::complete_autostart_prompt,
            tray::show_details,
            tray::hide_tray_card,
        ])
        .setup(|app| {
            tray::build_tray(app)?;
            let prompt_seen = settings::get_prompt_seen(app.handle().clone()).unwrap_or(false);
            let cleanup_failed = app
                .state::<cache_cleanup::StartupCleanupError>()
                .message()
                .is_some();
            if show_main_on_startup(prompt_seen, cleanup_failed) {
                tray::show_main(app.handle())
                    .map_err(std::io::Error::other)?;
            }
            #[cfg(windows)]
            {
                let gate = app
                    .try_state::<startup_gate::StartupGate>()
                    .ok_or_else(|| std::io::Error::other("启动门状态不存在"))?;
                publish_ready_after_setup(&gate).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == "tray-card" => {
                let _ = window.hide();
            }
            WindowEvent::Focused(true) => {
                let _ = window
                    .app_handle()
                    .emit("almanac://refresh-requested", ());
            }
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                match main_close_action(settings::decline_prompt_on_window_close(
                    window.app_handle(),
                )) {
                    MainCloseAction::Hide => {
                        let _ = window.hide();
                    }
                    MainCloseAction::KeepVisible => {
                        let _ = tray::show_main(window.app_handle());
                    }
                }
            }
            _ => {}
        })
        .build(context)
        .expect("error while building electronic almanac");

    #[cfg(windows)]
    let startup_gate = if startup_gate.can_claim_app_root() {
        startup_gate
    } else {
        // The plugin normally exits a secondary during `build`. If it returns, the callback owner
        // may have exited in the meantime, so re-check the mutex before deciding who owns the root.
        match startup_gate.promote_after_builder_return() {
            Ok(Some(gate)) => gate,
            Ok(None) => return,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        }
    };
    #[cfg(windows)]
    {
        let owns_callback = match startup_gate::current_process_owns_callback(&identifier) {
            Ok(owns_callback) => owns_callback,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        };
        match startup_gate::callback_owner_decision(owns_callback, retry_parent_pid) {
            startup_gate::CallbackOwnerDecision::Continue => {}
            startup_gate::CallbackOwnerDecision::RelaunchOnce => {
                if let Err(error) = startup_gate::spawn_retry_after_current_process() {
                    eprintln!("{error}");
                }
                return;
            }
            startup_gate::CallbackOwnerDecision::Exit => return,
        }
    }

    #[cfg(windows)]
    let startup_cleanup = {
        let resolved_app_root = match app
            .path()
            .resolve(&identifier, tauri::path::BaseDirectory::LocalData)
        {
            Ok(path) => path,
            Err(error) => {
                eprintln!("无法通过 Tauri 解析应用本地数据目录：{error}");
                return;
            }
        };
        match cache_cleanup::prepare_startup_cleanup(&resolved_app_root, &identifier) {
            Ok(Some(cleanup)) => cleanup,
            Ok(None) => return,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        }
    };
    #[cfg(not(windows))]
    let startup_cleanup = cache_cleanup::prepare_startup_cleanup_noop();

    let startup_cleanup_error = cache_cleanup::StartupCleanupError::from(&startup_cleanup);
    app.manage(startup_cleanup_error);
    #[cfg(windows)]
    app.manage(startup_gate);
    app.run(|_, _| {});
    drop(startup_cleanup);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_window_hides_only_after_prompt_close_succeeds() {
        assert_eq!(
            main_close_action(Ok(())),
            MainCloseAction::Hide
        );
        assert_eq!(
            main_close_action(Err("save failed".to_string())),
            MainCloseAction::KeepVisible
        );
    }

    #[test]
    fn only_an_unseen_prompt_opens_main_at_startup() {
        assert!(show_main_on_startup(false, false));
        assert!(!show_main_on_startup(true, false));
    }

    #[test]
    fn cleanup_failure_forces_the_main_window_visible() {
        assert!(show_main_on_startup(true, true));
    }

    #[cfg(windows)]
    #[test]
    fn ready_is_published_only_by_successful_setup_completion() {
        let identifier = format!(
            "com.paida.electronic-almanac.setup-ready.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let primary = startup_gate::open_startup_gate(&identifier)
            .unwrap()
            .resolve(1_000)
            .unwrap();
        let before_setup = startup_gate::open_startup_gate(&identifier).unwrap();
        let error = std::thread::spawn(move || before_setup.resolve(0))
            .join()
            .unwrap()
            .unwrap_err();
        assert!(error.contains("超时"));

        let after_setup = startup_gate::open_startup_gate(&identifier).unwrap();
        publish_ready_after_setup(&primary).unwrap();
        let secondary = std::thread::spawn(move || after_setup.resolve(1_000))
            .join()
            .unwrap()
            .unwrap();

        assert!(!secondary.can_claim_app_root());
    }
}
