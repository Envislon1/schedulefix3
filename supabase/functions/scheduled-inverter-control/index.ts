
// This function runs on a schedule to control inverter power state based on timing rules
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-database.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Set up CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScheduledControlParams {
  system_id: string;
  state: boolean;
  user_email?: string;
  schedule_id?: string;
  trigger_time?: string;
  test_mode?: boolean; // Added for debugging
  manual_execution?: boolean; // Flag for direct manual execution
  diagnostic_check?: boolean; // Added to support connection checks
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key to bypass RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Initialize Firebase
    const firebaseConfig = {
      apiKey: "AIzaSyCaJJ-2ExS5uGcH7jQ_9jwbHFIKLrj8J54",
      databaseURL: "https://powerverter-pro-default-rtdb.firebaseio.com/",
    };
    
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const database = getDatabase(app);
    
    // Get the request body
    const { system_id, state, user_email, schedule_id, trigger_time, test_mode, manual_execution, diagnostic_check } = await req.json() as ScheduledControlParams;
    
    const now = new Date();
    const executionTime = now.toISOString();
    
    console.log(`[DEBUG] Received request to set system ${system_id} power state to ${state ? "ON" : "OFF"} from ${user_email || "unknown"}`);
    console.log(`[DEBUG] Schedule details: ID=${schedule_id || "manual"}, Trigger time=${trigger_time || "manual"}, Current time=${executionTime}`);
    console.log(`[DEBUG] Execution type: ${manual_execution ? "Manual execution" : "Scheduled"}, Test mode: ${test_mode ? "YES" : "NO"}`);

    // If this is a diagnostic check only, just verify Firebase connection
    if (diagnostic_check) {
      console.log(`[DEBUG] Running diagnostic check for system ${system_id}`);
      
      try {
        // Just retrieve the data to verify connection
        const firebasePath = `/_${system_id}`;
        const systemRef = ref(database, firebasePath);
        const snapshot = await get(systemRef);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            connection_status: "Connected successfully to Firebase",
            timestamp: executionTime,
            data_exists: snapshot.exists()
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (diagError) {
        console.error("[ERROR] Diagnostic check failed:", diagError);
        return new Response(
          JSON.stringify({ 
            success: false, 
            connection_status: `Connection failed: ${diagError.message}`,
            timestamp: executionTime
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    if (!system_id) {
      console.error("[ERROR] Missing system_id parameter");
      return new Response(
        JSON.stringify({ error: "Missing system_id parameter" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    // Reference to the system node in Firebase - ensure leading underscore for correct path format
    const firebasePath = `/_${system_id}`;
    console.log(`[DEBUG] Using Firebase path: ${firebasePath}`);
    const systemRef = ref(database, firebasePath);
    
    // First get current data to preserve existing values
    try {
      console.log(`[DEBUG] Fetching current state from Firebase for system ${system_id}`);
      const snapshot = await get(systemRef);
      if (!snapshot.exists()) {
        console.log(`[DEBUG] No existing data found for system ${system_id}, will create new entry`);
      } else {
        console.log(`[DEBUG] Current Firebase data exists: ${JSON.stringify(snapshot.val())}`);
      }
      
      const currentData = snapshot.val() || {};
      console.log(`[DEBUG] Current Firebase data:`, JSON.stringify(currentData));
      console.log(`[DEBUG] Current power state: ${currentData.power || 0}`);
      
      // The data to update in Firebase, preserving other values
      // IMPORTANT FIX: Ensure the scheduledPowerChange object is properly formatted and included
      const updateData = {
        ...currentData,
        power: state ? 1 : 0,
        lastUpdate: new Date().toISOString(),
        lastUserPower: user_email || (schedule_id ? `scheduled-task:${schedule_id}` : "manual-task@system.auto"),
        // Ensure this is properly formatted as an object with all required fields
        scheduledPowerChange: {
          timestamp: new Date().toISOString(),
          schedule_id: schedule_id || "manual",
          triggered_by: user_email || (manual_execution ? "manual_execution" : "schedule-system"),
          state: state ? 1 : 0
        }
      };
      
      console.log(`[DEBUG] Attempting to set system ${system_id} power state to ${state ? "ON" : "OFF"} with data:`, JSON.stringify(updateData));
      console.log(`[DEBUG] scheduledPowerChange data:`, JSON.stringify(updateData.scheduledPowerChange));
      
      try {
        // Update the Firebase database with retry logic
        let success = false;
        let attempts = 0;
        const maxAttempts = 5; // Increased from 3 to 5
        
        while (!success && attempts < maxAttempts) {
          try {
            console.log(`[DEBUG] Firebase update attempt ${attempts + 1} for system ${system_id}`);
            await set(systemRef, updateData);
            success = true;
            console.log(`[DEBUG] Successfully updated Firebase on attempt ${attempts + 1}`);
          } catch (firebaseError) {
            attempts++;
            console.error(`[ERROR] Firebase update attempt ${attempts} failed:`, firebaseError);
            if (attempts >= maxAttempts) throw firebaseError;
            // Wait a bit before retrying with exponential backoff
            const waitTime = Math.pow(2, attempts) * 500; // 1s, 2s, 4s, 8s...
            console.log(`[DEBUG] Waiting ${waitTime}ms before retry attempt ${attempts + 1}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        
        // Verify the update was applied
        console.log(`[DEBUG] Verifying Firebase update for system ${system_id}`);
        
        // Wait briefly to ensure Firebase has time to update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const verifySnapshot = await get(systemRef);
        const verifyData = verifySnapshot.val() || {};
        console.log(`[DEBUG] Verification data from Firebase:`, JSON.stringify(verifyData));
        
        const powerStateUpdated = verifyData.power === (state ? 1 : 0);
        const schedulePowerChangeUpdated = verifyData.scheduledPowerChange && 
                                          verifyData.scheduledPowerChange.state === (state ? 1 : 0);
        
        console.log(`[DEBUG] Power state verification: expected=${state ? 1 : 0}, actual=${verifyData.power}, match=${powerStateUpdated}`);
        console.log(`[DEBUG] scheduledPowerChange verification: updated=${schedulePowerChangeUpdated}, value=`, 
                   JSON.stringify(verifyData.scheduledPowerChange));
        
        if (!powerStateUpdated || !schedulePowerChangeUpdated) {
          console.error(`[ERROR] Firebase update verification failed: power state or scheduledPowerChange did not update correctly`);
          
          // Try one more time with direct power update
          const emergencyUpdate = {
            power: state ? 1 : 0,
            lastUpdate: new Date().toISOString(),
            lastUserPower: `emergency-retry:${user_email || "system"}`,
            scheduledPowerChange: {
              timestamp: new Date().toISOString(),
              schedule_id: schedule_id || "emergency-retry",
              triggered_by: "emergency-retry-system",
              state: state ? 1 : 0
            },
            retryReason: "verification_failed"
          };
          
          console.log(`[DEBUG] EMERGENCY RETRY: Setting power state directly:`, JSON.stringify(emergencyUpdate));
          await set(systemRef, { ...verifyData, ...emergencyUpdate });
          
          // Verify again
          const finalVerifySnapshot = await get(systemRef);
          const finalVerifyData = finalVerifySnapshot.val() || {};
          const finalPowerState = finalVerifyData.power === (state ? 1 : 0);
          const finalScheduleUpdateState = finalVerifyData.scheduledPowerChange && 
                                         finalVerifyData.scheduledPowerChange.state === (state ? 1 : 0);
          
          console.log(`[DEBUG] Final verification: expected power=${state ? 1 : 0}, actual=${finalVerifyData.power}, match=${finalPowerState}`);
          console.log(`[DEBUG] Final scheduledPowerChange verification: updated=${finalScheduleUpdateState}, value=`, 
                     JSON.stringify(finalVerifyData.scheduledPowerChange));
          
          if (!finalPowerState || !finalScheduleUpdateState) {
            throw new Error("Firebase power state and scheduledPowerChange verification failed after emergency retry");
          } else {
            console.log("[DEBUG] Emergency retry SUCCESS - power state and scheduledPowerChange set correctly");
          }
        }
        
        // Log this action to Supabase for auditing
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id,
            action: state ? "power_on" : "power_off",
            triggered_by: schedule_id ? "schedule" : (manual_execution ? "manual_execution" : "manual_api"),
            details: { 
              source: schedule_id ? "scheduler" : (manual_execution ? "manual_execution" : "manual_api"),
              schedule_id: schedule_id || null,
              trigger_time: trigger_time || null, 
              email: user_email || "system",
              timestamp: executionTime,
              success: true,
              power_state: state ? 1 : 0,
              firebase_data: updateData,
              test_mode: test_mode || false,
              verification: {
                verified: true,
                expected: state ? 1 : 0,
                actual: verifyData.power,
                scheduledPowerChange: verifyData.scheduledPowerChange
              }
            }
          });
        
        // Make sure the update is properly visible to client applications
        // Force additional delay to allow the update to propagate
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Also send an additional notification to Supabase to ensure 
        // clients are aware of the power state change
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id,
            action: "schedule_execution_completed",
            triggered_by: schedule_id ? "schedule" : (manual_execution ? "manual_execution" : "manual_api"),
            details: { 
              success: true,
              power_changed_to: state ? "ON" : "OFF",
              timestamp: new Date().toISOString(),
              schedule_id: schedule_id || null,
              scheduledPowerChange: updateData.scheduledPowerChange
            }
          });
        
        console.log(`[DEBUG] Successfully updated system ${system_id} power state to ${state ? "ON" : "OFF"}`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: `System ${system_id} power state changed to ${state ? "ON" : "OFF"}`,
            timestamp: executionTime,
            data: updateData
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (dbError) {
        console.error("[ERROR] Database operation error:", dbError);
        throw new Error(`Database operation failed: ${dbError.message}`);
      }
    } catch (error) {
      console.error("[ERROR] Error in scheduled inverter control:", error);
      
      // Try to log the error to Supabase if possible
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // Extract system_id from request if possible
        let system_id = "unknown";
        let requestData = {};
        try {
          const body = await req.json();
          system_id = body.system_id || "unknown";
          requestData = body;
        } catch (e) {
          // Ignore parse errors
        }
        
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id,
            action: "error",
            triggered_by: "schedule",
            details: { 
              error: error.message,
              timestamp: new Date().toISOString(),
              request_data: requestData
            }
          });
      } catch (logError) {
        console.error("[ERROR] Failed to log error to Supabase:", logError);
      }
      
      return new Response(
        JSON.stringify({ 
          error: error.message,
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }
  } catch (error) {
    console.error("[ERROR] Unhandled error in scheduled inverter control:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Unknown error occurred",
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
