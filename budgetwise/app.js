/**
 * BudgetWise App - Client-side entry point.
 * Handles storage, state, and view coordination.
 */

import { Charts } from "./charts.js";

const STORAGE_VERSION = 1;
const STORAGE_KEYS = {
  transactions: "BW_V1_TRANSACTIONS",
  categories: "BW_V1_CATEGORIES",
  recurring: "BW_V1_RECURRING",
  settings: "BW_V1_SETTINGS",
};

const BUCKETS = ["Necessities", "Leisure", "Savings"];

const DEFAULT_RULE = {
  necessities: 50,
  leisure: 30,
  savings: 20,
};

const DEFAULT_SETTINGS = {
  currency: "USD",
  locale: "en-US",
  rule: { ...DEFAULT_RULE },
  firstDayOfWeek: 1,
  showAdvancedCharts: false,
  hapticFeedback: false,
  schema_version: STORAGE_VERSION,
};

const DEFAULT_CATEGORIES = [
  { id: createId(), name: "Housing", bucket: "Necessities", archived: false },
  { id: createId(), name: "Groceries", bucket: "Necessities", archived: false },
  { id: createId(), name: "Fun", bucket: "Leisure", archived: false },
];

/**
 * Generates moderately unique, chronologically sortable ids.
 */
function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Safe JSON parse with fallback.
 */
function safeParse(value, fallback, onError) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    if (typeof onError === "function") {
      onError(err);
    }
    return fallback;
  }
}

const StorageService = (() => {
  const corruptedKeys = new Set();

  function read(key, fallback) {
    const raw = window.localStorage.getItem(key);
    return safeParse(raw, fallback, () => {
      corruptedKeys.add(key);
    });
  }

  function write(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function ensureDefaults() {
    const storedSettings = read(STORAGE_KEYS.settings, null);
    if (
      !storedSettings ||
      storedSettings.schema_version !== STORAGE_VERSION
    ) {
      write(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS });
    }

    const categories = read(STORAGE_KEYS.categories, null);
    if (!Array.isArray(categories)) {
      write(STORAGE_KEYS.categories, DEFAULT_CATEGORIES.map((c) => ({ ...c })));
    }

    const transactions = read(STORAGE_KEYS.transactions, null);
    if (!Array.isArray(transactions)) {
      write(STORAGE_KEYS.transactions, []);
    }

    const recurring = read(STORAGE_KEYS.recurring, null);
    if (!Array.isArray(recurring)) {
      write(STORAGE_KEYS.recurring, []);
    }
  }

  function init() {
    corruptedKeys.clear();
    ensureDefaults();
  }

  function getSnapshot() {
    return {
      settings: read(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS }),
      categories: read(STORAGE_KEYS.categories, []).filter(Boolean),
      transactions: read(STORAGE_KEYS.transactions, []).filter(Boolean),
      recurring: read(STORAGE_KEYS.recurring, []).filter(Boolean),
    };
  }

  function saveSettings(settings) {
    write(STORAGE_KEYS.settings, settings);
  }

  function saveCategories(categories) {
    write(STORAGE_KEYS.categories, categories);
  }

  function saveTransactions(transactions) {
    write(STORAGE_KEYS.transactions, transactions);
  }

  function saveRecurring(recurring) {
    write(STORAGE_KEYS.recurring, recurring);
  }

  function hasCorruption() {
    return corruptedKeys.size > 0;
  }

  function getCorruptedKeys() {
    return Array.from(corruptedKeys);
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEYS.transactions);
    window.localStorage.removeItem(STORAGE_KEYS.categories);
    window.localStorage.removeItem(STORAGE_KEYS.recurring);
    window.localStorage.removeItem(STORAGE_KEYS.settings);
    init();
    return getSnapshot();
  }

  return {
    init,
    getSnapshot,
    saveSettings,
    saveCategories,
    saveTransactions,
    saveRecurring,
    hasCorruption,
    getCorruptedKeys,
    reset,
  };
})();

function getMonthKey(dateIso) {
  const [year, month] = dateIso.split("T")[0].split("-");
  return `${year}-${month}`;
}

function compareTransactionsDesc(a, b) {
  if (a.date_iso !== b.date_iso) {
    return b.date_iso.localeCompare(a.date_iso);
  }
  return b.id.localeCompare(a.id);
}

function isSameMonth(dateIso, year, monthIndex) {
  const date = new Date(dateIso);
  return date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex;
}

function getMonthRange(year, monthIndex) {
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));
  return { start, end };
}

const Store = (() => {
  const listeners = new Set();
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    categories: [],
    transactions: [],
    recurring: [],
    month: {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
    },
    corruption: {
      hasCorruption: false,
      keys: [],
    },
  };

  function loadFromStorage() {
    const snapshot = StorageService.getSnapshot();
    state.settings = normalizeSettings(snapshot.settings);
    state.categories = normalizeCategories(snapshot.categories);
    state.transactions = normalizeTransactions(snapshot.transactions);
    state.recurring = normalizeRecurring(snapshot.recurring);
    state.corruption = {
      hasCorruption: StorageService.hasCorruption(),
      keys: StorageService.getCorruptedKeys(),
    };
  }

  function normalizeSettings(raw) {
    const settings = { ...DEFAULT_SETTINGS, ...raw };
    settings.schema_version = STORAGE_VERSION;
    const rule = { ...DEFAULT_RULE, ...((raw && raw.rule) || {}) };
    settings.rule = rule;
    settings.showAdvancedCharts = Boolean(settings.showAdvancedCharts);
    settings.hapticFeedback = Boolean(settings.hapticFeedback);
    settings.firstDayOfWeek =
      Number.isInteger(settings.firstDayOfWeek) && settings.firstDayOfWeek === 0
        ? 0
        : 1;
    return settings;
  }

  function normalizeCategories(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id || createId(),
        name: typeof item.name === "string" ? item.name : "Untitled",
        bucket: BUCKETS.includes(item.bucket) ? item.bucket : "Necessities",
        archived: Boolean(item.archived),
      }));
  }

  function normalizeTransactions(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item === "object")
      .map((tx) => ({
        id: tx.id || createId(),
        type: tx.type === "income" ? "income" : "expense",
        amount_cents: Number.isFinite(tx.amount_cents)
          ? Math.max(0, Math.trunc(tx.amount_cents))
          : 0,
        description: typeof tx.description === "string" ? tx.description : "",
        category_id: tx.category_id || null,
        bucket: BUCKETS.includes(tx.bucket) ? tx.bucket : null,
        date_iso:
          typeof tx.date_iso === "string"
            ? tx.date_iso
            : new Date().toISOString(),
      }))
      .filter((tx) => tx.amount_cents > 0);
  }

  function normalizeRecurring(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id || createId(),
        description:
          typeof item.description === "string" ? item.description : "",
        default_amount_cents: Number.isFinite(item.default_amount_cents)
          ? Math.max(0, Math.trunc(item.default_amount_cents))
          : 0,
        category_id: item.category_id || null,
      }));
  }

  function persist() {
    StorageService.saveSettings(state.settings);
    StorageService.saveCategories(state.categories);
    StorageService.saveTransactions(state.transactions);
    StorageService.saveRecurring(state.recurring);
  }

  function notify(detail) {
    listeners.forEach((listener) => {
      listener(getState(), detail);
    });
  }

  function getState() {
    return {
      settings: state.settings,
      categories: state.categories,
      transactions: state.transactions,
      recurring: state.recurring,
      month: state.month,
      corruption: state.corruption,
    };
  }

  function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function init() {
    StorageService.init();
    loadFromStorage();
    notify({ type: "init" });
  }

  function setMonth(year, monthIndex) {
    state.month = { year, month: monthIndex };
    notify({ type: "month:change" });
  }

  function addTransaction(payload) {
    const transaction = buildTransaction(payload);
    state.transactions = [...state.transactions, transaction].sort(
      compareTransactionsDesc
    );
    persist();
    notify({ type: "transactions:add", transaction });
    return transaction;
  }

  function buildTransaction({
    type,
    amount_cents,
    description = "",
    category_id = null,
    bucket = null,
    date_iso = new Date().toISOString(),
  }) {
    const normalizedType = type === "income" ? "income" : "expense";
    const amount = Math.max(0, Math.trunc(amount_cents));
    const resolvedBucket =
      normalizedType === "expense" && BUCKETS.includes(bucket)
        ? bucket
        : normalizedType === "expense" && category_id
        ? getCategoryBucket(category_id)
        : null;

    return {
      id: createId(),
      type: normalizedType,
      amount_cents: amount,
      description: description || "",
      category_id: normalizedType === "expense" ? category_id : null,
      bucket: normalizedType === "expense" ? resolvedBucket : null,
      date_iso,
    };
  }

  function getCategoryBucket(categoryId) {
    const category = state.categories.find((cat) => cat.id === categoryId);
    return category ? category.bucket : null;
  }

  function updateTransaction(id, updates) {
    let target = null;
    state.transactions = state.transactions.map((tx) => {
      if (tx.id !== id) return tx;
      const merged = {
        ...tx,
        ...updates,
      };
      if (merged.type === "expense") {
        merged.bucket = BUCKETS.includes(merged.bucket)
          ? merged.bucket
          : getCategoryBucket(merged.category_id);
      } else {
        merged.bucket = null;
        merged.category_id = null;
      }
      merged.amount_cents = Math.max(
        0,
        Math.trunc(Number(merged.amount_cents) || 0)
      );
      merged.date_iso =
        typeof merged.date_iso === "string"
          ? merged.date_iso
          : new Date().toISOString();
      target = merged;
      return merged;
    });
    state.transactions.sort(compareTransactionsDesc);
    persist();
    notify({ type: "transactions:update", transaction: target });
    return target;
  }

  function deleteTransaction(id) {
    const removed = state.transactions.find((tx) => tx.id === id);
    state.transactions = state.transactions.filter((tx) => tx.id !== id);
    persist();
    notify({ type: "transactions:delete", transaction: removed });
    return removed;
  }

  function addCategory({ name, bucket }) {
    const category = {
      id: createId(),
      name: name.trim() || "Untitled",
      bucket: BUCKETS.includes(bucket) ? bucket : "Necessities",
      archived: false,
    };
    state.categories = [...state.categories, category];
    persist();
    notify({ type: "categories:add", category });
    return category;
  }

  function updateCategory(id, updates) {
    let target = null;
    state.categories = state.categories.map((cat) => {
      if (cat.id !== id) return cat;
      target = {
        ...cat,
        ...updates,
      };
      if (!BUCKETS.includes(target.bucket)) {
        target.bucket = "Necessities";
      }
      return target;
    });
    persist();
    notify({ type: "categories:update", category: target });
    return target;
  }

  function archiveCategory(id, archived = true) {
    return updateCategory(id, { archived: Boolean(archived) });
  }

  function addRecurring({ description, default_amount_cents, category_id }) {
    const template = {
      id: createId(),
      description: description.trim() || "Template",
      default_amount_cents: Math.max(
        0,
        Math.trunc(Number(default_amount_cents) || 0)
      ),
      category_id: category_id || null,
    };
    state.recurring = [...state.recurring, template];
    persist();
    notify({ type: "recurring:add", template });
    return template;
  }

  function updateRecurring(id, updates) {
    let target = null;
    state.recurring = state.recurring.map((template) => {
      if (template.id !== id) return template;
      target = {
        ...template,
        ...updates,
      };
      target.default_amount_cents = Math.max(
        0,
        Math.trunc(Number(target.default_amount_cents) || 0)
      );
      return target;
    });
    persist();
    notify({ type: "recurring:update", template: target });
    return target;
  }

  function deleteRecurring(id) {
    const target = state.recurring.find((template) => template.id === id);
    state.recurring = state.recurring.filter((template) => template.id !== id);
    persist();
    notify({ type: "recurring:delete", template: target });
    return target;
  }

  function saveSettings(updates) {
    state.settings = normalizeSettings({
      ...state.settings,
      ...updates,
    });
    persist();
    notify({ type: "settings:update" });
    return state.settings;
  }

  function reset() {
    const snapshot = StorageService.reset();
    state.settings = normalizeSettings(snapshot.settings);
    state.categories = normalizeCategories(snapshot.categories);
    state.transactions = normalizeTransactions(snapshot.transactions);
    state.recurring = normalizeRecurring(snapshot.recurring);
    notify({ type: "app:reset" });
  }

  function exportData() {
    return {
      schema_version: STORAGE_VERSION,
      settings: state.settings,
      categories: state.categories,
      recurring: state.recurring,
      transactions: state.transactions,
    };
  }

  function importData(payload, { strategy = "replace" } = {}) {
    if (!payload || payload.schema_version !== STORAGE_VERSION) {
      const error = new Error("Unsupported schema version");
      error.code = "SCHEMA_MISMATCH";
      throw error;
    }

    const imported = {
      settings: normalizeSettings(payload.settings),
      categories: normalizeCategories(payload.categories),
      recurring: normalizeRecurring(payload.recurring),
      transactions: normalizeTransactions(payload.transactions),
    };

    if (strategy === "merge") {
      const existingCategoryIds = new Set(state.categories.map((c) => c.id));
      const mergedCategories = [
        ...state.categories,
        ...imported.categories.filter((cat) => !existingCategoryIds.has(cat.id)),
      ];

      const mergedTransactions = dedupeById([
        ...state.transactions,
        ...imported.transactions,
      ]);

      const mergedRecurring = dedupeById([
        ...state.recurring,
        ...imported.recurring,
      ]);

      state.settings = imported.settings;
      state.categories = mergedCategories;
      state.transactions = mergedTransactions.sort(compareTransactionsDesc);
      state.recurring = mergedRecurring;
    } else {
      state.settings = imported.settings;
      state.categories = imported.categories;
      state.transactions = imported.transactions.sort(compareTransactionsDesc);
      state.recurring = imported.recurring;
    }

    persist();
    notify({ type: "data:import", strategy });
  }

  function dedupeById(list) {
    const seen = new Set();
    return list.filter((item) => {
      if (!item || !item.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  function getMonthlyTotals(year, monthIndex) {
    const totals = {
      income_cents: 0,
      expense_cents: 0,
      buckets: {
        Necessities: { spent_cents: 0 },
        Leisure: { spent_cents: 0 },
        Savings: { spent_cents: 0 },
        Uncategorized: { spent_cents: 0 },
      },
    };

    for (const tx of state.transactions) {
      if (!isSameMonth(tx.date_iso, year, monthIndex)) continue;
      if (tx.type === "income") {
        totals.income_cents += tx.amount_cents;
      } else {
        totals.expense_cents += tx.amount_cents;
        const bucketKey = tx.bucket && BUCKETS.includes(tx.bucket)
          ? tx.bucket
          : "Uncategorized";
        totals.buckets[bucketKey].spent_cents += tx.amount_cents;
      }
    }

    totals.buckets.Necessities.budget_cents = Math.round(
      totals.income_cents * (state.settings.rule.necessities / 100)
    );
    totals.buckets.Leisure.budget_cents = Math.round(
      totals.income_cents * (state.settings.rule.leisure / 100)
    );
    totals.buckets.Savings.budget_cents = Math.round(
      totals.income_cents * (state.settings.rule.savings / 100)
    );
    totals.buckets.Uncategorized.budget_cents = 0;

    for (const bucket of Object.values(totals.buckets)) {
      bucket.remaining_cents = bucket.budget_cents
        ? bucket.budget_cents - bucket.spent_cents
        : -bucket.spent_cents;
    }

    return totals;
  }

  function getSpendingByCategory(year, monthIndex) {
    const map = new Map();
    for (const tx of state.transactions) {
      if (tx.type !== "expense") continue;
      if (!isSameMonth(tx.date_iso, year, monthIndex)) continue;
      const id = tx.category_id || "uncategorized";
      if (!map.has(id)) {
        const category =
          state.categories.find((cat) => cat.id === tx.category_id) || null;
        map.set(id, {
          category_id: id,
          name: category ? category.name : "Uncategorized",
          bucket: category ? category.bucket : null,
          spent_cents: 0,
          count: 0,
        });
      }
      const entry = map.get(id);
      entry.spent_cents += tx.amount_cents;
      entry.count += 1;
    }
    return Array.from(map.values()).sort(
      (a, b) => b.spent_cents - a.spent_cents
    );
  }

  function getRecentTransactions(limit = 20, cursor = null) {
    const sorted = [...state.transactions].sort(compareTransactionsDesc);
    let startIndex = 0;
    if (cursor) {
      const [cursorDate, cursorId] = cursor.split("|");
      startIndex = sorted.findIndex(
        (tx) => tx.date_iso === cursorDate && tx.id === cursorId
      );
      if (startIndex !== -1) {
        startIndex += 1;
      } else {
        startIndex = 0;
      }
    }

    const slice = sorted.slice(startIndex, startIndex + limit);
    const last = slice[slice.length - 1];
    const nextCursor = slice.length === limit && last
      ? `${last.date_iso}|${last.id}`
      : null;

    return {
      items: slice,
      nextCursor,
      hasMore: Boolean(nextCursor),
    };
  }

  function getActivityGroups(year, monthIndex, { pageSize = 20, cursor = null } = {}) {
    const { items, nextCursor, hasMore } = getRecentTransactions(
      pageSize,
      cursor
    );
    const grouped = [];
    const dateFormatter = new Intl.DateTimeFormat(state.settings.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    let currentGroup = null;
    for (const tx of items) {
      if (!isSameMonth(tx.date_iso, year, monthIndex)) {
        // For Activity view we still show transactions from adjacent months
        // if paginated, to honour chronological history.
      }
      const dayLabel = dateFormatter.format(new Date(tx.date_iso));
      if (!currentGroup || currentGroup.dateLabel !== dayLabel) {
        currentGroup = {
          dateLabel: dayLabel,
          entries: [],
        };
        grouped.push(currentGroup);
      }
      currentGroup.entries.push(tx);
    }

    return {
      groups: grouped,
      nextCursor,
      hasMore,
    };
  }

  function getCategoryStats(year, monthIndex) {
    const counts = new Map();
    for (const tx of state.transactions) {
      if (tx.type !== "expense") continue;
      if (!isSameMonth(tx.date_iso, year, monthIndex)) continue;
      const id = tx.category_id || "uncategorized";
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return state.categories.map((category) => ({
      ...category,
      currentMonthCount: counts.get(category.id) || 0,
    }));
  }

  return {
    init,
    subscribe,
    getState,
    setMonth,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addCategory,
    updateCategory,
    archiveCategory,
    addRecurring,
    updateRecurring,
    deleteRecurring,
    saveSettings,
    reset,
    exportData,
    importData,
    getMonthlyTotals,
    getSpendingByCategory,
    getRecentTransactions,
    getActivityGroups,
    getCategoryStats,
  };
})();

function createFormatters(settings) {
  try {
    return {
      currency: new Intl.NumberFormat(settings.locale || "en-US", {
        style: "currency",
        currency: settings.currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      month: new Intl.DateTimeFormat(settings.locale || "en-US", {
        year: "numeric",
        month: "long",
      }),
      day: new Intl.DateTimeFormat(settings.locale || "en-US", {
        month: "short",
        day: "numeric",
        weekday: "short",
      }),
      fullDate: new Intl.DateTimeFormat(settings.locale || "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: new Intl.DateTimeFormat(settings.locale || "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  } catch (error) {
    console.warn("Falling back to en-US formatters", error);
    return createFormatters({ currency: "USD", locale: "en-US" });
  }
}

function formatCurrency(cents, formatters) {
  const amount = Number(cents || 0) / 100;
  return formatters.currency.format(amount);
}

function formatSignedCurrency(cents, formatters) {
  const amount = Number(cents || 0);
  const formatted = formatCurrency(Math.abs(amount), formatters);
  return amount < 0 ? `- ${formatted}` : formatted;
}

function parseAmountToCents(inputValue) {
  if (typeof inputValue !== "string") return NaN;
  const sanitized = inputValue.replace(/[^\d.,]/g, "");
  if (!sanitized) return NaN;

  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");
  const separatorIndex = Math.max(lastComma, lastDot);

  if (separatorIndex === -1) {
    const digits = sanitized.replace(/[^\d]/g, "");
    if (!digits) return NaN;
    return Number.parseInt(digits, 10) * 100;
  }

  const integerPart = sanitized.slice(0, separatorIndex).replace(/[^\d]/g, "");
  let fractionalPart = sanitized
    .slice(separatorIndex + 1)
    .replace(/[^\d]/g, "");

  if (!integerPart) return NaN;
  if (fractionalPart.length === 0) {
    fractionalPart = "00";
  } else if (fractionalPart.length === 1) {
    fractionalPart = `${fractionalPart}0`;
  } else {
    fractionalPart = fractionalPart.slice(0, 2);
  }

  const cents =
    Number.parseInt(integerPart, 10) * 100 +
    Number.parseInt(fractionalPart, 10);
  return Number.isFinite(cents) ? cents : NaN;
}

const Toasts = (() => {
  const container = document.getElementById("toastContainer");
  const active = new Set();

  function dismiss(toastEl) {
    if (!toastEl) return;
    toastEl.classList.add("toast--leaving");
    setTimeout(() => {
      toastEl.remove();
      active.delete(toastEl);
    }, 200);
  }

  function show(message, { duration = 4000, actionLabel, onAction } = {}) {
    if (!container) return () => {};
    const toast = document.createElement("div");
    toast.className = "toast";
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    if (actionLabel && typeof onAction === "function") {
      const actionButton = document.createElement("button");
      actionButton.className = "toast__action";
      actionButton.type = "button";
      actionButton.textContent = actionLabel;
      actionButton.addEventListener("click", () => {
        onAction();
        dismiss(toast);
      });
      toast.appendChild(actionButton);
    }

    container.appendChild(toast);
    active.add(toast);

    const timeout = window.setTimeout(() => {
      dismiss(toast);
    }, duration);

    toast.addEventListener("mouseenter", () => window.clearTimeout(timeout));

    return () => dismiss(toast);
  }

  return {
    show,
    dismissAll() {
      active.forEach((toast) => dismiss(toast));
    },
  };
})();

const Dialog = (() => {
  const layer = document.getElementById("dialogLayer");
  let activeCard = null;

  function close() {
    if (!layer) return;
    layer.classList.remove("dialog-layer--visible");
    layer.innerHTML = "";
    document.body.style.overflow = "";
    activeCard = null;
  }

  function open({ title, content, actions = [] }) {
    if (!layer) return null;
    close();
    const card = document.createElement("div");
    card.className = "dialog-card";
    if (title) {
      const heading = document.createElement("h2");
      heading.textContent = title;
      card.appendChild(heading);
    }
    if (content) {
      card.appendChild(content);
    }
    if (actions.length) {
      const actionRow = document.createElement("div");
      actionRow.className = "dialog-card__actions";
      actions.forEach((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.className = action.className || "secondary-button";
        button.addEventListener("click", () => {
          if (typeof action.onClick === "function") {
            action.onClick();
          }
        });
        actionRow.appendChild(button);
      });
      card.appendChild(actionRow);
    }

    layer.appendChild(card);
    layer.classList.add("dialog-layer--visible");
    document.body.style.overflow = "hidden";
    activeCard = card;
    return card;
  }

  if (layer) {
    layer.addEventListener("click", (event) => {
      if (event.target === layer) {
        close();
      }
    });
  }

  return { open, close };
})();

const App = {
  init() {
    this.cacheDom();
    this.bindEvents();
    this.activityCursor = null;
    this.pendingUndo = null;
    this.unsubscribe = Store.subscribe(this.handleStateChange.bind(this));
    Store.init();
    this.state = Store.getState();
    this.formatters = createFormatters(this.state.settings);
    Charts.init();
  },

  handleStateChange(state, detail) {
    this.state = state;
    this.formatters = createFormatters(state.settings);
    this.render(detail);
    if (detail.type === "init" && state.corruption.hasCorruption) {
      console.warn(
        "Storage corruption detected for keys:",
        state.corruption.keys
      );
      Toasts.show(
        "Data issue detected. Reset or import a backup to recover.",
        { duration: 6000 }
      );
    }
  },
};

App.cacheDom = function cacheDom() {
  this.elements = {
    appShell: document.getElementById("app"),
    navButtons: Array.from(document.querySelectorAll(".tab-bar__item")),
    panels: Array.from(document.querySelectorAll(".panel")),
    currentMonthLabel: document.getElementById("currentMonthLabel"),
    prevMonthButton: document.getElementById("prevMonthButton"),
    nextMonthButton: document.getElementById("nextMonthButton"),
    dashboardCards: document.getElementById("dashboardCards"),
    quickLogChips: document.getElementById("quickLogChips"),
    manageRecurringButton: document.getElementById("manageRecurringButton"),
    recentActivityList: document.getElementById("recentActivityList"),
    viewActivityButton: document.getElementById("viewActivityButton"),
    incomeForm: document.getElementById("incomeForm"),
    expenseForm: document.getElementById("expenseForm"),
    expenseCategorySelect: document.getElementById("expenseCategorySelect"),
    addIncomeTab: document.getElementById("addIncomeTab"),
    addExpenseTab: document.getElementById("addExpenseTab"),
    addIncomePanel: document.getElementById("addIncomePanel"),
    addExpensePanel: document.getElementById("addExpensePanel"),
    activityList: document.getElementById("activityList"),
    activityEmptyState: document.getElementById("activityEmptyState"),
    loadMoreActivityButton: document.getElementById("loadMoreActivityButton"),
    categoryList: document.getElementById("categoryList"),
    newCategoryButton: document.getElementById("newCategoryButton"),
    settingsForm: document.getElementById("settingsForm"),
    importButton: document.getElementById("importButton"),
    importFileInput: document.getElementById("importFileInput"),
    resetButton: document.getElementById("resetButton"),
    exportButton: document.getElementById("exportButton"),
    dashboardCharts: document.getElementById("dashboardCharts"),
  };
};

App.bindEvents = function bindEvents() {
  this.elements.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      this.switchPanel(button.dataset.target, button);
    });
  });

  this.elements.prevMonthButton.addEventListener("click", () => {
    this.changeMonth(-1);
  });

  this.elements.nextMonthButton.addEventListener("click", () => {
    this.changeMonth(1);
  });

  if (this.elements.incomeForm) {
    this.elements.incomeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitIncomeForm(new FormData(this.elements.incomeForm));
    });
  }

  if (this.elements.expenseForm) {
    this.elements.expenseForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitExpenseForm(new FormData(this.elements.expenseForm));
    });
  }

  if (this.elements.addIncomeTab && this.elements.addExpenseTab) {
    this.elements.addIncomeTab.addEventListener("click", () =>
      this.toggleAddPanel("income")
    );
    this.elements.addExpenseTab.addEventListener("click", () =>
      this.toggleAddPanel("expense")
    );
  }

  if (this.elements.viewActivityButton) {
    this.elements.viewActivityButton.addEventListener("click", () => {
      this.switchPanel("panel-activity");
    });
  }

  if (this.elements.loadMoreActivityButton) {
    this.elements.loadMoreActivityButton.addEventListener("click", () => {
      this.renderActivity(true);
    });
  }

  if (this.elements.newCategoryButton) {
    this.elements.newCategoryButton.addEventListener("click", () => {
      this.openCategoryDialog();
    });
  }

  if (this.elements.manageRecurringButton) {
    this.elements.manageRecurringButton.addEventListener("click", () => {
      this.openRecurringDialog();
    });
  }

  if (this.elements.settingsForm) {
    this.elements.settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitSettingsForm(new FormData(this.elements.settingsForm));
    });
  }

  if (this.elements.importButton && this.elements.importFileInput) {
    this.elements.importButton.addEventListener("click", () => {
      this.elements.importFileInput.click();
    });
    this.elements.importFileInput.addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) {
        this.handleImportFile(file);
      }
      event.target.value = "";
    });
  }

  if (this.elements.resetButton) {
    this.elements.resetButton.addEventListener("click", () => {
      this.confirmReset();
    });
  }

  if (this.elements.exportButton) {
    this.elements.exportButton.addEventListener("click", () => {
      this.exportData();
    });
  }
};

App.render = function render(detail) {
  this.renderMonth();
  this.renderDashboard();
  this.renderRecentActivity();
  this.renderCategoryPicker();
  this.renderQuickLog();
  this.renderActivity(detail && detail.type === "activity:append");
  this.renderCategories();
  this.renderSettingsForm();
};

App.switchPanel = function switchPanel(targetId, button) {
  this.elements.panels.forEach((panel) => {
    panel.classList.toggle("panel--active", panel.id === targetId);
  });
  this.elements.navButtons.forEach((navButton) => {
    const active = navButton === button || navButton.dataset.target === targetId;
    navButton.classList.toggle("tab-bar__item--active", active);
    navButton.setAttribute("aria-selected", active ? "true" : "false");
  });
  this.feedback();
};

App.changeMonth = function changeMonth(delta) {
  const { year, month } = this.state.month;
  const nextDate = new Date(year, month + delta, 1);
  Store.setMonth(nextDate.getFullYear(), nextDate.getMonth());
  this.activityCursor = null;
};

App.renderMonth = function renderMonth() {
  const { year, month } = this.state.month;
  const date = new Date(year, month, 1);
  this.elements.currentMonthLabel.textContent = this.formatters.month.format(
    date
  );
};

App.renderDashboard = function renderDashboard() {
  const totals = Store.getMonthlyTotals(
    this.state.month.year,
    this.state.month.month
  );
  const categorySpend = Store.getSpendingByCategory(
    this.state.month.year,
    this.state.month.month
  );

  const cards = [];
  cards.push(this.buildSummaryCard("Total income", totals.income_cents));
  cards.push(
    this.buildSummaryCard("Total spending", totals.expense_cents, {
      negative: true,
    })
  );

  Object.entries(totals.buckets).forEach(([bucket, data]) => {
    cards.push(this.buildBucketCard(bucket, data));
  });

  this.elements.dashboardCards.replaceChildren(...cards);
  Charts.updateDashboard({
    totals,
    categories: categorySpend,
    settings: this.state.settings,
    month: this.state.month,
  });
};

App.buildSummaryCard = function buildSummaryCard(label, cents, options = {}) {
  const { negative = false } = options;
  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = label;

  const value = document.createElement("div");
  value.className = "card__value";
  value.textContent = formatCurrency(cents, this.formatters);
  if (negative) {
    value.classList.add("card__value--negative");
  }

  card.append(title, value);
  return card;
};

App.buildBucketCard = function buildBucketCard(bucket, data) {
  const card = document.createElement("article");
  card.className = `card card--bucket card--bucket-${bucket.toLowerCase()}`;

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = bucket;

  const budgetValue = document.createElement("div");
  budgetValue.className = "card__value";
  budgetValue.textContent = formatCurrency(data.budget_cents, this.formatters);

  const meta = document.createElement("div");
  meta.className = "card__meta";
  meta.innerHTML = `
    <span>Spent: ${formatCurrency(
      data.spent_cents,
      this.formatters
    )}</span>
    <span>Remaining: ${formatSignedCurrency(
      data.remaining_cents,
      this.formatters
    )}</span>
  `;

  card.append(title, budgetValue, meta);
  return card;
};

App.renderRecentActivity = function renderRecentActivity() {
  const { items } = Store.getRecentTransactions(5);
  if (!items.length) {
    this.elements.recentActivityList.innerHTML =
      `<li class="empty-state">No recent activity.</li>`;
    return;
  }
  const nodes = items.map((tx) => this.buildActivityItem(tx, { compact: true }));
  this.elements.recentActivityList.replaceChildren(...nodes);
};

App.renderActivity = function renderActivity(append = false) {
  const result = Store.getActivityGroups(
    this.state.month.year,
    this.state.month.month,
    {
      pageSize: 20,
      cursor: append ? this.activityCursor : null,
    }
  );

  if (!append) {
    this.elements.activityList.innerHTML = "";
  }

  if (!append && result.groups.length === 0) {
    this.elements.activityEmptyState.hidden = false;
    this.elements.activityList.appendChild(this.elements.activityEmptyState);
    this.elements.loadMoreActivityButton.hidden = true;
    this.activityCursor = null;
    return;
  }

  if (!append) {
    this.elements.activityEmptyState.hidden = true;
  }

  result.groups.forEach((group) => {
    const groupEl = document.createElement("li");
    groupEl.className = "activity-day-group";

    const dateLabel = document.createElement("div");
    dateLabel.className = "activity-day-group__date";
    dateLabel.textContent = group.dateLabel;
    groupEl.appendChild(dateLabel);

    group.entries.forEach((tx) => {
      groupEl.appendChild(this.buildActivityItem(tx));
    });

    this.elements.activityList.appendChild(groupEl);
  });

  this.activityCursor = result.nextCursor;
  this.elements.loadMoreActivityButton.hidden = !result.hasMore;
};

App.buildActivityItem = function buildActivityItem(transaction, options = {}) {
  const { compact = false } = options;
  const item = document.createElement("article");
  item.className = "activity-list__item";
  item.dataset.id = transaction.id;

  const header = document.createElement("div");
  header.className = "activity-list__header";

  const title = document.createElement("span");
  title.textContent =
    transaction.description ||
    (transaction.type === "income" ? "Income" : "Expense");

  const amount = document.createElement("strong");
  amount.textContent =
    (transaction.type === "income" ? "" : "-") +
    formatCurrency(transaction.amount_cents, this.formatters);

  header.append(title, amount);
  item.appendChild(header);

  const meta = document.createElement("p");
  meta.className = "activity-list__description";
  const category =
    this.state.categories.find((cat) => cat.id === transaction.category_id) ||
    null;
  const timeLabel = this.formatters.time.format(new Date(transaction.date_iso));
  meta.textContent =
    transaction.type === "income"
      ? `Received • ${timeLabel}`
      : `${category ? category.name : "Uncategorized"} • ${
          transaction.bucket || "No bucket"
        } • ${timeLabel}`;
  item.appendChild(meta);

  if (!compact) {
    const controls = document.createElement("div");
    controls.className = "activity-list__controls";

    const editButton = document.createElement("button");
    editButton.className = "secondary-button";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () =>
      this.openTransactionDialog(transaction)
    );

    const deleteButton = document.createElement("button");
    deleteButton.className = "destructive-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () =>
      this.deleteTransaction(transaction)
    );

    controls.append(editButton, deleteButton);
    item.appendChild(controls);
  }

  return item;
};

App.renderCategoryPicker = function renderCategoryPicker() {
  if (!this.elements.expenseCategorySelect) return;
  const select = this.elements.expenseCategorySelect;
  select.innerHTML = "";
  const uncategorizedOption = document.createElement("option");
  uncategorizedOption.value = "";
  uncategorizedOption.textContent = "Uncategorized";
  select.appendChild(uncategorizedOption);
  this.state.categories
    .filter((category) => !category.archived)
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.name} (${category.bucket})`;
      select.appendChild(option);
    });
};

App.renderQuickLog = function renderQuickLog() {
  const container = this.elements.quickLogChips;
  container.innerHTML = "";
  if (!this.state.recurring.length) {
    container.innerHTML =
      `<p class="quick-log__empty">Create templates to quick-log frequent expenses.</p>`;
    return;
  }

  this.state.recurring.forEach((template) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = `${template.description} • ${formatCurrency(
      template.default_amount_cents,
      this.formatters
    )}`;
    chip.addEventListener("click", () => this.applyTemplate(template));
    let longPressTimer = null;
    const openCustom = () => {
      this.openTemplateQuickLogDialog(template);
    };
    chip.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      longPressTimer = window.setTimeout(() => {
        openCustom();
      }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
      chip.addEventListener(type, () => {
        if (longPressTimer) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
    });
    chip.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openCustom();
    });
    container.appendChild(chip);
  });
};

App.renderCategories = function renderCategories() {
  const list = this.elements.categoryList;
  list.innerHTML = "";
  const stats = Store.getCategoryStats(
    this.state.month.year,
    this.state.month.month
  );
  if (!stats.length) {
    list.innerHTML = `<li class="empty-state">No categories yet.</li>`;
    return;
  }

  stats.forEach((category) => {
    const item = document.createElement("li");
    item.className = "category-item";
    item.dataset.id = category.id;

    const info = document.createElement("div");
    info.className = "category-item__info";
    const name = document.createElement("strong");
    name.textContent = category.name;
    const meta = document.createElement("span");
    meta.className = "category-item__meta";
    meta.textContent = `${category.bucket} • ${
      category.currentMonthCount
    } expenses this month`;
    info.append(name, meta);

    const controls = document.createElement("div");
    controls.className = "category-item__controls";

    const editButton = document.createElement("button");
    editButton.className = "secondary-button";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () =>
      this.openCategoryDialog(category)
    );

    const archiveButton = document.createElement("button");
    archiveButton.className = category.archived
      ? "primary-button primary-button--small"
      : "secondary-button";
    archiveButton.type = "button";
    archiveButton.textContent = category.archived ? "Unarchive" : "Archive";
    archiveButton.addEventListener("click", () =>
      Store.archiveCategory(category.id, !category.archived)
    );

    controls.append(editButton, archiveButton);
    item.append(info, controls);
    list.appendChild(item);
  });
};

App.renderSettingsForm = function renderSettingsForm() {
  if (!this.elements.settingsForm) return;
  const form = this.elements.settingsForm;
  form.currency.value = this.state.settings.currency;
  form.locale.value = this.state.settings.locale;
  form.firstDayOfWeek.value = String(this.state.settings.firstDayOfWeek);
  form["rule-necessities"].value = this.state.settings.rule.necessities;
  form["rule-leisure"].value = this.state.settings.rule.leisure;
  form["rule-savings"].value = this.state.settings.rule.savings;
  form.showAdvancedCharts.checked = Boolean(
    this.state.settings.showAdvancedCharts
  );
  form.hapticFeedback.checked = Boolean(
    this.state.settings.hapticFeedback
  );
};

App.submitIncomeForm = function submitIncomeForm(formData) {
  const amountValue = formData.get("amount");
  const amountCents = parseAmountToCents(amountValue);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    Toasts.show("Enter an amount greater than zero.");
    return;
  }
  const description = (formData.get("description") || "").trim();
  Store.addTransaction({
    type: "income",
    amount_cents: amountCents,
    description,
  });
  this.elements.incomeForm.reset();
  Toasts.show("Income saved.");
  this.feedback();
};

App.submitExpenseForm = function submitExpenseForm(formData) {
  const amountValue = formData.get("amount");
  const amountCents = parseAmountToCents(amountValue);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    Toasts.show("Enter an amount greater than zero.");
    return;
  }
  const categoryId = formData.get("category") || null;
  const description = (formData.get("description") || "").trim();
  Store.addTransaction({
    type: "expense",
    amount_cents: amountCents,
    description,
    category_id: categoryId,
  });
  this.elements.expenseForm.reset();
  Toasts.show("Expense saved.");
  this.feedback();
};

App.toggleAddPanel = function toggleAddPanel(mode) {
  const showIncome = mode === "income";
  this.elements.addIncomePanel.hidden = !showIncome;
  this.elements.addIncomePanel.classList.toggle("add-panel--hidden", !showIncome);
  this.elements.addExpensePanel.hidden = showIncome;
  this.elements.addExpensePanel.classList.toggle("add-panel--hidden", showIncome);
  this.elements.addIncomeTab.classList.toggle(
    "segmented-control__item--active",
    showIncome
  );
  this.elements.addExpenseTab.classList.toggle(
    "segmented-control__item--active",
    !showIncome
  );
};

App.submitSettingsForm = function submitSettingsForm(formData) {
  const necessities = Number(formData.get("rule-necessities"));
  const leisure = Number(formData.get("rule-leisure"));
  const savings = Number(formData.get("rule-savings"));
  const total = necessities + leisure + savings;
  if (total !== 100) {
    Toasts.show("50/30/20 rule must total 100%.");
    return;
  }
  Store.saveSettings({
    currency: (formData.get("currency") || "USD").trim().toUpperCase(),
    locale: (formData.get("locale") || "en-US").trim(),
    firstDayOfWeek: Number(formData.get("firstDayOfWeek")) || 1,
    showAdvancedCharts: Boolean(formData.get("showAdvancedCharts")),
    hapticFeedback: Boolean(formData.get("hapticFeedback")),
    rule: {
      necessities,
      leisure,
      savings,
    },
  });
  Toasts.show("Settings updated.");
};

App.openCategoryDialog = function openCategoryDialog(category = null) {
  const form = document.createElement("form");
  form.className = "form-card";
  form.innerHTML = `
    <label class="input-field">
      <span>Name</span>
      <input type="text" name="name" required value="${category ? category.name : ""}" />
    </label>
    <label class="input-field">
      <span>Bucket</span>
      <select name="bucket" required>
        ${BUCKETS.map((bucket) => `<option value="${bucket}" ${
          category && category.bucket === bucket ? "selected" : ""
        }>${bucket}</option>`).join("")}
      </select>
    </label>
    <button type="submit" class="primary-button">${
      category ? "Save changes" : "Create category"
    }</button>
  `;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = form.name.value.trim();
    if (!name) {
      Toasts.show("Category name is required.");
      return;
    }
    const bucket = form.bucket.value;
    if (category) {
      Store.updateCategory(category.id, { name, bucket });
      Toasts.show("Category updated.");
    } else {
      Store.addCategory({ name, bucket });
      Toasts.show("Category created.");
    }
    Dialog.close();
  });

  Dialog.open({
    title: category ? "Edit category" : "New category",
    content: form,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
    ],
  });
};

App.openTransactionDialog = function openTransactionDialog(transaction) {
  const form = document.createElement("form");
  form.className = "form-card";
  const isIncome = transaction.type === "income";
  form.innerHTML = `
    <label class="input-field">
      <span>Amount</span>
      <input type="text" name="amount" inputmode="decimal" required value="${
        (transaction.amount_cents / 100).toFixed(2)
      }" />
    </label>
    <label class="input-field">
      <span>Description</span>
      <input type="text" name="description" value="${
        transaction.description || ""
      }" />
    </label>
    ${
      isIncome
        ? ""
        : `<label class="input-field">
            <span>Category</span>
            <select name="category">
              <option value="">Uncategorized</option>
              ${this.state.categories
                .filter((cat) => !cat.archived)
                .map(
                  (cat) => `<option value="${cat.id}" ${
                    transaction.category_id === cat.id ? "selected" : ""
                  }>${cat.name}</option>`
                )
                .join("")}
            </select>
          </label>`
    }
    <button type="submit" class="primary-button">Save changes</button>
  `;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const amountCents = parseAmountToCents(form.amount.value);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      Toasts.show("Amount must be greater than zero.");
      return;
    }
    const updates = {
      amount_cents: amountCents,
      description: form.description.value.trim(),
    };
    if (!isIncome) {
      updates.category_id = form.category.value || null;
    }
    Store.updateTransaction(transaction.id, updates);
    Toasts.show("Transaction updated.");
    Dialog.close();
  });

  Dialog.open({
    title: "Edit transaction",
    content: form,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
    ],
  });
};

App.deleteTransaction = function deleteTransaction(transaction) {
  const removed = Store.deleteTransaction(transaction.id);
  if (!removed) return;
  if (this.pendingUndo) {
    this.pendingUndo.cancel();
  }
  const undo = () => {
    Store.addTransaction({ ...removed });
  };
  const dismiss = Toasts.show("Transaction deleted.", {
    actionLabel: "Undo",
    onAction: () => {
      undo();
      this.pendingUndo = null;
    },
    duration: 5000,
  });
  this.pendingUndo = {
    cancel: () => {
      dismiss();
      this.pendingUndo = null;
    },
  };
};

App.applyTemplate = function applyTemplate(template) {
  if (!template.default_amount_cents) {
    Toasts.show("Template amount missing. Edit the template first.");
    return;
  }
  Store.addTransaction({
    type: "expense",
    amount_cents: template.default_amount_cents,
    description: template.description,
    category_id: template.category_id,
  });
  Toasts.show("Quick logged.");
};

App.openRecurringDialog = function openRecurringDialog() {
  const container = document.createElement("div");
  container.className = "recurring-list";

  const list = document.createElement("div");
  list.className = "recurring-list__items";

  if (!this.state.recurring.length) {
    list.innerHTML =
      `<p class="empty-state">No templates yet. Add one below.</p>`;
  } else {
    this.state.recurring.forEach((template) => {
      const row = document.createElement("div");
      row.className = "recurring-item";

      const label = document.createElement("div");
      label.className = "recurring-item__label";
      const category =
        this.state.categories.find((cat) => cat.id === template.category_id) ||
        null;
      label.innerHTML = `
        <strong>${template.description}</strong>
        <span>${formatCurrency(
          template.default_amount_cents,
          this.formatters
        )} • ${category ? category.name : "Uncategorized"}</span>
      `;

      const actions = document.createElement("div");
      actions.className = "recurring-item__actions";

      const editButton = document.createElement("button");
      editButton.className = "secondary-button";
      editButton.type = "button";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () =>
        this.openTemplateForm(template)
      );

      const deleteButton = document.createElement("button");
      deleteButton.className = "destructive-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Remove";
      deleteButton.addEventListener("click", () => {
        Store.deleteRecurring(template.id);
      });

      actions.append(editButton, deleteButton);
      row.append(label, actions);
      list.appendChild(row);
    });
  }

  const addButton = document.createElement("button");
  addButton.className = "primary-button";
  addButton.type = "button";
  addButton.textContent = "Add template";
  addButton.addEventListener("click", () => this.openTemplateForm());

  container.append(list, addButton);

  Dialog.open({
    title: "Recurring templates",
    content: container,
    actions: [
      {
        label: "Close",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
    ],
  });
};

App.openTemplateForm = function openTemplateForm(template = null) {
  const form = document.createElement("form");
  form.className = "form-card";
  form.innerHTML = `
    <label class="input-field">
      <span>Description</span>
      <input type="text" name="description" required value="${
        template ? template.description : ""
      }" />
    </label>
    <label class="input-field">
      <span>Default amount</span>
      <input type="text" name="amount" inputmode="decimal" value="${
        template ? (template.default_amount_cents / 100).toFixed(2) : ""
      }" />
    </label>
    <label class="input-field">
      <span>Category</span>
      <select name="category">
        <option value="">Uncategorized</option>
        ${this.state.categories
          .filter((cat) => !cat.archived)
          .map(
            (cat) =>
              `<option value="${cat.id}" ${
                template && template.category_id === cat.id ? "selected" : ""
              }>${cat.name}</option>`
          )
          .join("")}
      </select>
    </label>
    <button type="submit" class="primary-button">${
      template ? "Save template" : "Create template"
    }</button>
  `;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const description = form.description.value.trim();
    if (!description) {
      Toasts.show("Description required.");
      return;
    }
    const amountValue = form.amount.value.trim();
    const amountCents = amountValue ? parseAmountToCents(amountValue) : 0;
    const payload = {
      description,
      default_amount_cents: Number.isFinite(amountCents) ? amountCents : 0,
      category_id: form.category.value || null,
    };
    if (template) {
      Store.updateRecurring(template.id, payload);
      Toasts.show("Template updated.");
    } else {
      Store.addRecurring(payload);
      Toasts.show("Template created.");
    }
    Dialog.close();
    this.openRecurringDialog();
  });

  Dialog.open({
    title: template ? "Edit template" : "New template",
    content: form,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => {
          Dialog.close();
          this.openRecurringDialog();
        },
      },
    ],
  });
};

App.openTemplateQuickLogDialog = function openTemplateQuickLogDialog(template) {
  const form = document.createElement("form");
  form.className = "form-card";
  form.innerHTML = `
    <p>Log ${template.description} with a custom amount.</p>
    <label class="input-field">
      <span>Amount</span>
      <input type="text" name="amount" inputmode="decimal" required value="${
        template.default_amount_cents
          ? (template.default_amount_cents / 100).toFixed(2)
          : ""
      }" />
    </label>
    <button type="submit" class="primary-button">Log expense</button>
  `;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const amountCents = parseAmountToCents(form.amount.value);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      Toasts.show("Amount must be greater than zero.");
      return;
    }
    Store.addTransaction({
      type: "expense",
      amount_cents: amountCents,
      description: template.description,
      category_id: template.category_id,
    });
    Toasts.show("Expense logged.");
    Dialog.close();
  });

  Dialog.open({
    title: "Quick log amount",
    content: form,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
    ],
  });
};

App.handleImportFile = function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      this.promptImportStrategy(payload);
    } catch (error) {
      Toasts.show("Import failed: invalid JSON.");
    }
  };
  reader.readAsText(file);
};

App.promptImportStrategy = function promptImportStrategy(payload) {
  const content = document.createElement("div");
  content.innerHTML = `
    <p>How would you like to import data?</p>
    <button type="button" class="primary-button" data-strategy="replace">Replace existing data</button>
    <button type="button" class="secondary-button" data-strategy="merge">Merge with existing data</button>
  `;

  content.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const strategy = button.dataset.strategy;
      try {
        Store.importData(payload, { strategy });
        Toasts.show("Import successful.");
        Dialog.close();
      } catch (error) {
        Toasts.show(
          error.code === "SCHEMA_MISMATCH"
            ? "Import failed: incompatible schema."
            : "Import failed."
        );
        Dialog.close();
      }
    });
  });

  Dialog.open({
    title: "Import data",
    content,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
    ],
  });
};

App.exportData = function exportData() {
  try {
    const data = Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().split("T")[0];
    link.download = `budgetwise-export-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    Toasts.show("Export ready.");
  } catch (error) {
    Toasts.show("Export failed.");
  }
};

App.confirmReset = function confirmReset() {
  const content = document.createElement("p");
  content.textContent =
    "This clears all BudgetWise data from this device. You can import a backup afterward.";
  Dialog.open({
    title: "Reset app?",
    content,
    actions: [
      {
        label: "Cancel",
        className: "secondary-button",
        onClick: () => Dialog.close(),
      },
      {
        label: "Reset",
        className: "destructive-button",
        onClick: () => {
          Store.reset();
          Dialog.close();
          Toasts.show("App reset.");
        },
      },
    ],
  });
};

App.feedback = function feedback() {
  if (!this.state.settings.hapticFeedback) return;
  this.elements.appShell.classList.add("app-shell--feedback");
  window.setTimeout(() => {
    this.elements.appShell.classList.remove("app-shell--feedback");
  }, 120);
};

window.addEventListener("DOMContentLoaded", () => {
  App.init();
});
