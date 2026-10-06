-- 纸页书架：数据库 + RLS + 图片存储
-- 在 Supabase SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

create table if not exists public.novels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  slug text not null unique,
  description text not null default '',
  cover_url text,
  status text not null default '连载中',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  novel_id uuid not null references public.novels(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  order_index integer not null default 1 check (order_index >= 0),
  content_md text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chapters_novel_order_idx on public.chapters(novel_id, order_index);
create index if not exists novels_owner_idx on public.novels(owner_id);
create index if not exists chapters_owner_idx on public.chapters(owner_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists novels_touch_updated_at on public.novels;
create trigger novels_touch_updated_at
before update on public.novels
for each row execute function public.touch_updated_at();

drop trigger if exists chapters_touch_updated_at on public.chapters;
create trigger chapters_touch_updated_at
before update on public.chapters
for each row execute function public.touch_updated_at();

alter table public.novels enable row level security;
alter table public.chapters enable row level security;

-- 访客只能读公开作品；作者能读自己的全部作品。
drop policy if exists "read visible novels" on public.novels;
create policy "read visible novels"
on public.novels for select
to anon, authenticated
using (is_public = true or owner_id = auth.uid());

-- 只有当前登录用户能建立、修改、删除属于自己的作品。
drop policy if exists "insert own novels" on public.novels;
create policy "insert own novels"
on public.novels for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "update own novels" on public.novels;
create policy "update own novels"
on public.novels for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "delete own novels" on public.novels;
create policy "delete own novels"
on public.novels for delete
to authenticated
using (owner_id = auth.uid());

-- 章节：访客只读“章节公开 + 所属作品公开”；作者可读自己全部章节。
drop policy if exists "read visible chapters" on public.chapters;
create policy "read visible chapters"
on public.chapters for select
to anon, authenticated
using (
  owner_id = auth.uid()
  or (
    is_public = true
    and exists (
      select 1 from public.novels n
      where n.id = chapters.novel_id and n.is_public = true
    )
  )
);

-- 写章节时同时校验章节属于自己的作品，避免把章节挂到别人的作品上。
drop policy if exists "insert own chapters" on public.chapters;
create policy "insert own chapters"
on public.chapters for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.novels n
    where n.id = chapters.novel_id and n.owner_id = auth.uid()
  )
);

drop policy if exists "update own chapters" on public.chapters;
create policy "update own chapters"
on public.chapters for update
to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.novels n
    where n.id = chapters.novel_id and n.owner_id = auth.uid()
  )
);

drop policy if exists "delete own chapters" on public.chapters;
create policy "delete own chapters"
on public.chapters for delete
to authenticated
using (owner_id = auth.uid());

-- Data API 权限；真正能访问哪一行仍由 RLS 控制。
grant usage on schema public to anon, authenticated;
grant select on public.novels, public.chapters to anon;
grant select, insert, update, delete on public.novels, public.chapters to authenticated;

-- 图片存储桶。它是 public：插入正文的图片可被访客直接加载。
insert into storage.buckets (id, name, public)
values ('novel-images', 'novel-images', true)
on conflict (id) do update set public = excluded.public;

-- 公开 bucket 的对象可公开读取。
drop policy if exists "public read novel images" on storage.objects;
create policy "public read novel images"
on storage.objects for select
to public
using (bucket_id = 'novel-images');

-- 登录用户只允许把文件上传到以自己 user id 为第一层目录的路径。
drop policy if exists "upload own novel images" on storage.objects;
create policy "upload own novel images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'novel-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "update own novel images" on storage.objects;
create policy "update own novel images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'novel-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'novel-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "delete own novel images" on storage.objects;
create policy "delete own novel images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'novel-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
