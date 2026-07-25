import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApiKeys, getUser } from "@/lib/dal";
import { ApiKeys, type ApiKeyRow } from "./api-keys";

export default async function Page() {
  const [user, keys] = await Promise.all([getUser(), getApiKeys()]);

  // Dates are serialized to ISO strings so the client component receives
  // plain, deterministic values.
  const rows: ApiKeyRow[] = keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    expired: key.expired,
  }));

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Create a key to reach your time data from outside the app. Keys are
            shown once at creation — we only store a hash.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeys keys={rows} timezone={user?.timezone ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
