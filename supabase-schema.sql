-- הרצה חד-פעמית ב-Supabase: Project -> SQL Editor -> New query -> הדביקו והריצו

-- טבלת רכבים - שורה אחת למשתמש (MVP: רכב אחד לכל חשבון)
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plate_number text,
  manufacturer text,
  model text,
  year int,
  color text,
  fuel_type text,
  current_km int default 0,
  vin text,
  photo text,
  service_book_images jsonb default '[]'::jsonb,
  maintenance_intervals jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- טבלת רשומות טיפול - כמה שורות שרוצים למשתמש
create table if not exists maintenance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date,
  km int,
  part text,
  price numeric,
  provider text,
  sku text,
  receipt_image text,
  created_at timestamptz default now()
);

-- אבטחה ברמת שורה - כל משתמש רואה ונוגע רק בנתונים שלו
alter table vehicles enable row level security;
alter table maintenance_records enable row level security;

create policy "vehicles: owner full access"
  on vehicles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "records: owner full access"
  on maintenance_records for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
