export class ClientError extends Error {
    constructor(message: string, public status = 400) { super(message); this.name = 'ClientError'; }
}
export function publicError(error: unknown, fallback = 'Unable to complete this request.') { return error instanceof ClientError ? error.message : fallback; }
