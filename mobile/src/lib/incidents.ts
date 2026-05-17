// ============================================================
// Incidents data layer — mirrors migration 010's incidents table.
// Used by app/(tabs)/incidents.tsx for filing a report from the
// iPad (typical use case: front-desk fills the form right after
// the incident happens, instead of waiting to find a laptop).
// ============================================================
import { supabase } from './supabase';

export type Severity = 'none' | 'first_aid' | 'urgent_care' | 'er' | 'ems_911';

export type Incident = {
  id: string;
  occurred_at: string;
  park_area: string;
  skater_id: string | null;
  skater_name: string;
  skater_dob: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  types: string[];
  severity: Severity;
  helmet_worn: boolean | null;
  pass_type: string | null;
  description: string;
  medical_treatment: string | null;
  hospital: string | null;
  ems_arrival_min: number | null;
  corrective_action: string | null;
  action_owner: string | null;
  action_deadline: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export const PARK_AREAS = [
  { value: 'street',     label: 'Street section' },
  { value: 'bowl',       label: 'Bowl' },
  { value: 'mini_ramp',  label: 'Mini-ramp' },
  { value: 'snake_run',  label: 'Snake run' },
  { value: 'launch',     label: 'Launch ramps' },
  { value: 'lobby',      label: 'Lobby / front desk' },
  { value: 'parking',    label: 'Parking lot' },
  { value: 'restroom',   label: 'Restroom' },
  { value: 'other',      label: 'Other' },
];

export const INCIDENT_TYPES = [
  'fall',
  'collision',
  'head impact',
  'wrist/arm break',
  'leg/ankle break',
  'concussion',
  'laceration',
  'near miss',
  'theft',
  'fight',
  'allergic reaction',
  'fainting / seizure',
  'other',
];

export const SEVERITY_OPTIONS: { value: Severity; label: string; color: string }[] = [
  { value: 'none',         label: 'None / no treatment',  color: '#16a34a' },
  { value: 'first_aid',    label: 'First aid (in-park)',  color: '#0369a1' },
  { value: 'urgent_care',  label: 'Urgent care referral', color: '#d97706' },
  { value: 'er',           label: 'ER (parent transport)',color: '#dc2626' },
  { value: 'ems_911',      label: 'EMS / 911',            color: '#991b1b' },
];

export type CreateIncidentInput = {
  occurred_at: string;
  park_area: string;
  skater_id?: string | null;
  skater_name: string;
  skater_dob?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  types: string[];
  severity: Severity;
  helmet_worn: boolean | null;
  pass_type?: string | null;
  description: string;
  medical_treatment?: string | null;
  hospital?: string | null;
  ems_arrival_min?: number | null;
  corrective_action?: string | null;
};

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  const row: any = {
    occurred_at:       input.occurred_at,
    park_area:         input.park_area,
    skater_id:         input.skater_id ?? null,
    skater_name:       input.skater_name.trim(),
    skater_dob:        input.skater_dob ?? null,
    guardian_name:     input.guardian_name?.trim() || null,
    guardian_phone:    input.guardian_phone?.trim() || null,
    types:             input.types,
    severity:          input.severity,
    helmet_worn:       input.helmet_worn,
    pass_type:         input.pass_type ?? null,
    description:       input.description.trim(),
    medical_treatment: input.medical_treatment?.trim() || null,
    hospital:          input.hospital?.trim() || null,
    ems_arrival_min:   input.ems_arrival_min ?? null,
    corrective_action: input.corrective_action?.trim() || null,
    data:              { source: 'ipad-mobile', filed_at: new Date().toISOString() },
  };
  const { data, error } = await supabase
    .from('incidents')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data as Incident;
}

export async function listRecentIncidents(limit = 30): Promise<Incident[]> {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Incident[];
}
