// Shared helpers for reading/writing the extension's configuration and
// session state. Loaded as a plain script (no bundler) by popup.html and
// options.html.

const STORAGE_KEYS = {
  baseUrl: "lmsBaseUrl",
  session: "lmsSession",
};

async function getBaseUrl() {
  const { [STORAGE_KEYS.baseUrl]: baseUrl } = await chrome.storage.sync.get(
    STORAGE_KEYS.baseUrl
  );
  return baseUrl ? baseUrl.replace(/\/+$/, "") : "";
}

async function setBaseUrl(baseUrl) {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.baseUrl]: baseUrl.replace(/\/+$/, ""),
  });
}

async function getSession() {
  const { [STORAGE_KEYS.session]: session } = await chrome.storage.local.get(
    STORAGE_KEYS.session
  );
  return session || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.session);
}
