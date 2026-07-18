import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUser } from "@/lib/dal";
import { TimezoneForm } from "./timezone-form";

export default async function Page() {
  const user = await getUser();

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Update your profile, notifications, and app preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Time zone</h3>
            <p className="text-sm text-muted-foreground">
              Choose your country to set the time zone used across the app.
            </p>
          </div>
          <TimezoneForm
            initialCountry={user?.country ?? null}
            initialTimezone={user?.timezone ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
