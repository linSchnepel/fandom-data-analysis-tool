// Scrapes bookmarks given to a work

import { NotFoundError, SSLError } from '../error.js';
import { delay, loadPage, readingData, writingData, saveData } from '../essential.js';

const TIMER = 5000;

export async function getBookmarks(fileName) {
    console.time(`Parsing cost Bookmarks`);
    const mode = `BOOKMARKS`;
    const BATCH_SIZE = 20;
    const buffer = [];
    let totalPages = 0;
    let pagesSinceFlush = 0;

    for await (const record of readingData(fileName)) {
        if (!record || !record.stats || !record.stats.Bookmarks || record.stats.Bookmarks == 0) continue;

        const {bookmarks, pages} = await process(record);
        buffer.push(bookmarks);
        totalPages += pages;
        pagesSinceFlush += pages;

        if (pagesSinceFlush >= BATCH_SIZE) {
            await saveData(buffer, `${fileName}_${mode}.jsonl`);
            buffer.length = 0;
            pagesSinceFlush = 0;
        }
    }

    if (buffer.length) {
        await saveData(buffer, `${fileName}_${mode}.jsonl`);
    }

    console.info(`getBookmarks: processed ${totalPages} pages of data`);
    //await writingData(`${fileName}_CLEAN.jsonl`, `${fileName}_${mode}.jsonl`, `withBookmarks`);
    console.timeEnd(`Parsing cost Bookmarks`);
}

async function process(record) {
    if (!record.id) {
        return {bookmarks: {}, pages: 0};
    } else {
        console.time(`Parsing cost [${record.id} - ${record.title}]`);
        let bookmarksArray = [];
        let page = 1;
        let lastPage = null;

        do {
            const url = `https://archiveofourown.org/works/${record.id}/bookmarks?page=${page}`;

            console.log(`Fetching bookmarks page ${page}: ${record.id} - ${record.title}`);

            try {
                let $ = await loadPage(url);

                if (!$) {
                    throw new Error('Could not load page, although no error was thrown');
                } else {
                    // Parse bookmark users and their collections/tags
                    $('li.user.short.blurb.group').each((i, el) => {
                        const username = $(el).find('.header.module h5.byline.heading a').text().trim();

                        const bookmarkDate = $(el).find('.header.module p.datetime').text().trim().replace(/[()]/g, '');
                        const dateObj = new Date(bookmarkDate);
                        const bookmarkDateUNIX = !isNaN(dateObj) ? dateObj.getTime() : null;

                        // Extract collections, if present
                        let collections = [];
                        $(el).find('h6.meta.heading:contains("Bookmark Collections:")').next('ul.meta.commas').find('li a').each((i, coll) => {
                            collections.push($(coll).text().trim());
                        });

                        // Extract tags, if present
                        let tags = [];
                        $(el).find('h6.meta.heading:contains("Bookmark Tags:")').next('ul.meta.tags.commas').find('li a.tag').each((i, tag) => {
                            tags.push($(tag).text().trim());
                        });

                        // Extract notes text (may contain multiple paragraphs, join with newline)
                        let notes = [];
                        $(el).find('h6.landmark.heading:contains("Bookmark Notes:")').next('blockquote.userstuff.summary').find('p').each((i, p) => {
                            notes.push($(p).text().trim());
                        });
                        const notesText = notes.join('\n');

                        bookmarksArray.push({
                            username,
                            bookmarkDate,
                            bookmarkDateUNIX,
                            collections,
                            tags,
                            notes: notesText,
                        });
                    });

                    if (lastPage === null) {
                        lastPage = 1;

                        $('.pagination.actions li a').each((i, elem) => {
                            let numText = $(elem).text().trim();
                            let num = parseInt(numText, 10);

                            if (!isNaN(num) && num > lastPage) {
                                lastPage = num;
                            }
                        });
                    }

                    page++;

                    // Delay between requests
                    await delay(TIMER);
                }
            } catch (error) {
                if (error instanceof NotFoundError) {
                    console.warn(`Skipping page ${page}: page not found.`);
                } else if (!(error instanceof SSLError)) {
                    console.error('Error scraping bookmarks:', error.message);
                    console.error(`Attempted to access page ${page}.`);
                    console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
                    return {bookmarks: {"id": record.id, "bookmarks": bookmarksArray}, pages: page};
                }
            }
        } while (page <= lastPage);

        console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
        return {bookmarks: {"id": record.id, "bookmarks": bookmarksArray}, pages: page - 1};
    }
}