-- DropIndex
DROP INDEX "Company_tenantId_idx";

-- DropIndex
DROP INDEX "User_tenantId_idx";

-- DropIndex
DROP INDEX "JobAssignment_companyId_idx";

-- DropIndex
DROP INDEX "ApprovalRequest_companyId_idx";

-- DropIndex
DROP INDEX "ChartOfAccount_companyId_idx";

-- DropIndex
DROP INDEX "JournalEntry_companyId_idx";

-- DropIndex
DROP INDEX "ApprovalRoute_tenantId_idx";

-- DropIndex
DROP INDEX "Employee_companyId_idx";

-- DropIndex
DROP INDEX "AuditLog_tenantId_idx";

-- DropIndex
DROP INDEX "Invoice_companyId_idx";

-- DropIndex
DROP INDEX "PayrollRun_companyId_idx";

-- DropIndex
DROP INDEX "Attendance_companyId_idx";

-- DropIndex
DROP INDEX "CustomFieldDef_tenantId_idx";

-- DropIndex
DROP INDEX "Party_companyId_idx";

-- DropIndex
DROP INDEX "PartyAdvance_companyId_idx";

-- DropIndex
DROP INDEX "Item_companyId_idx";

-- DropIndex
DROP INDEX "Store_companyId_idx";

-- DropIndex
DROP INDEX "StockMovement_companyId_idx";

-- DropIndex
DROP INDEX "MaterialRequest_companyId_idx";

-- DropIndex
DROP INDEX "PurchaseOrder_companyId_idx";

-- DropIndex
DROP INDEX "Equipment_companyId_idx";

-- DropIndex
DROP INDEX "MaterialReturn_companyId_idx";

-- DropIndex
DROP INDEX "Cheque_companyId_idx";

-- DropIndex
DROP INDEX "Job_companyId_idx";

-- DropIndex
DROP INDEX "CostCentre_companyId_idx";

-- DropIndex
DROP INDEX "CorporateTaxReturn_companyId_idx";

-- DropIndex
DROP INDEX "Rfq_companyId_idx";

-- DropIndex
DROP INDEX "RfqQuote_rfqId_idx";

-- DropIndex
DROP INDEX "RfqQuoteLine_quoteId_idx";

-- DropIndex
DROP INDEX "StorageBin_storeId_idx";

-- DropIndex
DROP INDEX "Lead_companyId_idx";

-- DropIndex
DROP INDEX "Estimate_companyId_idx";

-- DropIndex
DROP INDEX "Quotation_companyId_idx";

-- CreateIndex
CREATE INDEX "ApprovalRequest_companyId_status_idx" ON "ApprovalRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_partyId_idx" ON "JournalEntry"("partyId");

-- CreateIndex
CREATE INDEX "JournalEntry_reversalOfId_idx" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "Invoice_originalInvoiceId_idx" ON "Invoice"("originalInvoiceId");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_idx" ON "StockMovement"("storeId");

-- CreateIndex
CREATE INDEX "StockMovement_binId_idx" ON "StockMovement"("binId");

-- CreateIndex
CREATE INDEX "StockMovement_partyId_idx" ON "StockMovement"("partyId");

-- CreateIndex
CREATE INDEX "StockMovement_purchaseOrderLineId_idx" ON "StockMovement"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_date_idx" ON "StockMovement"("companyId", "date");

-- CreateIndex
CREATE INDEX "MaterialRequest_storeId_idx" ON "MaterialRequest"("storeId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_storeId_idx" ON "PurchaseOrder"("storeId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_requestId_idx" ON "PurchaseOrder"("requestId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_jobId_idx" ON "PurchaseOrderLine"("jobId");

-- CreateIndex
CREATE INDEX "Equipment_storeId_idx" ON "Equipment"("storeId");

-- CreateIndex
CREATE INDEX "Equipment_jobId_idx" ON "Equipment"("jobId");

-- CreateIndex
CREATE INDEX "MaterialReturn_storeId_idx" ON "MaterialReturn"("storeId");

-- CreateIndex
CREATE INDEX "MaterialReturnLine_movementId_idx" ON "MaterialReturnLine"("movementId");

-- CreateIndex
CREATE INDEX "Job_partyId_idx" ON "Job"("partyId");

-- CreateIndex
CREATE INDEX "Rfq_requestId_idx" ON "Rfq"("requestId");

-- CreateIndex
CREATE INDEX "Rfq_awardedPartyId_idx" ON "Rfq"("awardedPartyId");

-- CreateIndex
CREATE INDEX "RfqLine_itemId_idx" ON "RfqLine"("itemId");

-- CreateIndex
CREATE INDEX "RfqQuoteLine_rfqLineId_idx" ON "RfqQuoteLine"("rfqLineId");

-- CreateIndex
CREATE INDEX "Lead_jobId_idx" ON "Lead"("jobId");

-- CreateIndex
CREATE INDEX "TakeoffLine_itemId_idx" ON "TakeoffLine"("itemId");

-- CreateIndex
CREATE INDEX "Quotation_partyId_idx" ON "Quotation"("partyId");

-- CreateIndex
CREATE INDEX "Quotation_jobId_idx" ON "Quotation"("jobId");

