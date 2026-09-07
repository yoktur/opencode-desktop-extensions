const fs = require("node:fs")
const path = require("node:path")

// The installed application sets its Beta/Stable identity and reloads shell
// environment during startup. Own these boundaries before importing its main.
function configureChannel(app, root) {
  const directories = Object.fromEntries(
    ["desktop", "session", "data", "config", "cache", "state"].map((name) => [name, path.join(root, name)]),
  )
  for (const directory of Object.values(directories)) fs.mkdirSync(directory, { recursive: true })
  const environment = {
    XDG_DATA_HOME: directories.data,
    XDG_CONFIG_HOME: directories.config,
    XDG_CACHE_HOME: directories.cache,
    XDG_STATE_HOME: directories.state,
    OPENCODE_DB: path.join(directories.data, "opencode", "ocdx.db"),
    OPENCODE_TEST_ONBOARDING: "0",
  }
  fs.mkdirSync(path.dirname(environment.OPENCODE_DB), { recursive: true })
  const service = path.join(directories.config, "opencode", "service.json")
  fs.mkdirSync(path.dirname(service), { recursive: true })
  // Beta and Stable default to 49374. A separate registration alone does not
  // isolate their listening port. Preserve an existing OCDX service preference.
  if (!fs.existsSync(service)) fs.writeFileSync(service,
    JSON.stringify({ hostname: "127.0.0.1", port: 49376 }), { flag: "wx", mode: 0o600 },
  )
  Object.assign(process.env, environment)
  // OpenCode explicitly deletes XDG_STATE_HOME after importing the shell env.
  // Keep the channel's paths fixed, including when that env is reloaded later.
  process.env = new Proxy(process.env, {
    set(target, key, value) {
      return Reflect.set(target, key, Object.hasOwn(environment, key) ? environment[key] : value)
    },
    deleteProperty(target, key) {
      return Object.hasOwn(environment, key) || Reflect.deleteProperty(target, key)
    },
  })
  const setName = app.setName.bind(app)
  app.setName = () => setName("OCDX")
  app.setName()
  const setID = app.setAppUserModelId.bind(app)
  app.setAppUserModelId = () => setID("dev.hona.ocdx")
  app.setAppUserModelId()
  const setPath = app.setPath.bind(app)
  app.setPath = (name, value) => setPath(name,
    name === "userData" ? directories.desktop : name === "sessionData" ? directories.session : value,
  )
  app.setPath("userData", directories.desktop)
  app.setPath("sessionData", directories.session)
  // OCDX uses the installed payload, but must not take over its protocol handler.
  app.setAsDefaultProtocolClient = () => false
  return { root, directories, environment }
}

module.exports = { configureChannel }
