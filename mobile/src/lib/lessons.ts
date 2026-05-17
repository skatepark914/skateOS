// ============================================================
// Lessons data layer — list scheduled lessons + instructors.
// Mirrors admin/index.html lesson queries.
// ============================================================
import { supabase } from './supabase';

export type Lesson = {
  id: string;
  customer_id: string | null;
  type: string;
  scheduled_at: string;
  duration_min: number | null;
  instructor: string | null;
  price: number | null;
  status: string;
  notes: string | null;
  reminder_sent_at: string | null;
  customers?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export async function listUpcomingLessons(daysAhead = 14): Promise<Lesson[]> {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 86_400_000);
  const { data, error } = await supabase
    .from('lessons')
    .select('id, customer_id, type, scheduled_at, duration_min, instructor, price, status, notes, reminder_sent_at, customers(id,name,email,phone)')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', future.toISOString())
    .in('status', ['scheduled', 'confirmed'])
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Lesson[];
}

// Distinct instructors who've taught at least one lesson — feeds the
// instructor dropdown on the new-lesson modal so cashier picks a known
// name (typo-resistant) but can still type a new one.
export async function listKnownInstructors(): Promise<string[]> {
  const { data } = await supabase
    .from('lessons')
    .select('instructor')
    .not('instructor', 'is', null)
    .limit(500);
  const set = new Set<string>();
  (data ?? []).forEach((r: any) => { if (r.instructor) set.add(r.instructor); });
  return Array.from(set).sort();
}

// Insert a new lesson row. Returns the inserted record.
// Audit-stamps the booking source into notes so the admin web's
// existing review flow knows where it came from.
export async function createLesson(input: {
  customer_id: string | null;
  customer_name?: string | null;   // denormalized fallback for walk-ins
  type: string;                    // 'private' | 'group' | 'camp' | 'event' | 'birthday'
  scheduled_at: string;            // ISO timestamp
  duration_min?: number | null;
  instructor?: string | null;
  price?: number | null;
  capacity?: number | null;        // 1 = solo (matches admin migration 032)
  notes?: string | null;
}): Promise<Lesson> {
  const auditStamp = `[Booked ${new Date().toISOString().slice(0,10)} via iPad mobile]`;
  const rawNotes = (input.notes || '').trim();
  const notes = rawNotes ? rawNotes + '\n\n' + auditStamp : auditStamp;
  const row: any = {
    customer_id:  input.customer_id,
    type:         input.type,
    scheduled_at: input.scheduled_at,
    duration_min: input.duration_min ?? null,
    instructor:   input.instructor?.trim() || null,
    price:        input.price ?? null,
    status:       'scheduled',
    notes,
  };
  if (input.capacity != null) row.max_attendees = input.capacity;

  const { data, error } = await supabase
    .from('lessons')
    .insert(row)
    .select('id, customer_id, type, scheduled_at, duration_min, instructor, price, status, notes, reminder_sent_at, customers(id,name,email,phone)')
    .single();
  if (error) throw error;
  return data as unknown as Lesson;
}

export async function listTodaysLessons(): Promise<Lesson[]> {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const { data, error } = await supabase
    .from('lessons')
    .select('id, customer_id, type, scheduled_at, duration_min, instructor, price, status, notes, reminder_sent_at, customers(id,name,email,phone)')
    .gte('scheduled_at', startOfDay.toISOString())
    .lte('scheduled_at', endOfDay.toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Lesson[];
}
