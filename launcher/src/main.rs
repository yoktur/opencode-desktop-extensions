#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use ocdx_launcher::{
    extension_directories, hook_library, launch_app, parse_args, production_executable,
    replacement_asar, runtime_bundle,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let log = log_path();
    if let Some(directory) = log.as_ref().and_then(|path| path.parent()) {
        let _ = std::fs::create_dir_all(directory);
    }
    if let Some(path) = &log {
        std::env::set_var("OCDX_LOG", path);
    }
    write_log("launcher started");
    match launch() {
        Ok(()) => {
            write_log("launch returned successfully");
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

#[cfg(target_os = "macos")]
fn log_path() -> Option<std::path::PathBuf> {
    dirs::cache_dir().map(|directory| directory.join("OCDX").join("ocdx.log"))
}

#[cfg(not(target_os = "macos"))]
fn log_path() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|directory| directory.join("ocdx.log")))
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
    let directories = extension_directories();
    write_log(&format!("user mods: {}", directories.user.display()));
    if let Some(builtin) = &directories.builtin {
        std::env::set_var("OCDX_BUILTIN_DIR", builtin);
    }
    if let Some(portable) = &directories.portable {
        std::env::set_var("OCDX_PORTABLE_DIR", portable);
    }
    std::env::set_var("OCDX_MODS_DIR", &directories.user);
    std::env::set_var("OCDX_CONFIG", &directories.config);
    let asar = replacement_asar(&executable, &runtime)?;
    write_log(&format!("replacement ASAR: {}", asar.display()));

    write_log("calling platform launcher");
    launch_app(&executable, &library, &asar, options.args)?;
    Ok(())
}
