export interface ProvisionSession {
    userId: string;
    token: string;
    expiresTs: number;
}

export interface ProvisioningStore {
    getSessionForToken(token: string): Promise<ProvisionSession>;
    createSession(session: ProvisionSession): Promise<void>;
    deleteSession(token: string): Promise<void>;
    deleteAllSessions(userId: string): Promise<void>;
}
