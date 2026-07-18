-- CreateEnum
CREATE TYPE "TimeTrackerStatus" AS ENUM ('IN_PROGRESS', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "time_trackers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "minutesSpent" INTEGER NOT NULL DEFAULT 0,
    "status" "TimeTrackerStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_trackers_userId_idx" ON "time_trackers"("userId");

-- CreateIndex
CREATE INDEX "time_trackers_taskId_idx" ON "time_trackers"("taskId");

-- AddForeignKey
ALTER TABLE "time_trackers" ADD CONSTRAINT "time_trackers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_trackers" ADD CONSTRAINT "time_trackers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
