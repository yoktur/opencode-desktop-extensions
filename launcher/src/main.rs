#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use ocdx_launcher::{
    discover_extensions, hook_library, launch_app, parse_args, production_executable,
    replacement_asar, runtime_bundle,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let log = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|directory| directory.join("ocdx.log")));
    if let Some(path) = &log {
        std::env::set_var("OCDX_LOG", path);
    }
    write_log("launcher started");
    match launch() {
        Ok(()) => {
            write_log("Electron-Hook launch returned successfully");
            ExitCode::SUCCESS
        }
        Err(error) => {
            write_log(&format!("launcher failed: {error}"));
            eprintln!("OCDX Launcher: {error}");
            show_error(&error);
            ExitCode::FAILURE
        }
    }
}

#[cfg(windows)]
fn show_error(error: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use winapi::um::winuser::{MessageBoxW, MB_ICONERROR, MB_OK};

    let message = OsStr::new(error)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let title = OsStr::new("OCDX Launcher")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        MessageBoxW(
            null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_error(_error: &str) {}

fn write_log(message: &str) {
    let Some(path) = std::env::var_os("OCDX_LOG") else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{message}");
}

fn launch() -> Result<(), String> {
    let options = parse_args()?;
    let executable = production_executable(options.executable)?;
    write_log(&format!("production executable: {}", executable.display()));
    let runtime = runtime_bundle(options.runtime)?;
    write_log(&format!("runtime bundle: {}", runtime.display()));
    let library = hook_library()?;
    write_log(&format!("hook library: {}", library.display()));
    let (extensions, errors, mods, config) = discover_extensions();
    for error in errors {
        write_log(&format!("extension skipped: {error}"));
    }
    write_log(&format!(
        "extensions: {} from {}",
        extensions.len(),
        mods.display()
    ));
    std::env::set_var(
        "OCDX_EXTENSIONS",
        serde_json::to_string(&extensions)
            .map_err(|error| format!("cannot serialize extensions: {error}"))?,
    );
    std::env::set_var("OCDX_MODS_DIR", &mods);
    std::env::set_var("OCDX_CONFIG", &config);
    let asar = replacement_asar(&executable, &runtime)?;
    write_log(&format!("replacement ASAR: {}", asar.display()));

    write_log("calling Electron-Hook");
    launch_app(&executable, &library, &asar, options.args)?;
    Ok(())
}
