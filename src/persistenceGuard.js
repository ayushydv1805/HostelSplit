const STORAGE_KEY = "hostelsplit-data";
const BACKUP_KEY = "hostelsplit-data-backup";

// Recover a backup only when the primary copy is missing. The app's explicit
// Clear Group action removes both keys, so a deliberately deleted group stays deleted.
try {
  const current = localStorage.getItem(STORAGE_KEY);
  const backup = localStorage.getItem(BACKUP_KEY);
  if (!current && backup) {
    localStorage.setItem(STORAGE_KEY, backup);
  }
} catch {
  // Storage can be unavailable in private/restricted browser contexts.
}

// Keep a recoverable copy after successful primary writes without intercepting
// removeItem(). Intercepting deletes made Clear Group restore the data on reload.
try {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (key === STORAGE_KEY && value) {
      try {
        originalSetItem.call(this, BACKUP_KEY, value);
      } catch {
        // Keep the primary save working even if the backup cannot be written.
      }
    }
  };
} catch {
  // Do not block the app if Storage.prototype is locked by the browser.
}
