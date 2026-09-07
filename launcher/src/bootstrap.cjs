const fs = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { app, net, protocol, utilityProcess, webContents } = require("electron")

const runtimePath = process.env.MODLOADER_MOD_ENTRYPOINT
const originalAsar = path.resolve(__dirname, process.env.MODLOADER_ORIGINAL_ASAR_RELATIVE)
const { configureChannel } = require("./channel.cjs")
const channel = configureChannel(app, path.resolve(process.env.OCDX_HOME || path.join(app.getPath("appData"), "OCDX")))
const extensions = []
const roots = new Map()
const mainExtensions = new Map()
const builtinDirectory = process.env.OCDX_BUILTIN_DIR
const portableDirectory = process.env.OCDX_PORTABLE_DIR
const modsDirectory = process.env.OCDX_MODS_DIR
const configPath = process.env.OCDX_CONFIG
const runtime = fs.readFileSync(runtimePath, "utf8")
const log = (message) => {
  if (!process.env.OCDX_LOG) return
  fs.appendFileSync(process.env.OCDX_LOG, `${message}\n`)
}
log(`bootstrap started in pid ${process.pid}`)
log(`OCDX channel: ${channel.root}`)
// Updating through the injected host would update the source installation.
// The source app owns its updater; OCDX consumes that payload on its next launch.
const { autoUpdater } = require(path.join(originalAsar, "node_modules", "electron-updater"))
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.checkForUpdates = async () => null
autoUpdater.downloadUpdate = async () => []
autoUpdater.quitAndInstall = () => { throw new Error("Update the source OpenCode installation, then relaunch OCDX.") }
const discovered = discoverExtensions().catch((error) => {
  log(`extension discovery failed: ${error.stack || error}`)
})

// The bootstrap owns all archive validation, extraction, and caching; the
// Rust launcher only names the directories through OCDX_* variables.
async function discoverExtensions() {
  const config = readConfig()
  const sources = [
    { directory: builtinDirectory, builtin: true, managed: false },
    { directory: portableDirectory, builtin: false, managed: false },
    { directory: modsDirectory, builtin: false, managed: true },
  ]
  if (modsDirectory) fs.mkdirSync(modsDirectory, { recursive: true })
  const selected = new Map()
  for (const source of sources) {
    if (!source.directory || !fs.existsSync(source.directory)) continue
    const archives = fs
      .readdirSync(source.directory)
      .filter((name) => name.toLowerCase().endsWith(".ocdx"))
      .sort()
    for (const name of archives) {
      const archive = path.join(source.directory, name)
      try {
        const extension = await loadArchive(archive)
        if (selected.get(extension.id)?.builtin) {
          throw new Error("extension id is reserved by a built-in extension")
        }
        extension.builtin = source.builtin
        extension.managed = source.managed
        extension.enabled = source.builtin || !config.disabled.includes(extension.id)
        selected.set(extension.id, extension)
      } catch (error) {
        log(`extension skipped: ${archive}: ${error.stack || error}`)
      }
    }
  }
  for (const extension of selected.values()) {
    extensions.push(extension)
    roots.set(extension.id, extension.root)
  }
  log(`extensions discovered: ${extensions.length}`)
}
const signalReady = () => {
  if (!process.env.MODLOADER_READY_FILE) return
  try {
    fs.writeFileSync(process.env.MODLOADER_READY_FILE, String(process.pid))
  } catch (error) {
    log(`failed to signal bootstrap readiness: ${error}`)
  }
}

const registerSchemes = protocol.registerSchemesAsPrivileged
let schemesRegistered = false
protocol.registerSchemesAsPrivileged = (schemes) => {
  if (schemesRegistered) return
  schemesRegistered = true
  registerSchemes.call(protocol, [
    ...schemes,
    {
      scheme: "ocdx",
      privileges: {
        bypassCSP: true,
        corsEnabled: true,
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ])
}

void app.whenReady().then(async () => {
  protocol.handle("ocdx", async (request) => {
    const url = new URL(request.url)
    if (url.host === "host" && url.pathname === "/connection") {
      try {
        const registration = JSON.parse(await fs.promises.readFile(path.join(channel.directories.state, "opencode", "service.json"), "utf8"))
        if (typeof registration.url !== "string" || typeof registration.password !== "string")
          return json({ error: "OCDX service registration is incomplete" }, 503)
        return json({ key: "sidecar", url: registration.url, username: "opencode", password: registration.password })
      } catch {
        return json({ error: "OCDX service is not ready" }, 503)
      }
    }
    if (url.host === "manager") return handleManagerRequest(request, url)
    if (url.host === "main") return handleMainRequest(request, url)
    const parts = url.pathname.split("/").filter(Boolean)
    if (url.host !== "mods" || parts.length < 2) return new Response("Not found", { status: 404 })
    const root = roots.get(parts.shift())
    if (!root) return new Response("Not found", { status: 404 })
    const target = path.resolve(root, parts.map(decodeURIComponent).join(path.sep))
    const relative = path.relative(root, target)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target)) {
      return new Response("Not found", { status: 404 })
    }
    const range = request.headers.get("Range")
    return net.fetch(pathToFileURL(target).toString(), {
      headers: range ? { Range: range } : undefined,
    })
  })
  await discovered
  for (const extension of extensions) {
    if (!extension.enabled || !extension.main) continue
    try {
      activateMainExtension(extension)
    } catch (error) {
      log(`main extension failed: ${extension.id}: ${error.stack || error}`)
      console.error(`[ocdx:${extension.id}:main]`, error)
    }
  }
})

app.once("will-quit", () => {
  for (const extensionID of [...mainExtensions.keys()]) disposeMainExtension(extensionID)
})

// OpenCode's utility process is not hooked, so translate the virtual original ASAR path back to disk.
const fork = utilityProcess.fork
utilityProcess.fork = (modulePath, args, options) => {
  const originalPath = modulePath.replace(
    `${path.sep}_app.asar${path.sep}`,
    `${path.sep}app.asar${path.sep}`,
  )
  return fork.call(utilityProcess, originalPath, args, options)
}

if (process.env.MODLOADER_EXECUTABLE) {
  const relaunch = app.relaunch
  app.relaunch = (options = {}) => {
    let args = process.argv.slice(1)
    try {
      args = JSON.parse(process.env.MODLOADER_PROCESS_ARGV)
    } catch (error) {
      log(`failed to restore launcher arguments: ${error}`)
    }
    relaunch.call(app, {
      ...options,
      args,
      execPath: process.env.MODLOADER_EXECUTABLE,
    })
  }
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("dom-ready", () => {
    if (!contents.getURL().startsWith("oc://renderer/")) return
    void inject(contents)
  })
})

async function inject(contents) {
  await discovered
  try {
    await contents.executeJavaScript(`${runtime}\n//# sourceURL=ocdx-runtime.js`, true)
  } catch (error) {
    log(`runtime injection failed: ${error.stack || error}`)
    return
  }
  for (const extension of extensions) {
    if (!extension.enabled) continue
    try {
      const source = fs.readFileSync(extension.entry, "utf8")
      await contents.executeJavaScript(
        `${source}\n//# sourceURL=ocdx-${extension.id}.js`,
        true,
      )
      log(`extension loaded: ${extension.id}@${extension.version}`)
    } catch (error) {
      log(`extension failed: ${extension.id}: ${error.stack || error}`)
      console.error(`[ocdx:${extension.id}]`, error)
    }
  }
}

function activateMainExtension(extension) {
  disposeMainExtension(extension.id)
  if (!extension.main) return

  const controller = new AbortController()
  const owned = [() => controller.abort()]
  const resolved = require.resolve(extension.main)
  delete require.cache[resolved]
  const loaded = require(resolved)
  const source = loaded?.default ?? loaded
  if (!source || typeof source.activate !== "function") {
    delete require.cache[resolved]
    throw new Error("Main extension must export an activate function")
  }

  const record = { methods: new Map(), resolved, dispose: undefined }
  const own = (dispose) => {
    if (typeof dispose !== "function") throw new TypeError("Main extension disposer must be a function")
    owned.push(dispose)
    return () => {
      const index = owned.indexOf(dispose)
      if (index !== -1) owned.splice(index, 1)
      dispose()
    }
  }
  const cleanup = () => {
    record.methods.clear()
    for (const dispose of owned.reverse()) {
      try {
        dispose()
      } catch (error) {
        log(`main extension cleanup failed: ${extension.id}: ${error.stack || error}`)
      }
    }
    owned.length = 0
    delete require.cache[resolved]
  }

  try {
    const methods = source.activate({
      id: extension.id,
      lifecycle: { signal: controller.signal, own },
    })
    if (!methods || typeof methods !== "object" || Array.isArray(methods)) {
      throw new TypeError("Main extension activate must return a method object")
    }
    for (const [name, method] of Object.entries(methods)) {
      if (name === "then" || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) {
        throw new Error(`Invalid main extension method: ${name}`)
      }
      if (typeof method !== "function") {
        throw new TypeError(`Main extension method must be a function: ${name}`)
      }
      record.methods.set(name, method)
    }
    record.dispose = cleanup
    mainExtensions.set(extension.id, record)
    log(`main extension loaded: ${extension.id}@${extension.version}`)
  } catch (error) {
    cleanup()
    throw error
  }
}

function disposeMainExtension(extensionID) {
  const record = mainExtensions.get(extensionID)
  if (!record) return
  mainExtensions.delete(extensionID)
  record.dispose()
}

async function handleMainRequest(request, url) {
  if (request.method === "OPTIONS") return json({ ok: true })
  try {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
    if (request.method !== "POST" || parts.length !== 2) {
      return json({ error: "Main extension method not found" }, 404)
    }
    const [extensionID, methodName] = parts
    const input = await request.json()
    if (!input || !Array.isArray(input.args)) {
      return json({ error: "Main extension arguments must be an array" }, 400)
    }
    const method = mainExtensions.get(extensionID)?.methods.get(methodName)
    if (!method) return json({ error: "Main extension method not found" }, 404)
    return json({ value: await method(...input.args) })
  } catch (error) {
    log(`main extension request failed: ${error.stack || error}`)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
}

async function handleManagerRequest(request, url) {
  if (request.method === "OPTIONS") return json({ ok: true })
  await discovered
  if (request.method === "GET" && url.pathname === "/extensions") {
    return json({ extensions: extensions.map(extensionInfo) })
  }
  if (request.method === "POST" && url.pathname === "/install") {
    const bytes = Buffer.from(await request.arrayBuffer())
    const name = url.searchParams.get("name") || `extension-${Date.now()}.ocdx`
    return await installArchive(name, bytes)
  }
  if (request.method === "POST" && url.pathname === "/install-url") {
    const input = await request.json()
    const source = new URL(input.url)
    if (source.protocol !== "https:" && source.protocol !== "http:") {
      return json({ error: "Only HTTP and HTTPS URLs are supported" }, 400)
    }
    const response = await net.fetch(source.toString())
    if (!response.ok) return json({ error: `Download failed with status ${response.status}` }, 400)
    const length = Number(response.headers.get("content-length") || 0)
    if (length > 1_073_741_824) return json({ error: "Extension is larger than 1 GiB" }, 400)
    const name = decodeURIComponent(path.basename(source.pathname)) || `extension-${Date.now()}.ocdx`
    return await installArchive(name, Buffer.from(await response.arrayBuffer()))
  }
  if (request.method === "POST" && url.pathname === "/toggle") {
    const input = await request.json()
    const extension = extensions.find((item) => item.id === input.id)
    if (!extension) return json({ error: "Extension not found" }, 404)
    if (extension.builtin) return json({ error: "Built-in extensions cannot be disabled" }, 400)
    try {
      await setExtensionEnabled(extension, Boolean(input.enabled))
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
    const config = readConfig()
    const disabled = new Set(config.disabled)
    if (input.enabled) disabled.delete(extension.id)
    else disabled.add(extension.id)
    config.disabled = [...disabled].sort()
    writeConfig(config)
    extension.enabled = Boolean(input.enabled)
    return json({ ok: true, restart: true })
  }
  return json({ error: "Not found" }, 404)
}

function extensionInfo({ id, name, version, enabled, builtin, main }) {
  return { id, name, version, enabled, builtin, hasMain: Boolean(main) }
}

async function setExtensionEnabled(extension, enabled) {
  const targets = webContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed() && contents.getURL().startsWith("oc://renderer/"))
  if (!enabled) {
    const id = JSON.stringify(extension.id)
    await Promise.allSettled(
      targets.map((contents) => contents.executeJavaScript(`globalThis.__ocdx?.disable(${id})`, true)),
    )
    disposeMainExtension(extension.id)
    return
  }

  activateMainExtension(extension)
  try {
    const source = fs.readFileSync(extension.entry, "utf8")
    await Promise.all(
      targets.map((contents) =>
        contents.executeJavaScript(
          `${source}\n//# sourceURL=ocdx-${extension.id}.js`,
          true,
        ),
      ),
    )
  } catch (error) {
    const id = JSON.stringify(extension.id)
    await Promise.allSettled(
      targets.map((contents) => contents.executeJavaScript(`globalThis.__ocdx?.disable(${id})`, true)),
    )
    disposeMainExtension(extension.id)
    throw error
  }
}

async function installArchive(name, bytes) {
  if (!modsDirectory) return json({ error: "Mods directory is unavailable" }, 500)
  if (bytes.length < 4 || bytes.length > 1_073_741_824 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return json({ error: "The file is not a valid .ocdx archive" }, 400)
  }
  const filename = path
    .basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/\.ocdx$/i, "")
  const target = path.join(modsDirectory, `${filename || `extension-${Date.now()}`}.ocdx`)
  const temporary = `${target}.${process.pid}.tmp`
  const backup = `${target}.${process.pid}.bak`
  fs.mkdirSync(modsDirectory, { recursive: true })
  fs.rmSync(temporary, { force: true })
  fs.rmSync(backup, { force: true })
  fs.writeFileSync(temporary, bytes)
  // Each completed step pushes its compensation; a failure runs them in reverse.
  const undo = [() => fs.rmSync(temporary, { force: true })]
  try {
    const extension = await loadArchive(temporary)
    if (extension.main) {
      throw new Error("Main-process extensions must be installed from the mods directory and require a restart")
    }
    extension.enabled = true
    extension.managed = true
    const existing = extensions.find((item) => item.id === extension.id)
    if (existing?.builtin) throw new Error("Extension ID is reserved by a built-in extension")
    if (existing?.enabled) {
      await setExtensionEnabled(existing, false)
      undo.push(() => setExtensionEnabled(existing, true))
    }
    const previousRoot = roots.get(extension.id)
    roots.set(extension.id, extension.root)
    undo.push(() => {
      if (previousRoot) roots.set(extension.id, previousRoot)
      else roots.delete(extension.id)
    })
    await setExtensionEnabled(extension, true)
    undo.push(() => setExtensionEnabled(extension, false))

    if (fs.existsSync(target)) {
      fs.renameSync(target, backup)
      undo.push(() => fs.renameSync(backup, target))
    }
    fs.renameSync(temporary, target)
    undo.push(() => fs.rmSync(target, { force: true }))
    extension.archive = target

    const config = readConfig()
    config.disabled = config.disabled.filter((id) => id !== extension.id)
    writeConfig(config)
    const index = extensions.findIndex((item) => item.id === extension.id)
    if (index === -1) extensions.push(extension)
    else extensions.splice(index, 1, extension)
    if (existing?.managed && existing.archive !== target) fs.rmSync(existing.archive, { force: true })
    fs.rmSync(backup, { force: true })
    return json({ ok: true, extension: extensionInfo(extension), filename: path.basename(target) })
  } catch (error) {
    for (const compensate of undo.reverse()) {
      try {
        await compensate()
      } catch (rollbackError) {
        log(`install rollback step failed: ${rollbackError.stack || rollbackError}`)
      }
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
}

async function loadArchive(archivePath) {
  const { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } = require("./archive.cjs")
  const archive = new ZipReader(new BlobReader(new Blob([fs.readFileSync(archivePath)])), { useWebWorkers: false })
  const entries = await archive.getEntries()
  if (entries.length > 1_024) throw new Error("Archive contains more than 1024 entries")
  const manifestEntry = entries.find((entry) => entry.filename === "manifest.json")
  if (!manifestEntry || manifestEntry.directory || manifestEntry.uncompressedSize > 64 * 1_024) {
    throw new Error("manifest.json is missing or invalid")
  }
  const manifest = JSON.parse(await manifestEntry.getData(new TextWriter()))
  validateManifest(manifest)
  if (!entries.some((entry) => entry.filename === manifest.entry && !entry.directory)) {
    throw new Error(`Entry is missing: ${manifest.entry}`)
  }
  if (manifest.main && !entries.some((entry) => entry.filename === manifest.main && !entry.directory)) {
    throw new Error(`Main entry is missing: ${manifest.main}`)
  }

  let total = 0
  for (const entry of entries) {
    validateArchivePath(entry.filename)
    total += entry.uncompressedSize
    if (total > 1_073_741_824) throw new Error("Archive expands beyond 1 GiB")
  }

  const metadata = fs.statSync(archivePath)
  const root = path.join(
    path.dirname(configPath),
    "cache",
    manifest.id,
    `${manifest.version}-${metadata.size}-${Math.trunc(metadata.mtimeMs)}`,
  )
  if (
    !fs.existsSync(path.join(root, manifest.entry)) ||
    (manifest.main && !fs.existsSync(path.join(root, manifest.main)))
  ) {
    const temporary = `${root}.${process.pid}.tmp`
    fs.rmSync(temporary, { recursive: true, force: true })
    for (const entry of entries) {
      const target = path.join(temporary, ...entry.filename.split("/").filter(Boolean))
      if (entry.directory) {
        fs.mkdirSync(target, { recursive: true })
        continue
      }
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, Buffer.from(await entry.getData(new Uint8ArrayWriter())))
    }
    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(root), { recursive: true })
    fs.renameSync(temporary, root)
  }
  await archive.close()
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    entry: path.join(root, manifest.entry),
    main: manifest.main ? path.join(root, manifest.main) : undefined,
    root,
    archive: archivePath,
    enabled: false,
    builtin: false,
    managed: false,
  }
}

function validateManifest(manifest) {
  if (manifest.schema !== 1) throw new Error(`Unsupported manifest schema: ${manifest.schema}`)
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.id || "")) throw new Error("Invalid extension ID")
  if (!String(manifest.name || "").trim() || !String(manifest.version || "").trim()) {
    throw new Error("Extension name and version are required")
  }
  if (!/^[a-zA-Z0-9._+-]+$/.test(manifest.version)) {
    throw new Error("Extension version contains unsupported characters")
  }
  validateArchivePath(manifest.entry)
  if (manifest.main !== undefined) validateArchivePath(manifest.main)
}

function validateArchivePath(value) {
  if (!value || value.includes("\\") || value.startsWith("/")) throw new Error(`Unsafe archive path: ${value}`)
  const parts = value.split("/").filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${value}`)
  }
}

function readConfig() {
  if (!configPath || !fs.existsSync(configPath)) return { disabled: [] }
  try {
    const value = JSON.parse(fs.readFileSync(configPath, "utf8"))
    return { disabled: Array.isArray(value.disabled) ? value.disabled : [] }
  } catch {
    return { disabled: [] }
  }
}

function writeConfig(config) {
  if (!configPath) return
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const temporary = `${configPath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2))
  fs.rmSync(configPath, { force: true })
  fs.renameSync(temporary, configPath)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  })
}

const originalPackage = JSON.parse(fs.readFileSync(path.join(originalAsar, "package.json"), "utf8"))
const originalMain = path.resolve(originalAsar, originalPackage.main)

void import(pathToFileURL(originalMain).href)
  .then(signalReady)
  .catch((error) => {
    log(`OpenCode startup failed: ${error.stack || error}`)
    console.error("[ocdx] OpenCode startup failed", error)
    app.exit(1)
  })
