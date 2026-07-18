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
          <CardTitle>API</CardTitle>
          <CardDescription>
            Manage your API keys, endpoints, and integration settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Your API dashboard is ready for configuration and monitoring.</p>
          <p>Use this space to connect services and manage request access.</p>
        </CardContent>
      </Card>
    </div>
  );
}
