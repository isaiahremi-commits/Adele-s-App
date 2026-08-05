// Metro only watches the project root by default, so runtime imports from the
// repo-root shared/ directory (e.g. ../../shared/tos) fail to resolve without
// this. Type-only imports like shared/db.types never reach Metro and work
// regardless.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.watchFolders = [path.resolve(__dirname, "../shared")];

module.exports = config;
