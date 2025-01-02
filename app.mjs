// app.mjs
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import prettyBytes from 'pretty-bytes';

class MacOSCleaner {
	constructor() {
		// These are the main locations where macOS stores system data and caches
		this.systemPaths = [
			'/private/var/db/diagnostics',       // System diagnostics
			'/private/var/folders',              // Per-user temporary files
			'/private/var/log',                  // System logs
			'/Library/Caches',                   // System-wide caches
			'/Library/Logs',                     // System-wide logs
			'/System/Library/Caches',            // System caches
			'/private/var/vm',                   // Swap files
			'/private/var/tmp',                  // Temporary files
			path.join(os.homedir(), 'Library/Caches'),
			path.join(os.homedir(), 'Library/Containers'),  // App containers
			path.join(os.homedir(), 'Library/Application Support')
		];
	}

	async getTotalSize(inputPath) {
		let totalBytes = 0;
		let fileCount = 0;

		async function calculateSize(dirPath) {
			try {
				const items = await fs.readdir(dirPath);

				for (const item of items) {
					const fullPath = path.join(dirPath, item);
					try {
						const stats = await fs.stat(fullPath);
						if (stats.isDirectory()) {
							await calculateSize(fullPath);
						} else {
							totalBytes += stats.size;
							fileCount++;
						}
					} catch (err) {
						// Skip files we can't access
					}
				}
			} catch (err) {
				// Skip directories we can't access
			}
		}

		try {
			const stats = await fs.stat(inputPath);
			if (stats.isDirectory()) {
				await calculateSize(inputPath);
			} else {
				totalBytes = stats.size;
				fileCount = 1;
			}
		} catch (error) {
			// Skip if we can't access the path
			return { totalBytes: 0, prettySize: '0 B', items: 0 };
		}

		return {
			totalBytes,
			prettySize: prettyBytes(totalBytes),
			items: fileCount
		};
	}

	async analyzeSystemData() {
		const results = [];

		console.log('Analyzing system data locations...\n');

		for (const dirPath of this.systemPaths) {
			try {
				console.log(`Scanning ${dirPath}...`);
				const size = await this.getTotalSize(dirPath);
				if (size.totalBytes > 0) {
					results.push({
						path: dirPath,
						...size
					});
				}
			} catch (err) {
				// Skip inaccessible locations
			}
		}

		return results.sort((a, b) => b.totalBytes - a.totalBytes);
	}
}

// CLI interface
async function main() {
	const cleaner = new MacOSCleaner();

	try {
		const items = await cleaner.analyzeSystemData();

		console.log('\nSystem Data Analysis:');
		console.table(items.map(item => ({
			'Location': item.path,
			'Size': item.prettySize,
			'Files': item.items
		})));

		const totalBytes = items.reduce((acc, item) => acc + item.totalBytes, 0);
		console.log(`\nTotal System Data Size: ${prettyBytes(totalBytes)}`);
		console.log(`Total Files: ${items.reduce((acc, item) => acc + item.items, 0)}`);

	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}

export default MacOSCleaner;
