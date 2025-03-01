// indicatorStatusIcon.js (fully modified)
// This file is part of the AppIndicator/KStatusNotifierItem GNOME Shell extension
// [License text omitted for brevity]

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as AppIndicator from './appIndicator.js';
import * as PromiseUtils from './promiseUtils.js';
import * as SettingsManager from './settingsManager.js';
import * as Util from './util.js';
import * as DBusMenu from './dbusMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'; // For popup animations

const DEFAULT_ICON_SIZE = Panel.PANEL_ICON_SIZE || 16;

let customIconHandler = null;

export function setCustomIconHandler(handler) {
  customIconHandler = handler;
}

export function addIconToPanel(statusIcon) {
  if (!(statusIcon instanceof BaseStatusIcon))
    throw TypeError(`Unexpected icon type: ${statusIcon}`);

  if (customIconHandler) {
    customIconHandler(statusIcon);
    return;
  }

  const settings = SettingsManager.getDefaultGSettings();
  const indicatorId = `appindicator-${statusIcon.uniqueId}`;

  const currentIcon = Main.panel.statusArea[indicatorId];
  if (currentIcon) {
    if (currentIcon !== statusIcon) currentIcon.destroy();
    Main.panel.statusArea[indicatorId] = null;
  }

  Main.panel.addToStatusArea(
    indicatorId,
    statusIcon,
    1,
    settings.get_string('tray-pos')
  );

  Util.connectSmart(settings, 'changed::tray-pos', statusIcon, () =>
    addIconToPanel(statusIcon)
  );
}

export function getTrayIcons() {
  return Object.values(Main.panel.statusArea).filter(
    (i) => i instanceof IndicatorStatusTrayIcon
  );
}

export function getAppIndicatorIcons() {
  return Object.values(Main.panel.statusArea).filter(
    (i) => i instanceof IndicatorStatusIcon
  );
}

export const BaseStatusIcon = GObject.registerClass(
  class IndicatorBaseStatusIcon extends PanelMenu.Button {
    _init(menuAlignment, nameText, iconActor, dontCreateMenu) {
      super._init(menuAlignment, nameText, dontCreateMenu);

      const settings = SettingsManager.getDefaultGSettings();
      Util.connectSmart(
        settings,
        'changed::icon-opacity',
        this,
        this._updateOpacity
      );
      this.connect('notify::hover', () => this._onHoverChanged());

      if (!super._onDestroy) this.connect('destroy', () => this._onDestroy());

      this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
      this.add_child(this._box);

      this._setIconActor(iconActor);
      this._showIfReady();
    }

    _setIconActor(icon) {
      if (!(icon instanceof Clutter.Actor))
        throw new Error(`${icon} is not a valid actor`);

      if (this._icon && this._icon !== icon) this._icon.destroy();

      this._icon = icon;
      this._updateEffects();
      this._monitorIconEffects();

      if (this._icon) {
        this._box.add_child(this._icon);
        const id = this._icon.connect('destroy', () => {
          this._icon.disconnect(id);
          this._icon = null;
          this._monitorIconEffects();
        });
      }
    }

    _onDestroy() {
      if (this._icon) this._icon.destroy();
      if (super._onDestroy) super._onDestroy();
    }

    isReady() {
      throw new GObject.NotImplementedError(
        `isReady() in ${this.constructor.name}`
      );
    }

    get icon() {
      return this._icon;
    }

    get uniqueId() {
      throw new GObject.NotImplementedError(
        `uniqueId in ${this.constructor.name}`
      );
    }

    _showIfReady() {
      this.visible = this.isReady();
    }

    _onHoverChanged() {
      if (this.hover) {
        this.opacity = 255;
        if (this._icon) this._icon.remove_effect_by_name('desaturate');
      } else {
        this._updateEffects();
      }
    }

    _updateOpacity() {
      const settings = SettingsManager.getDefaultGSettings();
      const userValue = settings.get_user_value('icon-opacity');
      if (userValue) this.opacity = userValue.unpack();
      else this.opacity = 255;
    }

    _updateEffects() {
      this._updateOpacity();
      if (this._icon) {
        this._updateSaturation();
        this._updateBrightnessContrast();
      }
    }

    _monitorIconEffects() {
      const settings = SettingsManager.getDefaultGSettings();
      const monitoring = !!this._iconSaturationIds;

      if (!this._icon && monitoring) {
        Util.disconnectSmart(settings, this, this._iconSaturationIds);
        delete this._iconSaturationIds;
        Util.disconnectSmart(settings, this, this._iconBrightnessIds);
        delete this._iconBrightnessIds;
        Util.disconnectSmart(settings, this, this._iconContrastIds);
        delete this._iconContrastIds;
      } else if (this._icon && !monitoring) {
        this._iconSaturationIds = Util.connectSmart(
          settings,
          'changed::icon-saturation',
          this,
          this._updateSaturation
        );
        this._iconBrightnessIds = Util.connectSmart(
          settings,
          'changed::icon-brightness',
          this,
          this._updateBrightnessContrast
        );
        this._iconContrastIds = Util.connectSmart(
          settings,
          'changed::icon-contrast',
          this,
          this._updateBrightnessContrast
        );
      }
    }

    _updateSaturation() {
      const settings = SettingsManager.getDefaultGSettings();
      const desaturationValue = settings.get_double('icon-saturation');
      let desaturateEffect = this._icon.get_effect('desaturate');

      if (desaturationValue > 0) {
        if (!desaturateEffect) {
          desaturateEffect = new Clutter.DesaturateEffect();
          this._icon.add_effect_with_name('desaturate', desaturateEffect);
        }
        desaturateEffect.set_factor(desaturationValue);
      } else if (desaturateEffect) {
        this._icon.remove_effect(desaturateEffect);
      }
    }

    _updateBrightnessContrast() {
      const settings = SettingsManager.getDefaultGSettings();
      const brightnessValue = settings.get_double('icon-brightness');
      const contrastValue = settings.get_double('icon-contrast');
      let brightnessContrastEffect = this._icon.get_effect('brightness-contrast');

      if (brightnessValue !== 0 | contrastValue !== 0) {
        if (!brightnessContrastEffect) {
          brightnessContrastEffect = new Clutter.BrightnessContrastEffect();
          this._icon.add_effect_with_name(
            'brightness-contrast',
            brightnessContrastEffect
          );
        }
        brightnessContrastEffect.set_brightness(brightnessValue);
        brightnessContrastEffect.set_contrast(contrastValue);
      } else if (brightnessContrastEffect) {
        this._icon.remove_effect(brightnessContrastEffect);
      }
    }
  }
);

export const IndicatorStatusIcon = GObject.registerClass(
  class IndicatorStatusIcon extends BaseStatusIcon {
    _init(indicator) {
      super._init(
        0.5,
        indicator.accessibleName,
        new AppIndicator.IconActor(indicator, DEFAULT_ICON_SIZE)
      );
      this._indicator = indicator;

      this._lastClickTime = -1;
      this._lastClickX = -1;
      this._lastClickY = -1;

      this._box.add_style_class_name('appindicator-box');

      Util.connectSmart(this._indicator, 'ready', this, this._showIfReady);
      Util.connectSmart(this._indicator, 'menu', this, this._updateMenu);
      Util.connectSmart(this._indicator, 'label', this, this._updateLabel);
      Util.connectSmart(this._indicator, 'status', this, this._updateStatus);
      Util.connectSmart(this._indicator, 'reset', this, () => {
        this._updateStatus();
        this._updateLabel();
      });
      Util.connectSmart(
        this._indicator,
        'accessible-name',
        this,
        () => this.set_accessible_name(this._indicator.accessibleName)
      );
      Util.connectSmart(this._indicator, 'destroy', this, () => this.destroy());

      this.connect('notify::visible', () => this._updateMenu());

      this._showIfReady();

      // Ensure the submenu is managed by the global menu manager and does not auto-close.
      if (this.menu) {
        Main.panel.menuManager.addMenu(this.menu);
        this.menu.closeOnSelect = false;
      }
    }

    _onDestroy() {
      if (this._menuClient) {
        this._menuClient.disconnect(this._menuReadyId);
        this._menuClient.destroy();
        this._menuClient = null;
      }
      if (this.menu) {
        Main.panel.menuManager.removeMenu(this.menu);
      }
      super._onDestroy();
    }

    get uniqueId() {
      return this._indicator.uniqueId;
    }

    isReady() {
      return this._indicator && this._indicator.isReady;
    }

    _updateLabel() {
      const { label } = this._indicator;
      if (label) {
        if (!this._label || !this._labelBin) {
          this._labelBin = new St.Bin({
            yAlign: Clutter.ActorAlign.CENTER,
          });
          this._label = new St.Label();
          Util.addActor(this._labelBin, this._label);
          Util.addActor(this._box, this._labelBin);
        }
        this._label.set_text(label);
        if (!this._box.contains(this._labelBin))
          Util.addActor(this._box, this._labelBin);
      } else if (this._label) {
        this._labelBin.destroy_all_children();
        Util.removeActor(this._box, this._labelBin);
        this._labelBin.destroy();
        delete this._labelBin;
        delete this._label;
      }
    }

    _updateStatus() {
      const wasVisible = this.visible;
      this.visible = this._indicator.status !== AppIndicator.SNIStatus.PASSIVE;

      if (this.visible !== wasVisible)
        this._indicator.checkAlive().catch(Util.logError);
    }

    _updateMenu() {
      if (this._menuClient) {
        this._menuClient.disconnect(this._menuReadyId);
        this._menuClient.destroy();
        this._menuClient = null;
        this.menu.removeAll();
      }

      if (this.visible && this._indicator.menuPath) {
        this._menuClient = new DBusMenu.Client(
          this._indicator.busName,
          this._indicator.menuPath,
          this._indicator
        );

        if (this._menuClient.isReady) {
          this._menuClient.attachToMenu(this.menu);
        } else {
          Util.Logger.debug(
            `Menu client not ready for ${this.uniqueId}, using fallback`
          );
          this.menu.actor.reactive = true;
        }

        this._menuReadyId = this._menuClient.connect('ready-changed', () => {
          if (this._menuClient.isReady) {
            this._menuClient.attachToMenu(this.menu);
          } else {
            this._updateMenu();
          }
        });
      }
    }

    _showIfReady() {
      if (!this.isReady()) return;

      this._updateLabel();
      this._updateStatus();
      this._updateMenu();
    }

    vfunc_button_press_event(event) {
      if (event.get_button() === Clutter.BUTTON_MIDDLE) {
        if (Main.panel.menuManager.activeMenu)
          Main.panel.menuManager._closeMenu(
            true,
            Main.panel.menuManager.activeMenu
          );
        this._indicator.secondaryActivate(
          event.get_time(),
          ...event.get_coords()
        );
        return Clutter.EVENT_STOP;
      }

      if (
        event.get_button() === Clutter.BUTTON_SECONDARY ||
        event.get_button() === Clutter.BUTTON_PRIMARY
      ) {
        if (this.menu && this.menu.numMenuItems > 0) {
          Util.Logger.debug(`Opening submenu for ${this.uniqueId}`);

          // Retrieve the active (parent) menu and set its _submenuOpen flag.
          let parentMenu = Main.panel.menuManager.activeMenu;
          if (parentMenu) {
            parentMenu._submenuOpen = true;
            // When the submenu closes, clear the flag.
            this.menu.connect('close', () => {
              parentMenu._submenuOpen = false;
              Util.Logger.debug(`Submenu closed for ${this.uniqueId}`);
            });
          }
          // Compute the submenu's desired position so it stays within the screen.
          let [x, y] = this.get_transformed_position();
          let [actorWidth, actorHeight] = this.get_transformed_size();
          let screenWidth = Main.layoutManager.primaryMonitor.width;
          let screenHeight = Main.layoutManager.primaryMonitor.height;
          let menuWidth = this.menu.actor.get_width();
          let menuHeight = this.menu.actor.get_height();
          if (menuWidth <= 0) menuWidth = 200;
          if (menuHeight <= 0) menuHeight = 300;
          // Adjust horizontal position.
          if (x + menuWidth > screenWidth) {
            x = screenWidth - menuWidth;
            if (x < 0) x = 0;
          }
          // Adjust vertical position.
          if (y + actorHeight + menuHeight > screenHeight) {
            if (y - menuHeight >= 0) {
              y = y - menuHeight;
            } else {
              y = screenHeight - menuHeight;
            }
          } else {
            y = y + actorHeight;
          }
          this.menu.actor.set_position(x, y);

          if (!this.menu.isOpen) {
            this.menu.open(BoxPointer.PopupAnimation.SLIDE);
            Util.Logger.debug(`Submenu opened for ${this.uniqueId}`);
          }
          this.menu.actor.grab_key_focus();
        } else {
          Util.Logger.debug(
            `Submenu for ${this.uniqueId} has no items, not opening`
          );
        }
        return Clutter.EVENT_STOP;
      }

      return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(event) {
      if (event.get_scroll_direction() === Clutter.ScrollDirection.SMOOTH) {
        const [dx, dy] = event.get_scroll_delta();
        this._indicator.scroll(dx, dy);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    }
  }
);

export const IndicatorStatusTrayIcon = GObject.registerClass(
  class IndicatorTrayIcon extends BaseStatusIcon {
    _init(icon) {
      super._init(0.5, icon.wm_class, icon, { dontCreateMenu: true });
      Util.Logger.debug(`Adding legacy tray icon ${this.uniqueId}`);
      this._box.add_style_class_name('appindicator-trayicons-box');
      this.add_style_class_name('appindicator-icon');
      this.add_style_class_name('tray-icon');

      this.connect('button-press-event', (_actor, _event) => {
        this.add_style_pseudo_class('active');
        return Clutter.EVENT_PROPAGATE;
      });
      this.connect('button-release-event', (_actor, event) => {
        this._icon.click(event);
        this.remove_style_pseudo_class('active');
        return Clutter.EVENT_PROPAGATE;
      });
      this.connect('key-press-event', (_actor, event) => {
        this.add_style_pseudo_class('active');
        this._icon.click(event);
        return Clutter.EVENT_PROPAGATE;
      });
      this.connect('key-release-event', (_actor, event) => {
        this._icon.click(event);
        this.remove_style_pseudo_class('active');
        return Clutter.EVENT_PROPAGATE;
      });

      Util.connectSmart(this._icon, 'destroy', this, () => {
        icon.clear_effects();
        this.destroy();
      });

      const settings = SettingsManager.getDefaultGSettings();
      Util.connectSmart(settings, 'changed::icon-size', this, this._updateIconSize);

      const themeContext = St.ThemeContext.get_for_stage(global.stage);
      Util.connectSmart(themeContext, 'notify::scale-factor', this, () =>
        this._updateIconSize()
      );

      this._updateIconSize();
    }

    _onDestroy() {
      Util.Logger.debug(`Destroying legacy tray icon ${this.uniqueId}`);
      super._onDestroy();
    }

    isReady() {
      return !!this._icon;
    }

    get uniqueId() {
      return `legacy:${this._icon.wm_class}:${this._icon.pid}`;
    }

    vfunc_navigate_focus(from, direction) {
      this.grab_key_focus();
      return super.vfunc_navigate_focus(from, direction);
    }

    _getSimulatedButtonEvent(touchEvent) {
      const event = Clutter.Event.new(Clutter.EventType.BUTTON_RELEASE);
      event.set_button(1);
      event.set_time(touchEvent.get_time());
      event.set_flags(touchEvent.get_flags());
      event.set_stage(global.stage);
      event.set_source(touchEvent.get_source());
      event.set_coords(...touchEvent.get_coords());
      event.set_state(touchEvent.get_state());
      return event;
    }

    vfunc_touch_event(event) {
      if (!imports.gi.Meta.is_wayland_compositor())
        return Clutter.EVENT_PROPAGATE;

      const slot = event.get_event_sequence().get_slot();

      if (
        !this._touchPressSlot &&
        event.get_type() === Clutter.EventType.TOUCH_BEGIN
      ) {
        this.add_style_pseudo_class('active');
        this._touchButtonEvent = this._getSimulatedButtonEvent(event);
        this._touchPressSlot = slot;
        this._touchDelayPromise = new PromiseUtils.TimeoutPromise(
          AppDisplay.MENU_POPUP_TIMEOUT
        );
        this._touchDelayPromise.then(() => {
          delete this._touchDelayPromise;
          delete this._touchPressSlot;
          this._touchButtonEvent.set_button(3);
          this._icon.click(this._touchButtonEvent);
          this.remove_style_pseudo_class('active');
        });
      } else if (
        event.get_type() === Clutter.EventType.TOUCH_END &&
        this._touchPressSlot === slot
      ) {
        delete this._touchPressSlot;
        delete this._touchButtonEvent;
        if (this._touchDelayPromise) {
          this._touchDelayPromise.cancel();
          delete this._touchDelayPromise;
        }
        this._icon.click(this._getSimulatedButtonEvent(event));
        this.remove_style_pseudo_class('active');
      } else if (
        event.get_type() === Clutter.EventType.TOUCH_UPDATE &&
        this._touchPressSlot === slot
      ) {
        this.add_style_pseudo_class('active');
        this._touchButtonEvent = this._getSimulatedButtonEvent(event);
      }
      return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
      this.remove_style_pseudo_class('active');
      if (this._touchDelayPromise) {
        this._touchDelayPromise.cancel();
        delete this._touchDelayPromise;
      }
      return super.vfunc_leave_event(event);
    }

    _updateIconSize() {
      const settings = SettingsManager.getDefaultGSettings();
      const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
      let iconSize = settings.get_int('icon-size');
      if (iconSize <= 0) iconSize = DEFAULT_ICON_SIZE;
      this.height = -1;
      this._icon.set({
        width: iconSize * scaleFactor,
        height: iconSize * scaleFactor,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      });
    }
  }
);
