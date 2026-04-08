// Tauri app entry point
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lectureteller_lib::run()
}
