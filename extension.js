import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import * as StatusNotifierWatcher from './statusNotifierWatcher.js';
import * as Interfaces from './interfaces.js';
import * as TrayIconsManager from './trayIconsManager.js';
import * as Util from './util.js';
import { SettingsManager } from './settingsManager.js';
import * as IndicatorStatusIcon from './indicatorStatusIcon.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'; // For PopupAnimation

const TRAY_ICON_SIZE = 20;
const PADDING = 6;
const ICON_SPACING = 2;

// For compatibility with newer GNOME Shell versions
export default class CollapsibleAppTrayExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    Util.Logger.init(this);
    Interfaces.initialize(this);

    this._isEnabled = false;
    this._trayButton = null;
    this._appSystem = Shell.AppSystem.get_default();
    this._backgroundApps = new Map();
    this._trayIcons = new Map();
    this._statusNotifierWatcher = null;
    this._watchDog = new Util.NameWatcher(StatusNotifierWatcher.WATCHER_BUS_NAME);
    this._trayManagerInstance = null;
    this._settings = null;
  }

  enable() {
    this._isEnabled = true;
    Util.Logger.debug('Enabling extension');

    // Initialize settings
    this._settings = this.getSettings();
    SettingsManager.initialize(this);

    IndicatorStatusIcon.setCustomIconHandler((icon) => {
      Util.Logger.debug(`Custom handler caught icon: ${icon.uniqueId}`);
      this._addTrayIcon(icon);
    });

    this._createTrayButton();
    this._trayManagerInstance = TrayIconsManager.TrayIconsManager.initialize();
    this._setupAppTracking();
    this._maybeEnableAfterNameAvailable();
    this._populateTrayIcons();
    Util.Logger.debug('Extension enabled');
  }

  disable() {
    this._isEnabled = false;
    Util.Logger.debug('Disabling extension');

    // Disconnect the arrow direction signal handler
    if (this._arrowDirectionChangedId && this._settings) {
      this._settings.disconnect(this._arrowDirectionChangedId);
      this._arrowDirectionChangedId = null;
    }

    if (this._trayButton) {
      this._trayButton.destroy();
      this._trayButton = null;
    }

    IndicatorStatusIcon.setCustomIconHandler(null);
    TrayIconsManager.TrayIconsManager.destroy();

    if (this._statusNotifierWatcher) {
      this._statusNotifierWatcher.destroy();
      this._statusNotifierWatcher = null;
    }

    this._cleanupAppTracking();
    SettingsManager.destroy();
    this._trayManagerInstance = null;
    this._settings = null;
    Util.Logger.debug('Extension disabled');
  }

  _createTrayButton() {
    this._trayButton = new PanelMenu.Button(0.0, 'CollapsibleAppTray', false);
    Util.Logger.debug('Creating tray button');

    // Get the arrow direction from settings
    const arrowDirection = this._settings.get_string('arrow-direction') || 'down';
    
    // Map direction to icon name
    const directionToIcon = {
      'down': 'pan-down-symbolic',
      'up': 'pan-up-symbolic',
      'left': 'pan-start-symbolic',
      'right': 'pan-end-symbolic'
    };
    
    const iconName = directionToIcon[arrowDirection] || 'pan-down-symbolic';
    
    const icon = new St.Icon({
      icon_name: iconName,
      style_class: 'system-status-icon',
      icon_size: TRAY_ICON_SIZE,
    });

    if (this._trayButton.actor) {
      this._trayButton.actor.add_child(icon);
    } else {
      this._trayButton.add_child(icon);
    }

    // Connect to settings change to update the icon when the setting changes
    this._arrowDirectionChangedId = this._settings.connect('changed::arrow-direction', () => {
      const newDirection = this._settings.get_string('arrow-direction') || 'down';
      const newIconName = directionToIcon[newDirection] || 'pan-down-symbolic';
      icon.icon_name = newIconName;
      Util.Logger.debug(`Arrow direction changed to: ${newDirection}`);
    });

    this._traySection = new PopupMenu.PopupMenuSection();
    this._trayBox = new St.BoxLayout({
      style: `padding: ${PADDING}px; spacing: ${ICON_SPACING}px;`,
    });
    const trayItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    trayItem.add_child(this._trayBox);
    this._traySection.addMenuItem(trayItem);

    this._trayButton.menu.addMenuItem(this._traySection);
    // Prevent automatic closure on selection.
    this._trayButton.menu.closeOnSelect = false;
    // Introduce an internal flag and override close() and hide()
    this._trayButton.menu._submenuOpen = false;
    let origClose = this._trayButton.menu.close.bind(this._trayButton.menu);
    this._trayButton.menu.close = () => {
      if (!this._trayButton.menu._submenuOpen) {
        origClose();
      } else {
        Util.Logger.debug("Parent menu close suppressed because submenu is open");
      }
    };
    let origHide = this._trayButton.menu.actor.hide.bind(this._trayButton.menu.actor);
    this._trayButton.menu.actor.hide = () => {
      if (!this._trayButton.menu._submenuOpen) {
        origHide();
      } else {
        Util.Logger.debug("Parent menu hide suppressed because submenu is open");
      }
    };

    Util.Logger.debug(
      `Tray menu created, initial children: ${this._trayBox.get_children().length}`
    );

    Main.panel.addToStatusArea('collapsible-app-tray', this._trayButton);
  }

  _setupAppTracking() {
    if (!this._appSystem) {
      Util.Logger.error('AppSystem is not available');
      return;
    }

    this._appRunningHandler = this._appSystem.connect('app-state-changed', (appSystem, app) =>
      this._onAppStateChanged(app)
    );
    Util.Logger.debug('App tracking set up');

    const runningApps = this._appSystem.get_running();
    runningApps.forEach((app) => this._addAppToTray(app));
  }

  _cleanupAppTracking() {
    if (this._appRunningHandler && this._appSystem) {
      this._appSystem.disconnect(this._appRunningHandler);
      this._appRunningHandler = null;
    }
    this._backgroundApps.clear();
    this._trayIcons.clear();
    Util.Logger.debug('App tracking cleaned up');
  }

  _onAppStateChanged(app) {
    const state = app.state;

    if (state === Shell.AppState.RUNNING) {
      this._addAppToTray(app);
    } else if (state === Shell.AppState.STOPPED) {
      this._removeAppFromTray(app);
    }
  }

  _addAppToTray(app) {
    const appId = app.get_id();
    const isBackground = !app.get_windows().length;

    if (!isBackground) {
      this._removeAppFromTray(app);
      return;
    }

    if (this._backgroundApps.has(appId)) {
      return;
    }

    Util.Logger.debug(`Adding background app: ${appId}`);
    const menuItem = new PopupMenu.PopupImageMenuItem(app.get_name(), app.get_icon());

    menuItem.connect('activate', () => {
      Util.Logger.debug(`Activating app: ${appId}`);
      app.activate();
      // Do not close the parent menu.
    });

    this._backgroundApps.set(appId, menuItem);
    this._trayBox.add_child(menuItem);
    Util.Logger.debug(`Background app added: ${appId}`);
  }

  _removeAppFromTray(app) {
    const appId = app.get_id();
    const menuItem = this._backgroundApps.get(appId);
    if (menuItem) {
      Util.Logger.debug(`Removing app: ${appId}`);
      this._trayBox.remove_child(menuItem);
      menuItem.destroy();
      this._backgroundApps.delete(appId);
    }
  }

  _populateTrayIcons() {
    Util.Logger.debug('Starting tray icon population');
    this._trayIcons.forEach((menuItem, id) => {
      this._trayBox.remove_child(menuItem);
      menuItem.destroy();
      this._trayIcons.delete(id);
    });

    Object.values(Main.panel.statusArea).forEach((icon) => {
      if (
        icon instanceof IndicatorStatusIcon.IndicatorStatusIcon ||
        icon instanceof IndicatorStatusIcon.IndicatorStatusTrayIcon
      ) {
        Util.Logger.debug(`Found existing icon in panel: ${icon.uniqueId}`);
        if (icon.get_parent()) {
          icon.get_parent().remove_child(icon);
        }
        this._addTrayIcon(icon);
        delete Main.panel.statusArea[`appindicator-${icon.uniqueId}`];
      }
    });

    if (this._statusNotifierWatcher && this._statusNotifierWatcher._items) {
      this._statusNotifierWatcher._items.forEach((indicator) => {
        const statusIcon = new IndicatorStatusIcon.IndicatorStatusIcon(indicator);
        Util.Logger.debug(`Adding from watcher: ${statusIcon.uniqueId}`);
        this._addTrayIcon(statusIcon);
      });
    }
    Util.Logger.debug(`Tray icons populated, total: ${this._trayIcons.size}`);
  }

  _addTrayIcon(icon) {
    const id = icon.uniqueId || icon.title || 'unknown-tray-icon';
    if (this._trayIcons.has(id)) {
      return;
    }

    Util.Logger.debug(`Adding tray icon: ${id}`);
    const menuItem = new PopupMenu.PopupBaseMenuItem();
    if (icon.get_parent()) {
      icon.get_parent().remove_child(icon);
    }
    menuItem.add_child(icon);

    menuItem.connect('button-press-event', (actor, event) => {
      if (event.get_button() === Clutter.BUTTON_PRIMARY) {
        if (icon.menu) {
          Util.Logger.debug(`Opening submenu for: ${id}`);
          // For icons created via IndicatorStatusIcon, let that code handle submenu.
          icon.menu.setSourceActor(menuItem);
          icon.menu.open(BoxPointer.PopupAnimation.SLIDE);
          icon.menu.actor.grab_key_focus();
          this._trayButton.menu._submenuOpen = true; // Set the flag when submenu is opened
          icon.menu.connect('closed', () => {
            this._trayButton.menu._submenuOpen = false; // Reset the flag when submenu is closed
          });
          return Clutter.EVENT_STOP;
        } else if (icon.click) {
          Util.Logger.debug(`Clicking tray icon: ${id}`);
          icon.click(event);
          return Clutter.EVENT_STOP;
        }
      }
      return Clutter.EVENT_PROPAGATE;
    });

    this._trayIcons.set(id, menuItem);
    this._trayBox.add_child(menuItem);
    Util.Logger.debug(`Tray icon added: ${id}, visible: ${menuItem.visible}`);
  }

  _maybeEnableAfterNameAvailable() {
    Util.Logger.debug('Starting _maybeEnableAfterNameAvailable');
    if (!this._isEnabled || this._statusNotifierWatcher) {
      Util.Logger.debug('Skipped: not enabled or watcher exists');
      return;
    }

    if (this._watchDog.nameAcquired && this._watchDog.nameOnBus) {
      Util.Logger.debug('Skipped: name already acquired');
      return;
    }

    try {
      this._statusNotifierWatcher = new StatusNotifierWatcher.StatusNotifierWatcher(this._watchDog);
      Util.Logger.debug('StatusNotifierWatcher initialized');
      this._populateTrayIcons();
    } catch (e) {
      Util.Logger.error(`Error in _maybeEnableAfterNameAvailable: ${e.message}`);
      this._populateTrayIcons();
    }
  }
}

// For compatibility with older GNOME Shell versions
function init(metadata) {
  return new CollapsibleAppTrayExtension(metadata);
}

function enable() {
  const extension = init();
  extension.enable();
  return extension;
}

function disable() {
  const extension = Main.extensionManager.lookup('groupedtrayicons@example.com');
  if (extension) {
    extension.disable();
  }
}