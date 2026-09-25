-- CreateIndex
CREATE INDEX "sessions_refreshTokenHash_idx" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_previousRefreshTokenHash_idx" ON "sessions"("previousRefreshTokenHash");
