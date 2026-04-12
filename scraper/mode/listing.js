// Scrapes the listing pages of AO3, along with history

import fs from 'fs'; // For synchronous methods (like existsSync)
import { fileURLToPath } from 'url';
import path from 'path';

import { NotFoundError, SSLError } from '../error.js';
import { delay, loadPage } from '../essential.js';

// TODO: Reduce duplicate consts
const TIMER = 5000;

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
            return { history: null, historyUNIX: null };
        }
    }
}

// Parse stats into an object
function getStats($, element) {
    const stats = {};
    const elemsStats = element.find('dl.stats dt').toArray();

    for (const dt of elemsStats) {
        const label = $(dt).text().trim().replace(/:/g, '');
        const dd = $(dt).next('dd');

        if (dd.length) {
            // originally accepts the value as a string, but then parses as Int if possible
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
    console.time(`- parsing listing page...`);
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

            // Get stats (bottom line)
            const stats = getStats($, $elem);
            const isMultiChaptered = (stats && stats.Chapters && stats.Chapters != "1/1" && stats.Chapters != "1/?");

            // Get history in a patient manner
            let chapterData = { history: null, historyUNIX: null };
            let workHistoryPatient;
            let workHistoryPromise;

            // If there is more than 1 chapter, then we get history of all chapters
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

        console.timeEnd(`- parsing listing page...`);
        return works;
    }
}

// Requires process.env
// Goes through a number of listing pages, which are scraped and parsed
export async function getListings(fileNames, startPage = 1) {
    // Pre-open a write stream per chunk, reuse across pages
    const streams = new Map();

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const outputDir = path.resolve(__dirname, '../../data/raw');
    fs.mkdirSync(outputDir, { recursive: true }); // No-op if already exists

    const getStream = (chunkIndex) => {
        // Cache / lazy-initialization guard
        if (streams.has(chunkIndex)) {
            return streams.get(chunkIndex);
        }

        const chunkFilePath = path.resolve(__dirname, `../../data/raw/${fileNames}_${chunkIndex}.jsonl`);
        const stream = fs.createWriteStream(chunkFilePath, { flags: 'a', encoding: 'utf8' });
        streams.set(chunkIndex, stream);
        return stream;
    };

    try {
        const PAGE_LIMIT = parseInt(process.env.PAGE_LIMIT, 10);
        if (isNaN(PAGE_LIMIT)) {
            throw new Error('PAGE_LIMIT not set or invalid in .env. Identified limit: ' + process.env.PAGE_LIMIT);
        }

        for (let i = startPage; i <= PAGE_LIMIT; i++) {
            console.info(`We are on page: ${i}/${PAGE_LIMIT} ( ${(i / PAGE_LIMIT) * 100}% )`);
            console.time("Parsing cost");

            const works = await scrapeWorks(process.env.AO3_URL + i);
            if (!works || works.length === 0) {
                // Page returns no works
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
        // Lose the page. The already-written chunks are intact because each stream.write() is already completed
        console.error(error);
    } finally {
        // Close all streams cleanly
        for (const [, stream] of streams) {
            await new Promise(resolve => stream.end(resolve));
        }
    }
}
