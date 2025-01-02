# macOS System Data Cleaner

A Node.js tool for analyzing and cleaning macOS system data storage. This tool helps you identify what's taking up space in your system storage and safely remove unnecessary files.

## Installation

1. Make sure you have Node.js installed on your Mac

2. Clone the repository:
```bash
git clone https://github.com/yourusername/macos-cleaner.git
cd macos-cleaner
```

3. Install dependencies:
```bash
npm install
```

## Usage

The tool provides three main commands:

### 1. Scan System Data
Shows all system data locations and their sizes:
```bash
sudo node app.mjs scan
```

This will analyze common system data locations including:
- `/private/var/db/diagnostics` (System diagnostics)
- `/private/var/folders` (Temporary files)
- `/private/var/log` (System logs)
- `/Library/Caches` (System caches)
- And more...

### 2. Inspect Specific Locations
View contents and sizes of a specific directory:
```bash
sudo node app.mjs inspect /path/to/directory
```

Example:
```bash
sudo node app.mjs inspect /Library/Caches
```

### 3. Remove Items
Remove specific files or directories:
```bash
sudo node app.mjs remove /path/to/item
```

Example:
```bash
sudo node app.mjs remove /Library/Caches/some-folder
```

## Safety Features

The tool includes several safety measures:
- Protected paths list to prevent removal of critical system files
- Recursive size calculation before removal
- Size reporting after successful removal
- Skip handling for inaccessible files
- Error handling for insufficient permissions

## Protected Locations

The following locations are protected from removal:
- `/System`
- `/Library/LaunchDaemons`
- `/Library/LaunchAgents`
- `/System/Library/LaunchDaemons`
- `/System/Library/LaunchAgents`

## Best Practices

1. Always run `scan` first to understand your system's storage usage
2. Use `inspect` to examine contents before removal
3. Be cautious when removing items - make sure you know what they are
4. Run with `sudo` to ensure proper access to system directories
5. Consider backing up important data before removing large amounts of files

## Common Issues

1. "Permission denied" errors:
   - Make sure to run the commands with `sudo`
   - Some system files are protected by SIP (System Integrity Protection)

2. "Cannot remove protected system path":
   - The file/directory is in the protected paths list
   - This is a safety feature to prevent system damage

## Warning

While this tool includes safety checks, use it at your own risk. Be especially careful when removing files from system locations. When in doubt:
1. Research what the files/directories are used for
2. Consider using macOS's built-in storage management tools
3. Back up important data before making changes

## Limitations

- Cannot remove SIP-protected files
- Some system files may require additional permissions
- Total sizes may be approximate due to rapidly changing system files

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
