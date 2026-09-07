import fs from "node:fs";
import path from "node:path";
import { STATE_PATH, HOME_DIR } from "./config.js";

export function ensureHome() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function saveState(state) {
  ensureHome();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    fs.unlinkSync(STATE_PATH);
  } catch {
    /* ignore */
  }
}

export function stateDir() {
  return path.dirname(STATE_PATH);
}
