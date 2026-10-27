import { Settings, DEFAULT_SETTINGS } from '../shared/messages';

export async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ...DEFAULT_SETTINGS }, (result) => {
      resolve(result as unknown as Settings);
    });
  });
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, resolve);
  });
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') {
      loadSettings().then(callback);
    }
  });
}
