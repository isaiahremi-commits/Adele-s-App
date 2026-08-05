// Database types for the Manadele Supabase project (uytyohrgabvnupqyjjao).
//
// Regenerate against the live schema with:
//   cd mobile && npm run gen:types
// (requires a one-time `npx supabase login`, or SUPABASE_ACCESS_TOKEN in the
// environment — the CLI is a devDependency of mobile/).
//
// This initial version was reconstructed from the repo's SQL migrations and
// verified column-by-column against the live database via PostgREST (every
// table/column below returned 200 on a live select probe on 2026-08-05).
// Relationship metadata is left empty until the CLI regenerates the file —
// typed nested-join inference is not needed by the mobile app yet.
//
// PR #3 (2026-08-05): `tenant_id`, the `tenants` + `device_sessions` tables
// and the `current_tenant_id` / `enforce_device_limit` RPCs were HAND-ADDED
// ahead of migrations 005_multi_tenant.sql + 006_device_sessions.sql, which
// are pending manual application — regenerating before they're applied would
// silently drop all of it. Re-run gen:types only after both migrations land.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      approved_weeks: {
        Row: {
          tenant_id: string;
          period_start_date: string;
          approved_at: string | null;
          approved_by: string | null;
          outlet_id: string | null;
        };
        Insert: {
          tenant_id?: string;
          period_start_date: string;
          approved_at?: string | null;
          approved_by?: string | null;
          outlet_id?: string | null;
        };
        Update: {
          tenant_id?: string;
          period_start_date?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          outlet_id?: string | null;
        };
        Relationships: [];
      };
      callout_history: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          shift_id: string | null;
          date: string;
          reason: string | null;
          entered_by: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          shift_id?: string | null;
          date: string;
          reason?: string | null;
          entered_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          shift_id?: string | null;
          date?: string;
          reason?: string | null;
          entered_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          name: string;
          type: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          type?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          type?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      device_sessions: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          device_label: string | null;
          last_seen_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          device_label?: string | null;
          last_seen_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          device_label?: string | null;
          last_seen_at?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      employee_outlets: {
        Row: {
          id: string;
          employee_id: string | null;
          outlet_id: string | null;
          position_name: string | null;
        };
        Insert: {
          id?: string;
          employee_id?: string | null;
          outlet_id?: string | null;
          position_name?: string | null;
        };
        Update: {
          id?: string;
          employee_id?: string | null;
          outlet_id?: string | null;
          position_name?: string | null;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          tenant_id: string;
          id: string;
          first_name: string | null;
          last_name: string | null;
          title: string | null;
          department: string | null;
          position: string | null;
          phone: string | null;
          email: string | null;
          created_at: string | null;
          department_id: string | null;
          home_outlet_id: string | null;
          home_position: string | null;
          employee_number: string | null;
          shirt_size: string | null;
          date_of_hire: string | null;
          termination_date: string | null;
          regular_rate: number | null;
          ot_rate: number | null;
          training_rate: number | null;
          pto_rate: number | null;
          pay_type: string;
          annual_salary: number | null;
          sms_opt_in: boolean | null;
          sms_opt_in_pending: boolean | null;
          sms_opted_in_at: string | null;
          auth_user_id: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          title?: string | null;
          department?: string | null;
          position?: string | null;
          phone?: string | null;
          email?: string | null;
          created_at?: string | null;
          department_id?: string | null;
          home_outlet_id?: string | null;
          home_position?: string | null;
          employee_number?: string | null;
          shirt_size?: string | null;
          date_of_hire?: string | null;
          termination_date?: string | null;
          regular_rate?: number | null;
          ot_rate?: number | null;
          training_rate?: number | null;
          pto_rate?: number | null;
          pay_type?: string;
          annual_salary?: number | null;
          sms_opt_in?: boolean | null;
          sms_opt_in_pending?: boolean | null;
          sms_opted_in_at?: string | null;
          auth_user_id?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          title?: string | null;
          department?: string | null;
          position?: string | null;
          phone?: string | null;
          email?: string | null;
          created_at?: string | null;
          department_id?: string | null;
          home_outlet_id?: string | null;
          home_position?: string | null;
          employee_number?: string | null;
          shirt_size?: string | null;
          date_of_hire?: string | null;
          termination_date?: string | null;
          regular_rate?: number | null;
          ot_rate?: number | null;
          training_rate?: number | null;
          pto_rate?: number | null;
          pay_type?: string;
          annual_salary?: number | null;
          sms_opt_in?: boolean | null;
          sms_opt_in_pending?: boolean | null;
          sms_opted_in_at?: string | null;
          auth_user_id?: string | null;
        };
        Relationships: [];
      };
      large_party_revenues: {
        Row: {
          tenant_id: string;
          id: string;
          tip_sheet_id: string | null;
          revenue: number | null;
          manager_employee_id: string | null;
          pool_amount: number | null;
          house_amount: number | null;
          manager_amount: number | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          tip_sheet_id?: string | null;
          revenue?: number | null;
          manager_employee_id?: string | null;
          pool_amount?: number | null;
          house_amount?: number | null;
          manager_amount?: number | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          tip_sheet_id?: string | null;
          revenue?: number | null;
          manager_employee_id?: string | null;
          pool_amount?: number | null;
          house_amount?: number | null;
          manager_amount?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      lateness_history: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          timecard_id: string | null;
          shift_id: string | null;
          date: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          timecard_id?: string | null;
          shift_id?: string | null;
          date?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          timecard_id?: string | null;
          shift_id?: string | null;
          date?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      outlet_roles: {
        Row: {
          tenant_id: string;
          id: string;
          outlet_id: string | null;
          position_name: string;
          points: number;
          tip_out_pct: number | null;
          tip_out_revenue_source: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          outlet_id?: string | null;
          position_name: string;
          points?: number;
          tip_out_pct?: number | null;
          tip_out_revenue_source?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          outlet_id?: string | null;
          position_name?: string;
          points?: number;
          tip_out_pct?: number | null;
          tip_out_revenue_source?: string | null;
        };
        Relationships: [];
      };
      outlet_services: {
        Row: {
          id: string;
          outlet_id: string | null;
          name: string;
        };
        Insert: {
          id?: string;
          outlet_id?: string | null;
          name: string;
        };
        Update: {
          id?: string;
          outlet_id?: string | null;
          name?: string;
        };
        Relationships: [];
      };
      outlets: {
        Row: {
          tenant_id: string;
          id: string;
          name: string;
          department_id: string | null;
          tip_pool_mode: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          name: string;
          department_id?: string | null;
          tip_pool_mode?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          name?: string;
          department_id?: string | null;
          tip_pool_mode?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      payroll_periods: {
        Row: {
          id: string;
          name: string | null;
          start_date: string;
          end_date: string;
          pay_date: string | null;
          active: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name?: string | null;
          start_date: string;
          end_date: string;
          pay_date?: string | null;
          active?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          start_date?: string;
          end_date?: string;
          pay_date?: string | null;
          active?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      pto_allocations: {
        Row: {
          tenant_id: string;
          id: string;
          pto_request_id: string | null;
          employee_id: string | null;
          date: string;
          paid_hours: number | null;
          unpaid_hours: number | null;
          pay_period_start: string | null;
          pay_period_end: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          pto_request_id?: string | null;
          employee_id?: string | null;
          date: string;
          paid_hours?: number | null;
          unpaid_hours?: number | null;
          pay_period_start?: string | null;
          pay_period_end?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          pto_request_id?: string | null;
          employee_id?: string | null;
          date?: string;
          paid_hours?: number | null;
          unpaid_hours?: number | null;
          pay_period_start?: string | null;
          pay_period_end?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      pto_balance_transactions: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          delta_hours: number;
          transaction_type: string | null;
          reference_id: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          delta_hours: number;
          transaction_type?: string | null;
          reference_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          delta_hours?: number;
          transaction_type?: string | null;
          reference_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      pto_balances: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string;
          balance_hours: number | null;
          updated_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id: string;
          balance_hours?: number | null;
          updated_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string;
          balance_hours?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      pto_requests: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          start_date: string;
          end_date: string;
          total_hours_requested: number;
          reason: string | null;
          notes: string | null;
          status: string;
          requested_at: string | null;
          decided_at: string | null;
          decided_by: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          start_date: string;
          end_date: string;
          total_hours_requested: number;
          reason?: string | null;
          notes?: string | null;
          status?: string;
          requested_at?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          start_date?: string;
          end_date?: string;
          total_hours_requested?: number;
          reason?: string | null;
          notes?: string | null;
          status?: string;
          requested_at?: string | null;
          decided_at?: string | null;
          decided_by?: string | null;
        };
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          name: string;
          outlet_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          outlet_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          outlet_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      setup: {
        Row: {
          tenant_id: string;
          id: string;
          company_name: string | null;
          pay_cycle: string;
          period_start_day: string;
          updated_at: string | null;
          lateness_tier1_minutes: number | null;
          lateness_tier2_minutes: number | null;
          discrepancy_threshold_hours: number | null;
          callout_threshold_count: number | null;
          callout_threshold_window_days: number | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          company_name?: string | null;
          pay_cycle?: string;
          period_start_day?: string;
          updated_at?: string | null;
          lateness_tier1_minutes?: number | null;
          lateness_tier2_minutes?: number | null;
          discrepancy_threshold_hours?: number | null;
          callout_threshold_count?: number | null;
          callout_threshold_window_days?: number | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          company_name?: string | null;
          pay_cycle?: string;
          period_start_day?: string;
          updated_at?: string | null;
          lateness_tier1_minutes?: number | null;
          lateness_tier2_minutes?: number | null;
          discrepancy_threshold_hours?: number | null;
          callout_threshold_count?: number | null;
          callout_threshold_window_days?: number | null;
        };
        Relationships: [];
      };
      shifts: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          date: string;
          start_time: string | null;
          end_time: string | null;
          shift_type: string | null;
          department: string | null;
          position: string | null;
          outlet_id: string | null;
          notes: string | null;
          is_training: boolean | null;
          is_event: boolean | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          date: string;
          start_time?: string | null;
          end_time?: string | null;
          shift_type?: string | null;
          department?: string | null;
          position?: string | null;
          outlet_id?: string | null;
          notes?: string | null;
          is_training?: boolean | null;
          is_event?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          date?: string;
          start_time?: string | null;
          end_time?: string | null;
          shift_type?: string | null;
          department?: string | null;
          position?: string | null;
          outlet_id?: string | null;
          notes?: string | null;
          is_training?: boolean | null;
          is_event?: boolean | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      sms_log: {
        Row: {
          id: string;
          recipient_phone: string | null;
          recipient_employee_id: string | null;
          message: string | null;
          status: string | null;
          error_message: string | null;
          sms_type: string | null;
          related_entity_type: string | null;
          related_entity_id: string | null;
          direction: string | null;
          twilio_sid: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          recipient_phone?: string | null;
          recipient_employee_id?: string | null;
          message?: string | null;
          status?: string | null;
          error_message?: string | null;
          sms_type?: string | null;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          direction?: string | null;
          twilio_sid?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          recipient_phone?: string | null;
          recipient_employee_id?: string | null;
          message?: string | null;
          status?: string | null;
          error_message?: string | null;
          sms_type?: string | null;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          direction?: string | null;
          twilio_sid?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      sms_settings: {
        Row: {
          id: number;
          shift_reminder_enabled: boolean | null;
          shift_reminder_hours_before: number | null;
          updated_at: string | null;
        };
        Insert: {
          id?: number;
          shift_reminder_enabled?: boolean | null;
          shift_reminder_hours_before?: number | null;
          updated_at?: string | null;
        };
        Update: {
          id?: number;
          shift_reminder_enabled?: boolean | null;
          shift_reminder_hours_before?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      swap_history: {
        Row: {
          tenant_id: string;
          id: string;
          shift_id: string | null;
          original_employee_id: string | null;
          new_employee_id: string | null;
          status: string | null;
          swapped_by: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          shift_id?: string | null;
          original_employee_id?: string | null;
          new_employee_id?: string | null;
          status?: string | null;
          swapped_by?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          shift_id?: string | null;
          original_employee_id?: string | null;
          new_employee_id?: string | null;
          status?: string | null;
          swapped_by?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string | null;
        };
        Insert: {
          id: string;
          name: string;
          slug: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      timecard_events: {
        Row: {
          tenant_id: string;
          id: string;
          timecard_id: string | null;
          event_type: string | null;
          value_before: Json | null;
          value_after: Json | null;
          actor_id: string | null;
          notes: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          timecard_id?: string | null;
          event_type?: string | null;
          value_before?: Json | null;
          value_after?: Json | null;
          actor_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          timecard_id?: string | null;
          event_type?: string | null;
          value_before?: Json | null;
          value_after?: Json | null;
          actor_id?: string | null;
          notes?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      timecards: {
        Row: {
          tenant_id: string;
          id: string;
          employee_id: string | null;
          shift_id: string | null;
          date: string;
          clock_in: string | null;
          clock_out: string | null;
          break_minutes: number | null;
          training_hours: number | null;
          notes: string | null;
          status: string;
          regular_hours: number | null;
          ot_hours: number | null;
          discrepancy_flag: boolean | null;
          lateness_tier: number | null;
          override_by: string | null;
          override_at: string | null;
          updated_at: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          shift_id?: string | null;
          date: string;
          clock_in?: string | null;
          clock_out?: string | null;
          break_minutes?: number | null;
          training_hours?: number | null;
          notes?: string | null;
          status?: string;
          regular_hours?: number | null;
          ot_hours?: number | null;
          discrepancy_flag?: boolean | null;
          lateness_tier?: number | null;
          override_by?: string | null;
          override_at?: string | null;
          updated_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          employee_id?: string | null;
          shift_id?: string | null;
          date?: string;
          clock_in?: string | null;
          clock_out?: string | null;
          break_minutes?: number | null;
          training_hours?: number | null;
          notes?: string | null;
          status?: string;
          regular_hours?: number | null;
          ot_hours?: number | null;
          discrepancy_flag?: boolean | null;
          lateness_tier?: number | null;
          override_by?: string | null;
          override_at?: string | null;
          updated_at?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tip_allocations: {
        Row: {
          id: string;
          tip_sheet_id: string | null;
          employee_id: string | null;
          role: string | null;
          hours: number | null;
          points: number | null;
          service_charge_amount: number | null;
          non_cash_amount: number | null;
          total_amount: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          tip_sheet_id?: string | null;
          employee_id?: string | null;
          role?: string | null;
          hours?: number | null;
          points?: number | null;
          service_charge_amount?: number | null;
          non_cash_amount?: number | null;
          total_amount?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          tip_sheet_id?: string | null;
          employee_id?: string | null;
          role?: string | null;
          hours?: number | null;
          points?: number | null;
          service_charge_amount?: number | null;
          non_cash_amount?: number | null;
          total_amount?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tip_pools: {
        Row: {
          tenant_id: string;
          id: string;
          outlet_id: string | null;
          name: string | null;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          outlet_id?: string | null;
          name?: string | null;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          outlet_id?: string | null;
          name?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tip_sheet_rows: {
        Row: {
          tenant_id: string;
          id: string;
          tip_sheet_id: string | null;
          employee_id: string | null;
          hours: number | null;
          tip_amount: number | null;
          declared_service_charge: number | null;
          declared_non_cash: number | null;
          role: string | null;
          sc_amount: number | null;
          nc_amount: number | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          tip_sheet_id?: string | null;
          employee_id?: string | null;
          hours?: number | null;
          tip_amount?: number | null;
          declared_service_charge?: number | null;
          declared_non_cash?: number | null;
          role?: string | null;
          sc_amount?: number | null;
          nc_amount?: number | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          tip_sheet_id?: string | null;
          employee_id?: string | null;
          hours?: number | null;
          tip_amount?: number | null;
          declared_service_charge?: number | null;
          declared_non_cash?: number | null;
          role?: string | null;
          sc_amount?: number | null;
          nc_amount?: number | null;
        };
        Relationships: [];
      };
      tip_sheets: {
        Row: {
          tenant_id: string;
          id: string;
          service_name: string | null;
          department: string | null;
          outlet_id: string | null;
          date: string;
          week_start: string | null;
          shift_type: string | null;
          source: string | null;
          service_charge: number | null;
          non_cash_tips: number | null;
          status: string;
          created_at: string | null;
        };
        Insert: {
          tenant_id?: string;
          id?: string;
          service_name?: string | null;
          department?: string | null;
          outlet_id?: string | null;
          date: string;
          week_start?: string | null;
          shift_type?: string | null;
          source?: string | null;
          service_charge?: number | null;
          non_cash_tips?: number | null;
          status?: string;
          created_at?: string | null;
        };
        Update: {
          tenant_id?: string;
          id?: string;
          service_name?: string | null;
          department?: string | null;
          outlet_id?: string | null;
          date?: string;
          week_start?: string | null;
          shift_type?: string | null;
          source?: string | null;
          service_charge?: number | null;
          non_cash_tips?: number | null;
          status?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_tenant_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      enforce_device_limit: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_device_label: string | null;
        };
        Returns: string[];
      };
      is_restaurant_manager: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      pay_breakdown: {
        Args: { p_start: string; p_end: string; p_mode?: string };
        Returns: {
          employee_id: string;
          first_name: string;
          last_name: string;
          title: string;
          department: string;
          job_position: string;
          outlet_name: string;
          regular_hours: number;
          ot_hours: number;
          training_hours: number;
          pto_hours: number;
          projected_hours: number;
          approved_count: number;
          scheduled_count: number;
          regular_rate: number;
          ot_rate_effective: number;
          training_rate: number;
          pto_rate: number;
          regular_pay: number;
          ot_pay: number;
          training_pay: number;
          pto_pay: number;
          manager_amount: number;
          tip_rows_amount: number;
          sc_tips: number;
          nc_tips: number;
          tip_pay: number;
          gross_pay: number;
          has_missing_rate: boolean;
          warnings: string[];
          pay_type: string;
        }[];
      };
      pay_post_period: {
        Args: { p_start: string; p_end: string };
        Returns: Json;
      };
      pto_accrue_for_timecard: {
        Args: { p_timecard_id: string };
        Returns: undefined;
      };
      pto_adjust_balance: {
        Args: { p_employee_id: string; p_delta: number; p_notes?: string };
        Returns: Json;
      };
      pto_approve: {
        Args: { p_request_id: string; p_periods: Json };
        Returns: Json;
      };
      pto_deny: {
        Args: { p_request_id: string; p_notes?: string };
        Returns: Json;
      };
      pto_recompute_balance: {
        Args: { p_employee_id: string };
        Returns: undefined;
      };
      pto_summary: {
        Args: { p_employee_id: string };
        Returns: Json;
      };
      pto_unapprove: {
        Args: { p_request_id: string };
        Returns: Json;
      };
      swap_accept: {
        Args: { p_swap_id: string };
        Returns: Json;
      };
      swap_cancel: {
        Args: { p_swap_id: string };
        Returns: Json;
      };
      swap_create: {
        Args: { p_shift_id: string; p_new_employee_id: string; p_notes?: string };
        Returns: Json;
      };
      tc_add_note: {
        Args: { p_timecard_id: string; p_note: string };
        Returns: Json;
      };
      tc_approve: {
        Args: { p_timecard_id: string; p_training_hours?: number };
        Returns: Json;
      };
      tc_create_adhoc: {
        Args: {
          p_employee_id: string;
          p_date: string;
          p_clock_in?: string;
          p_clock_out?: string;
          p_break_minutes?: number;
          p_notes?: string;
        };
        Returns: Json;
      };
      tc_lateness_range: {
        Args: { p_start: string; p_end: string };
        Returns: {
          shift_id: string;
          timecard_id: string;
          employee_id: string;
          work_date: string;
          lateness_tier: number;
          minutes_late: number;
        }[];
      };
      tc_override: {
        Args: { p_timecard_id: string; p_field: string; p_value: string; p_note: string };
        Returns: Json;
      };
      tc_save: {
        Args: {
          p_timecard_id?: string;
          p_shift_id?: string;
          p_employee_id?: string;
          p_date?: string;
          p_clock_in?: string;
          p_clock_out?: string;
          p_break_minutes?: number;
          p_training_hours?: number;
          p_notes?: string;
        };
        Returns: Json;
      };
      tc_set_status: {
        Args: { p_timecard_id: string; p_to: string };
        Returns: Json;
      };
      ts_add_large_party: {
        Args: { p_tip_sheet_id: string; p_revenue: number; p_manager_employee_id?: string };
        Returns: Json;
      };
      ts_compute: {
        Args: { p_tip_sheet_id: string };
        Returns: Json;
      };
      ts_post: {
        Args: { p_tip_sheet_id: string };
        Returns: Json;
      };
      ts_reassign_manager: {
        Args: { p_lpr_id: string; p_manager_employee_id: string };
        Returns: Json;
      };
      ts_unpost: {
        Args: { p_tip_sheet_id: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Database;

type DefaultSchema = DatabaseWithoutInternals["public"];

export type Tables<
  TableName extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] &
  DefaultSchema["Views"])[TableName] extends { Row: infer R }
  ? R
  : never;

export type TablesInsert<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName] extends { Insert: infer I } ? I : never;

export type TablesUpdate<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName] extends { Update: infer U } ? U : never;

export type Functions<
  FunctionName extends keyof DefaultSchema["Functions"],
> = DefaultSchema["Functions"][FunctionName];
