-- Workaround for Supabase auth.admin.listUsers() returning 500s on this project.
-- Provides SECURITY DEFINER access to auth.users for service_role only.

CREATE OR REPLACE FUNCTION public.list_platform_users()
RETURNS TABLE(id uuid, email text, last_sign_in_at timestamptz, created_at timestamptz)
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE sql
AS $$
  SELECT u.id, u.email::text, u.last_sign_in_at, u.created_at
  FROM auth.users u
  ORDER BY u.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.count_platform_users()
RETURNS bigint
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE sql
AS $$
  SELECT count(*) FROM auth.users;
$$;

-- Lock down: only service_role can execute (anon/authenticated cannot enumerate platform users)
REVOKE ALL ON FUNCTION public.list_platform_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_platform_users() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_users() TO service_role;

REVOKE ALL ON FUNCTION public.count_platform_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_platform_users() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_platform_users() TO service_role;
