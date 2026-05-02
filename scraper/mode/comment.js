// Scrapes comments given to a work
// Yes it's very similar to kudos.js and likely bookmark.js
// But also slightly different enough that abstraction would be annoying

import { NotFoundError, SSLError } from '../error.js';
import { delay, readingData, writingData, saveData, loadPageComments } from '../essential.js';

const TIMER = 5000;

export async function getComments(fileName) {
    console.time(`Parsing cost Comments`);
    const mode = `COMMENTS`;
    const BATCH_SIZE = 20;
    const buffer = [];
    let totalPages = 0;
    let pagesSinceFlush = 0;

    for await (const record of readingData(fileName)) {
        if (!record || !record.stats || !record.stats.Comments || record.stats.Comments == 0) continue;

        const {comments, pages} = await process(record);
        buffer.push(comments);
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

    console.info(`getComments: processed ${totalPages} pages of data`);
    //await writingData(`${fileName}_CLEAN.jsonl`, `${fileName}_${mode}.jsonl`, `withComments`);
    console.timeEnd(`Parsing cost Comments`);
}

async function process(record) {
    if (!record.id) {
        return {comments: {}, pages: 0};
    } else {
        console.time(`Parsing cost [${record.id} - ${record.title}]`);
        let commentsArray = [];
        let page = 1;
        let lastPage = null;

        do {
            console.log(`Fetching comments page ${page}: ${record.id} - ${record.title}`);

            try {
                let $ = await loadPageComments(record.id, page);

                if (!$) {
                    throw new Error('Could not load page, although no error was thrown');
                } else {
                    $('ol.thread > li.comment.group').each((i, el) => {
                        const $comment = $(el);
                        const commentId = $comment.attr('id')?.replace('comment_', '') || null;
                        const chapter = $comment.find('span.parent a').first().text().trim() || "1";

                        const parentHref = $comment
                            .find('ul.actions a[href*="/comments/"]')
                            .first()
                            .attr('href');

                        const parentId = parentHref && parentHref !== `/comments/${commentId}`
                            ? parentHref.match(/\/comments\/(\d+)/)?.[1]
                            : null;

                        const isChild = (parentId !== null);

                        const day = $comment.find('span.posted.datetime abbr.day').text().trim();
                        const dateNum = $comment.find('span.posted.datetime .date').text().trim();
                        const month = $comment.find('span.posted.datetime abbr.month').text().trim();
                        const year = $comment.find('span.posted.datetime .year').text().trim();
                        const time = $comment.find('span.posted.datetime .time').text().trim();
                        const timezone = $comment.find('span.posted.datetime abbr.timezone').text().trim();
                        const postedDate = `${day} ${dateNum} ${month} ${year} ${time} ${timezone}`;
                        const commentText = $comment.find('blockquote.userstuff').text().trim();

                        const dateObj = parseCustomDate(day, dateNum, month, year, time);
                        const bookmarkDateUNIX = dateObj && !isNaN(dateObj) ? dateObj.getTime() : null;

                        commentsArray.push({
                            id: record.id,
                            commentId,
                            parentId,
                            isChild,
                            chapter,
                            postedDate,
                            postedDateUnix: bookmarkDateUNIX,
                            commentLength: commentText.length,
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
                    console.error('Error scraping comments:', error.message);
                    console.error(`Attempted to access page ${page}.`);
                    console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
                    return {comments: {"id": record.id, "comments": commentsArray}, pages: page};
                }
            }
        } while (page <= lastPage);

        console.timeEnd(`Parsing cost [${record.id} - ${record.title}]`);
        return {comments: {"id": record.id, "comments": commentsArray}, pages: page - 1};
    }
}

function parseCustomDate(day, dateNum, monthStr, year, time12h) {
  // Map month short name to number string with leading zero
  const monthMap = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };

  const month = monthMap[monthStr];
  if (!month) return null;

  // Convert 12h time with AM/PM to 24h format HH:mm:ss
  // input example: "10:28PM" or "03:05AM"
  const timeRegex = /^(\d{1,2}):(\d{2})(AM|PM)$/;
  const match = time12h.match(timeRegex);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const ampm = match[3];

  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const hh = hour.toString().padStart(2, '0');
  
  // Construct ISO string for local time (no timezone)
  const isoString = `${year}-${month}-${dateNum.padStart(2, '0')}T${hh}:${minute}:00`;

  return new Date(isoString);
}