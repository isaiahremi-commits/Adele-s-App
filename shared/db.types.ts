export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      approved_weeks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          outlet_id: string
          period_start_date: string
          tenant_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          outlet_id: string
          period_start_date: string
          tenant_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          outlet_id?: string
          period_start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approved_weeks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approved_weeks_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approved_weeks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_reads: {
        Row: {
          broadcast_id: string
          employee_id: string
          read_at: string
          tenant_id: string
        }
        Insert: {
          broadcast_id: string
          employee_id: string
          read_at?: string
          tenant_id?: string
        }
        Update: {
          broadcast_id?: string
          employee_id?: string
          read_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_reads_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_reads_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_reads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_replies: {
        Row: {
          body: string
          broadcast_id: string
          created_at: string | null
          id: string
          sender_employee_id: string
          tenant_id: string
        }
        Insert: {
          body: string
          broadcast_id: string
          created_at?: string | null
          id?: string
          sender_employee_id: string
          tenant_id?: string
        }
        Update: {
          body?: string
          broadcast_id?: string
          created_at?: string | null
          id?: string
          sender_employee_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_replies_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_replies_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_replies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_employee_ids: string[] | null
          audience_type: string
          body: string
          created_at: string | null
          id: string
          sender_employee_id: string
          tenant_id: string
        }
        Insert: {
          audience_employee_ids?: string[] | null
          audience_type: string
          body: string
          created_at?: string | null
          id?: string
          sender_employee_id: string
          tenant_id?: string
        }
        Update: {
          audience_employee_ids?: string[] | null
          audience_type?: string
          body?: string
          created_at?: string | null
          id?: string
          sender_employee_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      callout_history: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          entered_by: string | null
          id: string
          notes: string | null
          reason: string | null
          shift_id: string | null
          status: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          entered_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          shift_id?: string | null
          status?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          entered_by?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          shift_id?: string | null
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "callout_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callout_history_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callout_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callout_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requests: {
        Row: {
          callout_id: string
          created_at: string | null
          id: string
          manager_decision_at: string | null
          manager_decision_by: string | null
          notes: string | null
          shift_id: string
          status: string
          tenant_id: string
          volunteer_employee_id: string | null
        }
        Insert: {
          callout_id: string
          created_at?: string | null
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          notes?: string | null
          shift_id: string
          status?: string
          tenant_id?: string
          volunteer_employee_id?: string | null
        }
        Update: {
          callout_id?: string
          created_at?: string | null
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          notes?: string | null
          shift_id?: string
          status?: string
          tenant_id?: string
          volunteer_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requests_callout_id_fkey"
            columns: ["callout_id"]
            isOneToOne: true
            referencedRelation: "callout_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_manager_decision_by_fkey"
            columns: ["manager_decision_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_volunteer_employee_id_fkey"
            columns: ["volunteer_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      department_positions: {
        Row: {
          created_at: string
          department_id: string
          id: string
          position_name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          position_name: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          position_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_positions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_positions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string | null
          id: string
          name: string
          tenant_id: string
          tip_pool_strategy: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          tenant_id?: string
          tip_pool_strategy?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
          tip_pool_strategy?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          created_at: string | null
          device_label: string | null
          id: string
          last_seen_at: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_label?: string | null
          id?: string
          last_seen_at?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_label?: string | null
          id?: string
          last_seen_at?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_outlets: {
        Row: {
          employee_id: string | null
          id: string
          outlet_id: string | null
          position_name: string | null
          tenant_id: string
        }
        Insert: {
          employee_id?: string | null
          id?: string
          outlet_id?: string | null
          position_name?: string | null
          tenant_id?: string
        }
        Update: {
          employee_id?: string | null
          id?: string
          outlet_id?: string | null
          position_name?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_outlets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_outlets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_outlets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          annual_salary: number | null
          auth_user_id: string | null
          created_at: string | null
          date_of_birth: string | null
          date_of_hire: string | null
          department: string | null
          department_id: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_number: string | null
          // employment_type + seasonal_* HAND-ADDED for pending migration
          // 028 — regenerating types before 028 is applied will silently
          // drop these entries; re-add or regen after.
          employment_type: string
          first_name: string
          has_completed_self_onboarding: boolean
          home_address: string | null
          home_outlet_id: string | null
          home_position: string | null
          id: string
          last_name: string
          ot_rate: number | null
          pay_type: string
          phone: string | null
          position: string | null
          pto_rate: number | null
          regular_rate: number | null
          seasonal_end_date: string | null
          seasonal_start_date: string | null
          shirt_size: string | null
          sms_opt_in: boolean
          sms_opt_in_pending: boolean
          sms_opted_in_at: string | null
          tenant_id: string
          termination_date: string | null
          title: string | null
          training_rate: number | null
        }
        Insert: {
          annual_salary?: number | null
          auth_user_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          date_of_hire?: string | null
          department?: string | null
          department_id?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_number?: string | null
          employment_type?: string
          first_name: string
          has_completed_self_onboarding?: boolean
          home_address?: string | null
          home_outlet_id?: string | null
          home_position?: string | null
          id?: string
          last_name: string
          ot_rate?: number | null
          pay_type?: string
          phone?: string | null
          position?: string | null
          pto_rate?: number | null
          regular_rate?: number | null
          seasonal_end_date?: string | null
          seasonal_start_date?: string | null
          shirt_size?: string | null
          sms_opt_in?: boolean
          sms_opt_in_pending?: boolean
          sms_opted_in_at?: string | null
          tenant_id?: string
          termination_date?: string | null
          title?: string | null
          training_rate?: number | null
        }
        Update: {
          annual_salary?: number | null
          auth_user_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          date_of_hire?: string | null
          department?: string | null
          department_id?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_number?: string | null
          employment_type?: string
          first_name?: string
          has_completed_self_onboarding?: boolean
          home_address?: string | null
          home_outlet_id?: string | null
          home_position?: string | null
          id?: string
          last_name?: string
          ot_rate?: number | null
          pay_type?: string
          phone?: string | null
          position?: string | null
          pto_rate?: number | null
          regular_rate?: number | null
          seasonal_end_date?: string | null
          seasonal_start_date?: string | null
          shirt_size?: string | null
          sms_opt_in?: boolean
          sms_opt_in_pending?: boolean
          sms_opted_in_at?: string | null
          tenant_id?: string
          termination_date?: string | null
          title?: string | null
          training_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_home_outlet_id_fkey"
            columns: ["home_outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eod_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          report_date: string
          submitted_by: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          report_date: string
          submitted_by?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          report_date?: string
          submitted_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eod_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eod_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      large_party_revenues: {
        Row: {
          created_at: string
          declared_by_row_id: string | null
          house_amount: number | null
          id: string
          manager_amount: number | null
          manager_employee_id: string | null
          notes: string | null
          pool_amount: number | null
          revenue: number
          tenant_id: string
          tip_sheet_id: string
        }
        Insert: {
          created_at?: string
          declared_by_row_id?: string | null
          house_amount?: number | null
          id?: string
          manager_amount?: number | null
          manager_employee_id?: string | null
          notes?: string | null
          pool_amount?: number | null
          revenue: number
          tenant_id?: string
          tip_sheet_id: string
        }
        Update: {
          created_at?: string
          declared_by_row_id?: string | null
          house_amount?: number | null
          id?: string
          manager_amount?: number | null
          manager_employee_id?: string | null
          notes?: string | null
          pool_amount?: number | null
          revenue?: number
          tenant_id?: string
          tip_sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "large_party_revenues_declared_by_row_id_fkey"
            columns: ["declared_by_row_id"]
            isOneToOne: false
            referencedRelation: "tip_sheet_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "large_party_revenues_manager_employee_id_fkey"
            columns: ["manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "large_party_revenues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "large_party_revenues_tip_sheet_id_fkey"
            columns: ["tip_sheet_id"]
            isOneToOne: false
            referencedRelation: "tip_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      late_signals: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          minutes_late: number
          shift_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          minutes_late: number
          shift_id?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          minutes_late?: number
          shift_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_signals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_signals_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "late_signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lateness_history: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          shift_id: string | null
          tenant_id: string
          timecard_id: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          shift_id?: string | null
          tenant_id?: string
          timecard_id: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          shift_id?: string | null
          tenant_id?: string
          timecard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lateness_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lateness_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lateness_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lateness_history_timecard_id_fkey"
            columns: ["timecard_id"]
            isOneToOne: false
            referencedRelation: "timecards"
            referencedColumns: ["id"]
          },
        ]
      }
      missed_punch_alerts: {
        Row: {
          alerted_at: string
          employee_id: string
          id: string
          resolved_at: string | null
          shift_id: string
          tenant_id: string
        }
        Insert: {
          alerted_at?: string
          employee_id: string
          id?: string
          resolved_at?: string | null
          shift_id: string
          tenant_id: string
        }
        Update: {
          alerted_at?: string
          employee_id?: string
          id?: string
          resolved_at?: string | null
          shift_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "missed_punch_alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_punch_alerts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_punch_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      missed_punch_requests: {
        Row: {
          created_at: string
          decision_reason: string | null
          employee_id: string
          id: string
          manager_decision_at: string | null
          manager_decision_by: string | null
          reason: string | null
          requested_clock_in: string
          requested_clock_out: string
          shift_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          decision_reason?: string | null
          employee_id: string
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          reason?: string | null
          requested_clock_in: string
          requested_clock_out: string
          shift_id: string
          status?: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          decision_reason?: string | null
          employee_id?: string
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          reason?: string | null
          requested_clock_in?: string
          requested_clock_out?: string
          shift_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "missed_punch_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_punch_requests_manager_decision_by_fkey"
            columns: ["manager_decision_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_punch_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missed_punch_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_pars: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          outlet_id: string
          position_name: string
          required_count: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          outlet_id: string
          position_name: string
          required_count: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          outlet_id?: string
          position_name?: string
          required_count?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_pars_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_pars_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_roles: {
        Row: {
          id: string
          is_tipped: boolean
          outlet_id: string | null
          points: number
          pool_id: string | null
          position_name: string
          tenant_id: string
          tip_out_pct: number | null
          tip_out_revenue_source: string | null
        }
        Insert: {
          id?: string
          is_tipped?: boolean
          outlet_id?: string | null
          points?: number
          pool_id?: string | null
          position_name: string
          tenant_id?: string
          tip_out_pct?: number | null
          tip_out_revenue_source?: string | null
        }
        Update: {
          id?: string
          is_tipped?: boolean
          outlet_id?: string | null
          points?: number
          pool_id?: string | null
          position_name?: string
          tenant_id?: string
          tip_out_pct?: number | null
          tip_out_revenue_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlet_roles_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_roles_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "tip_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_services: {
        Row: {
          end_time: string | null
          id: string
          name: string
          outlet_id: string | null
          start_time: string | null
        }
        Insert: {
          end_time?: string | null
          id?: string
          name: string
          outlet_id?: string | null
          start_time?: string | null
        }
        Update: {
          end_time?: string | null
          id?: string
          name?: string
          outlet_id?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlet_services_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          created_at: string | null
          department_id: string
          id: string
          name: string
          tenant_id: string
          tip_pool_mode: string | null
        }
        Insert: {
          created_at?: string | null
          department_id: string
          id?: string
          name: string
          tenant_id?: string
          tip_pool_mode?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string
          id?: string
          name?: string
          tenant_id?: string
          tip_pool_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          active: boolean | null
          created_at: string | null
          end_date: string
          id: string
          name: string | null
          pay_date: string | null
          start_date: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          end_date: string
          id?: string
          name?: string | null
          pay_date?: string | null
          start_date: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          end_date?: string
          id?: string
          name?: string | null
          pay_date?: string | null
          start_date?: string
        }
        Relationships: []
      }
      pto_allocations: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          paid_hours: number
          pay_period_end: string
          pay_period_start: string
          pto_request_id: string
          tenant_id: string
          unpaid_hours: number
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          paid_hours: number
          pay_period_end: string
          pay_period_start: string
          pto_request_id: string
          tenant_id?: string
          unpaid_hours?: number
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          paid_hours?: number
          pay_period_end?: string
          pay_period_start?: string
          pto_request_id?: string
          tenant_id?: string
          unpaid_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "pto_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_allocations_pto_request_id_fkey"
            columns: ["pto_request_id"]
            isOneToOne: false
            referencedRelation: "pto_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_balance_transactions: {
        Row: {
          created_at: string
          delta_hours: number
          employee_id: string
          id: string
          notes: string | null
          reference_id: string | null
          tenant_id: string
          transaction_type: string
        }
        Insert: {
          created_at?: string
          delta_hours: number
          employee_id: string
          id?: string
          notes?: string | null
          reference_id?: string | null
          tenant_id?: string
          transaction_type: string
        }
        Update: {
          created_at?: string
          delta_hours?: number
          employee_id?: string
          id?: string
          notes?: string | null
          reference_id?: string | null
          tenant_id?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pto_balance_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_balance_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_balances: {
        Row: {
          balance_hours: number
          employee_id: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          balance_hours?: number
          employee_id: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          balance_hours?: number
          employee_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pto_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          employee_id: string
          end_date: string
          id: string
          notes: string | null
          reason: string
          requested_at: string
          start_date: string
          status: string
          tenant_id: string
          total_hours_requested: number
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          employee_id: string
          end_date: string
          id?: string
          notes?: string | null
          reason: string
          requested_at?: string
          start_date: string
          status?: string
          tenant_id?: string
          total_hours_requested: number
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          notes?: string | null
          reason?: string
          requested_at?: string
          start_date?: string
          status?: string
          tenant_id?: string
          total_hours_requested?: number
        }
        Relationships: [
          {
            foreignKeyName: "pto_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string | null
          id: string
          name: string
          outlet_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          outlet_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          outlet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      setup: {
        Row: {
          callout_threshold_count: number
          callout_threshold_window_days: number
          company_name: string | null
          discrepancy_threshold_hours: number
          id: string
          lateness_tier1_minutes: number
          lateness_tier2_minutes: number
          pay_cycle: string
          period_start_day: string
          // setup_locked_at HAND-ADDED for pending migration 028 —
          // regenerating types before 028 is applied will silently drop
          // this entry; re-add or regen after.
          setup_locked_at: string | null
          tenant_id: string
          timezone: string
          updated_at: string | null
        }
        Insert: {
          callout_threshold_count?: number
          callout_threshold_window_days?: number
          company_name?: string | null
          discrepancy_threshold_hours?: number
          id?: string
          lateness_tier1_minutes?: number
          lateness_tier2_minutes?: number
          pay_cycle?: string
          period_start_day?: string
          setup_locked_at?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string | null
        }
        Update: {
          callout_threshold_count?: number
          callout_threshold_window_days?: number
          company_name?: string | null
          discrepancy_threshold_hours?: number
          id?: string
          lateness_tier1_minutes?: number
          lateness_tier2_minutes?: number
          pay_cycle?: string
          period_start_day?: string
          setup_locked_at?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "setup_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string | null
          date: string | null
          day_of_week: number | null
          department: string | null
          employee_id: string | null
          end_time: string | null
          id: string
          is_event: boolean
          is_training: boolean
          notes: string | null
          outlet_id: string | null
          position: string | null
          shift_type: string | null
          start_time: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          day_of_week?: number | null
          department?: string | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          is_event?: boolean
          is_training?: boolean
          notes?: string | null
          outlet_id?: string | null
          position?: string | null
          shift_type?: string | null
          start_time?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string | null
          date?: string | null
          day_of_week?: number | null
          department?: string | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          is_event?: boolean
          is_training?: boolean
          notes?: string | null
          outlet_id?: string | null
          position?: string | null
          shift_type?: string | null
          start_time?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_log: {
        Row: {
          created_at: string
          direction: string
          error_message: string | null
          id: string
          message: string
          recipient_employee_id: string | null
          recipient_phone: string
          related_entity_id: string | null
          related_entity_type: string | null
          sms_type: string | null
          status: string
          twilio_sid: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          message: string
          recipient_employee_id?: string | null
          recipient_phone: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sms_type?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          message?: string
          recipient_employee_id?: string | null
          recipient_phone?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sms_type?: string | null
          status?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_log_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_settings: {
        Row: {
          id: number
          schedule_published_enabled: boolean
          shift_reminder_enabled: boolean
          shift_reminder_hours_before: number
          tip_approved_enabled: boolean
          updated_at: string
        }
        Insert: {
          id?: number
          schedule_published_enabled?: boolean
          shift_reminder_enabled?: boolean
          shift_reminder_hours_before?: number
          tip_approved_enabled?: boolean
          updated_at?: string
        }
        Update: {
          id?: number
          schedule_published_enabled?: boolean
          shift_reminder_enabled?: boolean
          shift_reminder_hours_before?: number
          tip_approved_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      swap_history: {
        Row: {
          created_at: string
          id: string
          manager_decision_at: string | null
          manager_decision_by: string | null
          new_employee_id: string
          notes: string | null
          original_employee_id: string
          shift_id: string
          status: string
          swapped_by: string | null
          target_accepted_at: string | null
          target_shift_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          new_employee_id: string
          notes?: string | null
          original_employee_id: string
          shift_id: string
          status?: string
          swapped_by?: string | null
          target_accepted_at?: string | null
          target_shift_id?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_decision_at?: string | null
          manager_decision_by?: string | null
          new_employee_id?: string
          notes?: string | null
          original_employee_id?: string
          shift_id?: string
          status?: string
          swapped_by?: string | null
          target_accepted_at?: string | null
          target_shift_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_history_manager_decision_by_fkey"
            columns: ["manager_decision_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_new_employee_id_fkey"
            columns: ["new_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_original_employee_id_fkey"
            columns: ["original_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_swapped_by_fkey"
            columns: ["swapped_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swap_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      timecard_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          notes: string | null
          tenant_id: string
          timecard_id: string
          value_after: Json | null
          value_before: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          notes?: string | null
          tenant_id?: string
          timecard_id: string
          value_after?: Json | null
          value_before?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          timecard_id?: string
          value_after?: Json | null
          value_before?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "timecard_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timecard_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timecard_events_timecard_id_fkey"
            columns: ["timecard_id"]
            isOneToOne: false
            referencedRelation: "timecards"
            referencedColumns: ["id"]
          },
        ]
      }
      timecards: {
        Row: {
          break_minutes: number
          break1_in: string | null
          break1_out: string | null
          break2_in: string | null
          break2_out: string | null
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          discrepancy_flag: boolean
          employee_id: string
          id: string
          lateness_tier: number
          notes: string | null
          ot_hours: number | null
          override_at: string | null
          override_by: string | null
          regular_hours: number | null
          shift_id: string | null
          status: string
          tenant_id: string
          training_hours: number | null
          updated_at: string
        }
        Insert: {
          break_minutes?: number
          break1_in?: string | null
          break1_out?: string | null
          break2_in?: string | null
          break2_out?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          discrepancy_flag?: boolean
          employee_id: string
          id?: string
          lateness_tier?: number
          notes?: string | null
          ot_hours?: number | null
          override_at?: string | null
          override_by?: string | null
          regular_hours?: number | null
          shift_id?: string | null
          status?: string
          tenant_id?: string
          training_hours?: number | null
          updated_at?: string
        }
        Update: {
          break_minutes?: number
          break1_in?: string | null
          break1_out?: string | null
          break2_in?: string | null
          break2_out?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          discrepancy_flag?: boolean
          employee_id?: string
          id?: string
          lateness_tier?: number
          notes?: string | null
          ot_hours?: number | null
          override_at?: string | null
          override_by?: string | null
          regular_hours?: number | null
          shift_id?: string | null
          status?: string
          tenant_id?: string
          training_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timecards_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timecards_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timecards_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timecards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_allocations: {
        Row: {
          created_at: string | null
          employee_id: string | null
          hours: number | null
          id: string
          non_cash_amount: number | null
          points: number | null
          role: string | null
          service_charge_amount: number | null
          tip_sheet_id: string | null
          total_amount: number | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          non_cash_amount?: number | null
          points?: number | null
          role?: string | null
          service_charge_amount?: number | null
          tip_sheet_id?: string | null
          total_amount?: number | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          non_cash_amount?: number | null
          points?: number | null
          role?: string | null
          service_charge_amount?: number | null
          tip_sheet_id?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_allocations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_allocations_tip_sheet_id_fkey"
            columns: ["tip_sheet_id"]
            isOneToOne: false
            referencedRelation: "tip_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_pools: {
        Row: {
          created_at: string
          id: string
          name: string
          outlet_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          outlet_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          outlet_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pools_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_pools_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_sheet_rows: {
        Row: {
          declared_non_cash: number | null
          declared_service_charge: number | null
          employee_id: string | null
          hours: number | null
          id: string
          nc_amount: number | null
          role: string | null
          sc_amount: number | null
          tenant_id: string
          tip_amount: number | null
          tip_sheet_id: string | null
        }
        Insert: {
          declared_non_cash?: number | null
          declared_service_charge?: number | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          nc_amount?: number | null
          role?: string | null
          sc_amount?: number | null
          tenant_id?: string
          tip_amount?: number | null
          tip_sheet_id?: string | null
        }
        Update: {
          declared_non_cash?: number | null
          declared_service_charge?: number | null
          employee_id?: string | null
          hours?: number | null
          id?: string
          nc_amount?: number | null
          role?: string | null
          sc_amount?: number | null
          tenant_id?: string
          tip_amount?: number | null
          tip_sheet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_sheet_rows_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_sheet_rows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_sheet_rows_tip_sheet_id_fkey"
            columns: ["tip_sheet_id"]
            isOneToOne: false
            referencedRelation: "tip_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_sheets: {
        Row: {
          created_at: string | null
          date: string | null
          department: string | null
          id: string
          non_cash_tips: number | null
          outlet_id: string | null
          service_charge: number | null
          service_name: string | null
          shift_type: string | null
          source: string | null
          status: string | null
          tenant_id: string
          week_start: string | null
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          department?: string | null
          id?: string
          non_cash_tips?: number | null
          outlet_id?: string | null
          service_charge?: number | null
          service_name?: string | null
          shift_type?: string | null
          source?: string | null
          status?: string | null
          tenant_id?: string
          week_start?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          department?: string | null
          id?: string
          non_cash_tips?: number | null
          outlet_id?: string | null
          service_charge?: number | null
          service_name?: string | null
          shift_type?: string | null
          source?: string | null
          status?: string | null
          tenant_id?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_sheets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_sheets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      am_i_a_manager: { Args: never; Returns: boolean }
      assert_manager_or_service: { Args: never; Returns: undefined }
      broadcast_mark_read: {
        Args: { p_broadcast_id: string }
        Returns: undefined
      }
      broadcast_read_receipts: {
        Args: { p_broadcast_id: string }
        Returns: {
          employee_id: string
          employee_name: string
          read_at: string
        }[]
      }
      broadcast_reply: {
        Args: { p_body: string; p_broadcast_id: string }
        Returns: string
      }
      broadcast_send: {
        Args: {
          p_audience_employee_ids?: string[]
          p_audience_type: string
          p_body: string
        }
        Returns: string
      }
      broadcast_thread: {
        Args: { p_broadcast_id: string }
        Returns: {
          body: string
          created_at: string
          item_id: string
          kind: string
          sender_employee_id: string
          sender_name: string
        }[]
      }
      callout_submit: {
        Args: { p_notes?: string; p_reason: string; p_shift_id: string }
        Returns: string
      }
      can_see_broadcast: { Args: { p_broadcast_id: string }; Returns: boolean }
      coverage_approve: {
        Args: { p_coverage_request_id: string }
        Returns: undefined
      }
      coverage_available_for_me: {
        Args: never
        Returns: {
          end_time: string
          outlet_id: string
          outlet_name: string
          request_id: string
          requested_by: string
          shift_date: string
          shift_id: string
          shift_position: string
          start_time: string
        }[]
      }
      coverage_deny: {
        Args: { p_coverage_request_id: string; p_reason?: string }
        Returns: undefined
      }
      coverage_offer: {
        Args: { p_coverage_request_id: string }
        Returns: undefined
      }
      coverage_withdraw: {
        Args: { p_coverage_request_id: string }
        Returns: undefined
      }
      current_employee_id: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      department_delete: { Args: { p_id: string }; Returns: undefined }
      department_list: {
        Args: never
        Returns: {
          id: string
          name: string
          outlet_count: number
          position_count: number
          type: string
        }[]
      }
      department_position_add: {
        Args: { p_department_id: string; p_position_name: string }
        Returns: string
      }
      department_position_remove: {
        Args: { p_department_id: string; p_position_name: string }
        Returns: number
      }
      department_upsert: {
        Args: { p_id?: string; p_name: string }
        Returns: string
      }
      employee_can_see_tip_sheet: {
        Args: { p_outlet_id: string; p_sheet_id: string }
        Returns: boolean
      }
      employee_eligible_for_coverage: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      employee_eligible_for_swap: {
        Args: { p_candidate_id: string; p_shift_id: string }
        Returns: boolean
      }
      employee_is_tipped: { Args: { p_employee_id?: string }; Returns: boolean }
      employee_pay_settings: {
        Args: never
        Returns: {
          callout_threshold_count: number
          callout_threshold_window_days: number
          pay_cycle: string
          period_start_day: string
        }[]
      }
      employee_reactivate: { Args: { p_employee_id: string }; Returns: Json }
      employee_reset_password_needed: {
        Args: { p_employee_id: string }
        Returns: Json
      }
      employee_sees_team_shift: {
        Args: { p_outlet_id: string; p_owner_id: string }
        Returns: boolean
      }
      // HAND-ADDED for pending migration 028 — regenerating types before
      // 028 is applied will silently drop this entry; re-add or regen after.
      employee_tip_totals_ytd: {
        Args: never
        Returns: {
          employee_id: string
          total_tips: number
          total_sc: number
          total_nc: number
        }[]
      }
      employee_self_onboard: {
        Args: {
          p_address?: string
          p_dob?: string
          p_emergency_name?: string
          p_emergency_phone?: string
          p_phone?: string
          p_tshirt_size?: string
        }
        Returns: Json
      }
      employee_terminate: {
        Args: { p_employee_id: string; p_termination_date?: string }
        Returns: Json
      }
      enforce_device_limit: {
        Args: {
          p_device_label: string
          p_session_id: string
          p_user_id: string
        }
        Returns: string[]
      }
      enforce_termination_lockouts: { Args: never; Returns: Json }
      is_restaurant_manager: { Args: never; Returns: boolean }
      large_party_add: {
        Args: {
          p_amount: number
          p_date: string
          p_notes?: string
          p_outlet_id: string
        }
        Returns: string
      }
      manager_approval_inbox: { Args: never; Returns: Json }
      missed_punch_request_approve: {
        Args: { p_request_id: string }
        Returns: Json
      }
      missed_punch_request_cancel: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      missed_punch_request_deny: {
        Args: { p_reason?: string; p_request_id: string }
        Returns: undefined
      }
      missed_punch_request_submit: {
        Args: {
          p_clock_in: string
          p_clock_out: string
          p_reason?: string
          p_shift_id: string
        }
        Returns: string
      }
      my_callouts_and_coverage: {
        Args: never
        Returns: {
          callout_id: string
          callout_status: string
          coverage_status: string
          created_at: string
          end_time: string
          kind: string
          notes: string
          outlet_name: string
          reason: string
          request_id: string
          requested_by: string
          shift_date: string
          shift_id: string
          shift_position: string
          start_time: string
          volunteer_name: string
        }[]
      }
      my_inbox: {
        Args: never
        Returns: {
          audience_type: string
          body: string
          broadcast_id: string
          created_at: string
          is_mine: boolean
          is_read: boolean
          reply_count: number
          sender_employee_id: string
          sender_name: string
        }[]
      }
      my_sent_broadcasts: {
        Args: never
        Returns: {
          audience_type: string
          body: string
          broadcast_id: string
          created_at: string
          read_count: number
          reply_count: number
          total_audience_size: number
        }[]
      }
      my_swap_requests: {
        Args: never
        Returns: {
          counterparty_name: string
          created_at: string
          direction: string
          manager_decision_at: string
          offered_end_time: string
          offered_outlet_name: string
          offered_position: string
          offered_shift_date: string
          offered_shift_id: string
          offered_start_time: string
          requested_end_time: string
          requested_outlet_name: string
          requested_position: string
          requested_shift_date: string
          requested_shift_id: string
          requested_start_time: string
          status: string
          swap_id: string
          target_accepted_at: string
        }[]
      }
      my_teammate_shifts: {
        Args: { p_end: string; p_start: string }
        Returns: {
          employee_id: string
          end_time: string
          first_name: string
          last_name: string
          notes: string
          outlet_id: string
          outlet_name: string
          shift_date: string
          shift_id: string
          shift_position: string
          shift_type: string
          start_time: string
        }[]
      }
      outlet_assign_position: {
        Args: {
          p_outlet_id: string
          p_points?: number
          p_position_name: string
        }
        Returns: string
      }
      outlet_detail: { Args: { p_outlet_id: string }; Returns: Json }
      outlet_list_for_department: {
        Args: { p_department_id: string }
        Returns: {
          employee_count: number
          id: string
          name: string
          position_count: number
          tip_pool_mode: string
        }[]
      }
      outlet_unassign_position: {
        Args: { p_outlet_id: string; p_position_name: string }
        Returns: number
      }
      outlet_upsert: {
        Args: {
          p_department_id: string
          p_id?: string
          p_name: string
          p_tip_pool_mode?: string
        }
        Returns: string
      }
      par_compliance_for_week: {
        Args: { p_start_date: string }
        Returns: {
          date: string
          day_of_week: number
          delta: number
          has_par: boolean
          outlet_id: string
          outlet_name: string
          position_name: string
          required: number
          scheduled: number
        }[]
      }
      par_delete: {
        Args: {
          p_day_of_week: number
          p_outlet_id: string
          p_position_name: string
        }
        Returns: number
      }
      par_list_for_outlet: {
        Args: { p_outlet_id: string }
        Returns: {
          day_of_week: number
          id: string
          outlet_id: string
          position_name: string
          required_count: number
        }[]
      }
      par_upsert: {
        Args: {
          p_day_of_week: number
          p_outlet_id: string
          p_position_name: string
          p_required_count: number
        }
        Returns: string
      }
      pay_breakdown: {
        Args: { p_end: string; p_mode?: string; p_start: string }
        Returns: {
          approved_count: number
          department: string
          employee_id: string
          first_name: string
          gross_pay: number
          has_missing_rate: boolean
          job_position: string
          last_name: string
          manager_amount: number
          nc_tips: number
          ot_hours: number
          ot_pay: number
          ot_rate_effective: number
          outlet_name: string
          pay_type: string
          projected_hours: number
          pto_hours: number
          pto_pay: number
          pto_rate: number
          regular_hours: number
          regular_pay: number
          regular_rate: number
          sc_tips: number
          scheduled_count: number
          tip_pay: number
          tip_rows_amount: number
          title: string
          training_hours: number
          training_pay: number
          training_rate: number
          warnings: string[]
        }[]
      }
      pay_breakdown_for_me: {
        Args: { p_end: string; p_mode?: string; p_start: string }
        Returns: {
          approved_count: number
          department: string
          employee_id: string
          first_name: string
          gross_pay: number
          has_missing_rate: boolean
          job_position: string
          last_name: string
          manager_amount: number
          nc_tips: number
          ot_hours: number
          ot_pay: number
          ot_rate_effective: number
          outlet_name: string
          pay_type: string
          projected_hours: number
          pto_hours: number
          pto_pay: number
          pto_rate: number
          regular_hours: number
          regular_pay: number
          regular_rate: number
          sc_tips: number
          scheduled_count: number
          tip_pay: number
          tip_rows_amount: number
          title: string
          training_hours: number
          training_pay: number
          training_rate: number
          warnings: string[]
        }[]
      }
      pay_post_period: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      pay_post_period_unguarded: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      pay_ytd_for_me: {
        Args: never
        Returns: {
          gross_pay: number
          manager_amount: number
          nc_tips: number
          ot_hours: number
          pay_type: string
          pto_hours: number
          regular_hours: number
          sc_tips: number
          tip_pay: number
          training_hours: number
          year: number
        }[]
      }
      pto_accrue_for_timecard: {
        Args: { p_timecard_id: string }
        Returns: undefined
      }
      pto_adjust_balance: {
        Args: { p_delta: number; p_employee_id: string; p_notes?: string }
        Returns: Json
      }
      pto_adjust_balance_unguarded: {
        Args: { p_delta: number; p_employee_id: string; p_notes?: string }
        Returns: Json
      }
      pto_approve: {
        Args: { p_periods: Json; p_request_id: string }
        Returns: Json
      }
      pto_approve_unguarded: {
        Args: { p_periods: Json; p_request_id: string }
        Returns: Json
      }
      pto_cancel: { Args: { p_request_id: string }; Returns: undefined }
      pto_deny: {
        Args: { p_notes?: string; p_request_id: string }
        Returns: Json
      }
      pto_deny_unguarded: {
        Args: { p_notes?: string; p_request_id: string }
        Returns: Json
      }
      pto_modify: {
        Args: {
          p_end_date: string
          p_reason: string
          p_request_id: string
          p_start_date: string
        }
        Returns: undefined
      }
      pto_recompute_balance: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      pto_submit: {
        Args: { p_end_date: string; p_reason: string; p_start_date: string }
        Returns: string
      }
      pto_summary: { Args: { p_employee_id: string }; Returns: Json }
      pto_unapprove: { Args: { p_request_id: string }; Returns: Json }
      pto_unapprove_unguarded: { Args: { p_request_id: string }; Returns: Json }
      running_late_submit: {
        Args: { p_minutes: number; p_shift_id?: string }
        Returns: string
      }
      scan_missed_punches: { Args: never; Returns: Json }
      shift_start_at: {
        Args: { p_date: string; p_start: string }
        Returns: string
      }
      shift_start_ts: {
        Args: { p_date: string; p_start: string }
        Returns: string
      }
      swap_accept: { Args: { p_swap_id: string }; Returns: Json }
      swap_accept_unguarded: { Args: { p_swap_id: string }; Returns: Json }
      swap_cancel: { Args: { p_swap_id: string }; Returns: Json }
      swap_cancel_unguarded: { Args: { p_swap_id: string }; Returns: Json }
      swap_create: {
        Args: {
          p_new_employee_id: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: Json
      }
      swap_create_unguarded: {
        Args: {
          p_new_employee_id: string
          p_notes?: string
          p_shift_id: string
        }
        Returns: Json
      }
      swap_eligible_teammates: {
        Args: { p_shift_id: string }
        Returns: {
          employee_id: string
          employee_name: string
          employee_position: string
          end_time: string
          outlet_name: string
          shift_date: string
          shift_id: string
          shift_position: string
          start_time: string
        }[]
      }
      swap_request_accept: { Args: { p_swap_id: string }; Returns: undefined }
      swap_request_approve: {
        Args: { p_swap_id: string; p_target_shift_id_override?: string }
        Returns: undefined
      }
      swap_request_cancel: { Args: { p_swap_id: string }; Returns: undefined }
      swap_request_decline: { Args: { p_swap_id: string }; Returns: undefined }
      swap_request_deny: {
        Args: { p_reason?: string; p_swap_id: string }
        Returns: undefined
      }
      swap_request_submit: {
        Args: {
          p_my_shift_id: string
          p_target_employee_id: string
          p_target_shift_id?: string
        }
        Returns: string
      }
      tc_add_note: {
        Args: { p_note: string; p_timecard_id: string }
        Returns: Json
      }
      tc_add_note_unguarded: {
        Args: { p_note: string; p_timecard_id: string }
        Returns: Json
      }
      tc_approve: {
        Args: { p_timecard_id: string; p_training_hours?: number }
        Returns: Json
      }
      tc_break_punch: { Args: { p_shift_id: string }; Returns: Json }
      tc_create_adhoc: {
        Args: {
          p_break_minutes?: number
          p_clock_in?: string
          p_clock_out?: string
          p_date: string
          p_employee_id: string
          p_notes?: string
        }
        Returns: Json
      }
      tc_create_adhoc_unguarded: {
        Args: {
          p_break_minutes?: number
          p_clock_in?: string
          p_clock_out?: string
          p_date: string
          p_employee_id: string
          p_notes?: string
        }
        Returns: Json
      }
      tc_lateness_range: {
        Args: { p_end: string; p_start: string }
        Returns: {
          employee_id: string
          lateness_tier: number
          minutes_late: number
          shift_id: string
          timecard_id: string
          work_date: string
        }[]
      }
      tc_override: {
        Args: {
          p_field: string
          p_note: string
          p_timecard_id: string
          p_value: string
        }
        Returns: Json
      }
      tc_override_unguarded: {
        Args: {
          p_field: string
          p_note: string
          p_timecard_id: string
          p_value: string
        }
        Returns: Json
      }
      tc_save: {
        Args: {
          p_break_minutes?: number
          p_break1_in?: string
          p_break1_out?: string
          p_break2_in?: string
          p_break2_out?: string
          p_clock_in?: string
          p_clock_out?: string
          p_date?: string
          p_employee_id?: string
          p_notes?: string
          p_shift_id?: string
          p_timecard_id?: string
          p_training_hours?: number
        }
        Returns: Json
      }
      tc_save_unguarded: {
        Args: {
          p_break_minutes?: number
          p_break1_in?: string
          p_break1_out?: string
          p_break2_in?: string
          p_break2_out?: string
          p_clock_in?: string
          p_clock_out?: string
          p_date?: string
          p_employee_id?: string
          p_notes?: string
          p_shift_id?: string
          p_timecard_id?: string
          p_training_hours?: number
        }
        Returns: Json
      }
      tc_set_status: {
        Args: { p_timecard_id: string; p_to: string }
        Returns: Json
      }
      tc_set_status_unguarded: {
        Args: { p_timecard_id: string; p_to: string }
        Returns: Json
      }
      tenant_today: { Args: never; Returns: string }
      tenant_tz: { Args: never; Returns: string }
      tip_declaration_for_me: {
        Args: { p_outlet_id: string; p_shift_date: string }
        Returns: {
          declared_large_party: number
          declared_non_cash: number
          declared_service_charge: number
          row_id: string
          sheet_exists: boolean
          sheet_open: boolean
          sheet_status: string
          tip_amount: number
          tip_pool_mode: string
        }[]
      }
      tip_declaration_submit: {
        Args: {
          p_large_party_revenue?: number
          p_non_cash: number
          p_outlet_id: string
          p_service_charges: number
          p_shift_date: string
        }
        Returns: string
      }
      tip_history_for_me: {
        Args: { p_from: string; p_to: string }
        Returns: {
          declared_large_party: number
          declared_non_cash: number
          declared_service_charge: number
          outlet_id: string
          outlet_name: string
          sheet_status: string
          shift_date: string
          tip_amount: number
        }[]
      }
      ts_add_large_party: {
        Args: {
          p_manager_employee_id?: string
          p_revenue: number
          p_tip_sheet_id: string
        }
        Returns: Json
      }
      ts_add_large_party_unguarded: {
        Args: {
          p_manager_employee_id?: string
          p_revenue: number
          p_tip_sheet_id: string
        }
        Returns: Json
      }
      ts_compute: { Args: { p_tip_sheet_id: string }; Returns: Json }
      ts_compute_unguarded: { Args: { p_tip_sheet_id: string }; Returns: Json }
      ts_post: { Args: { p_tip_sheet_id: string }; Returns: Json }
      ts_post_unguarded: { Args: { p_tip_sheet_id: string }; Returns: Json }
      ts_reassign_manager: {
        Args: { p_lpr_id: string; p_manager_employee_id: string }
        Returns: Json
      }
      ts_reassign_manager_unguarded: {
        Args: { p_lpr_id: string; p_manager_employee_id: string }
        Returns: Json
      }
      ts_unpost: { Args: { p_tip_sheet_id: string }; Returns: Json }
      ts_unpost_unguarded: { Args: { p_tip_sheet_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
