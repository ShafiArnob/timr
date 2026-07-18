import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Timer</CardTitle>
          <CardDescription>
            Track time spent on tasks and review your sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Start, pause, and stop timers for your work.</p>
          <p>This space is ready for the timer feature to be built out.</p>
        </CardContent>
      </Card>
    </div>
  );
}
