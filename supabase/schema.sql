-- Run in Supabase SQL editor.

create table if not exists outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists outlet_services (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists outlet_roles (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id) on delete cascade,
  position_name text not null,
  points numeric not null default 1,
  created_at timestamptz default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department text,
  position text,
  phone text,
  email text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  shift_type text,            -- am | pm | all_day
  department text,
  position text,
  outlet_id uuid references outlets(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

create table if not exists tip_sheets (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete set null,
  service_name text,
  department text,
  outlet_id uuid references outlets(id) on delete set null,
  sheet_date date not null,
  service_charge numeric default 0,
  non_cash_tips numeric default 0,
  status text default 'pending', -- pending | approved
  created_at timestamptz default now(),
  approved_at timestamptz
);

create table if not exists tip_event_managers (
  id uuid primary key default gen_random_uuid(),
  tip_sheet_id uuid references tip_sheets(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  commission_pct numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists tip_allocations (
  id uuid primary key default gen_random_uuid(),
  tip_sheet_id uuid references tip_sheets(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  role text,
  hours numeric default 0,
  points numeric default 1,
  service_charge_amount numeric default 0,
  non_cash_amount numeric default 0,
  total_amount numeric default 0,
  created_at timestamptz default now()
);

create table if not exists setup (
  id uuid primary key default gen_random_uuid(),
  pay_cycle text not null default 'weekly', -- weekly | biweekly
  period_start_day text not null default 'monday', -- monday..sunday
  updated_at timestamptz default now()
);

create table if not exists payroll_periods (
  id uuid primary key default gen_random_uuid(),
  name text,
  start_date date not null,
  end_date date not null,
  pay_date date,
  active boolean default true,
  created_at timestamptz default now()
);
