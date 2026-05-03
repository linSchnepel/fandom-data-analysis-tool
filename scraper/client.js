// Singleton

import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';

const jar = new CookieJar();

const impit = new Impit({
    browser: 'firefox',
    cookieJar: jar,
});

export async function ImpitGet(url, { params, headers, validateStatus, redirect } = {}) {
    const parsed = new URL(url);
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            parsed.searchParams.set(k, v);
        }
    }

    const response = await impit.fetch(parsed, { headers, redirect: redirect });

    if (validateStatus ? !validateStatus(response.status) : response.status >= 400) {
        throw new ImpitError(response);
    }

    const data = await response.text();

    return { data, status: response.status, headers: response.headers };
}

export async function ImpitPost(url, body, { headers, validateStatus, redirect } = {}) {
    const response = await impit.fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect,
    });

    if (validateStatus ? !validateStatus(response.status) : response.status >= 400) {
        throw new ImpitError(response);
    }

    return { data: await response.text(), status: response.status, headers: response.headers };
}

class ImpitError extends Error {
    constructor(response) {
        super(`Request failed: ${response.status}`);
        this.response = response;
    }
}