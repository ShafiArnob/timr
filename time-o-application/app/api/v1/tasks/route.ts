import { authenticateRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

/**
 * Lists the tasks a time entry can be logged against, in the owner's manual
 * order. Doubles as the cheapest way for a device to check its key at boot.
 */
export async function GET(request: Request) {
  const result = await authenticateRequest(request);
  if (!result.ok) return result.response;

  try {
    const tasks = await prisma.task.findMany({
      where: { userId: result.auth.userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, value: true, label: true, color: true },
    });

    return apiJson({ tasks });
  } catch (error) {
    console.error("Failed to list tasks via API:", error);
    return apiError("server_error", "Something went wrong. Please try again.");
  }
}
