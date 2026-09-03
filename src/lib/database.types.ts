/**
 * Supabase `Database` type for MAMA THERA Finance Suite.
 *
 * Generated-from-migrations — the schema below is derived deterministically
 * from the committed SQL schema in `supabase/migrations/` (source of truth),
 * which back `supabase gen types` would otherwise pull live from the hosted
 * project. It covers the final schema (12 tables):
 *   parents, students, payments, staff, salary_payments, expenses,
 *   vendor_expenses, todos, user_profiles, audit_logs, academic_years,
 *   custom_classes, app_settings, calendar_notes.
 * (`custom_grades` is dropped by migration 20260828000004 and is intentionally
 * absent.) No Postgres enums exist; `user_profiles.role` uses a TEXT + CHECK
 * and is therefore typed `string`, mirroring what the official tool emits.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_notes: {
        Row: {
          id: string;
          note_date: string;
          text: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          note_date: string;
          text: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          note_date?: string;
          text?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_notes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      parents: {
        Row: {
          id: string;
          full_name: string;
          phones: string[];
          email: string | null;
          address: string;
          occupation: string;
          relationship: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          phones: string[];
          email?: string | null;
          address: string;
          occupation: string;
          relationship: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          phones?: string[];
          email?: string | null;
          address?: string;
          occupation?: string;
          relationship?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          student_id: string | null;
          parent_id: string | null;
          name: string;
          parent_name: string | null;
          parent_email: string | null;
          parent_phone: string | null;
          total_due: number | null;
          amount_paid: number | null;
          scholarship_discount: number | null;
          due_date: string | null;
          last_payment_date: string | null;
          notes: string | null;
          last_note_date: string | null;
          note_entries: Json;
          flagged: boolean | null;
          academic_year: string | null;
          grade: string | null;
          photo: string | null;
          emergency_contact_name: string | null;
          emergency_contact_relation: string | null;
          emergency_contact_phone: string | null;
          medical_notes: string | null;
          enrollment_date: string | null;
          previous_school: string | null;
          status: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          parent_id?: string | null;
          name: string;
          parent_name?: string | null;
          parent_email?: string | null;
          parent_phone?: string | null;
          total_due?: number | null;
          amount_paid?: number | null;
          scholarship_discount?: number | null;
          due_date?: string | null;
          last_payment_date?: string | null;
          notes?: string | null;
          last_note_date?: string | null;
          note_entries?: Json;
          flagged?: boolean | null;
          academic_year?: string | null;
          grade?: string | null;
          photo?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_relation?: string | null;
          emergency_contact_phone?: string | null;
          medical_notes?: string | null;
          enrollment_date?: string | null;
          previous_school?: string | null;
          status?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          parent_id?: string | null;
          name?: string;
          parent_name?: string | null;
          parent_email?: string | null;
          parent_phone?: string | null;
          total_due?: number | null;
          amount_paid?: number | null;
          scholarship_discount?: number | null;
          due_date?: string | null;
          last_payment_date?: string | null;
          notes?: string | null;
          last_note_date?: string | null;
          note_entries?: Json;
          flagged?: boolean | null;
          academic_year?: string | null;
          grade?: string | null;
          photo?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_relation?: string | null;
          emergency_contact_phone?: string | null;
          medical_notes?: string | null;
          enrollment_date?: string | null;
          previous_school?: string | null;
          status?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          student_id: string | null;
          date: string;
          amount: number;
          academic_year: string | null;
          receipt_number: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          date: string;
          amount: number;
          academic_year?: string | null;
          receipt_number?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          date?: string;
          amount?: number;
          academic_year?: string | null;
          receipt_number?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          id: string;
          name: string;
          position: string;
          salary: number;
          email: string | null;
          phone: string | null;
          bank_details: string | null;
          emergency_contact: string | null;
          academic_year: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          position: string;
          salary: number;
          email?: string | null;
          phone?: string | null;
          bank_details?: string | null;
          emergency_contact?: string | null;
          academic_year?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          position?: string;
          salary?: number;
          email?: string | null;
          phone?: string | null;
          bank_details?: string | null;
          emergency_contact?: string | null;
          academic_year?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      salary_payments: {
        Row: {
          id: string;
          staff_id: string | null;
          amount: number;
          date: string;
          academic_year: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          staff_id?: string | null;
          amount: number;
          date: string;
          academic_year?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          staff_id?: string | null;
          amount?: number;
          date?: string;
          academic_year?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          category: string;
          description: string;
          amount: number;
          date: string;
          academic_year: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          description: string;
          amount: number;
          date: string;
          academic_year?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          description?: string;
          amount?: number;
          date?: string;
          academic_year?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      vendor_expenses: {
        Row: {
          id: string;
          vendor_name: string;
          category: string;
          amount: number;
          due_date: string;
          payment_status: string;
          amount_paid: number | null;
          description: string | null;
          academic_year: string | null;
          aid_type: string | null;
          beneficiary_student_name: string | null;
          beneficiary_student_grade: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_name: string;
          category: string;
          amount: number;
          due_date: string;
          payment_status: string;
          amount_paid?: number | null;
          description?: string | null;
          academic_year?: string | null;
          aid_type?: string | null;
          beneficiary_student_name?: string | null;
          beneficiary_student_grade?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          vendor_name?: string;
          category?: string;
          amount?: number;
          due_date?: string;
          payment_status?: string;
          amount_paid?: number | null;
          description?: string | null;
          academic_year?: string | null;
          aid_type?: string | null;
          beneficiary_student_name?: string | null;
          beneficiary_student_grade?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      todos: {
        Row: {
          id: string;
          text: string;
          completed: boolean | null;
          student_id: string | null;
          due_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          text: string;
          completed?: boolean | null;
          student_id?: string | null;
          due_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          text?: string;
          completed?: boolean | null;
          student_id?: string | null;
          due_date?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          user_email: string | null;
          user_name: string | null;
          user_role: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          details: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_name?: string | null;
          user_role?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          user_email?: string | null;
          user_name?: string | null;
          user_role?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          details?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      academic_years: {
        Row: {
          id: string;
          year_name: string;
          start_date: string | null;
          end_date: string | null;
          is_current: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          year_name: string;
          start_date?: string | null;
          end_date?: string | null;
          is_current?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          year_name?: string;
          start_date?: string | null;
          end_date?: string | null;
          is_current?: boolean | null;
          created_at?: string;
        };
        Relationships: [];
      };
      custom_classes: {
        Row: {
          id: string;
          code: string;
          cycle: string;
          year: string;
          section: string;
          name_fr: string;
          name_en: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          cycle?: string;
          year?: string;
          section?: string;
          name_fr: string;
          name_en: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          cycle?: string;
          year?: string;
          section?: string;
          name_fr?: string;
          name_en?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_set_user_password: {
        Args: {
          target_user_id: string;
          new_password: string;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Row type for a public table, e.g. `DbRow<'students'>`. */
export type DbRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
/** Insert type for a public table. */
export type DbInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
/** Update type for a public table. */
export type DbUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];