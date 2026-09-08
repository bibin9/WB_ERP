-- CreateIndex
CREATE INDEX "CompanyMembership_roleId_idx" ON "CompanyMembership"("roleId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_date_idx" ON "JournalEntry"("companyId", "date");

-- CreateIndex
CREATE INDEX "Attendance_companyId_date_idx" ON "Attendance"("companyId", "date");

