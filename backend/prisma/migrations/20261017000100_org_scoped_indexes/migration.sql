-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_paidAt_idx" ON "SupplierPayment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "IntegrationConnection_organizationId_idx" ON "IntegrationConnection"("organizationId");

-- CreateIndex
CREATE INDEX "ExternalOrder_organizationId_status_createdAt_idx" ON "ExternalOrder"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceEditEvent_organizationId_createdAt_idx" ON "InvoiceEditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrderActivityEvent_salesOrderId_idx" ON "SalesOrderActivityEvent"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderActivityEvent_organizationId_createdAt_idx" ON "SalesOrderActivityEvent"("organizationId", "createdAt");
