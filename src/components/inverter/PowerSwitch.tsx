
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
  const [isUpdating, setIsUpdating] = useState(false);

  // Listen for schedule actions on this system with enhanced response
  useEffect(() => {
    if (!systemId) return;
    
    const fetchScheduleActions = async () => {
      try {
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
          const actionTime = new Date(latestAction.created_at);
          const now = new Date();
          const isRecent = (now.getTime() - actionTime.getTime()) < 300000; // Within last 5 minutes
          
          // Only show in debug UI if it's recent
          if (isRecent) {
            setLastScheduleAction(`${latestAction.action} at ${new Date(latestAction.created_at).toLocaleTimeString()}`);
            setLastScheduleData(latestAction);
            setDebugMode(true); // Auto-enable debug mode for recent actions
          }
          
          // Extract success status and target power state from details if available
          let targetPowerState = null;
          
          if (latestAction.details && typeof latestAction.details === 'object') {
            // Try multiple paths to find the target power state
            if ('power_state' in latestAction.details) {
              targetPowerState = latestAction.details.power_state === 1;
            } else if ('power_changed_to' in latestAction.details) {
              targetPowerState = latestAction.details.power_changed_to === "ON";
            } else if ('target_state' in latestAction.details) {
              targetPowerState = latestAction.details.target_state === "ON";
            }
          }
          
          // Determine if this action is new and should trigger an update
          const isNewAction = !lastFirebaseUpdate || actionTime > lastFirebaseUpdate;
          
          // Process power state changes from schedules - with stricter conditions
          if ((latestAction.triggered_by === 'schedule' || 
              latestAction.action === 'schedule_execution_completed' || 
              latestAction.action === 'power_on' || 
              latestAction.action === 'power_off') && 
              isRecent && isNewAction && !isUpdating) {
            
            // Only if we have a definitive target state to apply
            if (targetPowerState !== null && targetPowerState !== inverterState) {
              console.log(`Schedule action detected: ${latestAction.action}, target state: ${targetPowerState}`);
              
              // Highlight the power switch to show the schedule affected it
              setIsScheduleTriggered(true);
              setTimeout(() => setIsScheduleTriggered(false), 10000); // Longer visual feedback
              
              // Prevent duplicate updates
              setIsUpdating(true);
              
              try {
                // Update counter to track attempts
                setScheduleTriggerAttempts(prev => prev + 1);
                
                console.log(`Executing direct Firebase power state update to ${targetPowerState ? 'ON' : 'OFF'}`);
                
                // IMPORTANT: Use direct Firebase update for maximum reliability
                const result = await setDevicePowerState(systemId, targetPowerState, true);
                setLastFirebaseUpdate(new Date());
                
                toast({
                  title: "Schedule Applied",
                  description: `System power set to ${targetPowerState ? 'ON' : 'OFF'} by schedule`,
                });
                
                console.log(`Schedule power update result:`, result);
                
                // Log verification
                await supabase
                  .from('scheduled_actions_log')
                  .insert({
                    system_id: systemId,
                    action: "schedule_verification_success",
                    triggered_by: "power_switch_component",
                    details: { 
                      verified_state: targetPowerState,
                      action_id: latestAction.id,
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
                
                // Log failure
                await supabase
                  .from('scheduled_actions_log')
                  .insert({
                    system_id: systemId,
                    action: "schedule_verification_failure",
                    triggered_by: "power_switch_component",
                    details: { 
                      error: err instanceof Error ? err.message : String(err),
                      action_id: latestAction.id,
                      timestamp: new Date().toISOString()
                    }
                  });
              } finally {
                // Allow updates again after a delay
                setTimeout(() => {
                  setIsUpdating(false);
                }, 30000); // 30 second cooldown between schedule-triggered updates
              }
            } else {
              console.log(`Schedule action detected but no state change needed. Current: ${inverterState}, Target: ${targetPowerState}`);
            }
          }
        }
      } catch (error) {
        console.error("Error in fetchScheduleActions:", error);
      }
    };
    
    // Initial fetch
    fetchScheduleActions();
    
    // Set up interval to check more frequently for better responsiveness
    const interval = setInterval(fetchScheduleActions, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, [systemId, inverterState, lastFirebaseUpdate, scheduleTriggerAttempts, isUpdating]);

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
    if (isUpdating) {
      toast({
        title: "Please wait",
        description: "Another update is in progress",
        variant: "default",
      });
      return;
    }
    
    setIsUpdating(true);
    
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
    } finally {
      setIsUpdating(false);
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
            {inverterState ? "System On" : "System Off"} {isUpdating && "(Updating...)"}
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
        disabled={isUpdating}
        className={`${isScheduleTriggered ? 'ring-2 ring-orange-500' : ''} data-[state=checked]:bg-orange-500`}
      />
    </div>
  );
};
