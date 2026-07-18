import { getTasks } from "@/lib/dal";
import { Timer } from "./timer";

export default async function Page() {
  const tasks = await getTasks();

  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center px-4 lg:px-6">
      <Timer tasks={tasks} />
    </div>
  );
}
