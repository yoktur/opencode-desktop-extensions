const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { spawnSync } = require("node:child_process")

test("channel survives host identity and environment resets, including child processes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocdx-channel-"))
  try {
    const child = spawnSync(process.execPath, ["-e", `
      const { configureChannel } = require(${JSON.stringify(path.resolve("launcher/src/channel.cjs"))});
      const paths = {};
      const app = { setName(value) { this.name = value }, setAppUserModelId(value) { this.id = value }, setPath(name, value) { paths[name] = value } };
      const channel = configureChannel(app, ${JSON.stringify(root)});
      app.setName('OpenCode Beta'); app.setAppUserModelId('ai.opencode.desktop.beta');
      app.setPath('userData', 'beta'); app.setPath('sessionData', 'beta');
      delete process.env.XDG_STATE_HOME;
      Object.assign(process.env, { XDG_DATA_HOME: 'beta', OPENCODE_DB: 'beta.db' });
      const child = require('node:child_process').spawnSync(process.execPath, ['-p', 'JSON.stringify({state: process.env.XDG_STATE_HOME, db: process.env.OPENCODE_DB})'], { encoding: 'utf8' });
      console.log(JSON.stringify({name: app.name, id: app.id, paths, data: process.env.XDG_DATA_HOME, protocol: app.setAsDefaultProtocolClient('opencode'), child: JSON.parse(child.stdout)}));
    `], { encoding: "utf8" })
    assert.equal(child.status, 0, child.stderr)
    const value = JSON.parse(child.stdout)
    assert.equal(value.name, "OCDX")
    assert.equal(value.id, "dev.hona.ocdx")
    assert.equal(value.paths.userData, path.join(root, "desktop"))
    assert.equal(value.paths.sessionData, path.join(root, "session"))
    assert.equal(value.data, path.join(root, "data"))
    assert.equal(value.child.state, path.join(root, "state"))
    assert.equal(value.child.db, path.join(root, "data", "opencode", "ocdx.db"))
    assert.equal(value.protocol, false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config", "opencode", "service.json"))).port, 49376)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
