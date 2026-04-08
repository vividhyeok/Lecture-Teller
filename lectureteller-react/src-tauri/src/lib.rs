use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ── State ─────────────────────────────────────────────────────────────────────
struct ServerState(Arc<Mutex<Option<CommandChild>>>);

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns true if something is already listening on the given port.
fn is_port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Blocks until `port` is open or `timeout` elapses. Returns whether it succeeded.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(350));
    }
    false
}

/// Open the main app window (1400×900, points at the local FastAPI server).
fn open_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::External(
            "http://localhost:8000/v2/".parse().expect("valid URL"),
        ),
    )
    .title("LectureTeller")
    .inner_size(1400.0, 900.0)
    .min_inner_size(900.0, 600.0)
    .center()
    .build()?;
    Ok(())
}

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState(Arc::new(Mutex::new(None))))
        .setup(|app| {
            // 1. Show splash screen immediately.
            tauri::WebviewWindowBuilder::new(
                app,
                "splash",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("LectureTeller")
            .inner_size(400.0, 200.0)
            .resizable(false)
            .decorations(false) // borderless splash
            .center()
            .build()?;

            let handle = app.handle().clone();
            let state: tauri::State<ServerState> = app.state();
            let state_arc = state.0.clone();

            // 2. Backend startup in a separate thread so the splash renders.
            std::thread::spawn(move || {
                // If port is already open (e.g. user ran start.bat during dev),
                // skip spawning a sidecar and go straight to opening the window.
                if !is_port_open(8000) {
                    let bundled_resource_dir = handle
                        .path()
                        .resource_dir()
                        .ok()
                        .filter(|dir| dir.join("static-v2").exists());

                    // Try to spawn the bundled Python sidecar.
                    let sidecar_command = handle.shell().sidecar("server").map(|cmd| {
                        if let Some(resource_dir) = bundled_resource_dir.as_ref() {
                            let data_dir = handle
                                .path()
                                .app_local_data_dir()
                                .unwrap_or_else(|_| resource_dir.join("user-data"));
                            let _ = std::fs::create_dir_all(&data_dir);

                            cmd.current_dir(&data_dir)
                                .env("LT_RESOURCE_DIR", resource_dir)
                                .env("LT_DATA_DIR", &data_dir)
                        } else {
                            cmd
                        }
                    });

                    match sidecar_command.and_then(|cmd| cmd.spawn()) {
                        Ok((_events, child)) => {
                            if let Ok(mut g) = state_arc.lock() {
                                *g = Some(child);
                            }
                        }
                        Err(e) => {
                            eprintln!("[LectureTeller] Could not start sidecar: {e}");
                            // In dev mode without start.bat this is expected — just wait.
                        }
                    }

                    // Wait up to 25 s for the server to become ready.
                    if !wait_for_port(8000, Duration::from_secs(25)) {
                        eprintln!("[LectureTeller] Server did not respond within 25 s.");
                        // Close splash so the user isn't stuck on a blank screen.
                        if let Some(w) = handle.get_webview_window("splash") {
                            let _ = w.close();
                        }
                        return;
                    }
                }

                // 3. Server is up — open the main window.
                if let Err(e) = open_main_window(&handle) {
                    eprintln!("[LectureTeller] Failed to open main window: {e}");
                }

                // 4. Close splash.
                if let Some(w) = handle.get_webview_window("splash") {
                    let _ = w.close();
                }
            });

            Ok(())
        })
        // Kill the Python sidecar when the user closes the main window.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let state = window.state::<ServerState>().0.clone();
                    let mut guard = match state.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };

                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LectureTeller");
}
