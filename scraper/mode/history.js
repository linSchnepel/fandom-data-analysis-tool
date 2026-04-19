// Scrapes bookmarks given to a work

import { NotFoundError, SSLError } from '../error.js';
import { delay, loadPage, readingData, writingData, saveData } from '../essential.js';

const TIMER = 5000;

export async function getHistories(fileName) {
    const mode = `HISTORIES`;
    const BATCH_SIZE = 20;
    const buffer = [];

    for await (const record of readingData(fileName)) {
        if (!record || !record.stats.Chapters || !record.stats.Chapters || record.stats.Chapters == "1/?" || record.stats.Chapters.match(/1\/\d/)) continue;

        const {histories} = await process(record);
        buffer.push(histories);

        if (buffer.length >= BATCH_SIZE) {
            await saveData(buffer, `${fileName}_${mode}.jsonl`);
            buffer.length = 0;
        }
    }

    if (buffer.length) {
        await saveData(buffer, `${fileName}_${mode}.jsonl`);
    }

    //await writingData(`${fileName}_CLEAN.jsonl`, `${fileName}_${mode}.jsonl`, `withHistories`);
}

async function process(record) {
    if (!record.id) {
        return {histories: {}};
    } else {
        console.time(`Parsing cost [${record.id} - ${record.title}]`);
        let history = [];
        let historyUNIX = [];

        const url = `https://archiveofourown.org/works/${record.id}/navigate`;

        console.log(`Fetching histories: ${record.id} - ${record.title}`);

        try {
            let $ = await loadPage(url);

            if (!$) {
                throw new Error('Could not load page, although no error was thrown');
            } else {
                const elemsHistory = $('ol.chapter.index.group li a').toArray();

                for (const elem of elemsHistory) {
                    const dateText = $(elem).next('span.datetime').text().trim(); // e.g. (YYYY-MM-DD)
                    const dateSanitized = dateText.replace(/[()]/g, '');
                    history.push(dateSanitized);

                    const dateObj = new Date(dateSanitized);
                    historyUNIX.push(!isNaN(dateObj) ? dateObj.getTime() : null);
                }

                // Delay between requests
                await delay(TIMER);
            }
        } catch (error) {
            if (error instanceof NotFoundError) {
                console.warn(`Skipping page ${url}: page not found.`);
            } else if (!(error instanceof SSLError)) {
                console.error('Error scraping histories:', error.message);
                console.error(`Attempted to access page ${url}.`);
                console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
                return {histories: {"id": record.id, "history": history, "historyUNIX": historyUNIX}};
            }
        }

        console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
        return {histories: {"id": record.id, "history": history, "historyUNIX": historyUNIX}};
    }
}