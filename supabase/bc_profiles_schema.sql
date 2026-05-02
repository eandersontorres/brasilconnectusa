-- ═══════════════════════════════════════════════════════════════
-- BrasilConnect — Perfis com camadas de privacidade
-- 4 níveis: public, community, group, private
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS bc_profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE,                -- liga ao auth.users do Supabase quando ativar Auth
  email           TEXT UNIQUE NOT NULL,
  full_name       TEXT,
  display_name    TEXT,                       -- como aparecer nos grupos (ex: "Anderson T.")
  avatar_url      TEXT,
  avatar_color    TEXT DEFAULT '#0F5132',     -- cor do avatar gerado por iniciais
  bio             TEXT,
  city            TEXT,
  state           TEXT,
  whatsapp        TEXT,
  instagram       TEXT,
  role            TEXT DEFAULT 'member',      -- 'member', 'provider', 'admin'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bc_privacy_settings (
  user_id         UUID PRIMARY KEY,
  -- Cada campo tem um nível: 'public', 'community', 'group', 'private'
  settings        JSONB NOT NULL DEFAULT '{
    "full_name": "community",
    "city":      "community",
    "state":     "public",
    "bio":       "community",
    "whatsapp":  "group",
    "instagram": "group",
    "interests": "community",
    "groups":    "private"
  }'::jsonb,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bc_notification_prefs (
  user_id           UUID PRIMARY KEY,
  email_drip        BOOLEAN DEFAULT TRUE,
  email_events      BOOLEAN DEFAULT TRUE,
  email_messages    BOOLEAN DEFAULT TRUE,
  push_enabled      BOOLEAN DEFAULT FALSE,
  push_new_apt      BOOLEAN DEFAULT TRUE,
  push_reminder     BOOLEAN DEFAULT TRUE,
  push_review       BOOLEAN DEFAULT TRUE,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bc_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_privacy_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_notification_prefs  ENABLE ROW LEVEL SECURITY;

-- Função: retorna campos visíveis pra um viewer baseado em privacy_settings
CREATE OR REPLACE FUNCTION get_public_profile(p_email TEXT, p_viewer_role TEXT DEFAULT 'public')
RETURNS JSONB AS $$
DECLARE
  v_profile RECORD;
  v_settings JSONB;
  v_result JSONB := '{}'::jsonb;
BEGIN
  SELECT * INTO v_profile FROM bc_profiles WHERE email = p_email;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT settings INTO v_settings FROM bc_privacy_settings WHERE user_id = v_profile.id;
  IF v_settings IS NULL THEN
    v_settings := '{"full_name":"community","city":"community","state":"public","bio":"community","whatsapp":"group","instagram":"group"}'::jsonb;
  END IF;

  -- Sempre inclui display_name e avatar
  v_result := jsonb_build_object(
    'display_name', COALESCE(v_profile.display_name, v_profile.full_name),
    'avatar_url',   v_profile.avatar_url,
    'avatar_color', v_profile.avatar_color
  );

  -- Para cada campo, verifica se viewer tem acesso
  IF visible(v_settings->>'full_name', p_viewer_role) THEN v_result := v_result || jsonb_build_object('full_name', v_profile.full_name); END IF;
  IF visible(v_settings->>'city',      p_viewer_role) THEN v_result := v_result || jsonb_build_object('city',      v_profile.city); END IF;
  IF visible(v_settings->>'state',     p_viewer_role) THEN v_result := v_result || jsonb_build_object('state',     v_profile.state); END IF;
  IF visible(v_settings->>'bio',       p_viewer_role) THEN v_result := v_result || jsonb_build_object('bio',       v_profile.bio); END IF;
  IF visible(v_settings->>'whatsapp',  p_viewer_role) THEN v_result := v_result || jsonb_build_object('whatsapp',  v_profile.whatsapp); END IF;
  IF visible(v_settings->>'instagram', p_viewer_role) THEN v_result := v_result || jsonb_build_object('instagram', v_profile.instagram); END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Função auxiliar
CREATE OR REPLACE FUNCTION visible(setting TEXT, viewer TEXT) RETURNS BOOLEAN AS $$
BEGIN
  IF setting = 'public'    THEN RETURN TRUE; END IF;
  IF setting = 'community' THEN RETURN viewer IN ('community', 'group', 'self'); END IF;
  IF setting = 'group'     THEN RETURN viewer IN ('group', 'self'); END IF;
  IF setting = 'private'   THEN RETURN viewer = 'self'; END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
