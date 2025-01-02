import { promises as fs } from 'fs';
import path from 'path';
import prettyBytes from 'pretty-bytes';
import { parentPort, workerData } from 'worker_threads';

async function getTotalSize(inputPath) {
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
        } catch (err) {}
      }
    } catch (err) {}
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
    items: fileCount,
  };
}

(async () => {
  const inputPath = workerData.inputPath;
  const result = await getTotalSize(inputPath);
  parentPort.postMessage(result);
})();
