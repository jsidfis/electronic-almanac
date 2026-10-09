use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AlmanacState(Mutex<Option<Value>>);

impl AlmanacState {
    pub fn set(&self, value: Value) {
        *self.0.lock().expect("almanac state lock poisoned") = Some(value);
    }

    pub fn get(&self) -> Option<Value> {
        self.0
            .lock()
            .expect("almanac state lock poisoned")
            .clone()
    }
}

#[tauri::command]
pub fn publish_almanac_snapshot(
    app: AppHandle,
    state: State<'_, AlmanacState>,
    snapshot: Value,
) -> Result<(), String> {
    state.set(snapshot.clone());
    app.emit("almanac://updated", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_almanac_snapshot(state: State<'_, AlmanacState>) -> Option<Value> {
    state.get()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_state_replaces_the_previous_day() {
        let state = AlmanacState::default();
        state.set(json!({"date":"2026-08-06"}));
        state.set(json!({"date":"2026-08-07"}));
        assert_eq!(state.get().unwrap()["date"], "2026-08-07");
    }
}
