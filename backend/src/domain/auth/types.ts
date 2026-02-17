export type AuthUser = {
    id: string;
    email: string;
    createdAt: string;
};

export type UserSession = {
    id: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
};
