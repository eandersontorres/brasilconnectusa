-- ═════════════════════════════════════════════════════════════════════════════
-- 09/10/2026 · App AgendaPro (agendapro/) · notificacoes push
-- Tokens Expo dos celulares da profissional. api/agenda/push-token.js grava;
-- api/_lib/agendaPush.js envia (agendamento novo, avaliacao, resumo de amanha,
-- aviso de cobranca) e desativa o token quando a Expo responde DeviceNotRegistered.
-- APLICADO em producao em 09/10/2026 (migration ag_app_push). Idempotente. Aplicar depois de ag_app_base.sql.
-- ═════════════════════════════════════════════════════════════════════════════

-- ag_push_tokens — um celular por linha (o mesmo token troca de dona se outra conta entrar no aparelho)
CREATE TABLE IF NOT EXISTS public.ag_push_tokens (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   uuid NOT NULL REFERENCES public.ag_providers(id) ON DELETE CASCADE,
  user_id       uuid,                                  -- auth.users.id de quem registrou (sem FK: o login pode ser apagado antes)
  token         text NOT NULL UNIQUE,                  -- 'ExponentPushToken[...]'
  platform      text,                                  -- 'ios' | 'android'
  device_name   text,                                  -- 'iPhone da Ana'
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),    -- atualizado a cada abertura do app
  disabled_at   timestamptz                            -- app desinstalado / notificacoes desligadas no aparelho
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_provider ON public.ag_push_tokens(provider_id) WHERE disabled_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ag_push_tokens_platform_check') THEN
    ALTER TABLE public.ag_push_tokens
      ADD CONSTRAINT ag_push_tokens_platform_check CHECK (platform IS NULL OR platform IN ('ios', 'android'));
  END IF;
END $$;

-- Mesmo modelo das outras ag_*: RLS ligado e sem policy, so a service key (APIs) acessa
ALTER TABLE public.ag_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ag_push_tokens FROM anon, authenticated;
