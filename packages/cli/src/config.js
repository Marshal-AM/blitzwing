/** Default Discovery Service URL — override with BLITZWING_DISCOVERY_URL or --discovery-url */
export const DEFAULT_DISCOVERY_URL =
  process.env.BLITZWING_DISCOVERY_URL ||
  process.env.npm_package_config_discoveryUrl ||
  "https://f44c-103-98-63-33.ngrok-free.app";

export const HOME_DIR = process.env.BLITZWING_HOME || `${process.env.HOME || process.env.USERPROFILE}/.blitzwing`;
export const STATE_PATH = `${HOME_DIR}/contributor.json`;
export const VENV_PATH = `${HOME_DIR}/venv`;
// Windows + WSL on same PC: avoid 8001/31337 — WSL forwards those on 127.0.0.1.
const defaultShardPort = process.platform === "win32" ? 8011 : 8001;
const defaultPetalsPort = process.platform === "win32" ? 31338 : 31337;
export const SHARD_PORT = Number(process.env.BLITZWING_SHARD_PORT || defaultShardPort);
export const PETALS_PORT = Number(process.env.BLITZWING_PETALS_PORT || defaultPetalsPort);
