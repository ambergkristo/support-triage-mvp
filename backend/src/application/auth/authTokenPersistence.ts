import type { GoogleTokens } from "../../infrastructure/auth/tokenStore";

export function mergeTokensForPersistence(params: {
    nextTokens: GoogleTokens;
    currentTokens?: GoogleTokens | null;
    persistedTokens?: GoogleTokens | null;
}): GoogleTokens {
    const { nextTokens, currentTokens, persistedTokens } = params;
    const existingRefreshToken =
        nextTokens.refresh_token ??
        currentTokens?.refresh_token ??
        persistedTokens?.refresh_token;

    return {
        ...currentTokens,
        ...nextTokens,
        ...(existingRefreshToken ? { refresh_token: existingRefreshToken } : {}),
    };
}
