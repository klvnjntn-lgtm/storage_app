-- CreateIndex
CREATE INDEX "Stock_organizationId_idx" ON "Stock"("organizationId");

-- CreateIndex
CREATE INDEX "Stock_locationId_idx" ON "Stock"("locationId");

-- CreateIndex
CREATE INDEX "Session_organizationId_createdAt_idx" ON "Session"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionItem_sessionId_idx" ON "SessionItem"("sessionId");

-- CreateIndex
CREATE INDEX "Event_sessionId_productId_type_idx" ON "Event"("sessionId", "productId", "type");

-- CreateIndex
CREATE INDEX "Event_organizationId_createdAt_idx" ON "Event"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_productId_createdAt_idx" ON "Event"("productId", "createdAt");

