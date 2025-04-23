
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
  test_mode?: boolean; 
  manual_execution?: boolean; 
  diagnostic_check?: boolean;
  direct_execution?: boolean;
  emergency_execution?: boolean; 
  execution_id?: string;
  bypass_verification?: boolean;
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
    const { 
      system_id, state, user_email, schedule_id, trigger_time, 
      test_mode, manual_execution, diagnostic_check, direct_execution,
      emergency_execution, execution_id, bypass_verification
    } = await req.json() as ScheduledControlParams;
    
    const now = new Date();
    const executionTime = now.toISOString();
    const executionId = execution_id || `exec-${now.getTime()}`;
    
    console.log(`[DEBUG] Request ID ${executionId}: Received request to set system ${system_id} power state to ${state ? "ON" : "OFF"} from ${user_email || "unknown"}`);
    console.log(`[DEBUG] Request ID ${executionId}: Schedule details: ID=${schedule_id || "manual"}, Trigger time=${trigger_time || "manual"}, Current time=${executionTime}`);
    console.log(`[DEBUG] Request ID ${executionId}: Execution type: ${emergency_execution ? "EMERGENCY" : direct_execution ? "Direct execution" : manual_execution ? "Manual execution" : "Scheduled"}, Test mode: ${test_mode ? "YES" : "NO"}`);

    // If this is a diagnostic check only, just verify Firebase connection
    if (diagnostic_check) {
      console.log(`[DEBUG] Request ID ${executionId}: Running diagnostic check for system ${system_id}`);
      
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
            data_exists: snapshot.exists(),
            request_id: executionId
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (diagError) {
        console.error(`[ERROR] Request ID ${executionId}: Diagnostic check failed:`, diagError);
        return new Response(
          JSON.stringify({ 
            success: false, 
            connection_status: `Connection failed: ${diagError.message}`,
            timestamp: executionTime,
            request_id: executionId
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    if (!system_id) {
      console.error(`[ERROR] Request ID ${executionId}: Missing system_id parameter`);
      return new Response(
        JSON.stringify({ error: "Missing system_id parameter", request_id: executionId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    // Reference to the system node in Firebase - ensure leading underscore for correct path format
    const firebasePath = `/_${system_id}`;
    console.log(`[DEBUG] Request ID ${executionId}: Using Firebase path: ${firebasePath}`);
    const systemRef = ref(database, firebasePath);
    
    // Log this to Supabase first to inform the client we're processing
    await supabase
      .from('scheduled_actions_log')
      .insert({
        system_id: system_id,
        action: "processing_power_change",
        triggered_by: schedule_id ? "schedule" : (manual_execution ? "manual_execution" : "manual_api"),
        details: { 
          source: emergency_execution ? "emergency_execution" : 
                  schedule_id ? "scheduler" : 
                  (manual_execution ? "manual_execution" : "manual_api"),
          schedule_id: schedule_id || null,
          trigger_time: trigger_time || null, 
          email: user_email || "system",
          timestamp: executionTime,
          target_state: state ? "ON" : "OFF",
          direct_execution: direct_execution || false,
          emergency: emergency_execution || false,
          request_id: executionId
        }
      });
    
    try {
      console.log(`[DEBUG] Request ID ${executionId}: Fetching current state from Firebase for system ${system_id}`);
      const snapshot = await get(systemRef);
      if (!snapshot.exists()) {
        console.log(`[DEBUG] Request ID ${executionId}: No existing data found for system ${system_id}, will create new entry`);
      } else {
        console.log(`[DEBUG] Request ID ${executionId}: Current Firebase data exists with power = ${snapshot.val().power || 0}`);
      }
      
      // Simplified direct update for emergency execution
      if (emergency_execution) {
        console.log(`[DEBUG] Request ID ${executionId}: EMERGENCY EXECUTION - Setting power state directly to ${state ? 1 : 0}`);
        
        // Simplified data for emergency execution
        const emergencyData = {
          power: state ? 1 : 0,
          lastUpdate: new Date().toISOString(),
          lastUserPower: `emergency-execution:${executionId}`,
          scheduledPowerChange: {
            timestamp: new Date().toISOString(),
            schedule_id: schedule_id || "emergency-execution",
            triggered_by: "emergency-system",
            state: state ? 1 : 0,
            execution_id: executionId
          }
        };
        
        // Set power directly with minimal data
        await set(systemRef, emergencyData);
        
        // Log success to Supabase
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id,
            action: state ? "power_on" : "power_off",
            triggered_by: "emergency_execution",
            details: { 
              success: true,
              power_state: state ? 1 : 0,
              timestamp: new Date().toISOString(),
              execution_id: executionId,
              emergency: true
            }
          });
        
        // Final success notification
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id,
            action: "schedule_execution_completed",
            triggered_by: "emergency_execution",
            details: { 
              success: true,
              power_changed_to: state ? "ON" : "OFF",
              timestamp: new Date().toISOString(),
              schedule_id: schedule_id || null,
              execution_id: executionId,
              emergency: true
            }
          });
        
        console.log(`[DEBUG] Request ID ${executionId}: EMERGENCY execution completed successfully`);
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: `EMERGENCY - System ${system_id} power state changed to ${state ? "ON" : "OFF"}`,
            timestamp: executionTime,
            request_id: executionId
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Standard execution flow (non-emergency)
      const currentData = snapshot.val() || {};
      console.log(`[DEBUG] Request ID ${executionId}: Current Firebase data:`, JSON.stringify(currentData));
      
      // The data to update in Firebase, preserving other values
      const updateData = {
        ...currentData,
        power: state ? 1 : 0,
        lastUpdate: new Date().toISOString(),
        lastUserPower: user_email || (schedule_id ? `scheduled-task:${schedule_id}` : "manual-task@system.auto"),
        scheduledPowerChange: {
          timestamp: new Date().toISOString(),
          schedule_id: schedule_id || "manual",
          triggered_by: user_email || (manual_execution ? "manual_execution" : "schedule-system"),
          state: state ? 1 : 0,
          request_id: executionId
        }
      };
      
      console.log(`[DEBUG] Request ID ${executionId}: Attempting to set system ${system_id} power state to ${state ? "ON" : "OFF"}`);
      
      // Update the Firebase database with retry logic
      let success = false;
      let attempts = 0;
      const maxAttempts = direct_execution ? 3 : 2; // Reduced retries to avoid excessive loops
      
      while (!success && attempts < maxAttempts) {
        try {
          console.log(`[DEBUG] Request ID ${executionId}: Firebase update attempt ${attempts + 1}`);
          await set(systemRef, updateData);
          success = true;
          console.log(`[DEBUG] Request ID ${executionId}: Successfully updated Firebase on attempt ${attempts + 1}`);
          
          // Only verify if not in bypass mode
          if (!bypass_verification) {
            // Quick verification
            const verifySnapshot = await get(systemRef);
            const verifyData = verifySnapshot.val() || {};
            const powerStateUpdated = verifyData.power === (state ? 1 : 0);
            
            if (!powerStateUpdated) {
              console.log(`[DEBUG] Request ID ${executionId}: Initial verification failed, power=${verifyData.power}`);
              success = false;
            }
          }
        } catch (firebaseError) {
          attempts++;
          console.error(`[ERROR] Request ID ${executionId}: Firebase update attempt ${attempts} failed:`, firebaseError);
          if (attempts >= maxAttempts) throw firebaseError;
          // Short wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Log success to Supabase
      await supabase
        .from('scheduled_actions_log')
        .insert([{
          system_id: system_id,
          action: state ? "power_on" : "power_off",
          triggered_by: schedule_id ? "schedule" : (manual_execution ? "manual_execution" : "manual_api"),
          details: { 
            success: true,
            power_state: state ? 1 : 0,
            timestamp: new Date().toISOString(),
            request_id: executionId
          }
        },
        {
          system_id: system_id,
          action: "schedule_execution_completed",
          triggered_by: schedule_id ? "schedule" : (manual_execution ? "manual_execution" : "manual_api"),
          details: { 
            success: true,
            power_changed_to: state ? "ON" : "OFF",
            timestamp: new Date().toISOString(),
            schedule_id: schedule_id || null,
            request_id: executionId
          }
        }]);
      
      console.log(`[DEBUG] Request ID ${executionId}: Successfully updated system ${system_id} power state to ${state ? "ON" : "OFF"}`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `System ${system_id} power state changed to ${state ? "ON" : "OFF"}`,
          timestamp: executionTime,
          request_id: executionId
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error(`[ERROR] Request ID ${executionId}: Error in scheduled inverter control:`, error);
      
      // Try to log the error to Supabase
      try {
        await supabase
          .from('scheduled_actions_log')
          .insert({
            system_id: system_id || "unknown",
            action: "error",
            triggered_by: "schedule",
            details: { 
              error: error.message,
              timestamp: new Date().toISOString(),
              request_id: executionId
            }
          });
      } catch (logError) {
        console.error(`[ERROR] Request ID ${executionId}: Failed to log error to Supabase:`, logError);
      }
      
      return new Response(
        JSON.stringify({ 
          error: error.message,
          timestamp: new Date().toISOString(),
          request_id: executionId
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
