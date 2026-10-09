(function () {
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
  let currentMode = defaults.mode;
  let currentColorMode = defaults.colorMode;
  let scrollTimer;
  let scrollListenerAttached = false;
  let expectedAttr = null;

  const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  const normalizeSettings = (stored = {}) => {
    const settings = { ...defaults, ...stored };
    const hasPresetState = Object.prototype.hasOwnProperty.call(stored, "preset");
    if (!hasPresetState && ["light", "dark"].includes(settings.colorMode)) {
      settings.colorMode = "auto";
      settings.preset = "auto";
    }
    if (stored.color && !stored.lightColor) settings.lightColor = stored.color;
    if (stored.color && !stored.darkColor) settings.darkColor = stored.color;
    settings.lightColor = normalizeColor(settings.lightColor, defaults.lightColor);
    settings.darkColor = normalizeColor(settings.darkColor, defaults.darkColor);
    settings.excludedSites = Array.isArray(settings.excludedSites) ? settings.excludedSites : [];
    return settings;
  };

  const getColorScheme = (colorMode) => {
    if (colorMode === "light" || colorMode === "dark") return colorMode;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const applySettings = (stored) => {
    const settings = normalizeSettings(stored);
    let root = document.documentElement;
    if (!root) {
      // Injected at document_start, storage may answer before <html> exists.
      // Retry instead of silently dropping the settings.
      const retry = () => applySettings(stored);
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", retry, { once: true });
      } else {
        setTimeout(retry, 0);
      }
      return;
    }

    const excluded = Array.isArray(settings.excludedSites) && settings.excludedSites.includes(location.hostname);
    currentMode = settings.mode === "auto" ? "auto" : "always";
    currentColorMode = ["light", "dark"].includes(settings.colorMode) ? settings.colorMode : "auto";
    const colorScheme = getColorScheme(currentColorMode);
    root.dataset.macScrollbars = settings.enabled && !excluded ? "on" : "off";
    root.dataset.macScrollbarMode = currentMode;
    root.dataset.macColorScheme = colorScheme;
    expectedAttr = root.dataset.macScrollbars;
    root.style.setProperty("--mac-scrollbar-width", `${settings.width}px`);
    root.style.setProperty("--mac-scrollbar-color", colorScheme === "dark" ? settings.darkColor : settings.lightColor);
    root.style.setProperty("--mac-scrollbar-opacity", settings.opacity);

    if (root.dataset.macScrollbars !== "on" || currentMode !== "auto") {
      root.removeAttribute("data-mac-scrolling");
    }
    syncScrollListener(root.dataset.macScrollbars === "on" && currentMode === "auto");
  };

  // Guard: SPA frameworks and other extensions may rewrite or clean the
  // <html> attribute list. Restore our flag whenever it goes missing.
  const guardRootAttr = () => {
    const root = document.documentElement;
    if (root && expectedAttr && root.getAttribute("data-mac-scrollbars") !== expectedAttr) {
      root.setAttribute("data-mac-scrollbars", expectedAttr);
    }
  };
  const startGuard = () => {
    if (!document.documentElement) {
      setTimeout(startGuard, 0);
      return;
    }
    new MutationObserver(guardRootAttr).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mac-scrollbars"]
    });
  };
  startGuard();

  const markScrolling = () => {
    const root = document.documentElement;
    if (!root || currentMode !== "auto" || root.dataset.macScrollbars !== "on") return;

    root.dataset.macScrolling = "true";
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => root.removeAttribute("data-mac-scrolling"), 1000);
  };

  const syncScrollListener = (shouldListen) => {
    if (shouldListen && !scrollListenerAttached) {
      document.addEventListener("scroll", markScrolling, true);
      scrollListenerAttached = true;
    } else if (!shouldListen && scrollListenerAttached) {
      document.removeEventListener("scroll", markScrolling, true);
      clearTimeout(scrollTimer);
      scrollListenerAttached = false;
    }
  };

  const colorSchemeQuery = matchMedia("(prefers-color-scheme: dark)");
  const refreshTheme = () => {
    if (currentColorMode === "auto") chrome.storage.sync.get(null, applySettings);
  };
  if (colorSchemeQuery.addEventListener) colorSchemeQuery.addEventListener("change", refreshTheme);
  else if (colorSchemeQuery.addListener) colorSchemeQuery.addListener(refreshTheme);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "get-site") sendResponse({ hostname: location.hostname });
  });

  chrome.storage.sync.get(null, applySettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const next = {};
    for (const [key, change] of Object.entries(changes)) next[key] = change.newValue;
    chrome.storage.sync.get(null, (settings) => applySettings({ ...settings, ...next }));
  });
})();
