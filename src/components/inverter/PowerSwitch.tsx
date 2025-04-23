
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Power } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { subscribeToDeviceData, setDevicePowerState } from "@/integrations/firebase/client";
import { supabase } from "@/integrations/supabase/client";
import { useInverterAndLoadsSwitches } from "./useInverterAndLoadsSwitches";

interface PowerSwitchProps {
  inverterId: string;
  initialState?: boolean;
}

export const PowerSwitch = ({ inverterId, initialState = false }: PowerSwitchProps) => {
  const {
    inverterState,
    setInverterAndLoads,
    systemId,
  } = useInverterAndLoadsSwitches(inverterId);
  
  const [lastScheduleAction, setLastScheduleAction] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [isScheduleTriggered, setIsScheduleTriggered] = useState(false);

  // Listen for schedule actions on this system
  useEffect(() => {
    if (!systemId) return;
    
    const fetchScheduleActions = async () => {
      const { data, error } = await supabase
        .from('scheduled_actions_log')
        .select('*')
        .eq('system_id', systemId)
        .order('created_at', { ascending: false })
        .limit(1);
        
      if (error) {
        console.error('Error fetching schedule actions:', error);
        return;
      }
      
      if (data && data.length > 0) {
        const latestAction = data[0];
        setLastScheduleAction(`${latestAction.action} at ${new Date(latestAction.created_at).toLocaleTimeString()}`);
        
        // Extract success status from details if available
        let success = false;
        if (latestAction.details && 
            typeof latestAction.details === 'object' && 
            'success' in latestAction.details) {
          success = Boolean(latestAction.details.success);
        }
        
        // Show a toast for schedule actions
        if (latestAction.triggered_by === 'schedule' || latestAction.action === 'schedule_execution_completed') {
          // Highlight the power switch to show the schedule affected it
          setIsScheduleTriggered(true);
          setTimeout(() => setIsScheduleTriggered(false), 5000);
          
          toast({
            title: success ? "Schedule Executed Successfully" : "Schedule Action Detected",
            description: `System power was set to ${latestAction.action === 'power_on' ? 'ON' : 'OFF'} by a schedule`,
          });
          
          // Enable debug mode temporarily to show more info
          setDebugMode(true);
          setTimeout(() => setDebugMode(false), 10000);
        }
      }
    };
    
    // Initial fetch
    fetchScheduleActions();
    
    // Set up interval to check every 10 seconds (more frequent for better responsiveness)
    const interval = setInterval(fetchScheduleActions, 10000);
    
    return () => clearInterval(interval);
  }, [systemId]);

  const handleToggle = async (checked: boolean) => {
    try {
      await setInverterAndLoads(checked);
      toast({
        title: checked ? "Inverter turned ON" : "Inverter turned OFF",
        description: `System ${inverterId} power state changed (all states sent)`,
      });
    } catch (error: any) {
      console.error('Error updating power state:', error);
      toast({
        title: "Error updating power state",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className={`flex items-center justify-between p-4 
      ${isScheduleTriggered ? 'bg-orange-500/30 border border-orange-500 animate-pulse' : 
       debugMode ? 'bg-orange-500/20 border border-orange-500/50' : 'bg-black/40'} 
      rounded-lg transition-all duration-300`}>
      <div className="flex flex-col">
        <div className="flex items-center space-x-2">
          <Power className={`h-5 w-5 ${inverterState ? "text-orange-500" : "text-gray-500"}`} />
          <Label htmlFor={`power-switch-${inverterId}`} className="text-white">
            {inverterState ? "System On" : "System Off"}
          </Label>
        </div>
        {lastScheduleAction && (
          <div className="text-xs text-gray-400 mt-1">
            Last automated action: {lastScheduleAction}
          </div>
        )}
      </div>
      <Switch
        id={`power-switch-${inverterId}`}
        checked={inverterState}
        onCheckedChange={handleToggle}
        className={`${isScheduleTriggered ? 'ring-2 ring-orange-500' : ''} data-[state=checked]:bg-orange-500`}
      />
    </div>
  );
};
