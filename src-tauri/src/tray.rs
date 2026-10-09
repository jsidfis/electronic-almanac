use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalRect, PhysicalSize,
    Runtime, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_positioner::{Position, WindowExt};

use crate::settings::{
    self, AutostartMenuItem, AUTOSTART_LABEL, AUTOSTART_UNKNOWN_LABEL,
};

#[derive(Debug, PartialEq, Eq)]
pub enum CardAction {
    Show,
    Hide,
}

#[derive(Debug, PartialEq, Eq)]
enum AutostartMenuDecision {
    SetEnabled(bool),
    ReportStatusError {
        message: String,
        restore_checked: Option<bool>,
    },
}

#[derive(Debug, PartialEq, Eq)]
struct InitialAutostartMenuState {
    checked: bool,
    label: &'static str,
}

pub fn next_card_action(is_visible: bool) -> CardAction {
    if is_visible {
        CardAction::Hide
    } else {
        CardAction::Show
    }
}

fn card_action_from_visibility(visibility: Result<bool, String>) -> Result<CardAction, String> {
    visibility.map(next_card_action)
}

pub fn should_toggle_card(button: MouseButton, button_state: MouseButtonState) -> bool {
    matches!(
        (button, button_state),
        (MouseButton::Left, MouseButtonState::Up)
    )
}

fn autostart_menu_decision(
    status: Result<bool, String>,
    clicked_checked: Option<bool>,
) -> AutostartMenuDecision {
    match (status, clicked_checked) {
        (Ok(_), Some(target)) => AutostartMenuDecision::SetEnabled(target),
        (Ok(enabled), None) => AutostartMenuDecision::ReportStatusError {
            message: "无法读取托盘中的开机自启动选择，请稍后重试".to_string(),
            restore_checked: Some(enabled),
        },
        (Err(error), clicked_checked) => AutostartMenuDecision::ReportStatusError {
            message: format!("无法读取开机自启动状态，请稍后重试：{error}"),
            restore_checked: clicked_checked.map(|checked| !checked),
        },
    }
}

fn initial_autostart_menu_state(
    status: Result<bool, String>,
) -> InitialAutostartMenuState {
    match status {
        Ok(checked) => InitialAutostartMenuState {
            checked,
            label: AUTOSTART_LABEL,
        },
        Err(_) => InitialAutostartMenuState {
            checked: false,
            label: AUTOSTART_UNKNOWN_LABEL,
        },
    }
}

fn clamp_position_to_work_area(
    desired: PhysicalPosition<i32>,
    work_area: PhysicalRect<i32, u32>,
    window_size: PhysicalSize<u32>,
) -> Result<PhysicalPosition<i32>, String> {
    if window_size.width > work_area.size.width || window_size.height > work_area.size.height {
        return Err("tray-card window exceeds monitor work area".to_string());
    }

    let min_x = i64::from(work_area.position.x);
    let min_y = i64::from(work_area.position.y);
    let max_x = min_x + i64::from(work_area.size.width - window_size.width);
    let max_y = min_y + i64::from(work_area.size.height - window_size.height);
    let x = i64::from(desired.x).clamp(min_x, max_x);
    let y = i64::from(desired.y).clamp(min_y, max_y);

    Ok(PhysicalPosition::new(
        i32::try_from(x).map_err(|error| error.to_string())?,
        i32::try_from(y).map_err(|error| error.to_string())?,
    ))
}

fn safe_bottom_right_position(
    work_area: PhysicalRect<i32, u32>,
    window_size: PhysicalSize<u32>,
) -> Result<PhysicalPosition<i32>, String> {
    if window_size.width > work_area.size.width || window_size.height > work_area.size.height {
        return Err("tray-card window exceeds monitor work area".to_string());
    }

    const MARGIN: i64 = 12;
    let desired_x = i64::from(work_area.position.x)
        + i64::from(work_area.size.width - window_size.width)
        - MARGIN;
    let desired_y = i64::from(work_area.position.y)
        + i64::from(work_area.size.height - window_size.height)
        - MARGIN;
    let desired = PhysicalPosition::new(
        i32::try_from(desired_x).map_err(|error| error.to_string())?,
        i32::try_from(desired_y).map_err(|error| error.to_string())?,
    );
    clamp_position_to_work_area(desired, work_area, window_size)
}

fn relevant_monitor<R: Runtime>(window: &WebviewWindow<R>) -> Result<Monitor, String> {
    if let Ok(cursor) = window.cursor_position() {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            return Ok(monitor);
        }
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        return Ok(monitor);
    }
    if let Ok(Some(monitor)) = window.primary_monitor() {
        return Ok(monitor);
    }
    window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "no monitor available for tray-card fallback".to_string())
}

fn position_card<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let anchored = window.move_window_constrained(Position::TrayCenter).is_ok();
    let monitor = if anchored {
        match window.current_monitor() {
            Ok(Some(monitor)) => monitor,
            _ => relevant_monitor(window)?,
        }
    } else {
        relevant_monitor(window)?
    };
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let work_area = *monitor.work_area();
    let position = if anchored {
        match window.outer_position() {
            Ok(actual) => clamp_position_to_work_area(actual, work_area, window_size)?,
            Err(_) => safe_bottom_right_position(work_area, window_size)?,
        }
    } else {
        safe_bottom_right_position(work_area, window_size)?
    };
    window
        .set_position(position)
        .map_err(|error| error.to_string())
}

pub fn show_card(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("tray-card")
        .ok_or("tray-card window missing")?;
    position_card(&window)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn hide_card(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("tray-card")
        .ok_or("tray-card window missing")?;
    window.hide().map_err(|error| error.to_string())
}

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn build_tray(app: &mut App) -> tauri::Result<()> {
    let initial_autostart = initial_autostart_menu_state(
        app.autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string()),
    );
    let autostart = CheckMenuItemBuilder::new(initial_autostart.label)
        .id("autostart")
        .checked(initial_autostart.checked)
        .build(app)?;
    let show = MenuItemBuilder::with_id("show", "查看今日黄历").build(app)?;
    let about = MenuItemBuilder::with_id("about", "关于").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "彻底退出").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &autostart, &about, &separator, &quit])
        .build()?;
    app.manage(AutostartMenuItem(autostart.clone()));

    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("application icon missing")
                .clone(),
        )
        .tooltip("电子黄历")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                let _ = show_details(app.clone());
            }
            "about" => {
                let _ = app.emit("app://open-settings", Option::<String>::None);
                let _ = show_main(app);
            }
            "autostart" => {
                let manager = app.autolaunch();
                let menu = app.state::<AutostartMenuItem>();
                let clicked_checked = menu.0.is_checked().ok();
                let status = manager.is_enabled().map_err(|error| error.to_string());
                let status_unavailable = status.is_err();
                let _ = menu.0.set_text(if status_unavailable {
                    AUTOSTART_UNKNOWN_LABEL
                } else {
                    AUTOSTART_LABEL
                });
                match autostart_menu_decision(status, clicked_checked) {
                    AutostartMenuDecision::SetEnabled(enabled) => {
                        if settings::set_autostart_value(app, &menu, enabled).is_err() {
                            let message = if enabled {
                                "未能开启开机自启动，请稍后重试"
                            } else {
                                "未能关闭开机自启动，请稍后重试"
                            };
                            let _ = app.emit("app://open-settings", Some(message.to_string()));
                            let _ = show_main(app);
                        }
                    }
                    AutostartMenuDecision::ReportStatusError {
                        message,
                        restore_checked,
                    } => {
                        if let Some(checked) = restore_checked {
                            let _ = menu.0.set_checked(checked);
                        }
                        let _ = app.emit("app://open-settings", Some(message));
                        let _ = show_main(app);
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if !should_toggle_card(button, button_state) {
                    return;
                }

                if let Some(window) = tray.app_handle().get_webview_window("tray-card") {
                    let action = card_action_from_visibility(
                        window.is_visible().map_err(|error| error.to_string()),
                    );
                    match action {
                        Ok(CardAction::Show) => {
                            let _ = show_card(tray.app_handle());
                        }
                        Ok(CardAction::Hide) => {
                            let _ = hide_card(tray.app_handle());
                        }
                        Err(error) => {
                            let message =
                                format!("无法读取黄历卡片状态，请稍后重试：{error}");
                            let _ = tray
                                .app_handle()
                                .emit("app://open-settings", Some(message));
                            let _ = show_main(tray.app_handle());
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn reveal_details(
    emit_details: impl FnOnce() -> Result<(), String>,
    show_detail_window: impl FnOnce() -> Result<(), String>,
    hide_card_window: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    emit_details()?;
    show_detail_window()?;
    hide_card_window()
}

#[tauri::command]
pub fn show_details(app: AppHandle) -> Result<(), String> {
    reveal_details(
        || {
            app.emit("app://show-details", ())
                .map_err(|error| error.to_string())
        },
        || show_main(&app),
        || hide_card(&app),
    )
}

#[tauri::command]
pub fn hide_tray_card(app: AppHandle) -> Result<(), String> {
    hide_card(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use tauri::{
        tray::{MouseButton, MouseButtonState},
        PhysicalPosition, PhysicalRect, PhysicalSize,
    };

    fn work_area(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(width, height),
        }
    }

    fn assert_inside(
        area: PhysicalRect<i32, u32>,
        window: PhysicalSize<u32>,
        position: PhysicalPosition<i32>,
    ) {
        assert!(position.x >= area.position.x);
        assert!(position.y >= area.position.y);
        assert!(
            position.x + window.width as i32 <= area.position.x + area.size.width as i32
        );
        assert!(
            position.y + window.height as i32 <= area.position.y + area.size.height as i32
        );
    }

    #[test]
    fn tray_click_toggles_card_visibility() {
        assert_eq!(next_card_action(false), CardAction::Show);
        assert_eq!(next_card_action(true), CardAction::Hide);
    }

    #[test]
    fn unavailable_card_visibility_does_not_guess_a_toggle() {
        assert_eq!(
            card_action_from_visibility(Err("visibility unavailable".to_string())),
            Err("visibility unavailable".to_string())
        );
    }

    #[test]
    fn failed_detail_window_show_keeps_the_card_visible() {
        let hidden = Cell::new(false);

        let result = reveal_details(
            || Ok(()),
            || Err("main window unavailable".to_string()),
            || {
                hidden.set(true);
                Ok(())
            },
        );

        assert_eq!(result, Err("main window unavailable".to_string()));
        assert!(!hidden.get());
    }

    #[test]
    fn only_a_completed_left_click_toggles_the_card() {
        assert!(should_toggle_card(
            MouseButton::Left,
            MouseButtonState::Up
        ));
        assert!(!should_toggle_card(
            MouseButton::Right,
            MouseButtonState::Up
        ));
        assert!(!should_toggle_card(
            MouseButton::Left,
            MouseButtonState::Down
        ));
    }

    #[test]
    fn safe_fallback_uses_each_taskbar_adjusted_work_area() {
        let window = PhysicalSize::new(360, 500);
        let cases = [
            work_area(0, 40, 1920, 1040),
            work_area(0, 0, 1920, 1040),
            work_area(48, 0, 1872, 1080),
            work_area(0, 0, 1872, 1080),
        ];

        for area in cases {
            let position = safe_bottom_right_position(area, window).unwrap();
            assert_inside(area, window, position);
        }
    }

    #[test]
    fn safe_fallback_supports_negative_secondary_monitor_coordinates() {
        let area = work_area(-1920, -80, 1920, 1040);
        let window = PhysicalSize::new(360, 500);

        let position = safe_bottom_right_position(area, window).unwrap();

        assert_eq!(position, PhysicalPosition::new(-372, 448));
        assert_inside(area, window, position);
    }

    #[test]
    fn safe_fallback_keeps_100_to_200_percent_physical_sizes_inside() {
        let area = work_area(0, 0, 1920, 1040);

        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            let window = PhysicalSize::new((360.0 * scale) as u32, (500.0 * scale) as u32);
            let position = safe_bottom_right_position(area, window).unwrap();
            assert_inside(area, window, position);
        }
    }

    #[test]
    fn safe_fallback_clamps_margin_at_the_work_area_boundary() {
        let area = work_area(100, 50, 800, 600);
        let window = PhysicalSize::new(790, 590);

        let position = safe_bottom_right_position(area, window).unwrap();

        assert_eq!(position, PhysicalPosition::new(100, 50));
        assert_inside(area, window, position);
    }

    #[test]
    fn successful_tray_anchor_is_clamped_out_of_vertical_taskbars() {
        let window = PhysicalSize::new(360, 500);
        let left_area = work_area(48, 0, 1872, 1080);
        let right_area = work_area(0, 0, 1872, 1080);

        let left = clamp_position_to_work_area(
            PhysicalPosition::new(0, 300),
            left_area,
            window,
        )
        .unwrap();
        let right = clamp_position_to_work_area(
            PhysicalPosition::new(1700, 300),
            right_area,
            window,
        )
        .unwrap();

        assert_eq!(left, PhysicalPosition::new(48, 300));
        assert_eq!(right, PhysicalPosition::new(1512, 300));
        assert_inside(left_area, window, left);
        assert_inside(right_area, window, right);
    }

    #[test]
    fn unavailable_autostart_status_reports_without_toggling_the_system() {
        assert_eq!(
            autostart_menu_decision(Err("registry unavailable".to_string()), Some(true)),
            AutostartMenuDecision::ReportStatusError {
                message: "无法读取开机自启动状态，请稍后重试：registry unavailable".to_string(),
                restore_checked: Some(false),
            }
        );
        assert_eq!(
            autostart_menu_decision(Ok(true), Some(false)),
            AutostartMenuDecision::SetEnabled(false)
        );
    }

    #[test]
    fn checked_menu_state_is_the_user_autostart_target_even_when_os_state_is_stale() {
        assert_eq!(
            autostart_menu_decision(Ok(true), Some(true)),
            AutostartMenuDecision::SetEnabled(true)
        );
        assert_eq!(
            autostart_menu_decision(Ok(false), Some(false)),
            AutostartMenuDecision::SetEnabled(false)
        );
    }

    #[test]
    fn unavailable_startup_status_is_labeled_unknown_instead_of_disabled() {
        assert_eq!(
            initial_autostart_menu_state(Err("registry unavailable".to_string())),
            InitialAutostartMenuState {
                checked: false,
                label: "开机自启动（状态待确认）",
            }
        );
        assert_eq!(
            initial_autostart_menu_state(Ok(true)),
            InitialAutostartMenuState {
                checked: true,
                label: "开机自启动",
            }
        );
    }
}
