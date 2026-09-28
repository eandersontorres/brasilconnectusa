-- ════════════════════════════════════════════════════════════════════════
-- LIMPEZA PRE-LANCAMENTO
-- Apaga TODOS os usuarios menos eanderson.torres@gmail.com + conteudo gerado.
-- Comunidades semeadas (is_official=true) e dados de plataforma sao preservados.
--
-- ⚠️  IRREVERSIVEL. Crie um snapshot em Supabase Dashboard > Database >
--     Backups > Create backup ANTES de rodar a PARTE 2.
--
-- COMO USAR:
--   PARTE 1 (DRY RUN): roda primeiro pra ver o que SERIA apagado.
--   PARTE 2 (DELETE):  copia, descomenta o bloco e roda.
--   PARTE 3 (VERIFY):  roda depois pra conferir os contadores.
-- ════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 1 — DRY RUN: o que SERIA apagado
-- ═══════════════════════════════════════════════════════════════════════
WITH preserved AS (
  SELECT id, email FROM auth.users WHERE lower(email) = lower('eanderson.torres@gmail.com')
)
SELECT
  'auth.users (todos - preservado)' AS o_que,
  (SELECT COUNT(*) FROM auth.users WHERE id NOT IN (SELECT id FROM preserved)) AS qty
UNION ALL SELECT 'bc_profiles',          (SELECT COUNT(*) FROM bc_profiles          WHERE user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_posts',             (SELECT COUNT(*) FROM bc_posts             WHERE author_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_comments',          (SELECT COUNT(*) FROM bc_comments          WHERE author_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_votes',             (SELECT COUNT(*) FROM bc_votes             WHERE user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_community_members', (SELECT COUNT(*) FROM bc_community_members WHERE user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_communities (não-oficial criadas por outros)',
                                          (SELECT COUNT(*) FROM bc_communities      WHERE is_official = false AND created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_businesses (não preservado)',
                                          (SELECT COUNT(*) FROM bc_businesses        WHERE owner_user_id IS NULL OR owner_user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_orders',            (SELECT COUNT(*) FROM bc_orders            WHERE customer_user_id IS NULL OR customer_user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_bolao_members',     (SELECT COUNT(*) FROM bc_bolao_members     WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_notifications',     (SELECT COUNT(*) FROM bc_notifications     WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_push_subscriptions',(SELECT COUNT(*) FROM bc_push_subscriptions WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM preserved))
UNION ALL SELECT 'bc_drip_log',          (SELECT COUNT(*) FROM bc_drip_log)
UNION ALL SELECT 'bc_waitlist',          (SELECT COUNT(*) FROM bc_waitlist)
UNION ALL SELECT 'bc_contact_messages',  (SELECT COUNT(*) FROM bc_contact_messages)
UNION ALL SELECT 'bc_enterprise_leads',  (SELECT COUNT(*) FROM bc_enterprise_leads)
UNION ALL SELECT 'bc_affiliate_clicks',  (SELECT COUNT(*) FROM bc_affiliate_clicks)
UNION ALL SELECT 'bc_interest_waitlist', (SELECT COUNT(*) FROM bc_interest_waitlist)
UNION ALL SELECT '── PRESERVADOS ──',    0
UNION ALL SELECT 'bc_communities oficial (mantidos)',
                                          (SELECT COUNT(*) FROM bc_communities WHERE is_official = true)
UNION ALL SELECT 'bc_sponsors (mantidos)', (SELECT COUNT(*) FROM bc_sponsors)
UNION ALL SELECT 'auth.users preservado (deve ser 1)',
                                          (SELECT COUNT(*) FROM preserved);


-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 2 — DELETE (copia o bloco abaixo, DESCOMENTA e roda)
-- ═══════════════════════════════════════════════════════════════════════
/*
DO $$
DECLARE
  v_preserved_id    UUID;
  v_preserved_email TEXT := 'eanderson.torres@gmail.com';
BEGIN
  SELECT id INTO v_preserved_id FROM auth.users WHERE lower(email) = lower(v_preserved_email);
  IF v_preserved_id IS NULL THEN
    RAISE EXCEPTION 'Email preservado nao encontrado: %', v_preserved_email;
  END IF;
  RAISE NOTICE 'Preservando user_id=%', v_preserved_id;

  -- Posts, comentarios, votos, RSVPs, denuncias
  DELETE FROM bc_votes              WHERE user_id    <> v_preserved_id;
  DELETE FROM bc_event_rsvps        WHERE user_id    <> v_preserved_id;
  DELETE FROM bc_comments           WHERE author_id  <> v_preserved_id;
  DELETE FROM bc_posts              WHERE author_id  <> v_preserved_id;
  DELETE FROM bc_reports            WHERE reporter_id <> v_preserved_id;

  -- Comunidades — memberships, join requests, comunidades nao-oficiais criadas por outros
  DELETE FROM bc_community_join_requests WHERE user_id <> v_preserved_id;
  DELETE FROM bc_community_members       WHERE user_id <> v_preserved_id;
  DELETE FROM bc_communities
    WHERE is_official = false
      AND created_by IS NOT NULL
      AND created_by <> v_preserved_id;

  -- Profile + checklist + notif + push
  DELETE FROM bc_profile_checklist  WHERE user_id <> v_preserved_id;
  DELETE FROM bc_notifications      WHERE user_id IS NULL OR user_id <> v_preserved_id;
  DELETE FROM bc_push_subscriptions WHERE user_id IS NULL OR user_id <> v_preserved_id;

  -- Referrals + bans
  DELETE FROM bc_referral_uses  WHERE referrer_id <> v_preserved_id AND used_by <> v_preserved_id;
  DELETE FROM bc_referral_codes WHERE user_id <> v_preserved_id;
  DELETE FROM bc_banned_users   WHERE user_id <> v_preserved_id;

  -- Bolao
  DELETE FROM bc_bolao_predictions
    WHERE member_id IN (SELECT id FROM bc_bolao_members WHERE user_id IS NULL OR user_id <> v_preserved_id);
  DELETE FROM bc_bolao_members WHERE user_id IS NULL OR user_id <> v_preserved_id;
  DELETE FROM bc_bolao_groups  WHERE lower(admin_email) <> lower(v_preserved_email);

  -- Pedidos restaurante
  DELETE FROM bc_order_items
    WHERE order_id IN (SELECT id FROM bc_orders WHERE customer_user_id IS NULL OR customer_user_id <> v_preserved_id);
  DELETE FROM bc_orders WHERE customer_user_id IS NULL OR customer_user_id <> v_preserved_id;

  -- Negocios (cascade pra reviews/leads/clicks via FK na tabela)
  DELETE FROM bc_businesses
    WHERE (owner_user_id IS NULL OR owner_user_id <> v_preserved_id)
      AND (owner_email IS NULL OR lower(owner_email) <> lower(v_preserved_email));

  -- Logs e dados email-keyed (TODOS — teste)
  DELETE FROM bc_sponsor_events    WHERE TRUE;
  DELETE FROM bc_drip_log          WHERE TRUE;
  DELETE FROM bc_waitlist          WHERE TRUE;
  DELETE FROM bc_contact_messages  WHERE TRUE;
  DELETE FROM bc_enterprise_leads  WHERE TRUE;
  DELETE FROM bc_affiliate_clicks  WHERE TRUE;
  DELETE FROM bc_interest_waitlist WHERE TRUE;
  DELETE FROM bc_geocode_cache     WHERE TRUE;

  -- Profile e auth — POR ULTIMO
  DELETE FROM bc_profiles WHERE user_id <> v_preserved_id;
  DELETE FROM auth.users  WHERE id      <> v_preserved_id;

  RAISE NOTICE 'Cleanup completo. Pronto pra lancamento.';
END $$;
*/


-- ═══════════════════════════════════════════════════════════════════════
-- PARTE 3 — VERIFY (rodar depois do DELETE)
-- ═══════════════════════════════════════════════════════════════════════
SELECT 'auth.users'              AS tabela, COUNT(*) AS restante FROM auth.users
UNION ALL SELECT 'bc_profiles',            COUNT(*) FROM bc_profiles
UNION ALL SELECT 'bc_communities total',   COUNT(*) FROM bc_communities
UNION ALL SELECT 'bc_communities oficial', COUNT(*) FROM bc_communities WHERE is_official = true
UNION ALL SELECT 'bc_community_members',   COUNT(*) FROM bc_community_members
UNION ALL SELECT 'bc_posts',               COUNT(*) FROM bc_posts
UNION ALL SELECT 'bc_comments',            COUNT(*) FROM bc_comments
UNION ALL SELECT 'bc_businesses',          COUNT(*) FROM bc_businesses
UNION ALL SELECT 'bc_orders',              COUNT(*) FROM bc_orders
UNION ALL SELECT 'bc_bolao_members',       COUNT(*) FROM bc_bolao_members
UNION ALL SELECT 'bc_notifications',       COUNT(*) FROM bc_notifications
UNION ALL SELECT 'bc_drip_log',            COUNT(*) FROM bc_drip_log
UNION ALL SELECT 'bc_waitlist',            COUNT(*) FROM bc_waitlist
UNION ALL SELECT 'bc_contact_messages',    COUNT(*) FROM bc_contact_messages
UNION ALL SELECT 'bc_sponsors (preservados)', COUNT(*) FROM bc_sponsors
ORDER BY tabela;
