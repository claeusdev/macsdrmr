import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import prettyBytes from 'pretty-bytes';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

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

		this.dryRun = false;

        this.maxDepth = 3;
        this.workerPool = new Set();
        this.maxWorkers = os.cpus().length;
    }

    async analyzePath(inputPath, depth = 0) {
        const dirPath = path.resolve(inputPath.replace(/^~/, os.homedir()));
        const results = [];

        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            const processItem = async (item) => {
                const fullPath = path.join(dirPath, item.name);
                try {
                    if (item.isDirectory() && depth < this.maxDepth) {
                        const size = await this.getTotalSizeWithWorker(fullPath);
                        results.push({
                            name: item.name,
                            path: fullPath,
                            ...size,
                            isDirectory: true,
                            modifiedTime: (await fs.stat(fullPath)).mtime
                        });
                    } else {
                        const stats = await fs.stat(fullPath);
                        results.push({
                            name: item.name,
                            path: fullPath,
                            totalBytes: stats.size,
                            prettySize: prettyBytes(stats.size),
                            items: 1,
                            isDirectory: false,
                            modifiedTime: stats.mtime
                        });
                    }
                } catch (err) {
                    console.warn(`Skipping ${item.name}: ${err.message}`);
                }
            };

            // Process items in chunks to avoid memory overflow
            const chunkSize = 50;
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                await Promise.all(chunk.map(processItem));
                // Progress indicator - optional
                if (items.length > 100) {
                    const progress = Math.round((i + chunk.length) / items.length * 100);
                    console.log(`Processing... ${progress}%`);
                }
            }

            return results.sort((a, b) => b.totalBytes - a.totalBytes);
        } catch (error) {
            throw new Error(`Failed to analyze ${dirPath}: ${error.message}`);
        }
    }

    async getTotalSizeWithWorker(dirPath) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(fileURLToPath(import.meta.url), {
                workerData: { dirPath, mode: 'calculateSize' }
            });

            this.workerPool.add(worker);

            worker.on('message', (result) => {
                this.workerPool.delete(worker);
                resolve(result);
            });

            worker.on('error', (error) => {
                this.workerPool.delete(worker);
                reject(error);
            });

            worker.on('exit', (code) => {
                this.workerPool.delete(worker);
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    async analyzeSystemData() {
        const results = [];
        console.log('Analyzing system data locations...\n');

        const processPath = async (dirPath) => {
            try {
                console.log(`Scanning ${dirPath}...`);
                const size = await this.getTotalSizeWithWorker(dirPath);
                if (size.totalBytes > 0) {
                    results.push({
                        path: dirPath,
                        ...size
                    });
                }
            } catch (err) {
                console.warn(`Error scanning ${dirPath}: ${err.message}`);
            }
        };

        const chunks = [];
        for (let i = 0; i < this.systemPaths.length; i += this.maxWorkers) {
            const chunk = this.systemPaths.slice(i, i + this.maxWorkers);
            chunks.push(chunk);
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(processPath));
        }

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
			const size = await this.getTotalSizeWithWorker(itemPath);

			if(this.dryRun) {
				return {
				path: itemPath,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: size,
                wouldRemove: true
				};
			}

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

// Worker thread logic
if (!isMainThread) {
    const { dirPath, mode } = workerData;

    async function calculateSize(inputPath) {
        let totalBytes = 0;
        let fileCount = 0;

        async function processDirectory(dirPath) {
            try {
                const items = await fs.readdir(dirPath, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dirPath, item.name);
                    try {
                        if (item.isDirectory()) {
                            await processDirectory(fullPath);
                        } else {
                            const stats = await fs.stat(fullPath);
                            totalBytes += stats.size;
                            fileCount++;
                        }
                    } catch (err) { }
                }
            } catch (err) { }
        }

        try {
            const stats = await fs.stat(inputPath);
            if (stats.isDirectory()) {
                await processDirectory(inputPath);
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

    if (mode === 'calculateSize') {
        calculateSize(dirPath).then(result => parentPort.postMessage(result));
    }
}

async function main() {
	const cleaner = new MacOSCleaner();
	const command = process.argv[2];
	const targetPath = process.argv[3];

	const isDryRun = process.argv.includes('--dry-run');

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
				//Setting preview mode before removal
				cleaner.dryRun = isDryRun;
				const result = await cleaner.removeItem(targetPath);
                
                if (isDryRun) {
                    console.log('DRY RUN - No files will be removed');
                    console.log(`Would remove: ${result.path}`);
                    console.log(`Would free up: ${result.size.prettySize}`);
                } else {
                    console.log(`Successfully removed: ${result.path}`);
                    console.log(`Freed up: ${result.size.prettySize}`);
                }
                break;

				console.log(`Successfully removed: ${targetPath}`);
				console.log(`Freed up: ${removedSize.prettySize}`);
				break;

			// default:
			// 	console.log('Usage:');
			// 	console.log('  node app.mjs scan               # Show all system data locations and sizes');
			// 	console.log('  node app.mjs inspect <path>     # Show contents of specific directory');
			// 	console.log('  node app.mjs remove <path>      # Remove specific file or directory');
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