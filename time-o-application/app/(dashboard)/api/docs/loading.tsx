import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function DocCard({
  titleWidth,
  descriptionLines,
  bodyHeight,
}: {
  titleWidth: string;
  descriptionLines: number;
  bodyHeight: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Skeleton className={`h-5 ${titleWidth}`} />
        </CardTitle>
        <CardDescription className="space-y-1.5">
          {Array.from({ length: descriptionLines }, (_, index) => (
            <Skeleton
              key={index}
              className={`h-4 w-full ${index === descriptionLines - 1 ? "max-w-sm" : "max-w-xl"}`}
            />
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Skeleton className={`w-full ${bodyHeight}`} />
      </CardContent>
    </Card>
  );
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
      <DocCard titleWidth="w-28" descriptionLines={2} bodyHeight="h-16" />
      <DocCard titleWidth="w-36" descriptionLines={2} bodyHeight="h-12" />
      <DocCard titleWidth="w-24" descriptionLines={2} bodyHeight="h-40" />
      <DocCard titleWidth="w-20" descriptionLines={2} bodyHeight="h-32" />
      <DocCard titleWidth="w-28" descriptionLines={2} bodyHeight="h-48" />
      <DocCard titleWidth="w-52" descriptionLines={2} bodyHeight="h-56" />
    </div>
  );
}
