
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
  const [lastFirebaseUpdate, setLastFirebaseUpdate] = useState<Date | null>(null);
  const [scheduleTriggerAttempts, setScheduleTriggerAttempts] = useState<number>(0);

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
        
        // Check if this is a new schedule action we haven't processed yet
        const actionTime = new Date(latestAction.created_at);
        const isNewAction = !lastFirebaseUpdate || actionTime > lastFirebaseUpdate;
        
        // Show a toast for schedule actions
        if ((latestAction.triggered_by === 'schedule' || 
            latestAction.action === 'schedule_execution_completed') && 
            isNewAction) {
          
          // Highlight the power switch to show the schedule affected it
          setIsScheduleTriggered(true);
          setTimeout(() => setIsScheduleTriggered(false), 5000);
          
          // Update the Firebase state directly for schedules if needed
          if (latestAction.action === 'power_on' || latestAction.action === 'power_off') {
            const newPowerState = latestAction.action === 'power_on';
            
            // Force update regardless of current state to ensure schedule is applied
            console.log(`Schedule detected, forcing update of power state to ${newPowerState ? 'ON' : 'OFF'}`);
            
            try {
              // Update local state to match what the schedule intended
              setScheduleTriggerAttempts(prev => prev + 1);
              
              // Apply update directly to Firebase with retry mechanism
              const updateResult = await setInverterAndLoads(newPowerState, true);
              setLastFirebaseUpdate(new Date());
              
              console.log(`Direct Firebase update result:`, updateResult);
              
              toast({
                title: "Schedule Applied",
                description: `System power set to ${newPowerState ? 'ON' : 'OFF'} by schedule`,
              });
              
              // Log additional information for verification
              await supabase
                .from('scheduled_actions_log')
                .insert({
                  system_id: systemId,
                  action: "schedule_verification",
                  triggered_by: "ui_component",
                  details: { 
                    verified_state: newPowerState,
                    attempt: scheduleTriggerAttempts + 1,
                    component: "PowerSwitch",
                    timestamp: new Date().toISOString()
                  }
                });
            } catch (err) {
              console.error("Failed to apply scheduled power change:", err);
              toast({
                title: "Schedule Error",
                description: `Failed to apply power state: ${err instanceof Error ? err.message : "Unknown error"}`,
                variant: "destructive",
              });
              
              // Try direct Firebase update as backup
              try {
                console.log("Attempting direct Firebase update as fallback...");
                await setDevicePowerState(systemId, newPowerState);
                setLastFirebaseUpdate(new Date());
                
                toast({
                  title: "Schedule Applied (Fallback)",
                  description: `System power set to ${newPowerState ? 'ON' : 'OFF'} by schedule (fallback method)`,
                });
              } catch (fallbackErr) {
                console.error("Fallback method also failed:", fallbackErr);
              }
            }
          } else {
            toast({
              title: success ? "Schedule Executed Successfully" : "Schedule Action Detected",
              description: `System power was set to ${latestAction.action === 'power_on' ? 'ON' : 'OFF'} by a schedule`,
            });
          }
          
          // Enable debug mode temporarily to show more info
          setDebugMode(true);
          setTimeout(() => setDebugMode(false), 10000);
        }
      }
    };
    
    // Initial fetch
    fetchScheduleActions();
    
    // Set up interval to check every 5 seconds (more frequent for better responsiveness)
    const interval = setInterval(fetchScheduleActions, 5000);
    
    return () => clearInterval(interval);
  }, [systemId, setInverterAndLoads, lastFirebaseUpdate, scheduleTriggerAttempts]);

  // Subscribe to device data for real-time updates
  useEffect(() => {
    if (!systemId) return;
    
    const unsubscribe = subscribeToDeviceData(systemId, (data) => {
      console.log(`Received Firebase data for ${systemId}:`, data);
      
      // Update the lastFirebaseUpdate when we get data from Firebase
      if (data) {
        setLastFirebaseUpdate(new Date());
      }
    });
    
    return () => unsubscribe();
  }, [systemId]);

  const handleToggle = async (checked: boolean) => {
    try {
      // Force the update with priority flag
      await setInverterAndLoads(checked, true);
      setLastFirebaseUpdate(new Date());
      
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
        {lastFirebaseUpdate && (
          <div className="text-xs text-gray-400">
            Last sync: {lastFirebaseUpdate.toLocaleTimeString()}
          </div>
        )}
        {scheduleTriggerAttempts > 0 && (
          <div className="text-xs text-orange-400">
            Schedule triggers: {scheduleTriggerAttempts}
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
