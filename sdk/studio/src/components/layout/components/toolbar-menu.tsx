import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ToolbarMenu() {
  return (
    <div className="flex items-stretch">
      <Tabs defaultValue="overview" className="text-sm text-muted-foreground">
        <TabsList size="xs">
          <TabsTrigger value="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="permissions">
            Permissions
          </TabsTrigger>
          <TabsTrigger value="billing">
            Billing
          </TabsTrigger>
          <TabsTrigger value="members">
            Members
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
