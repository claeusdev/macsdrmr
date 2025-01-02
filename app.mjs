// app.mjs
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import prettyBytes from 'pretty-bytes';
import { parentPort, Worker, workerData } from 'worker_threads';

class MacOSCleaner {
	constructor() {
		this.systemPaths = [
			'/private/var/db/diagnostics',
			'/private/var/folders',
			'/private/var/log',
			'/Library/Caches',
			'/Library/Logs',
			'/System/Library/Caches',
			'/private/var/vm',
			'/private/var/tmp',
			path.join(os.homedir(), 'Library/Caches'),
			path.join(os.homedir(), 'Library/Containers'),
			path.join(os.homedir(), 'Library/Application Support')
		];

		this.protectedPaths = [
			'/System',
			'/Library/LaunchDaemons',
			'/Library/LaunchAgents',
			'/System/Library/LaunchDaemons',
			'/System/Library/LaunchAgents'
		];
	}

	async analyzePath(inputPath) {
		const dirPath = path.resolve(inputPath.replace(/^~/, os.homedir()));
		const results = [];
		const items = await fs.readdir(dirPath);

		const tasks = items.map(async (item) => {
			const fullPath = path.join(dirPath, item)
			try {
				const stats = await fs.stat(fullPath)
				const size = stats.isDirectory()
					? await this.makeWorker(fullPath)
					: { totalBytes: stats.size, prettysize: prettyBytes(stats.size), items: 1}
				results.push({
					name: item,
					path: fullPath,
					...size,
					isDirectory: stats.isDirectory(),
					modifiedTime: stats.mtime,
				})
			} catch (err) {
				console.warn(`Skipping ${item}: ${err.message}`)
			}
		})

		await Promise.all(tasks);

		return results.sort((a, b) => b.totalBytes - a.totalBytes)
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
					} catch (err) { }
				}
			} catch (err) { 

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
			return { totalBytes: 0, prettySize: '0 B', items: 0 };
		}

		return {
			totalBytes,
			prettySize: prettyBytes(totalBytes),
			items: fileCount
		};
	}

	async worker_thread () {
		const inputPath = workerData.inputPath;
		const result = await getTotalSize(inputPath);
		parentPort.postMessage(result)
	};

	makeWorker(inputPath) {
		return new Promise ((resolve, reject) => {
			const worker = new Worker(worker_thread, {
				workerData: { inputPath}
			});

			worker.on('message', resolve);
			worker.on('error', reject);
			worker.on('exit', (code) => {
				if(code !== 0) {
					reject(new Error(`This worker terminated with exit code ${code}`))
				}
			});
		});
	}

	async analyzeSystemData() {
		const results = [];
		console.log('Analyzing system data locations...\n');

		const tasks = this.systemPaths.map(async (dirPath) => {
			try {
				console.log(`Scanning ${dirPath}...`);
				const size = await this.makeWorker(dirPath);
				if (size.totalBytes > 0) {
					results.push({
						path: dirPath,
						...size
					});
				}
			} catch (err) {
				console.warn(`Error scanning ${dirPath}: ${err.message}`)
			}
		});

		await Promise.all(tasks);

		return results.sort((a, b) => b.totalBytes - a.totalBytes);
	}

	isProtectedPath(itemPath) {
		return this.protectedPaths.some(protectedPath => itemPath.startsWith(protectedPath));
	}

	async removeItem(inputPath) {
		const itemPath = path.resolve(inputPath.replace(/^~/, os.homedir()));

		try {
			// Safety checks
			if (this.isProtectedPath(itemPath)) {
				throw new Error('Cannot remove protected system path');
			}

			const stats = await fs.stat(itemPath);

			// Get size before removal for reporting
			const size = await this.getTotalSize(itemPath);

			if (stats.isDirectory()) {
				await fs.rm(itemPath, { recursive: true, force: true });
			} else {
				await fs.unlink(itemPath);
			}

			return size;
		} catch (error) {
			throw new Error(`Failed to remove ${itemPath}: ${error.message}`);
		}
	}
}

// CLI interface
async function main() {
	const cleaner = new MacOSCleaner();
	const command = process.argv[2];
	const targetPath = process.argv[3];

	try {
		switch (command) {
			case 'scan':
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
				break;

			case 'inspect':
				if (!targetPath) {
					throw new Error('Please provide a path to inspect');
				}
				const contents = await cleaner.analyzePath(targetPath);
				console.log(`\nAnalyzing contents of: ${targetPath}\n`);
				console.table(contents.map(item => ({
					'Name': item.name,
					'Size': item.prettySize,
					'Files': item.items,
					'Type': item.isDirectory ? 'directory' : 'file',
					'Modified': item.modifiedTime.toLocaleString()
				})));
				break;

			case 'remove':
				if (!targetPath) {
					throw new Error('Please provide a path to remove');
				}
				const removedSize = await cleaner.removeItem(targetPath);
				console.log(`Successfully removed: ${targetPath}`);
				console.log(`Freed up: ${removedSize.prettySize}`);
				break;

			default:
				console.log('Usage:');
				console.log('  node app.mjs scan               # Show all system data locations and sizes');
				console.log('  node app.mjs inspect <path>     # Show contents of specific directory');
				console.log('  node app.mjs remove <path>      # Remove specific file or directory');
		}
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
