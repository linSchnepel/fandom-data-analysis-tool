import dotenv from 'dotenv';
dotenv.config();

import { login } from './essential.js';

import { getListings } from './mode/listing.js';

const LOG_IN_TRUE = (process.env.LOG_IN_TRUE === 'true');

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
        process.exit(1); // Explicit exit code so the bat script can detect failure
    }
})();

// TODO: Add UI