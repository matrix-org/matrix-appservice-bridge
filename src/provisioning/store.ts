import { ApiError, ErrCode } from ".";

export interface ProvisionSession {
    userId: string;
    token: string;
    expiresTs: number;
}


export interface ProvisioningStore {
    getSessionForToken(token: string): Promise<ProvisionSession|null>|ProvisionSession|null;
    createSession(session: ProvisionSession): Promise<void>|void;
    deleteSession(token: string): Promise<void>|void;
    deleteAllSessions(userId: string): Promise<void>|void;
}

export class MemoryProvisioningStore implements ProvisioningStore {
    private readonly sessions = new Map<string, ProvisionSession>();

    public getSessionForToken(token: string): ProvisionSession|null {
        const session = this.sessions.get(token);
        if (!session) {
            return null;
        }
        return session;
    }

    public createSession(session: ProvisionSession): void {
        if (this.sessions.has(session.token)) {
            // Should be nearly impossible, but let's be safe
            throw Error('Token conflict!');
        }
        this.sessions.set(session.token, session);
    }

    public deleteSession(token: string): void {
        this.sessions.delete(token);
    }

    public deleteAllSessions(userId: string): void {
        [...this.sessions.values()].filter((s) => s.userId === userId).forEach(s => this.sessions.delete(s.token));
    }
}
