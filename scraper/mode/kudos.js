// Scrapes kudos given to a work

import { NotFoundError, SSLError } from '../error.js';
import { delay, loadPage, readingData, writingData, saveData } from '../essential.js';

const TIMER = 5000;

// Reads fileName_CLEAN.jsonl, processes records with Kudos,
// batches every 20 into _KUDOS.jsonl, then merges into _withKudos.jsonl
export async function getKudos(fileName) {
    console.time(`Parsing cost Kudos`);
    const mode = `KUDOS`;
    const BATCH_SIZE = 20;
    const buffer = [];
    let totalPages = 0;
    let pagesSinceFlush = 0;

    for await (const record of readingData(fileName)) {
        if (!record || !record.stats || !record.stats.Kudos || record.stats.Kudos == 0) continue;

        // [stats, pages] where flush += pages. Some works can have 1 page and others, 50
        const {kudos, pages} = await process(record);
        buffer.push(kudos);
        totalPages += pages;
        pagesSinceFlush += pages;

        if (pagesSinceFlush >= BATCH_SIZE) {
            await saveData(buffer, `${fileName}_${mode}.jsonl`);
            buffer.length = 0;
        }
    }

    // flush remainder
    if (buffer.length) {
        await saveData(buffer, `${fileName}_${mode}.jsonl`);
    }

    console.info(`getKudos: processed ${totalPages} pages of data`);
    //await writingData(`${fileName}_CLEAN.jsonl`, `${fileName}_${mode}.jsonl`, `withKudos`);
    console.timeEnd(`Parsing cost Kudos`);
}

// {"id":"123", unique dynamic attributes }
async function process(record) {
    if (!record.id) {
        return {kudos: {}, pages: 0};
    } else {
        console.time(`Parsing cost [${record.id} - ${record.title}]`);
        let kudosFromAccounts = 0;
        let page = 1;
        let lastPage = null;

        do {
            const url = `https://archiveofourown.org/works/${record.id}/kudos?page=${page}`;

            console.log(`Fetching Kudos page ${page}: ${record.id} - ${record.title}`);

            try {
                let $ = await loadPage(url);
                if (!$) {
                    throw new Error('Could not load page, although no error was thrown');
                } else {
                    // Parse kudos usernames
                    $('#kudos p.kudos a').each((i, el) => {
                    const username = $(el).text().trim();
                        kudosFromAccounts++;
                    });

                    // Find last page from pagination navigation
                    if (lastPage === null) {
                        lastPage = 1;

                        $('.pagination.actions li a').each((i, elem) => {
                            const numText = $(elem).text().trim();
                            const num = parseInt(numText, 10);

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
                    console.error('Error scraping kudos:', error.message);
                    console.error(`Attempted to access page ${page}.`);
                    console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
                    return {kudos: {"id": record.id, "kudos": {"guestKudos": record.stats.Kudos - kudosFromAccounts, "accountKudos": kudosFromAccounts, "kudosAccounts": kudosFromAccounts}}, pages: page};
                }
            }
        } while (page <= lastPage);

        console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
        return {kudos: {"id": record.id, "kudos": {"guestKudos": record.stats.Kudos - kudosFromAccounts, "accountKudos": kudosFromAccounts, "kudosAccounts": kudosFromAccounts}}, pages: page - 1};
    }
}