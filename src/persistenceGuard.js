const STORAGE_KEY = "hostelsplit-data";
const BACKUP_KEY = "hostelsplit-data-backup";

// Restore the last known copy before React starts reading the data.
try {
  const current = localStorage.getItem(STORAGE_KEY);
  const backup = localStorage.getItem(BACKUP_KEY);
  if (!current && backup) {
    localStorage.setItem(STORAGE_KEY, backup);
  }
} catch {
  // Storage can be unavailable in private/restricted browser contexts.
}

try {
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (key === STORAGE_KEY && value) {
      try {
        originalSetItem.call(this, BACKUP_KEY, value);
      } catch {
        // Keep the main save working even if the backup cannot be written.
      }
    }
  };

  Storage.prototype.removeItem = function (key) {
    if (key === STORAGE_KEY) {
      // Keep a recoverable copy. HostelSplit should never lose the user's data
      // because of the Clear Group action or an accidental localStorage delete.
      const current = this.getItem(STORAGE_KEY);
      if (current) {
        try {
          originalSetItem.call(this, BACKUP_KEY, current);
        } catch {
          // Ignore backup errors.
        }
      }
      return;
    }
    originalRemoveItem.call(this, key);
  };
} catch {
  // Do not block the app if Storage.prototype is locked by the browser.
}
