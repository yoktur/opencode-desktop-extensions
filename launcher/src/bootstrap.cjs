const fs = require("node:fs")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { app, net, protocol, utilityProcess, webContents } = require("electron")

const runtimePath = process.env.MODLOADER_MOD_ENTRYPOINT
const extensions = JSON.parse(process.env.OCDX_EXTENSIONS || "[]")
const roots = new Map(extensions.map((extension) => [extension.id, extension.root]))
const modsDirectory = process.env.OCDX_MODS_DIR
const configPath = process.env.OCDX_CONFIG
const runtime = fs.readFileSync(runtimePath, "utf8")
const log = (message) => {
  if (!process.env.OCDX_LOG) return
  fs.appendFileSync(process.env.OCDX_LOG, `${message}\n`)
}
log(`bootstrap started in pid ${process.pid}`)
log(`extensions discovered: ${extensions.length}`)

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

void app.whenReady().then(() => {
  protocol.handle("ocdx", async (request) => {
    const url = new URL(request.url)
    if (url.host === "manager") return handleManagerRequest(request, url)
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

async function handleManagerRequest(request, url) {
  if (request.method === "OPTIONS") return json({ ok: true })
  if (request.method === "GET" && url.pathname === "/extensions") {
    return json({ extensions })
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

async function setExtensionEnabled(extension, enabled) {
  const targets = webContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed() && contents.getURL().startsWith("oc://renderer/"))
  if (!enabled) {
    const id = JSON.stringify(extension.id)
    await Promise.all(
      targets.map((contents) => contents.executeJavaScript(`globalThis.__ocdx?.disable(${id})`, true)),
    )
    return
  }

  const source = fs.readFileSync(extension.entry, "utf8")
  try {
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
  fs.mkdirSync(modsDirectory, { recursive: true })
  fs.writeFileSync(temporary, bytes)
  fs.rmSync(target, { force: true })
  fs.renameSync(temporary, target)
  try {
    const extension = await loadArchive(target)
    const existing = extensions.find((item) => item.id === extension.id)
    if (existing?.builtin) throw new Error("Extension ID is reserved by a built-in extension")
    if (existing?.enabled) await setExtensionEnabled(existing, false)
    const index = extensions.findIndex((item) => item.id === extension.id)
    if (index === -1) extensions.push(extension)
    else extensions.splice(index, 1, extension)
    roots.set(extension.id, extension.root)
    await setExtensionEnabled(extension, true)
    const config = readConfig()
    config.disabled = config.disabled.filter((id) => id !== extension.id)
    writeConfig(config)
    return json({ ok: true, extension, filename: path.basename(target) })
  } catch (error) {
    fs.rmSync(target, { force: true })
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
}

async function loadArchive(archivePath) {
  const { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } = require(
    path.join(originalAsar, "node_modules", "@zip.js", "zip.js", "index.cjs"),
  )
  const archive = new ZipReader(new BlobReader(new Blob([fs.readFileSync(archivePath)])))
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
  if (!fs.existsSync(path.join(root, manifest.entry))) {
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
    root,
    enabled: true,
    builtin: false,
  }
}

function validateManifest(manifest) {
  if (manifest.schema !== 1) throw new Error(`Unsupported manifest schema: ${manifest.schema}`)
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.id || "")) throw new Error("Invalid extension ID")
  if (!String(manifest.name || "").trim() || !String(manifest.version || "").trim()) {
    throw new Error("Extension name and version are required")
  }
  validateArchivePath(manifest.entry)
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

const originalAsar = path.resolve(__dirname, process.env.MODLOADER_ORIGINAL_ASAR_RELATIVE)
const originalPackage = JSON.parse(fs.readFileSync(path.join(originalAsar, "package.json"), "utf8"))
const originalMain = path.resolve(originalAsar, originalPackage.main)

void import(pathToFileURL(originalMain).href).catch((error) => {
  log(`OpenCode startup failed: ${error.stack || error}`)
  console.error("[ocdx] OpenCode startup failed", error)
  app.exit(1)
})
