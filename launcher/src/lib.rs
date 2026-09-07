use ::asar::{AsarReader, AsarWriter};
use std::env;
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};

pub use electron_hook::*;

pub struct LauncherArgs {
    pub executable: Option<PathBuf>,
    pub runtime: Option<PathBuf>,
    pub args: Vec<String>,
}

pub struct ExtensionDirectories {
    pub builtin: Option<PathBuf>,
    pub portable: Option<PathBuf>,
    pub user: PathBuf,
    pub config: PathBuf,
}

pub fn parse_args() -> Result<LauncherArgs, String> {
    let mut values = env::args().skip(1);
    let mut executable = None;
    let mut runtime = None;
    let mut args = Vec::new();

    while let Some(value) = values.next() {
        if value == "--" {
            args.extend(values);
            break;
        }
        if value == "--executable" {
            executable = Some(PathBuf::from(
                values.next().ok_or("--executable requires a path")?,
            ));
            continue;
        }
        if value == "--runtime" {
            runtime = Some(PathBuf::from(
                values.next().ok_or("--runtime requires a path")?,
            ));
            continue;
        }
        if value == "--help" || value == "-h" {
            println!("Usage: ocdx [--executable PATH] [--runtime PATH] [-- ELECTRON_ARGS...]");
            std::process::exit(0);
        }
        return Err(format!("unknown option: {value}"));
    }

    Ok(LauncherArgs {
        executable,
        runtime,
        args,
    })
}

pub fn production_executable(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    let executable = match explicit {
        Some(path) => executable_from_input(path)?,
        None => {
            default_executable().ok_or("OpenCode production desktop installation was not found")?
        }
    };
    let executable = normalize_path(
        executable
            .canonicalize()
            .map_err(|error| format!("cannot resolve {}: {error}", executable.display()))?,
    );
    let resources = resources_directory(&executable)?;

    if !resources.join("app.asar").is_file() || !resources.join("app-update.yml").is_file() {
        return Err(format!(
            "{} is not an installed production OpenCode desktop build",
            executable.display()
        ));
    }
    Ok(executable)
}

pub fn runtime_bundle(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    let adjacent = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("runtime.js")));
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|parent| parent.join("dist").join("runtime.js"));
    let runtime = explicit
        .or(adjacent.filter(|path| path.is_file()))
        .or(development.filter(|path| path.is_file()))
        .ok_or("runtime.js was not found; run `bun run build` first")?;

    runtime
        .canonicalize()
        .map(normalize_path)
        .map_err(|error| format!("cannot resolve {}: {error}", runtime.display()))
}

pub fn hook_library() -> Result<PathBuf, String> {
    let directory = env::current_exe()
        .map_err(|error| format!("cannot find launcher executable: {error}"))?
        .parent()
        .ok_or("launcher executable has no parent directory")?
        .to_path_buf();
    #[cfg(windows)]
    let library = directory.join("ocdx_launcher.dll");
    #[cfg(target_os = "linux")]
    let library = directory.join("libocdx_launcher.so");
    #[cfg(target_os = "macos")]
    let library = directory.join("libocdx_launcher.dylib");

    if library.is_file() {
        return library
            .canonicalize()
            .map(normalize_path)
            .map_err(|error| format!("cannot resolve {}: {error}", library.display()));
    }
    Err(format!(
        "Electron-Hook library was not found at {}",
        library.display()
    ))
}

/// The bootstrap owns archive validation, extraction, and caching; the
/// launcher only names the directories it should scan.
pub fn extension_directories() -> ExtensionDirectories {
    let install = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let user = env::var_os("OCDX_HOME").map(PathBuf::from).unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .join("OCDX")
    }).join("mods");
    let config = user.parent().map_or_else(
        || PathBuf::from("config.json"),
        |directory| directory.join("config.json"),
    );
    ExtensionDirectories {
        builtin: install.as_ref().map(|directory| directory.join("builtin")),
        portable: install.map(|directory| directory.join("mods")),
        user,
        config,
    }
}

pub fn replacement_asar(executable: &Path, runtime: &Path) -> Result<PathBuf, String> {
    let original = resources_directory(executable)?.join("app.asar");
    let bytes = fs::read(&original)
        .map_err(|error| format!("cannot read {}: {error}", original.display()))?;
    let reader = AsarReader::new(&bytes, Some(original.clone()))
        .map_err(|error| format!("cannot parse {}: {error}", original.display()))?;
    let package = reader
        .files()
        .get(Path::new("package.json"))
        .ok_or("installed app.asar has no package.json")?;
    let mut package: serde_json::Value = serde_json::from_slice(package.data())
        .map_err(|error| format!("installed package.json is invalid: {error}"))?;
    let package = package
        .as_object_mut()
        .ok_or("installed package.json is not an object")?;
    package.remove("type");
    package.insert(
        "main".to_string(),
        serde_json::Value::String("index.js".to_string()),
    );

    let path = electron_hook::paths::asar_cache_path(&format!("ocdx-{}", std::process::id()));
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .map_err(|error| format!("cannot create {}: {error}", directory.display()))?;
        if let Ok(entries) = fs::read_dir(directory) {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|candidate| {
                    candidate != &path
                        && candidate
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| name == "ocdx.asar" || name.starts_with("ocdx-"))
                })
                .for_each(|candidate| {
                    let _ = fs::remove_file(candidate);
                });
        }
    }
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut writer = AsarWriter::new();
    writer
        .write_file("index.js", include_bytes!("bootstrap.cjs"), false)
        .map_err(|error| format!("cannot add hook bootstrap to ASAR: {error}"))?;
    writer
        .write_file("channel.cjs", include_bytes!("channel.cjs"), false)
        .map_err(|error| format!("cannot add OCDX channel to ASAR: {error}"))?;
    writer
        .write_file("archive.cjs", include_bytes!("../../dist/archive.cjs"), false)
        .map_err(|error| format!("cannot add archive reader to ASAR: {error}"))?;
    writer
        .write_file(
            "package.json",
            serde_json::to_vec(&package)
                .map_err(|error| format!("cannot serialize package metadata: {error}"))?,
            false,
        )
        .map_err(|error| format!("cannot add package metadata to ASAR: {error}"))?;
    writer
        .finalize(
            File::create(&temporary)
                .map_err(|error| format!("cannot create {}: {error}", temporary.display()))?,
        )
        .map_err(|error| format!("cannot write {}: {error}", temporary.display()))?;
    let _ = fs::remove_file(&path);
    fs::rename(&temporary, &path).map_err(|error| {
        format!(
            "cannot move {} to {}: {error}",
            temporary.display(),
            path.display()
        )
    })?;

    env::set_var("MODLOADER_ASAR_ID", format!("ocdx-{}", std::process::id()));
    env::set_var("MODLOADER_MOD_ENTRYPOINT", runtime);
    env::set_var("MODLOADER_WM_CLASS", "ai.opencode.desktop");
    Ok(path)
}

#[cfg(windows)]
pub fn launch_app(
    executable: &Path,
    library: &Path,
    asar: &Path,
    args: Vec<String>,
) -> Result<(), String> {
    use electron_hook_detours_sys::{
        DetourCreateProcessWithDllExW, _PROCESS_INFORMATION, _STARTUPINFOW,
    };
    use std::ffi::{CString, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use winapi::shared::minwindef::FALSE;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::{GetExitCodeProcess, ResumeThread};
    use winapi::um::synchapi::WaitForSingleObject;
    use winapi::um::winbase::{CREATE_SUSPENDED, WAIT_OBJECT_0};
    use winapi::um::winnt::HANDLE;

    let working_directory = executable
        .parent()
        .ok_or("OpenCode executable has no parent directory")?;
    let folder_name = working_directory
        .file_name()
        .ok_or("OpenCode installation directory has no name")?;
    let process_args = serde_json::to_string(&env::args().skip(1).collect::<Vec<_>>())
        .map_err(|error| format!("cannot serialize launcher arguments: {error}"))?;
    env::set_var("MODLOADER_ASAR_PATH", asar);
    env::set_var(
        "MODLOADER_EXECUTABLE",
        env::current_exe().map_err(|error| format!("cannot find launcher executable: {error}"))?,
    );
    env::set_var("MODLOADER_LIBRARY_PATH", library);
    env::set_var("MODLOADER_FOLDER_NAME", folder_name);
    env::set_var("MODLOADER_ORIGINAL_ASAR_RELATIVE", "../_app.asar");
    env::set_var("MODLOADER_PROCESS_ARGV", process_args);

    let executable_wide = executable
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let working_directory_wide = working_directory
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let command = std::iter::once(quote_windows(&executable.to_string_lossy()))
        .chain(args.iter().map(|arg| quote_windows(arg)))
        .collect::<Vec<_>>()
        .join(" ");
    let mut command_wide = OsStr::new(&command)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let library = library.to_string_lossy();
    let library = CString::new(library.strip_prefix(r"\\?\").unwrap_or(&library as &str))
        .map_err(|_| "hook library path contains a null byte")?;
    let mut startup: _STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = std::mem::size_of::<_STARTUPINFOW>() as u32;
    let mut process: _PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let created = unsafe {
        DetourCreateProcessWithDllExW(
            executable_wide.as_ptr(),
            command_wide.as_mut_ptr(),
            null_mut(),
            null_mut(),
            FALSE,
            CREATE_SUSPENDED,
            null_mut(),
            working_directory_wide.as_ptr(),
            &mut startup,
            &mut process,
            library.as_ptr(),
            None,
        )
    };
    if created == FALSE {
        return Err(format!(
            "Detours could not create OpenCode: {}",
            std::io::Error::last_os_error()
        ));
    }

    let thread = process.hThread as HANDLE;
    let process_handle = process.hProcess as HANDLE;
    let resumed = unsafe { ResumeThread(thread) };
    if resumed == u32::MAX {
        unsafe {
            CloseHandle(thread);
            CloseHandle(process_handle);
        }
        return Err(format!(
            "Detours could not resume OpenCode: {}",
            std::io::Error::last_os_error()
        ));
    }

    if unsafe { WaitForSingleObject(process_handle, 2_000) } == WAIT_OBJECT_0 {
        let mut code = 0;
        unsafe {
            GetExitCodeProcess(process_handle, &mut code);
            CloseHandle(thread);
            CloseHandle(process_handle);
        }
        return Err(format!(
            "OpenCode exited before the mod bootstrap started (exit code 0x{code:08X})"
        ));
    }

    unsafe {
        CloseHandle(thread);
        CloseHandle(process_handle);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn launch_app(
    executable: &Path,
    library: &Path,
    asar: &Path,
    args: Vec<String>,
) -> Result<(), String> {
    electron_hook::launch(
        executable
            .to_str()
            .ok_or("OpenCode executable path is not valid UTF-8")?,
        library
            .to_str()
            .ok_or("Electron-Hook library path is not valid UTF-8")?,
        asar.to_str()
            .ok_or("generated ASAR path is not valid UTF-8")?,
        args,
        true,
    )?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn launch_app(
    executable: &Path,
    library: &Path,
    asar: &Path,
    args: Vec<String>,
) -> Result<(), String> {
    use std::time::Duration;

    electron_hook::launch_with_options(
        executable
            .to_str()
            .ok_or("OpenCode executable path is not valid UTF-8")?,
        library
            .to_str()
            .ok_or("Electron-Hook library path is not valid UTF-8")?,
        asar.to_str()
            .ok_or("generated ASAR path is not valid UTF-8")?,
        args,
        true,
        &electron_hook::LaunchOptions {
            ready_timeout: Some(Duration::from_secs(10)),
        },
    )?;
    Ok(())
}

#[cfg(windows)]
fn quote_windows(value: &str) -> String {
    if !value.is_empty() && !value.contains([' ', '\t', '\n', '\x0B', '"']) {
        return value.to_string();
    }

    let mut quoted = String::from('"');
    let mut backslashes = 0;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push(character);
            backslashes = 0;
            continue;
        }
        quoted.push_str(&"\\".repeat(backslashes));
        backslashes = 0;
        quoted.push(character);
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(windows)]
fn normalize_path(path: PathBuf) -> PathBuf {
    const PREFIX: &str = r"\\?\";
    const UNC_PREFIX: &str = r"\\?\UNC\";
    let value = path.to_string_lossy();
    if let Some(value) = value.strip_prefix(UNC_PREFIX) {
        return PathBuf::from(format!(r"\\{value}"));
    }
    if let Some(value) = value.strip_prefix(PREFIX) {
        return PathBuf::from(value);
    }
    path
}

#[cfg(not(windows))]
fn normalize_path(path: PathBuf) -> PathBuf {
    path
}

#[cfg(target_os = "macos")]
fn executable_from_input(path: PathBuf) -> Result<PathBuf, String> {
    if path.extension().is_none_or(|extension| extension != "app") || !path.is_dir() {
        return Ok(path);
    }

    let name = path.file_stem().ok_or("OpenCode app bundle has no name")?;
    let executable = path.join("Contents").join("MacOS").join(name);
    if executable.is_file() {
        Ok(executable)
    } else {
        Err(format!(
            "cannot find the app executable at {}; pass its Contents/MacOS path instead",
            executable.display()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn executable_from_input(path: PathBuf) -> Result<PathBuf, String> {
    Ok(path)
}

#[cfg(target_os = "macos")]
fn resources_directory(executable: &Path) -> Result<PathBuf, String> {
    executable
        .parent()
        .and_then(Path::parent)
        .map(|contents| contents.join("Resources"))
        .ok_or_else(|| "OpenCode executable is not inside a macOS app bundle".to_string())
}

#[cfg(not(target_os = "macos"))]
fn resources_directory(executable: &Path) -> Result<PathBuf, String> {
    executable
        .parent()
        .map(|directory| directory.join("resources"))
        .ok_or_else(|| "OpenCode executable has no parent directory".to_string())
}

#[cfg(windows)]
fn default_executable() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA").map(|directory| {
        PathBuf::from(directory)
            .join("Programs")
            .join("OpenCode")
            .join("OpenCode.exe")
    })
}

#[cfg(target_os = "linux")]
fn default_executable() -> Option<PathBuf> {
    [
        PathBuf::from("/usr/bin/ai.opencode.desktop"),
        PathBuf::from("/opt/OpenCode/ai.opencode.desktop"),
        PathBuf::from("/opt/OpenCode/opencode"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

#[cfg(target_os = "macos")]
fn default_executable() -> Option<PathBuf> {
    let system = [
        PathBuf::from("/Applications/OpenCode.app/Contents/MacOS/OpenCode"),
        PathBuf::from("/Applications/OpenCode Beta.app/Contents/MacOS/OpenCode Beta"),
    ];
    let user = dirs::home_dir().into_iter().flat_map(|home| {
        [
            home.join("Applications/OpenCode.app/Contents/MacOS/OpenCode"),
            home.join("Applications/OpenCode Beta.app/Contents/MacOS/OpenCode Beta"),
        ]
    });
    system.into_iter().chain(user).find(|path| path.is_file())
}
