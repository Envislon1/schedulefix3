
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface SharedInverterResult {
  success: boolean;
  inverterId?: string;
  message: string;
}

/**
 * Finds or creates an inverter system for the current user based on a system ID
 * This allows multiple users to access the same physical inverter
 */
export const findOrCreateSharedInverter = async (systemId: string): Promise<SharedInverterResult> => {
  try {
    // First check if current user already has this system
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { 
        success: false, 
        message: "You must be logged in to access shared inverters" 
      };
    }
    
    // Check if this user already has an inverter system with this system_id
    const { data: existingSystem, error: findError } = await supabase
      .from('inverter_systems')
      .select('*')
      .eq('system_id', systemId)
      .eq('user_id', user.id)
      .maybeSingle();
      
    if (findError) {
      console.error("Error finding existing system:", findError);
      return { 
        success: false, 
        message: "Error checking for existing system" 
      };
    }
    
    // If user already has this system, return it
    if (existingSystem) {
      return { 
        success: true, 
        inverterId: existingSystem.id,
        message: "Connected to existing shared inverter" 
      };
    }
    
    // Need to check if this system_id exists at all to get its details
    const { data: templateSystem, error: templateError } = await supabase
      .from('inverter_systems')
      .select('*')
      .eq('system_id', systemId)
      .limit(1)
      .maybeSingle();
    
    if (templateError) {
      console.error("Error finding template system:", templateError);
      return { 
        success: false, 
        message: "Error finding system information" 
      };
    }
    
    let name = `Shared Inverter (${systemId.substring(0, 8)}...)`;
    let location = "Unknown";
    let model = "Generic";
    let capacity = 3000;
    
    // If found a template system, use its details
    if (templateSystem) {
      name = templateSystem.name || name;
      location = templateSystem.location || location;
      model = templateSystem.model || model;
      capacity = templateSystem.capacity || capacity;
    }
    
    // Create a new inverter system for this user with the same system_id
    const { data: newSystem, error: createError } = await supabase
      .from('inverter_systems')
      .insert({
        name,
        location,
        model,
        system_id: systemId,
        capacity,
        user_id: user.id
      })
      .select()
      .single();
      
    if (createError) {
      console.error("Error creating shared system:", createError);
      return { 
        success: false, 
        message: "Error creating shared inverter access" 
      };
    }
    
    return { 
      success: true, 
      inverterId: newSystem.id,
      message: "Connected to shared inverter" 
    };
    
  } catch (error: any) {
    console.error("Error in findOrCreateSharedInverter:", error);
    return { 
      success: false, 
      message: error.message || "Unknown error connecting to shared inverter" 
    };
  }
};
