const defaults = {
  enabled: true,
  width: 8,
  opacity: 0.45,
  colorMode: "auto",
  lightColor: "#7d8794",
  darkColor: "#b8c2cc",
  mode: "always",
  preset: "auto",
  excludedSites: []
};
const presets = {
  light: {
    colorMode: "light",
    width: 8,
    opacity: 0.45,
    lightColor: "#7d8794",
    darkColor: "#b8c2cc"
  },
  dark: {
    colorMode: "dark",
    width: 8,
    opacity: 0.45,
    lightColor: "#7d8794",
    darkColor: "#b8c2cc"
  }
};

const $ = (id) => document.getElementById(id);
const controls = {
  enabled: $("enabled"),
  width: $("width"),
  opacity: $("opacity"),
  colorMode: $("color-mode"),
  preset: $("preset"),
  lightColor: $("light-color"),
  darkColor: $("dark-color"),
  mode: $("mode"),
  siteEnabled: $("site-enabled"),
  reset: $("reset")
};
const syncStorage = globalThis.chrome?.storage?.sync;
const storageDebounceMs = 400;
let currentHost = null;
let saveTimer;
let latestSettings;
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function normalizeSettings(stored = {}) {
  const settings = { ...defaults, ...stored };
  const hasPresetState = Object.prototype.hasOwnProperty.call(stored, "preset");
  if (!hasPresetState && ["light", "dark"].includes(settings.colorMode)) {
    settings.colorMode = "auto";
    settings.preset = "auto";
  }
  if (stored.color && !stored.lightColor) settings.lightColor = stored.color;
  if (stored.color && !stored.darkColor) settings.darkColor = stored.color;
  settings.lightColor = /^#[0-9a-f]{6}$/i.test(settings.lightColor || "") ? settings.lightColor : defaults.lightColor;
  settings.darkColor = /^#[0-9a-f]{6}$/i.test(settings.darkColor || "") ? settings.darkColor : defaults.darkColor;
  settings.preset = ["auto", "light", "dark", "custom"].includes(settings.preset) ? settings.preset : "auto";
  settings.excludedSites = Array.isArray(settings.excludedSites) ? settings.excludedSites : [];
  return settings;
}

function getColorScheme(settings) {
  if (settings.colorMode === "light" || settings.colorMode === "dark") return settings.colorMode;
  return colorSchemeQuery.matches ? "dark" : "light";
}

function render(settings) {
  const incoming = normalizeSettings(settings);
  latestSettings = normalizeSettings(latestSettings ? { ...latestSettings, ...incoming } : incoming);
  const excludedSites = Array.isArray(latestSettings.excludedSites) ? latestSettings.excludedSites : [];
  controls.enabled.checked = latestSettings.enabled;
  controls.width.value = latestSettings.width;
  controls.opacity.value = latestSettings.opacity;
  controls.colorMode.value = ["light", "dark"].includes(latestSettings.colorMode) ? latestSettings.colorMode : "auto";
  controls.preset.value = findPreset(latestSettings);
  controls.lightColor.value = latestSettings.lightColor;
  controls.darkColor.value = latestSettings.darkColor;
  controls.mode.value = latestSettings.mode === "auto" ? "auto" : "always";
  controls.siteEnabled.checked = !excludedSites.includes(currentHost);
  $("width-value").textContent = `${latestSettings.width} px`;
  $("opacity-value").textContent = `${Math.round(latestSettings.opacity * 100)}%`;
  const scheme = getColorScheme(latestSettings);
  const preview = document.querySelector(".preview");
  const previewColor = scheme === "dark" ? latestSettings.darkColor : latestSettings.lightColor;
  preview.dataset.scheme = scheme;
  document.documentElement.style.setProperty("--preview-color", previewColor);
  document.querySelector(".preview-thumb").style.background = previewColor;
  document.querySelector(".preview-thumb").style.opacity = latestSettings.opacity;
}

function findPreset(settings) {
  if (settings.preset === "custom") return "custom";
  const scheme = settings.preset === "light" || settings.preset === "dark"
    ? settings.preset
    : getColorScheme(settings);
  const preset = presets[scheme];
  const matches = preset
    && settings.width === preset.width
    && settings.opacity === preset.opacity
    && settings.lightColor === preset.lightColor
    && settings.darkColor === preset.darkColor
    && (settings.preset === "auto" || settings.colorMode === preset.colorMode);
  return matches ? scheme : "custom";
}

function persist(settings) {
  if (!syncStorage) return;
  syncStorage.set(settings, () => {
    $("status").textContent = chrome.runtime.lastError ? "保存失败，请重试" : "设置会自动保存";
  });
}

function save(debounced = false, preset = "custom") {
  const settings = {
    enabled: controls.enabled.checked,
    width: Number(controls.width.value),
    opacity: Number(controls.opacity.value),
    colorMode: controls.colorMode.value,
    lightColor: controls.lightColor.value,
    darkColor: controls.darkColor.value,
    mode: controls.mode.value,
    preset,
    excludedSites: latestSettings?.excludedSites ?? []
  };
  render(settings);
  clearTimeout(saveTimer);
  if (debounced) saveTimer = setTimeout(() => persist(settings), storageDebounceMs);
  else persist(settings);
}

function applyPreset() {
  const selected = controls.preset.value;
  if (selected === "custom") {
    save(false, "custom");
    return;
  }
  const preset = presets[selected];
  if (!preset) return;
  controls.colorMode.value = preset.colorMode;
  controls.width.value = preset.width;
  controls.opacity.value = preset.opacity;
  controls.lightColor.value = preset.lightColor;
  controls.darkColor.value = preset.darkColor;
  save(false, selected);
}

function saveSiteSetting() {
  if (!syncStorage || !currentHost) return;
  syncStorage.get(null, (settings) => {
    const excludedSites = Array.isArray(settings.excludedSites) ? [...settings.excludedSites] : [];
    const index = excludedSites.indexOf(currentHost);
    if (controls.siteEnabled.checked && index !== -1) excludedSites.splice(index, 1);
    if (!controls.siteEnabled.checked && index === -1) excludedSites.push(currentHost);
    latestSettings = { ...(latestSettings ?? defaults), excludedSites };
    syncStorage.set({ excludedSites });
  });
}

function resetSettings() {
  clearTimeout(saveTimer);
  persist({ ...defaults });
  render({ ...defaults });
}

function discoverSite() {
  if (!globalThis.chrome?.tabs?.query) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { type: "get-site" }, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError || !response?.hostname) return;
      currentHost = response.hostname;
      $("site-name").textContent = currentHost;
      $("site-row").hidden = false;
      syncStorage.get(null, render);
    });
  });
}

if (syncStorage) syncStorage.get(null, render);
else render(defaults);
const keepPreset = () => latestSettings?.preset ?? "auto";
controls.enabled.addEventListener("input", () => save(false, keepPreset()));
controls.width.addEventListener("input", () => save(true));
controls.opacity.addEventListener("input", () => save(true));
controls.width.addEventListener("change", () => save());
controls.opacity.addEventListener("change", () => save());
controls.colorMode.addEventListener("change", () => save(false, "auto"));
controls.lightColor.addEventListener("input", () => save());
controls.darkColor.addEventListener("input", () => save());
controls.mode.addEventListener("change", () => save(false, keepPreset()));
controls.preset.addEventListener("change", applyPreset);
controls.siteEnabled.addEventListener("change", saveSiteSetting);
controls.reset.addEventListener("click", resetSettings);
discoverSite();
const refreshPreviewTheme = () => {
  if (latestSettings?.colorMode === "auto") render(latestSettings);
};
if (colorSchemeQuery.addEventListener) colorSchemeQuery.addEventListener("change", refreshPreviewTheme);
else if (colorSchemeQuery.addListener) colorSchemeQuery.addListener(refreshPreviewTheme);
