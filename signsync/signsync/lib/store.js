'use strict';
// User Data Persistence Service.
// Tables follow DESIGN.md section 4.2 (Users, Preferences, Session Logs) as plain
// collections behind a small repository interface. State is held in memory; a host
// (the local server) may attach a persistence hook via `setOnChange` / `load`.
// On serverless hosts this storage is per-instance and ephemeral -- see docs/DEPLOYMENT.md.
const { randomId } = require('./util');

const DEFAULT_PREFS = {
  targetLang: 'en', theme: 'dark', confidenceThreshold: 0.6, voice: 'default', connection: 'bluetooth', autoSpeak: false,
};

const state = { users: [], preferences: [], sessionLogs: [] };
let onChange = null;

function setOnChange(fn) { onChange = fn; }
function changed() { if (onChange) onChange(state); }
function load(data) {
  if (!data) return;
  state.users = data.users || []; state.preferences = data.preferences || []; state.sessionLogs = data.sessionLogs || [];
}

function findUserByName(username) { return state.users.find((u) => u.username.toLowerCase() === username.toLowerCase()); }
function findUserById(id) { return state.users.find((u) => u.id === id); }

function createUser({ username, salt, hash, profile }) {
  const user = { id: randomId('usr'), username, salt, passwordHash: hash, createdAt: new Date().toISOString(), profile: profile || {} };
  state.users.push(user);
  state.preferences.push({ userId: user.id, ...DEFAULT_PREFS });
  changed();
  return user;
}

function getPreferences(userId) {
  const p = state.preferences.find((x) => x.userId === userId);
  if (!p) return { ...DEFAULT_PREFS };
  const { userId: _u, ...rest } = p;
  return rest;
}

function updatePreferences(userId, patch) {
  let p = state.preferences.find((x) => x.userId === userId);
  if (!p) { p = { userId, ...DEFAULT_PREFS }; state.preferences.push(p); }
  Object.assign(p, patch);
  changed();
  return getPreferences(userId);
}

function addSessionLog(userId, entry) {
  const log = { id: randomId('log'), userId, createdAt: new Date().toISOString(), ...entry };
  state.sessionLogs.push(log);
  if (state.sessionLogs.length > 5000) state.sessionLogs.shift();
  changed();
  return log;
}

function listSessionLogs(userId, limit = 100) {
  return state.sessionLogs.filter((l) => l.userId === userId).slice(-limit).reverse();
}

function listUsersForAdmin() {
  return state.users.map((u) => {
    const logs = state.sessionLogs.filter((l) => l.userId === u.id);
    return { id: u.id, username: u.username, displayName: (u.profile && u.profile.displayName) || '', createdAt: u.createdAt, preferences: getPreferences(u.id), sessionCount: logs.length, lastSessionAt: logs.length ? logs[logs.length - 1].createdAt : null };
  }).reverse();
}

function listAllSessionLogs(limit = 1000) {
  const names = new Map(state.users.map((u) => [u.id, u.username]));
  return state.sessionLogs.slice(-limit).reverse().map((l) => ({ ...l, username: names.get(l.userId) || '(deleted user)' }));
}

module.exports = { listUsersForAdmin, listAllSessionLogs, DEFAULT_PREFS, setOnChange, load, findUserByName, findUserById, createUser, getPreferences, updatePreferences, addSessionLog, listSessionLogs, _state: state };
