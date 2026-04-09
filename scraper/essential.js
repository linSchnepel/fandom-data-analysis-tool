// All files in [mode] use these functions

import axios from "axios" // At top before cookie

import * as cheerio from 'cheerio'; // Parsing and manipulating HTML

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

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
