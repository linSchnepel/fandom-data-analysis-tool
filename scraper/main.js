import dotenv from 'dotenv';
dotenv.config();

import { login } from './essential.js';

import { getListings } from './mode/listing.js';
import { cleanData } from './mode/clean.js';
import { getKudos } from './mode/kudos.js';
import { getComments } from './mode/comment.js';
import { getBookmarks } from './mode/bookmark.js';
import { getHistories } from './mode/history.js';

const LOG_IN_TRUE = (process.env.LOG_IN_TRUE === 'true');

(async () => {
    try {
        let loginSuccess = !LOG_IN_TRUE;

        if (LOG_IN_TRUE) {
            loginSuccess = await login();
        }

        if (loginSuccess) {
            await getListings('output_file', 1);
            //await cleanData('output_file');

            //await getHistories('output_file');
            //await getBookmarks('output_file');
            //await getKudos('output_file');
            //await getComments('output_file');
        } else {
            console.error('Could not login.');
        }
    } catch (error) {
        // Anything unhandled below bubbles up here as a last resort
        console.error('Error in running main:', error);
        process.exit(1); // Explicit exit code so the bat script can detect failure
    }
})();