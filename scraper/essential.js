// All files in [mode] use these functions

import axios from "axios"
import * as cheerio from 'cheerio'; // Parsing and manipulating HTML

import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';

import { NotFoundError, SSLError } from './error.js';
import { client } from './client.js';

const LOG_IN_TRUE = (process.env.LOG_IN_TRUE === 'true');

const MAX_RETRIES = 20;
const TIMER = 5000;

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; ao3-map-bot/1.0; statistical analysis; +https://github.com/linSchnepel/fandom-data-analysis-tool)',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://archiveofourown.org/',
    'Connection': 'keep-alive',
};

const HTML_HEADERS = {
    ...BASE_HEADERS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const FORM_HEADERS = {
    ...BASE_HEADERS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

const JS_HEADERS = {
    ...BASE_HEADERS,
    'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript',
    'X-Requested-With': 'XMLHttpRequest',
};

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Yields one parsed object at a time from fileName_CLEAN.jsonl
export async function* readingData(fileName) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(__dirname, '../data/clean', `${fileName}_CLEAN.jsonl`);

    const { size: totalBytes } = await fs.promises.stat(filePath);
    let bytesRead = 0;
    let lastReported = -1;

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline
        const pct = Math.min(100, Math.floor((bytesRead / totalBytes) * 100));

        if (pct !== lastReported) {
            process.stdout.write(`Reading ${fileName}: ${pct}%\n`);
            lastReported = pct;
        }

        if (!line.trim()) continue;
        try {
            yield JSON.parse(line);
        } catch {
            console.warn('\nSkipping malformed line:', line);
        }
    }
}

// Append-only. Creates file if it doesn't exist. No read cost.
export async function saveData(records, fileName) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const outputDir = path.resolve(__dirname, '../data/clean');
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.resolve(outputDir, fileName);

    const writeStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    for (const record of records) {
        await writeStream.write(JSON.stringify(record) + '\n');
    }

    await new Promise(resolve => writeStream.end(resolve));
}

/**
 * Given a chunk of data like [ {"id":"82442271", unique dynamic attributes }, ...]
 * will read filename from data/clean/ and merge, creating a new file with both properties from the same ID.
 * If unique dynamic attributes are already in established data, overwrites.
 */
export async function writingData(destFileName, sourceFileName, newFileName) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dir = path.resolve(__dirname, '../data/clean');
    const sourcePath = path.resolve(dir, sourceFileName);
    const destPath = path.resolve(dir, destFileName);
    const writtenPath = path.resolve(dir, destFileName.replace('.jsonl', `_${newFileName}.jsonl`));

    // Load destination into map if it exists
    const recordMap = new Map();
    if (fs.existsSync(destPath)) {
        const rl = readline.createInterface({
            input: fs.createReadStream(destPath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const record = JSON.parse(line);
                if (record.id !== undefined) recordMap.set(record.id, record);
            } catch {
                console.warn('Skipping malformed line:', line);
            }
        }
    }

    // Merge source into map
    const rl2 = readline.createInterface({
        input: fs.createReadStream(sourcePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    for await (const line of rl2) {
        if (!line.trim()) continue;
        try {
            const incoming = JSON.parse(line);
            if (incoming.id !== undefined) {
                const existing = recordMap.get(incoming.id) ?? {};
                recordMap.set(incoming.id, { ...existing, ...incoming });
            }
        } catch {
            console.warn('Skipping malformed line:', line);
        }
    }

    // Write to new newFileName file
    const writeStream = fs.createWriteStream(writtenPath, { flags: 'w', encoding: 'utf8' });
    for (const record of recordMap.values()) {
        writeStream.write(JSON.stringify(record) + '\n');
    }

    await new Promise(resolve => writeStream.end(resolve));

    console.info(`writingData: merged ${recordMap.size} records into ${writtenPath}`);
}

export async function loadPageComments(workID, page) {
    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            const { data } = LOG_IN_TRUE
                ? await client.get(
                    'https://archiveofourown.org/comments/show_comments',
                    {
                        params: { page: page, work_id: workID },
                        headers: JS_HEADERS,
                        maxRedirects: 0, // don't follow redirects
                        validateStatus: s => s < 400,
                    }
                )
                : await axios.get(
                    'https://archiveofourown.org/comments/show_comments',
                    {
                        params: { page: page, work_id: workID },
                        headers: JS_HEADERS,
                        maxRedirects: 0, // don't follow redirects
                        validateStatus: s => s < 400,
                    }
                );

            // Extract all .append() and .html() string arguments and join them
            const chunks = [];
            const regex = /\$j\(["'][^"']+["']\)\.(?:html|append)\("([\s\S]*?)"\);/g;
            let match;

            while ((match = regex.exec(data)) !== null) {
                // Only grab the comments_placeholder appends, skip the link replacements
                if (data.slice(match.index, match.index + 60).includes('comments_placeholder')) {
                    chunks.push(match[1]);
                }
            }

            if (chunks.length === 0) {
                console.error('No comment chunks found in response');
                return null;
            }

            // Unescape JS string encoding
            const html = chunks
                .join('')
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '')
                .replace(/\\t/g, '\t')
                .replace(/\\\//g, '/')
                .replace(/\\'/g, "'");

            return cheerio.load(html);
        } catch (error) {
            if (error.response && error.response.status === 525) {
                if (i < MAX_RETRIES) {
                    console.warn(`Encountered 525 error on attempt ${i}. This is an SSL handshake issue. Retrying...`);
                    await delay(TIMER * i);
                }
            } else if (error.response && error.response.status === 429) {
                if (i < MAX_RETRIES) {
                    console.warn(`Encountered 429 error on attempt ${i}. This is a rate limit. Backing off...`);
                    await delay(TIMER * i * 5); // Heavier backoff
                }
            } else if (error.response && error.response.status === 404) {
                throw new NotFoundError(url);
            } else {
                // Maybe it will go away, but if it doesn't, reduce retry attempts
                console.error('Strange error encountered: ', error);
                await delay(TIMER * i * 5);
                i++;
            }
        }
    }

    throw new SSLError(url, MAX_RETRIES);
}

// Remember that ALL functions which call loadPage need to catch these errors
export async function loadPage(url) {
    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            // TODO: Remove this IF getting rate limited and after increasing the TIMER
            const { data } = LOG_IN_TRUE
                ? await client.get(url, { headers: HTML_HEADERS })
                : await axios.get(url, { headers: HTML_HEADERS });

            return cheerio.load(data); // Success, return immediately
        } catch (error) {
            if (error.response && error.response.status === 525) {
                if (i < MAX_RETRIES) {
                    console.warn(`Encountered 525 error on attempt ${i}. This is an SSL handshake issue. Retrying...`);
                    await delay(TIMER * i);
                }
            } else if (error.response && error.response.status === 429) {
                if (i < MAX_RETRIES) {
                    console.warn(`Encountered 429 error on attempt ${i}. This is a rate limit. Backing off...`);
                    await delay(TIMER * i * 5); // Heavier backoff
                }
            } else if (error.response && error.response.status === 404) {
                throw new NotFoundError(url);
            } else {
                // Maybe it will go away, but if it doesn't, reduce retry attempts
                console.error('Strange error encountered: ', error);
                await delay(TIMER * i * 5);
                i++;
            }
        }
    }

    throw new SSLError(url, MAX_RETRIES);
}

export async function login() {
    if (!process.env.LOGIN_USERNAME) {
        throw new Error('LOGIN_USERNAME not set in .env')
    }

    if (!process.env.LOGIN_PASSWORD) {
        throw new Error('LOGIN_PASSWORD not set in .env');
    }

    console.time("logging in");
    const loginUrl = 'https://archiveofourown.org/users/login';

    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            // GET login page to extract authenticity token
            const loginPage = await client.get(loginUrl, { headers: HTML_HEADERS });
            const $ = cheerio.load(loginPage.data);
            const authenticityToken = $('input[name="authenticity_token"]').attr('value');

            // POST login form data with credentials and token
            const loginData = new URLSearchParams();
            loginData.append('user[login]', process.env.LOGIN_USERNAME);
            loginData.append('user[password]', process.env.LOGIN_PASSWORD);
            loginData.append('authenticity_token', authenticityToken);
            loginData.append('commit', 'Log in');

            const response = await client.post(loginUrl, loginData.toString(), { headers: FORM_HEADERS });

            console.timeEnd("logging in");

            // AO3 redirects to the user page on success. If still on /users/login, it failed
            const $check = cheerio.load(response.data);
            const logginSucceed = !$check('form.new_user').length;
            if (!logginSucceed) {
                console.warn('Login POST completed but session does not appear authenticated.');
            }

            return logginSucceed;
        } catch (error) {
            if (error.response && error.response.status === 525) {
                console.warn(`Encountered 525 error on attempt ${i}. This is an SSL handshake issue. Retrying...`);
                await delay(TIMER * i);
            }
        }
    }

    throw new Error(`Failed to log in after ${MAX_RETRIES} attempts due to persistent errors.`);
}
