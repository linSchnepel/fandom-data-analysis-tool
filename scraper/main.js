import dotenv from 'dotenv';
dotenv.config();

import axios from "axios" // At top before cookie

import fs from 'fs'; // For synchronous methods (like existsSync)
import * as cheerio from 'cheerio'; // Parsing and manipulating HTML

import { CookieJar } from 'tough-cookie' // For logging in
import { wrapper } from 'axios-cookiejar-support';

const jar = new CookieJar();

const client = wrapper(axios.create({
  jar,
  withCredentials: true,
  // axios-cookiejar-support removes the need for a different agent
}));

const LOG_IN_TRUE = (process.env.LOG_IN_TRUE === 'true');

const MAX_RETRIES = 20;
const TIMER = 10000;

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

class NotFoundError extends Error {
    constructor(url) {
        super(`Page not found: ${url}`);
        this.name = 'NotFoundError';
        this.url = url;
    }
}

class SSLError extends Error {
    constructor(url, attempts) {
        super(`SSL handshake failed after ${attempts} attempts: ${url}`);
        this.name = 'SSLError';
        this.url = url;
    }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Remember that ALL functions which call loadPage need to catch these errors
async function loadPage(url) {
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

// Must always return the shape: { history: null, historyUNIX: null }
async function scrapeHistory(workId) {
    console.time(`- gathering history... (${workId})`);
    const url = `https://archiveofourown.org/works/${workId}/navigate`;

    try {
        let $ = await loadPage(url);

        if (!$) {
            console.timeEnd(`- gathering history... (${workId})`);
            return { history: null, historyUNIX: null };
        } else {
            const history = [];
            const historyUNIX = [];

            const elemsHistory = $('ol.chapter.index.group li a').toArray();
            for (const elem of elemsHistory) {
                const dateText = $(elem).next('span.datetime').text().trim(); // e.g. (YYYY-MM-DD)
                const dateSanitized = dateText.replace(/[()]/g, '');
                history.push(dateSanitized);

                const dateObj = new Date(dateSanitized);
                historyUNIX.push(!isNaN(dateObj) ? dateObj.getTime() : null);
            }

            console.timeEnd(`- gathering history... (${workId})`);
            return { history, historyUNIX };
        }
    } catch (error) {
        if (error instanceof NotFoundError) {
            console.warn(`Skipping ${url}: page not found.`);
            return [];
        } else if (!(error instanceof SSLError)) {
            console.error('Error scraping history:', error.message);
            console.error(`Page attempted to access: ${url}`);

            console.timeEnd(`- gathering history... (${workId})`);
            return { history: null, historyUNIX: null };
        }
    }
}

// Parses stats into an object
function getStats($, element) {
    const stats = {};
    const elemsStats = element.find('dl.stats dt').toArray();

    for (const dt of elemsStats) {
        const label = $(dt).text().trim().replace(/:/g, '');
        const dd = $(dt).next('dd');

        if (dd.length) {
            // Originally accepts the value as a string, but then parses as Int if possible
            let value = dd.text().trim();

            if (label === 'Words' || label === 'Comments' || label === 'Kudos' || label === 'Bookmarks' || label === 'Hits') {
                value = parseInt(value.replace(/,/g, ''), 10);
            }

            stats[label] = value;
        } else {
            stats[label] = null;
        }
    }

    return stats;
}

function getSquareData($, elements) {
    let rating = null;
    let warnings = [];
    let category = [];
    let completion = null;

    for (const el of elements) {
        const $el = $(el);

        if (!$el.length) {
            continue;
        }

        if ($el.hasClass('rating')) {
            rating = $el.text().trim() || null;
        } else if ($el.hasClass('warnings')) {
            let text = $el.text().trim();

            if (text) {
                warnings = text ? text.split(', ') : [];
            }
        } else if ($el.hasClass('category')) {
            let text = $el.text().trim();

            if (text) {
                category = text ? text.split(', ') : [];
            }
        } else if ($el.hasClass('iswip') || $el.hasClass('complete-yes') || $el.hasClass('complete-no')) {
            completion = $el.text().trim() || null;
        }
    }

    return { rating, warnings, category, completion };
}

// Load a page of 20 works, return a list of works
async function scrapeWorks(url) {
    let $;

    try {
        $ = await loadPage(url);
    } catch (error) {
        if (error instanceof NotFoundError) {
            console.warn(`Skipping ${url}: page not found.`);
            return [];
        }
    }

    // Touched, thus give Ao3 a rest
    await delay(TIMER);

    if (!$) {
        return [];
    } else {
        // Get all 20 works
        const elems = $('ol.work.index.group li[role=article]').toArray();
        let works = [];

        for (const elem of elems) {
            const $elem = $(elem);

            // -- synchronous chunk begin
            // Get ID
            const rawId = $elem.attr('id');
            const workId = rawId ? rawId.replace(/^work_/, '') : null;

            console.info(`scraping '${workId}' : "null"}`);

            // Get stats (bottom line)
            const stats = getStats($, $elem);
            const isMultiChaptered = (stats && stats.Chapters && stats.Chapters != "1/1" && stats.Chapters != "1/?");

            // Get history in a patient manner
            let chapterData = { history: null, historyUNIX: null };
            let workHistoryPatient;
            let workHistoryPromise;

            // If there is more than 1 chapter, then get history of all chapters
            if (isMultiChaptered) {
                workHistoryPatient = delay(TIMER);
                workHistoryPromise = scrapeHistory(workId);
            }

            // Get most recent update
            const updateEl = $elem.find('p.datetime').first();
            const update = (updateEl && updateEl.length) ? updateEl.text().trim() : null;

            let updateUNIX = null;
            if (update) {
                const dateObj = new Date(update);
                updateUNIX = !isNaN(dateObj) ? dateObj.getTime() : null;

                // If there is only one chapter, then update is same as history
                if (!isMultiChaptered && update) {
                    chapterData.history = [update];
                    chapterData.historyUNIX = [updateUNIX]
                }
            }
            // -- synchronous chunk end

            // Get square data
            const {rating, warnings, category, completion} = getSquareData($, $elem.find('ul.required-tags li a span').toArray());

            // Get fandoms
            const fandoms = [];
            const elemsFandoms = $elem.find('h5.fandoms.heading a.tag').toArray();

            for (const el of elemsFandoms) {
                const fandomName = $(el).text().trim();

                if (fandomName) {
                    fandoms.push(fandomName);
                }
            }

            // Get tags
            const tags = [];
            const elemsTags = $elem.find('ul.tags.commas li').toArray();

            for (const el of elemsTags) {
                const tagText = $(el).text().trim();

                if (tagText) {
                    tags.push(tagText);
                }
            }

            // Consolidate the promises
            if (isMultiChaptered) {
                await workHistoryPatient;

                try {
                    chapterData = await workHistoryPromise;
                } catch (error) {
                    if (error instanceof NotFoundError) {
                        console.error(`History not found for work ${workId}. Skipped.`);
                        chapterData = { history: null, historyUNIX: null };
                    }
                    // Anything else will propagate up to scrapeWorks
                }
            }
            
            works.push({
                id: workId,
                rating,
                warnings,
                category,
                tags,
                fandoms,
                completion,
                restricted: $elem.find('img[alt="(Restricted)"][title="Restricted"]').length > 0,
                stats,
                update,
                updateUNIX,
                ...chapterData,
            });
        };

        return works;
    }
}

// Goes through a number of listing pages, which are scraped and parsed
async function getListings(fileNames, startPage = 1) {
    // Pre-open a write stream per chunk, reuse across pages
    const streams = new Map();

    const getStream = (chunkIndex) => {
        // Cache / lazy-initialization guard
        if (streams.has(chunkIndex)) {
            return streams.get(chunkIndex);
        }

        const chunkFilePath = `${fileNames}_${chunkIndex}.jsonl`;
        const stream = fs.createWriteStream(chunkFilePath, { flags: 'a', encoding: 'utf8' });
        streams.set(chunkIndex, stream);
        return stream;
    };

    try {
        const PAGE_LIMIT = parseInt(process.env.PAGE_LIMIT, 10);
        if (isNaN(PAGE_LIMIT)) {
            throw new Error('PAGE_LIMIT not set or invalid in .env');
        }

        for (let i = startPage; i <= PAGE_LIMIT; i++) {
            console.info(`We are on page: ${i}/${PAGE_LIMIT} ( ${(i / PAGE_LIMIT) * 100}% )`);
            console.time("Parsing cost");

            const works = await scrapeWorks(process.env.AO3_URL + i);
            if (!works || works.length === 0) {
                // Page returned no works
                console.warn('Scraper ended before the page limit due to lack of works.')
                console.timeEnd("Parsing cost");
                break;
            } else if (works && works.length < 20) {
                // If PAGE_LIMIT is accurate, then this is redundant
                console.warn('This is the last page of works.')
                i = PAGE_LIMIT;
            }

            const chunkIndex = Math.floor(i / 5);
            const stream = getStream(chunkIndex);

            // Write each work as a separate line. No need to read existing data
            for (const work of works) {
                stream.write(JSON.stringify(work) + '\n');
            }

            console.info(`Added ${works.length} new works to chunk ${chunkIndex}`);
            console.timeEnd("Parsing cost");
        }
    } catch (error) {
        console.timeEnd("Parsing cost");
        // Lose the page. The already-written chunks are intact because each stream.write() are already completed
        console.error(`Fatal error on page ${i}. Resume from page ${i} to retry.`);
    } finally {
        // Close all streams cleanly
        for (const [, stream] of streams) {
            await new Promise(resolve => stream.end(resolve));
        }
    }
}

async function login() {
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

            //  put ...headers first, then Content-Type, so explicit content type wins but cookies managed by the jar aren't interfered with
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

(async () => {
    try {
        let loginSuccess = !LOG_IN_TRUE;

        if (LOG_IN_TRUE) {
            loginSuccess = await login();
        }

        if (loginSuccess) {
            await getListings('output_file', 1);
        } else {
            console.error('Could not login.');
        }
    } catch (error) {
        // Anything unhandled below bubbles up here as a last resort
        console.error('Error in running main:', error);
        process.exit(1); // explicit exit code so the bat script can detect failure
    }
})();
