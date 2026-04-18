// Merge files of a certain format, remove duplicate data
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';

export async function cleanData(fileNames) {
    console.time("Parsing cost");
    const streams = new Map();

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const inputDir = path.resolve(__dirname, '../../data/raw');
    const outputDir = path.resolve(__dirname, '../../data/clean');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const cleanFilePath = path.resolve(outputDir, `${fileNames}_CLEAN.jsonl`);
    const writeStream = fs.createWriteStream(cleanFilePath, { flags: 'w', encoding: 'utf8' });
    streams.set('clean', writeStream);

    try {
        // Get list of matching files sorted by chunk index (ascending)
        const listedData = fs.readdirSync(inputDir)
            .filter(f => f.match(new RegExp(`^${fileNames}_\\d+\\.jsonl$`)))
            .sort((a, b) => {
                const numA = parseInt(a.match(/(\d+)\.jsonl$/)[1], 10);
                const numB = parseInt(b.match(/(\d+)\.jsonl$/)[1], 10);
                return numA - numB;
            });

        if (listedData.length === 0) {
            console.warn(`No files found matching pattern: ${fileNames}_#.jsonl`);
            return;
        }

        // Read all files in order, writing every line to the clean file
        for (const dataFile of listedData) {
            const filePath = path.resolve(inputDir, dataFile);
            const rl = readline.createInterface({
                input: fs.createReadStream(filePath, { encoding: 'utf8' }),
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                if (line.trim()) {
                    await writeStream.write(line + '\n');
                }
            }

            console.info(`Merged: ${dataFile}`);
        }

        // Flush write stream before reading back
        await new Promise(resolve => writeStream.end(resolve));
        streams.delete('clean');

        // Re-read clean file from top, keeping only the FIRST occurrence of each id
        // (chunks are ascending, so first occurrence = most recent scrape chunk)
        const seenIds = new Set();
        const tempFilePath = cleanFilePath + '.tmp';
        const tempStream = fs.createWriteStream(tempFilePath, { flags: 'w', encoding: 'utf8' });
        streams.set('temp', tempStream);

        const rl2 = readline.createInterface({
            input: fs.createReadStream(cleanFilePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });

        for await (const line of rl2) {
            if (!line.trim()) continue;
            try {
                const record = JSON.parse(line);
                if (record.id !== undefined) {
                    if (!seenIds.has(record.id)) {
                        seenIds.add(record.id);
                        await tempStream.write(line + '\n');
                    }
                    // else: duplicate. Sskip it
                } else {
                    // No id field. Keep it unconditionally
                    await tempStream.write(line + '\n');
                }
            } catch {
                console.warn('Skipping malformed line:', line);
            }
        }

        await new Promise(resolve => tempStream.end(resolve));
        streams.delete('temp');

        // Atomically replace clean file with deduplicated version
        fs.renameSync(tempFilePath, cleanFilePath);

        console.info(`Cleaned data — ${seenIds.size} unique records written to ${fileNames}_CLEAN.jsonl`);
        console.timeEnd("Parsing cost");
    } catch (error) {
        // The clean file may be partially written, but raw chunks are untouched
        console.error(error);
    } finally {
        for (const [, stream] of streams) {
            await new Promise(resolve => stream.end(resolve));
        }
    }
}
