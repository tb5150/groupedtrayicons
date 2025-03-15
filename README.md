# Collapsible App Tray

A GNOME Shell extension that groups running and background applications into a collapsible tray, similar to how Windows handles system tray icons.

![screenshot_7990](https://github.com/user-attachments/assets/dfb015a8-bff7-410b-bbc9-479417c18498)


## Features

- Groups background applications and system tray icons into a single collapsible menu
- Customizable arrow direction (up, down, left, right)
- Keeps parent menu open when interacting with app submenus
- Supports legacy tray icons
- Customizable icon appearance (opacity, saturation, brightness, contrast)
- Adjustable icon size and spacing
- Configurable tray position in the panel

## Installation

### From GNOME Extensions Website

1. Visit [extensions.gnome.org](https://extensions.gnome.org) and search for "Collapsible App Tray"
2. Click the toggle switch to install and enable the extension

### Manual Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/groupedtrayicons.git
   ```

2. Build and install the extension:
   ```
   cd groupedtrayicons
   glib-compile-schemas schemas/
   gnome-extensions pack .
   gnome-extensions install --force groupedtrayicons@example.com.shell-extension.zip
   ```

3. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

4. Enable the extension:
   ```
   gnome-extensions enable groupedtrayicons@example.com
   ```

## Configuration

The extension can be configured through the GNOME Extensions app or by clicking the settings icon next to the extension in the Extensions section of GNOME Settings.

### Available Settings

- **Arrow Direction**: Choose which direction the tray button arrow points (up, down, left, right)
- **Legacy Tray Icons**: Enable or disable support for legacy tray icons
- **Icon Appearance**: Adjust opacity, saturation, brightness, and contrast
- **Icon Size**: Set the size of tray icons in pixels
- **Tray Position**: Choose where the tray appears in the GNOME panel (left, center, right)
- **Custom Icons**: Replace specific app icons with custom ones from your icon theme

## Compatibility

This extension is compatible with GNOME Shell versions:
- 45
- 46
- 47
- 48

## Development

### Building from Source

1. Clone the repository
2. Make your changes
3. Compile the schemas:
   ```
   glib-compile-schemas schemas/
   ```
4. Pack the extension:
   ```
   gnome-extensions pack .
   ```

### Structure

- `extension.js`: Main extension code
- `prefs.js`: Preferences dialog
- `settingsManager.js`: Settings management
- `indicatorStatusIcon.js`: Indicator and status icon handling
- `statusNotifierWatcher.js`: DBus watcher for status notifier items
- `schemas/`: GSettings schema files

## Troubleshooting

### Common Issues

- **Icons not appearing**: Make sure the application is running in the background
- **Extension crashes**: Check the logs with `journalctl /usr/bin/gnome-shell -f`
- **Settings not saving**: Ensure the schemas are properly compiled

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the GNU General Public License v2.0 - see the LICENSE file for details.

## Acknowledgments

- Inspired by the Windows system tray functionality
- Built upon the AppIndicator/KStatusNotifierItem GNOME Shell extension
