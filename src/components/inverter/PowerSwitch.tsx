
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
  const [lastScheduleData, setLastScheduleData] = useState<any>(null);

  // Listen for schedule actions on this system with enhanced response
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
        setLastScheduleData(latestAction);
        
        // Extract success status and target power state from details if available
        let success = false;
        let targetPowerState = null;
        
        if (latestAction.details && typeof latestAction.details === 'object') {
          if ('success' in latestAction.details) {
            success = Boolean(latestAction.details.success);
          }
          
          // Try multiple paths to find the target power state
          if ('power_state' in latestAction.details) {
            targetPowerState = Boolean(latestAction.details.power_state);
          } else if ('power_changed_to' in latestAction.details) {
            targetPowerState = latestAction.details.power_changed_to === "ON";
          } else if ('target_state' in latestAction.details) {
            targetPowerState = latestAction.details.target_state === "ON";
          }
        }
        
        // Determine if this action is new (hasn't been processed yet)
        const actionTime = new Date(latestAction.created_at);
        const now = new Date();
        const isRecent = (now.getTime() - actionTime.getTime()) < 60000; // Within last minute
        const isNewAction = !lastFirebaseUpdate || actionTime > lastFirebaseUpdate;
        
        // Process power state changes from schedules
        if ((latestAction.triggered_by === 'schedule' || 
            latestAction.action === 'schedule_execution_completed' || 
            latestAction.action === 'power_on' || 
            latestAction.action === 'power_off') && 
            isRecent && isNewAction) {
          
          // Highlight the power switch to show the schedule affected it
          setIsScheduleTriggered(true);
          setTimeout(() => setIsScheduleTriggered(false), 5000);
          
          // Determine the target power state
          const actionBasedPowerState = 
            latestAction.action === 'power_on' ? true : 
            latestAction.action === 'power_off' ? false : 
            targetPowerState;
          
          // Only update if we have a clear target state
          if (actionBasedPowerState !== null) {
            console.log(`Schedule detected, updating power state to ${actionBasedPowerState ? 'ON' : 'OFF'}`);
            
            try {
              // Update counter to track attempts
              setScheduleTriggerAttempts(prev => prev + 1);
              
              // Force immediate UI update to match the schedule's intent
              if (actionBasedPowerState !== inverterState) {
                // Force full sync with Firebase to ensure proper state
                const updateResult = await setInverterAndLoads(actionBasedPowerState, true);
                setLastFirebaseUpdate(new Date());
                
                console.log(`Schedule-triggered power state update result:`, updateResult);
                
                toast({
                  title: "Schedule Applied",
                  description: `System power set to ${actionBasedPowerState ? 'ON' : 'OFF'} by schedule`,
                });
              }
              
              // Log additional information for verification
              await supabase
                .from('scheduled_actions_log')
                .insert({
                  system_id: systemId,
                  action: "schedule_verification",
                  triggered_by: "power_switch_component",
                  details: { 
                    verified_state: actionBasedPowerState,
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
              
              // Direct Firebase fallback
              try {
                console.log("Attempting direct Firebase update as fallback...");
                await setDevicePowerState(systemId, actionBasedPowerState);
                setLastFirebaseUpdate(new Date());
                
                toast({
                  title: "Schedule Applied (Fallback)",
                  description: `System power set to ${actionBasedPowerState ? 'ON' : 'OFF'} by schedule (fallback method)`,
                });
              } catch (fallbackErr) {
                console.error("Fallback method also failed:", fallbackErr);
              }
            }
          } else if (success) {
            toast({
              title: "Schedule Action Detected",
              description: `System power was updated by a schedule`,
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
    
    // Set up interval to check more frequently for better responsiveness
    const interval = setInterval(fetchScheduleActions, 3000); // Check every 3 seconds
    
    return () => clearInterval(interval);
  }, [systemId, setInverterAndLoads, lastFirebaseUpdate, scheduleTriggerAttempts, inverterState]);

  // Subscribe to device data for real-time updates with improved responsiveness
  useEffect(() => {
    if (!systemId) return;
    
    const unsubscribe = subscribeToDeviceData(systemId, (data) => {
      console.log(`PowerSwitch received Firebase data for ${systemId}:`, data);
      
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
