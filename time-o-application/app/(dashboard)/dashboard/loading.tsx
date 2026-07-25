import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** One placeholder per real column: Task, Status, Started, Ended, Minutes, Actions. */
const COLUMN_COUNT = 6;
const ROW_COUNT = 6;

export default function Loading() {
  return (
    <>
      <div className="px-4 lg:px-6">
        <Card className="@container/chart">
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-5 w-28" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-56" />
            </CardDescription>
            <CardAction className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-8 w-20" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[250px] w-full" />
          </CardContent>
        </Card>
      </div>

      <div className="flex w-full flex-col gap-6">
        <div className="flex items-center justify-between px-4 lg:px-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  {Array.from({ length: COLUMN_COUNT }, (_, index) => (
                    <TableHead key={index}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: ROW_COUNT }, (_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: COLUMN_COUNT }, (_, col) => (
                      <TableCell key={col}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-end px-4">
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <Skeleton className="hidden h-8 w-32 lg:block" />
              <Skeleton className="h-4 w-20" />
              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <Skeleton className="size-8" />
                <Skeleton className="size-8" />
                <Skeleton className="size-8" />
                <Skeleton className="size-8" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
