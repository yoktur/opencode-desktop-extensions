use ::asar::{AsarReader, AsarWriter};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub use electron_hook::*;

pub struct LaunchOptions {
    pub executable: Option<PathBuf>,
    pub runtime: Option<PathBuf>,
    pub args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
    schema: u32,
    id: String,
    name: String,
    version: String,
    entry: String,
    #[serde(default)]
    main: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoadedExtension {
    id: String,
    name: String,
    version: String,
    entry: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    main: Option<PathBuf>,
    root: PathBuf,
    archive: PathBuf,
    enabled: bool,
    builtin: bool,
    managed: bool,
}

#[derive(Default, Deserialize)]
struct OcdxConfig {
    disabled: BTreeSet<String>,
}

pub fn parse_args() -> Result<LaunchOptions, String> {
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
            return Err(
                "Usage: ocdx [--executable PATH] [--runtime PATH] [-- ELECTRON_ARGS...]"
                    .to_string(),
            );
        }
        return Err(format!("unknown option: {value}"));
    }

    Ok(LaunchOptions {
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

pub fn discover_extensions() -> (Vec<LoadedExtension>, Vec<String>, PathBuf, PathBuf) {
    let install = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let builtin = install.as_ref().map(|directory| directory.join("builtin"));
    let portable = install.as_ref().map(|directory| directory.join("mods"));
    let user = dirs::data_dir()
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("OCDX")
        .join("mods");
    let config_path = user.parent().map_or_else(
        || PathBuf::from("config.json"),
        |directory| directory.join("config.json"),
    );
    let config = fs::read(&config_path)
        .ok()
        .and_then(|value| serde_json::from_slice::<OcdxConfig>(&value).ok())
        .unwrap_or_default();
    let mut errors = Vec::new();
    if let Err(error) = fs::create_dir_all(&user) {
        errors.push(format!("cannot create {}: {error}", user.display()));
    }

    let cache = dirs::cache_dir()
        .unwrap_or_else(env::temp_dir)
        .join("OCDX")
        .join("extensions");
    let mut selected = BTreeMap::new();
    let directories = builtin
        .into_iter()
        .map(|directory| (directory, true, false))
        .chain(portable.into_iter().map(|directory| (directory, false, false)))
        .chain([(user.clone(), false, true)]);
    for (directory, builtin, managed) in directories {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut archives = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("ocdx"))
            })
            .collect::<Vec<_>>();
        archives.sort();
        for archive in archives {
            match load_extension(&archive, &cache) {
                Ok(mut extension) => {
                    extension.builtin = builtin;
                    extension.managed = managed;
                    extension.enabled = builtin || !config.disabled.contains(&extension.id);
                    if selected
                        .get(&extension.id)
                        .is_some_and(|existing: &LoadedExtension| existing.builtin)
                    {
                        errors.push(format!(
                            "{}: extension id is reserved by a built-in extension",
                            archive.display()
                        ));
                        continue;
                    }
                    selected.insert(extension.id.clone(), extension);
                }
                Err(error) => errors.push(format!("{}: {error}", archive.display())),
            }
        }
    }
    (selected.into_values().collect(), errors, user, config_path)
}

fn load_extension(path: &Path, cache: &Path) -> Result<LoadedExtension, String> {
    let file = File::open(path).map_err(|error| format!("cannot open archive: {error}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("invalid archive: {error}"))?;
    if archive.len() > 1_024 {
        return Err("archive contains more than 1024 entries".to_string());
    }

    let manifest = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| "manifest.json is missing".to_string())?;
        if file.size() > 64 * 1_024 {
            return Err("manifest.json is larger than 64 KiB".to_string());
        }
        let mut value = String::new();
        file.read_to_string(&mut value)
            .map_err(|error| format!("cannot read manifest.json: {error}"))?;
        serde_json::from_str::<ExtensionManifest>(&value)
            .map_err(|error| format!("invalid manifest.json: {error}"))?
    };
    validate_manifest(&manifest)?;
    archive
        .by_name(&manifest.entry)
        .map_err(|_| format!("entry is missing: {}", manifest.entry))?;
    if let Some(main) = &manifest.main {
        archive
            .by_name(main)
            .map_err(|_| format!("main entry is missing: {main}"))?;
    }

    let mut total = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("cannot inspect archive: {error}"))?;
        if file.enclosed_name().is_none() {
            return Err(format!("unsafe archive path: {}", file.name()));
        }
        total = total
            .checked_add(file.size())
            .ok_or("archive size overflow")?;
        if total > 1_073_741_824 {
            return Err("archive expands beyond 1 GiB".to_string());
        }
    }

    let metadata =
        fs::metadata(path).map_err(|error| format!("cannot inspect archive file: {error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_secs());
    let root = cache.join(&manifest.id).join(format!(
        "{}-{}-{modified}",
        manifest.version,
        metadata.len()
    ));
    if !root.join(&manifest.entry).is_file()
        || manifest
            .main
            .as_ref()
            .is_some_and(|main| !root.join(main).is_file())
    {
        let temporary = root.with_extension(format!("{}.tmp", std::process::id()));
        if temporary.exists() {
            fs::remove_dir_all(&temporary)
                .map_err(|error| format!("cannot clear extension cache: {error}"))?;
        }
        if let Some(parent) = temporary.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create extension cache: {error}"))?;
        }
        archive
            .extract(&temporary)
            .map_err(|error| format!("cannot extract extension: {error}"))?;
        if root.exists() {
            fs::remove_dir_all(&root)
                .map_err(|error| format!("cannot replace extension cache: {error}"))?;
        }
        fs::rename(&temporary, &root)
            .map_err(|error| format!("cannot activate extension cache: {error}"))?;
    }

    Ok(LoadedExtension {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        entry: normalize_path(root.join(&manifest.entry)),
        main: manifest.main.map(|main| normalize_path(root.join(main))),
        root: normalize_path(root),
        archive: normalize_path(path.to_path_buf()),
        enabled: true,
        builtin: false,
        managed: false,
    })
}

fn validate_manifest(manifest: &ExtensionManifest) -> Result<(), String> {
    if manifest.schema != 1 {
        return Err(format!("unsupported manifest schema: {}", manifest.schema));
    }
    if manifest.id.is_empty()
        || !manifest.id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err(
            "id must contain only letters, numbers, dots, underscores, and hyphens".to_string(),
        );
    }
    if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
        return Err("name and version are required".to_string());
    }
    if !manifest.version.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '+' | '-')
    }) {
        return Err("version contains unsupported characters".to_string());
    }
    validate_manifest_path("entry", &manifest.entry)?;
    if let Some(main) = &manifest.main {
        validate_manifest_path("main", main)?;
    }
    Ok(())
}

fn validate_manifest_path(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || !Path::new(value)
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("{name} must be a safe relative path"));
    }
    Ok(())
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
