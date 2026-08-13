const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function readGatewayEnvironment() {
  const file = resolve(__dirname, ".env");
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator === -1 ? [] : [line.slice(0, separator), line.slice(separator + 1)];
      })
      .filter(([key]) => key),
  );
}

module.exports = {
  apps: [{
    name: "yape-telegram-gateway",
    script: "server.mjs",
    cwd: __dirname,
    interpreter: "node",
    autorestart: true,
    max_memory_restart: "150M",
    env: {
      NODE_ENV: "production",
      ...readGatewayEnvironment(),
    },
  }],
};
