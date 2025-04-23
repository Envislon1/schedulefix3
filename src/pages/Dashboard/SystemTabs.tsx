
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PowerSwitch } from "@/components/inverter/PowerSwitch";

export const SystemTabs = ({ inverterId }) => {
  return (
    <div className="space-y-4">
      <PowerSwitch inverterId={inverterId} initialState={true} />
    </div>
  );
};
