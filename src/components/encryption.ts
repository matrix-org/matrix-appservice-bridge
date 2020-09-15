export interface ClientEncryptionSession {
    userId: string;
    deviceId: string;
    accessToken: string;
}
export interface ClientEncryptionStore {
    getStoredSession(userId: string): Promise<ClientEncryptionSession|null>;
    setStoredSession(session: ClientEncryptionSession): Promise<void>;
}