-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill: seed each user's positions from the order the list used before
-- (newest first) so existing rows don't all collapse onto position 0.
WITH "ordered" AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "userId"
            ORDER BY "createdAt" DESC, "id" ASC
        ) - 1 AS "position"
    FROM "tasks"
)
UPDATE "tasks"
SET "position" = "ordered"."position"
FROM "ordered"
WHERE "tasks"."id" = "ordered"."id";

-- DropIndex
DROP INDEX "tasks_userId_idx";

-- CreateIndex
CREATE INDEX "tasks_userId_position_idx" ON "tasks"("userId", "position");
