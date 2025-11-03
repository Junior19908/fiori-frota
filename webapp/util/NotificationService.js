sap.ui.define([
  "sap/base/Log",
  "sap/ui/core/EventBus",
  "sap/ui/core/Core",
  "sap/ui/core/Component",
  "sap/ui/model/json/JSONModel",
  "sap/ui/thirdparty/jquery"
], function (Log, EventBus, Core, Component, JSONModel, jQuery) {
  "use strict";

  const STORAGE_KEY = "com.skysinc.frota.notifications";
  const DEFAULT_SOURCE = "com/skysinc/frota/frota/model/localdata/notifications.json";
  const RELATIVE_FORMAT = typeof Intl !== "undefined" && Intl.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })
    : null;

  let _component = null;
  let _view = null;
  let _model = null;
  let _interval = 60000;
  let _timer = null;
  let _fetchPromise = null;
  let _lastFetchTime = 0;
  let _eventBus = EventBus ? EventBus.getInstance() : Core.getEventBus();
  let _readCache = new Set();
  let _dataUrl = null;

  function debounce(fn, delay) {
    let handle;
    return function () {
      const ctx = this;
      const args = arguments;
      clearTimeout(handle);
      handle = setTimeout(function () {
        fn.apply(ctx, args);
      }, delay);
    };
  }

  const NotificationService = {};

  function _loadReadCache() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.readIds)) {
        _readCache = new Set(parsed.readIds);
      }
    } catch (err) {
      Log.warning("[NotificationService] Unable to load read cache", err);
    }
  }

  function _persistReadCache() {
    try {
      const payload = JSON.stringify({
        readIds: Array.from(_readCache)
      });
      window.localStorage.setItem(STORAGE_KEY, payload);
    } catch (err) {
      Log.warning("[NotificationService] Unable to persist read cache", err);
    }
  }

  function _resolveDataUrl(options) {
    if (options && options.dataUrl) {
      return options.dataUrl;
    }
    try {
      if (_component && _component.getManifestEntry) {
        const dataSources = _component.getManifestEntry("sap.app").dataSources;
        if (dataSources && dataSources.notifications && dataSources.notifications.uri) {
          const uri = dataSources.notifications.uri;
          if (/^https?:\/\//i.test(uri)) {
            return uri;
          }
          return sap.ui.require.toUrl(uri);
        }
      }
    } catch (err) {
      Log.debug("[NotificationService] Using default data source", err);
    }
    return sap.ui.require.toUrl(DEFAULT_SOURCE);
  }

  function _formatRelative(date) {
    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }
    if (!RELATIVE_FORMAT) {
      return date.toLocaleString("pt-BR");
    }
    const diff = date.getTime() - Date.now();
    const diffMinutes = Math.round(diff / 60000);
    if (Math.abs(diffMinutes) < 60) {
      return RELATIVE_FORMAT.format(diffMinutes, "minute");
    }
    const diffHours = Math.round(diff / 3600000);
    if (Math.abs(diffHours) < 24) {
      return RELATIVE_FORMAT.format(diffHours, "hour");
    }
    const diffDays = Math.round(diff / 86400000);
    return RELATIVE_FORMAT.format(diffDays, "day");
  }

  function _scheduleNextPoll() {
    if (_interval <= 0) {
      return;
    }
    clearTimeout(_timer);
    _timer = setTimeout(function () {
      NotificationService.fetch(true);
    }, _interval);
  }

  function _applyItems(items) {
    if (!_model) {
      return;
    }
    const list = items.map(function (item) {
      const createdAt = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt || Date.now());
      return Object.assign({}, item, {
        createdAt: createdAt.toISOString(),
        relativeTime: _formatRelative(createdAt),
        read: Boolean(item.read || _readCache.has(item.id))
      });
    });
    const unread = list.filter(function (item) { return !item.read; }).length;
    _model.setProperty("/items", list);
    _model.setProperty("/unread", unread);
    _model.setProperty("/lastFetch", new Date().toISOString());
    _eventBus.publish("notifications", "updated", { items: list, unread: unread });
  }

  function _loadNotifications() {
    return new Promise(function (resolve, reject) {
      const url = _dataUrl || _resolveDataUrl();
      jQuery.ajax({
        url: url,
        dataType: "json",
        cache: false,
        success: function (data) {
          resolve(Array.isArray(data) ? data : (data && data.results) || []);
        },
        error: function (err) {
          Log.error("[NotificationService] Failed to load notifications", err);
          reject(err);
        }
      });
    });
  }

  function _normaliseNotification(raw, index) {
    const createdAt = raw.createdAt ? new Date(raw.createdAt) : new Date();
    const id = raw.id || ("notif-" + index);
    const severity = raw.severity || "Information";
    const priority = raw.priority || (severity === "Error" ? "High" : (severity === "Warning" ? "Medium" : (severity === "Success" ? "Low" : "Low")));
    return {
      id: id,
      title: raw.title || "",
      body: raw.body || raw.description || "",
      severity: severity,
      priority: priority,
      icon: raw.icon || "sap-icon://bell",
      createdAt: createdAt,
      read: Boolean(raw.read),
      actionRoute: raw.actionRoute || raw.route || "",
      actionParams: raw.actionParams || raw.parameters || {}
    };
  }

  function _fetchNow() {
    if (_fetchPromise) {
      return _fetchPromise;
    }
    _fetchPromise = _loadNotifications().then(function (rawItems) {
      const items = rawItems.map(_normaliseNotification);
      items.forEach(function (item) {
        if (_readCache.has(item.id)) {
          item.read = true;
        }
      });
      _applyItems(items);
      _lastFetchTime = Date.now();
      return items;
    }).catch(function (err) {
      Log.error("[NotificationService] Fetch failed", err);
      return [];
    }).finally(function () {
      _fetchPromise = null;
      _scheduleNextPoll();
    });
    return _fetchPromise;
  }

  NotificationService.init = function (options) {
    options = options || {};
    _view = options.view || null;
    _component = options.component || (_view && Component.getOwnerComponentFor && Component.getOwnerComponentFor(_view)) || null;
    _interval = Math.max(15000, Number(options.intervalMs) || 60000);
    _dataUrl = options.dataUrl ? options.dataUrl : _resolveDataUrl(options);

    _loadReadCache();

    _model = options.model || new JSONModel({
      items: [],
      unread: 0,
      isOpen: false,
      lastFetch: null
    });
    _model.setSizeLimit(500);

    if (_view && typeof _view.setModel === "function") {
      _view.setModel(_model, "notifModel");
    } else if (_component && typeof _component.setModel === "function") {
      _component.setModel(_model, "notifModel");
    } else {
      Core.setModel(_model, "notifModel");
    }

    _scheduleNextPoll();
    return NotificationService.fetch(true);
  };

  NotificationService.fetch = function (force) {
    clearTimeout(_timer);
    if (force || (Date.now() - _lastFetchTime) > 500) {
      return _fetchNow();
    }
    return new Promise(function (resolve) {
      debounce(function () {
        _fetchNow().then(resolve);
      }, 300)();
    });
  };

  NotificationService.getModel = function () {
    return _model;
  };

  NotificationService.markAsRead = function (id) {
    if (!_model) {
      return;
    }
    const items = (_model.getProperty("/items") || []).map(function (item) {
      if (item.id === id) {
        item.read = true;
        _readCache.add(id);
      }
      return item;
    });
    _persistReadCache();
    _applyItems(items);
    _eventBus.publish("notifications", "read", { id: id });
  };

  NotificationService.markAll = function () {
    if (!_model) {
      return;
    }
    const items = (_model.getProperty("/items") || []).map(function (item) {
      _readCache.add(item.id);
      return Object.assign({}, item, { read: true });
    });
    _persistReadCache();
    _applyItems(items);
    _eventBus.publish("notifications", "read", { id: null });
  };

  NotificationService.clearAll = function () {
    if (!_model) {
      return;
    }
    _model.setProperty("/items", []);
    _model.setProperty("/unread", 0);
    _eventBus.publish("notifications", "cleared", {});
  };

  NotificationService.getUnreadCount = function () {
    return _model ? Number(_model.getProperty("/unread") || 0) : 0;
  };

  NotificationService.toggleOpen = function (isOpen) {
    if (!_model) {
      return;
    }
    _model.setProperty("/isOpen", Boolean(isOpen));
  };

  return NotificationService;
});
