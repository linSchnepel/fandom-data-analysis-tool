export  class NotFoundError extends Error {
    constructor(url) {
        super(`Page not found: ${url}`);
        this.name = 'NotFoundError';
        this.url = url;
    }
}

export class SSLError extends Error {
    constructor(url, attempts) {
        super(`SSL handshake failed after ${attempts} attempts: ${url}`);
        this.name = 'SSLError';
        this.url = url;
    }
}
